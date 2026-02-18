import type { PlannerState, Task, Tag } from './db'
import { searchWeb, isSearchEnabled } from './search'
import {
  chatWithEmbeddedRuntime,
  getEmbeddedRuntimeStatus,
  hasEmbeddedAssets,
  initEmbeddedRuntime,
  type EmbeddedRuntimeStatus
} from './ai-runtime'

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434/api/chat'
const MODEL      = process.env.OLLAMA_MODEL ?? 'llama3:8b-instruct-q4_K_M'

export type OllamaStatus = {
  url: string
  model: string
  reachable: boolean
  modelInstalled: boolean
  error?: string
}

export type AiStatus = {
  provider: 'embedded' | 'ollama' | 'none'
  reachable: boolean
  message: string
  embedded?: EmbeddedRuntimeStatus
  ollama?: OllamaStatus
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type OptimizeResult = {
  tasks: Task[]
  summary: string
}

// ─── Plan formatter ───────────────────────────────────────────────
const buildPlanSummary = (state: PlannerState): string => {
  const tagMap = new Map<string, Tag>(state.tags.map((t) => [t.id, t]))

  if (state.tasks.length === 0) return 'The day plan is currently empty.'

  const lines = [...state.tasks]
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((task) => {
      const tag       = task.tagId ? tagMap.get(task.tagId) : undefined
      const category  = tag ? tag.name : 'Uncategorized'
      const status    = task.fixed ? 'FIXED' : 'flexible'
      const duration  = durationLabel(task.startTime, task.endTime)
      const notes     = task.notes ? ` | Notes: ${task.notes}` : ''
      return `  • [${task.startTime}–${task.endTime}] (${duration}) ${task.title} — ${category} — ${status}${notes}`
    })
    .join('\n')

  return `Day plan (${state.tasks.length} tasks):\n${lines}`
}

const durationLabel = (start: string, end: string): string => {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = eh * 60 + em - (sh * 60 + sm)
  if (mins <= 0)  return '?'
  if (mins < 60)  return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// ─── Extract JSON even if the model adds surrounding text ─────────
const extractJson = (text: string): string => {
  // Try to find the outermost { ... } block
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start !== -1 && end > start) return text.slice(start, end + 1)
  return text
}

// ─── Ollama HTTP call ─────────────────────────────────────────────
const callOllama = async (messages: ChatMessage[]): Promise<string> => {
  const response = await fetch(OLLAMA_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model: MODEL, messages, stream: false })
  })

  if (!response.ok) throw new Error(`Ollama responded with ${response.status}`)

  const data = (await response.json()) as { message?: { content?: string } }
  return data.message?.content?.trim() ?? ''
}

const callAvailableProvider = async (messages: ChatMessage[]): Promise<string> => {
  if (hasEmbeddedAssets()) {
    try {
      const embedded = await initEmbeddedRuntime()
      if (embedded.reachable) {
        return chatWithEmbeddedRuntime(messages)
      }
    } catch {
      // fallback to ollama path below
    }
  }

  return callOllama(messages)
}

export const getOllamaStatus = async (): Promise<OllamaStatus> => {
  try {
    const base = new URL(OLLAMA_URL)
    const tagsUrl = `${base.origin}/api/tags`
    const response = await fetch(tagsUrl)
    if (!response.ok) {
      return {
        url: OLLAMA_URL,
        model: MODEL,
        reachable: false,
        modelInstalled: false,
        error: `Ollama responded with ${response.status}`
      }
    }

    const data = (await response.json()) as { models?: Array<{ name?: string; model?: string }> }
    const installed = (data.models ?? []).some((item) => item.name === MODEL || item.model === MODEL)

    return {
      url: OLLAMA_URL,
      model: MODEL,
      reachable: true,
      modelInstalled: installed
    }
  } catch (error) {
    return {
      url: OLLAMA_URL,
      model: MODEL,
      reachable: false,
      modelInstalled: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export const getAiStatus = async (): Promise<AiStatus> => {
  let embedded: EmbeddedRuntimeStatus | undefined
  if (hasEmbeddedAssets()) {
    try {
      embedded = await initEmbeddedRuntime()
      if (embedded.reachable) {
        return {
          provider: 'embedded',
          reachable: true,
          message: 'Embedded AI runtime is active.',
          embedded
        }
      }
    } catch {
      embedded = await getEmbeddedRuntimeStatus()
    }
  }

  const ollama = await getOllamaStatus()
  if (ollama.reachable && ollama.modelInstalled) {
    return {
      provider: 'ollama',
      reachable: true,
      message: 'Using local Ollama model.',
      embedded,
      ollama
    }
  }

  return {
    provider: 'none',
    reachable: false,
    message: embedded?.error
      ? `Embedded AI unavailable: ${embedded.error}`
      : ollama.reachable
        ? `Ollama reachable but model ${ollama.model} is missing.`
        : 'No local AI provider is currently available.',
    embedded,
    ollama
  }
}

// ─── Chat ─────────────────────────────────────────────────────────
export const chatWithPlanner = async (prompt: string, state: PlannerState): Promise<string> => {
  const system: ChatMessage = {
    role: 'system',
    content: [
      'You are an expert personal planning assistant embedded in a day-planner app.',
      'You help the user review, adjust, and improve their daily schedule.',
      'Be concise and practical. Avoid fluff. When giving time recommendations, be specific.',
      'Do not mention markdown formatting — reply in plain text.',
      isSearchEnabled()
        ? 'You have access to web search results when provided.'
        : 'You have no internet access. Base advice solely on the provided plan.'
    ].join(' ')
  }

  const plan = buildPlanSummary(state)

  let webContext = ''
  if (isSearchEnabled()) {
    try {
      const results = await searchWeb(prompt)
      if (results.length > 0) {
        const snippets = results
          .map((r, i) => `[${i + 1}] ${r.title}: ${r.snippet}`)
          .join('\n')
        webContext = `\n\nWeb search results for context:\n${snippets}`
      }
    } catch {
      // Web search failed — continue without it
    }
  }

  const user: ChatMessage = {
    role: 'user',
    content: `${plan}\n\nUser question: ${prompt}${webContext}`
  }

  return callAvailableProvider([system, user])
}

// ─── Fallback optimization (no Ollama) ───────────────────────────
const fallbackOptimize = (state: PlannerState): OptimizeResult => {
  const fixed    = state.tasks.filter((t) => t.fixed)
  const flexible = state.tasks.filter((t) => !t.fixed)

  // Sort flexible tasks by their current start time
  const sortedFlex = [...flexible].sort((a, b) => a.startTime.localeCompare(b.startTime))

  // Collect occupied time windows from fixed tasks
  const occupied = fixed.map((t) => ({
    start: toMins(t.startTime),
    end:   toMins(t.endTime)
  }))

  const placed: Task[] = []
  let cursor = 7 * 60 // start placing from 7 AM

  for (const task of sortedFlex) {
    const duration = toMins(task.endTime) - toMins(task.startTime)
    if (duration <= 0) { placed.push(task); continue }

    // Find next free slot of sufficient length
    let slotStart = cursor
    let found = false

    for (let attempt = 0; attempt < 24 * 4; attempt++) { // max 24h × 4 (15-min steps)
      const slotEnd = slotStart + duration
      const conflicts = occupied.some((w) => slotStart < w.end && slotEnd > w.start)
      if (!conflicts && slotEnd <= 23 * 60) {
        placed.push({ ...task, startTime: fromMins(slotStart), endTime: fromMins(slotEnd) })
        occupied.push({ start: slotStart, end: slotEnd })
        cursor = slotEnd
        found = true
        break
      }
      slotStart += 15
    }

    if (!found) placed.push(task) // couldn't place — keep original
  }

  const all = [...fixed, ...placed].sort((a, b) => a.startTime.localeCompare(b.startTime))

  return {
    tasks:   all,
    summary: 'Flexible tasks were rearranged to minimize gaps and avoid conflicts with fixed commitments.'
  }
}

const toMins   = (t: string): number => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const fromMins = (m: number): string  => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

// ─── AI-powered optimization ──────────────────────────────────────
export const optimizePlanWithOllama = async (state: PlannerState): Promise<OptimizeResult> => {
  const system: ChatMessage = {
    role: 'system',
    content: [
      'You are a scheduling optimizer. Your job is to return a JSON object — nothing else.',
      'Schema: { "summary": "<one sentence describing what changed>", "tasks": [ { "id": "<task id>", "startTime": "HH:MM", "endTime": "HH:MM" }, ... ] }',
      'Rules:',
      '1. NEVER change tasks marked as FIXED.',
      '2. Only adjust flexible tasks.',
      '3. Minimize context switching by grouping similar categories together.',
      '4. Avoid scheduling tasks before 07:00 or after 22:00.',
      '5. Ensure no two tasks overlap.',
      '6. Preserve task durations (do not make tasks shorter or longer).',
      '7. Return valid JSON only. No markdown, no explanation outside the JSON.'
    ].join(' ')
  }

  const plan = buildPlanSummary(state)

  const user: ChatMessage = {
    role: 'user',
    content: `${plan}\n\nOptimize the schedule for this day. Return JSON only.`
  }

  try {
    const raw    = await callAvailableProvider([system, user])
    const json   = extractJson(raw)
    const parsed = JSON.parse(json) as {
      summary: string
      tasks: Array<{ id: string; startTime: string; endTime: string }>
    }

    if (!Array.isArray(parsed.tasks) || typeof parsed.summary !== 'string') {
      throw new Error('Invalid response shape')
    }

    const tasks = state.tasks.map((task) => {
      if (task.fixed) return task
      const update = parsed.tasks.find((p) => p.id === task.id)
      if (!update) return task
      // Validate times before applying
      if (!/^\d{2}:\d{2}$/.test(update.startTime) || !/^\d{2}:\d{2}$/.test(update.endTime)) return task
      return { ...task, startTime: update.startTime, endTime: update.endTime }
    })

    return { tasks, summary: parsed.summary }
  } catch {
    // Graceful fallback to local optimizer
    return fallbackOptimize(state)
  }
}
