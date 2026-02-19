import React, { useEffect, useMemo, useRef, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────
type Tag = { id: string; name: string; color: string }

type Task = {
  id: string
  title: string
  taskDate: string
  startTime: string
  endTime: string
  tagId: string | null
  notes: string
  fixed: boolean
  done: boolean
}

type DbTask = Omit<Task, 'fixed' | 'done'> & { fixed: number; done: number }
type DbState = { tags: Tag[]; tasks: DbTask[] }
type ViewMode = 'day' | 'week' | 'month'

type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string }
type AiStatus = {
  provider: 'embedded' | 'ollama' | 'none'
  reachable: boolean
  message: string
  ollama?: {
    url: string
    model: string
    reachable: boolean
    modelInstalled: boolean
  }
}

type OptimizationPreview = { tasks: Task[]; summary: string }

type EditState = { task: Task; isNew: boolean }
type DragState = {
  taskId: string
  startClientY: number
  originalStart: number
  duration: number
  moved: boolean
  currentStart: number
}

// ─── Constants ────────────────────────────────────────────────────
const TIMELINE_START = 6   // 6 AM
const TIMELINE_END   = 23  // 11 PM
const BASE_PX_PER_MIN = 1
const DRAG_PX_PER_MIN = 2.2
const DRAG_VISIBLE_WINDOW_MINS = 120
const HOUR_HEIGHT    = 60  // pixels per hour
const HOURS = Array.from({ length: TIMELINE_END - TIMELINE_START }, (_, i) => TIMELINE_START + i)
const QUARTER_MARKS = Array.from(
  { length: (TIMELINE_END - TIMELINE_START) * 4 + 1 },
  (_, i) => TIMELINE_START * 60 + i * 15
)

// ─── Helpers ──────────────────────────────────────────────────────
function timeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function minsToTime(m: number): string {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function taskTop(task: Task, pxPerMin: number): number {
  const start = Math.max(timeToMins(task.startTime), TIMELINE_START * 60)
  return (start - TIMELINE_START * 60) * pxPerMin
}

function taskHeight(task: Task, pxPerMin: number): number {
  const start = Math.max(timeToMins(task.startTime), TIMELINE_START * 60)
  const end   = Math.min(timeToMins(task.endTime),   TIMELINE_END   * 60)
  return Math.max((end - start) * pxPerMin, 26)
}

function getNowTop(pxPerMin: number): number {
  const now = new Date()
  return (now.getHours() * 60 + now.getMinutes() - TIMELINE_START * 60) * pxPerMin
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function formatDate(d: Date): { day: string; full: string } {
  return {
    day:  d.toLocaleDateString('en-US', { weekday: 'long' }),
    full: d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }
}

function minsTo12HourTimeLabel(totalMinutes: number): string {
  const h24 = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(mins).padStart(2, '0')} ${period}`
}

function toIsoDate(date: Date): string {
  const tzOffsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 10)
}

function fromIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addDays(iso: string, delta: number): string {
  const next = fromIsoDate(iso)
  next.setDate(next.getDate() + delta)
  return toIsoDate(next)
}

function startOfWeekIso(iso: string): string {
  const date = fromIsoDate(iso)
  const day = date.getDay() === 0 ? 7 : date.getDay()
  date.setDate(date.getDate() - (day - 1))
  return toIsoDate(date)
}

function endOfWeekIso(iso: string): string {
  return addDays(startOfWeekIso(iso), 6)
}

function startOfMonthIso(iso: string): string {
  const date = fromIsoDate(iso)
  date.setDate(1)
  return toIsoDate(date)
}

function endOfMonthIso(iso: string): string {
  const date = fromIsoDate(iso)
  date.setMonth(date.getMonth() + 1, 0)
  return toIsoDate(date)
}

function isIsoBetween(target: string, start: string, end: string): boolean {
  return target >= start && target <= end
}

function shiftDateByView(iso: string, mode: ViewMode, direction: -1 | 1): string {
  if (mode === 'day') return addDays(iso, direction)
  if (mode === 'week') return addDays(iso, direction * 7)

  const date = fromIsoDate(iso)
  date.setMonth(date.getMonth() + direction)
  return toIsoDate(date)
}

/**
 * Compute non-overlapping columns for task blocks.
 * Returns a Map of taskId -> { col, totalCols }.
 */
function computeColumns(tasks: Task[]): Map<string, { col: number; totalCols: number }> {
  const result = new Map<string, { col: number; totalCols: number }>()
  const sorted = [...tasks].sort((a, b) => a.startTime.localeCompare(b.startTime))

  // Build groups of overlapping tasks
  const groups: Task[][] = []
  for (const task of sorted) {
    let merged = false
    for (const group of groups) {
      const groupEnd = Math.max(...group.map((t) => timeToMins(t.endTime)))
      if (timeToMins(task.startTime) < groupEnd) {
        group.push(task)
        merged = true
        break
      }
    }
    if (!merged) groups.push([task])
  }

  for (const group of groups) {
    // Assign columns within each group (greedy)
    const cols: Task[][] = []
    for (const task of group) {
      let placed = false
      for (let c = 0; c < cols.length; c++) {
        const last = cols[c][cols[c].length - 1]
        if (timeToMins(task.startTime) >= timeToMins(last.endTime)) {
          cols[c].push(task)
          placed = true
          break
        }
      }
      if (!placed) cols.push([task])
    }
    cols.forEach((col, ci) => {
      col.forEach((task) => result.set(task.id, { col: ci, totalCols: cols.length }))
    })
  }
  return result
}

// ─── State helpers ────────────────────────────────────────────────
const normalizeState = (s: DbState): { tags: Tag[]; tasks: Task[] } => ({
  tags:  s.tags,
  tasks: s.tasks.map((t) => ({ ...t, fixed: Boolean(t.fixed), done: Boolean((t as DbTask & { done?: number }).done ?? 0) }))
})

const toDbState = (tags: Tag[], tasks: Task[]): DbState => ({
  tags,
  tasks: tasks.map((t) => ({ ...t, fixed: t.fixed ? 1 : 0, done: t.done ? 1 : 0 }))
})

// ─── EditModal component ──────────────────────────────────────────
type EditModalProps = {
  editState: EditState
  tags: Tag[]
  onSave: (task: Task) => void
  onDelete: () => void
  onClose: () => void
}

const EditModal = ({ editState, tags, onSave, onDelete, onClose }: EditModalProps): JSX.Element => {
  const [draft, setDraft] = useState<Task>(editState.task)
  const up = (key: keyof Task, value: unknown): void =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleSave = (): void => {
    if (!draft.title.trim()) return
    onSave(draft)
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{editState.isNew ? 'New task' : 'Edit task'}</span>
          <button className="chat-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {/* Title */}
          <div>
            <label>Title</label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => up('title', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="What are you doing?"
              autoFocus
            />
          </div>

          {/* Times */}
          <div className="form-row">
            <div>
              <label>Start time</label>
              <input type="time" value={draft.startTime} onChange={(e) => up('startTime', e.target.value)} />
            </div>
            <div>
              <label>End time</label>
              <input type="time" value={draft.endTime} onChange={(e) => up('endTime', e.target.value)} />
            </div>
          </div>

          {/* Category */}
          <div>
            <label>Category</label>
            <select value={draft.tagId ?? ''} onChange={(e) => up('tagId', e.target.value || null)}>
              <option value="">No category</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label>Notes</label>
            <textarea
              value={draft.notes}
              onChange={(e) => up('notes', e.target.value)}
              placeholder="Optional notes…"
            />
          </div>

          {/* Done toggle */}
          <div className="toggle-row">
            <div className="toggle-label">
              <span>Mark as done</span>
              <small>Strikes through the task on the timeline</small>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={draft.done}
                onChange={(e) => up('done', e.target.checked)}
              />
              <span className="toggle-track" />
            </label>
          </div>

          {/* Fixed toggle */}
          <div className="toggle-row">
            <div className="toggle-label">
              <span>Fixed time</span>
              <small>AI will not reschedule this task</small>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={draft.fixed}
                onChange={(e) => up('fixed', e.target.checked)}
              />
              <span className="toggle-track" />
            </label>
          </div>
        </div>

        <div className="modal-footer">
          {!editState.isNew && (
            <button className="btn btn-danger btn-sm" onClick={onDelete}>Delete task</button>
          )}
          <div className="modal-footer-right">
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-accent btn-sm" onClick={handleSave} disabled={!draft.title.trim()}>
              {editState.isNew ? 'Create task' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────
const App = (): JSX.Element => {
  const [tags,  setTags]  = useState<Tag[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loaded, setLoaded] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)

  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const [selectedDate, setSelectedDate] = useState<string>(toIsoDate(new Date()))

  const [newTagName,  setNewTagName]  = useState('')
  const [newTagColor, setNewTagColor] = useState('#6c63ff')

  const [editState, setEditState] = useState<EditState | null>(null)

  const [chatOpen,  setChatOpen]  = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [messages,  setMessages]  = useState<ChatMessage[]>([])
  const [aiTyping,  setAiTyping]  = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null)

  const [optimization, setOptimization] = useState<OptimizationPreview | null>(null)
  const [optimizing,   setOptimizing]   = useState(false)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [dragPreviewMins, setDragPreviewMins] = useState<number | null>(null)

  const [nowTop, setNowTop] = useState(getNowTop(BASE_PX_PER_MIN))

  const chatEndRef     = useRef<HTMLDivElement>(null)
  const timelineRef    = useRef<HTMLDivElement>(null)
  const dragStateRef   = useRef<DragState | null>(null)
  const suppressTimelineClickRef = useRef(false)
  const todayIso = useMemo(() => toIsoDate(new Date()), [])
  const minDateIso = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 3)
    return toIsoDate(d)
  }, [])
  const dateLabel = useMemo(() => formatDate(fromIsoDate(selectedDate)), [selectedDate])
  const effectivePxPerMin = draggingTaskId ? DRAG_PX_PER_MIN : BASE_PX_PER_MIN
  const effectiveHourHeight = 60 * effectivePxPerMin
  const totalHeight = (TIMELINE_END - TIMELINE_START) * 60 * effectivePxPerMin

  // ── Load state ─────────────────────────────────────────────────
  useEffect(() => {
    if (!window.planner) {
      setStartupError('Planner bridge failed to initialize. Please restart the application.')
      return
    }
    window.planner
      .getState()
      .then((state) => {
        const n = normalizeState(state)
        setTags(n.tags)
        setTasks(n.tasks)
        setLoaded(true)
        return Promise.all([window.planner.getCapabilities(), window.planner.getAiStatus()])
      })
      .then(([caps, ai]) => {
        setWebSearch(caps.webSearch)
        setAiStatus(ai)
        setMessages([{
          id: crypto.randomUUID(),
          role: 'assistant',
          content: ai.provider === 'none'
            ? `✦ ${ai.message}`
            : ai.provider === 'ollama' && ai.ollama && !ai.ollama.modelInstalled
              ? `✦ Ollama is running, but model ${ai.ollama.model} is missing. Run: ollama pull ${ai.ollama.model}`
              : caps.webSearch
                ? '✦ Hi! I can help optimize your schedule or research topics using web results.'
                : ai.provider === 'embedded'
                  ? '✦ Hi! Embedded AI is active. I can help plan your day fully offline.'
                  : '✦ Hi! I can help you plan your day. (Ollama only — no internet)'
        }])
      })
      .catch(() => setStartupError('Could not load planner data. Please restart the application.'))
  }, [])

  // ── Auto-save ──────────────────────────────────────────────────
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => window.planner.saveState(toDbState(tags, tasks)), 500)
    return () => clearTimeout(t)
  }, [tags, tasks, loaded])

  // ── Now-line ticker ────────────────────────────────────────────
  useEffect(() => {
    setNowTop(getNowTop(effectivePxPerMin))
    const tick = setInterval(() => setNowTop(getNowTop(effectivePxPerMin)), 60_000)
    return () => clearInterval(tick)
  }, [effectivePxPerMin])

  // ── Scroll chat to bottom ──────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, aiTyping])

  // ── Keep drag target visible while zoomed ──────────────────────
  useEffect(() => {
    if (!draggingTaskId || dragPreviewMins === null || !timelineRef.current) return

    const targetTop = (dragPreviewMins - TIMELINE_START * 60) * effectivePxPerMin
    const wrapper = timelineRef.current
    const visibleTop = wrapper.scrollTop
    const visibleBottom = wrapper.scrollTop + wrapper.clientHeight

    if (targetTop < visibleTop + 90 || targetTop > visibleBottom - 90) {
      wrapper.scrollTo({ top: Math.max(0, targetTop - wrapper.clientHeight / 2), behavior: 'smooth' })
    }
  }, [draggingTaskId, dragPreviewMins, effectivePxPerMin])

  // ── Keyboard shortcuts ─────────────────────────────────────────
  // Escape — close any open modal
  // Ctrl+N  — open new task at current time (or 09:00 if before timeline)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setEditState(null)
        setOptimization(null)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        // Don't hijack Ctrl+N when typing inside an input or textarea
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        openNewTask()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags, tagFilter])

  // ── Derived ────────────────────────────────────────────────────
  const rangeStartIso = useMemo(() => {
    if (viewMode === 'day') return selectedDate
    if (viewMode === 'week') return startOfWeekIso(selectedDate)
    return startOfMonthIso(selectedDate)
  }, [viewMode, selectedDate])

  const rangeEndIso = useMemo(() => {
    if (viewMode === 'day') return selectedDate
    if (viewMode === 'week') return endOfWeekIso(selectedDate)
    return endOfMonthIso(selectedDate)
  }, [viewMode, selectedDate])

  const rangeTasks = useMemo(
    () => tasks.filter((task) => isIsoBetween(task.taskDate, rangeStartIso, rangeEndIso)),
    [tasks, rangeStartIso, rangeEndIso]
  )

  const filteredTasks = useMemo(
    () => (tagFilter ? rangeTasks.filter((t) => t.tagId === tagFilter) : rangeTasks),
    [rangeTasks, tagFilter]
  )

  const dayTimelineTasks = useMemo(
    () => filteredTasks.filter((task) => task.taskDate === selectedDate),
    [filteredTasks, selectedDate]
  )

  const columns = useMemo(() => computeColumns(dayTimelineTasks), [dayTimelineTasks])

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    rangeTasks.forEach((t) => { if (t.tagId) counts[t.tagId] = (counts[t.tagId] ?? 0) + 1 })
    return counts
  }, [rangeTasks])

  // Total minutes planned across all tasks (shown in topbar)
  const totalPlannedMins = useMemo(() =>
    rangeTasks.reduce((sum, t) => {
      const dur = timeToMins(t.endTime) - timeToMins(t.startTime)
      return sum + Math.max(0, dur)
    }, 0),
    [rangeTasks]
  )
  const plannedLabel = (() => {
    const h = Math.floor(totalPlannedMins / 60)
    const m = totalPlannedMins % 60
    if (h === 0) return `${m}m planned`
    if (m === 0) return `${h}h planned`
    return `${h}h ${m}m planned`
  })()

  const nowVisible = nowTop >= 0 && nowTop <= totalHeight

  const weekDays = useMemo(() => {
    const start = startOfWeekIso(selectedDate)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }, [selectedDate])

  const monthDays = useMemo(() => {
    const first = fromIsoDate(startOfMonthIso(selectedDate))
    const end = fromIsoDate(endOfMonthIso(selectedDate))
    const firstWeekDay = first.getDay() === 0 ? 7 : first.getDay()
    const gridStart = new Date(first)
    gridStart.setDate(first.getDate() - (firstWeekDay - 1))

    const days: string[] = []
    while (days.length < 42) {
      days.push(toIsoDate(gridStart))
      gridStart.setDate(gridStart.getDate() + 1)
    }

    return { days, startMonth: toIsoDate(first), endMonth: toIsoDate(end) }
  }, [selectedDate])

  const weekRangeLabel = useMemo(() => {
    const start = fromIsoDate(startOfWeekIso(selectedDate))
    const end = fromIsoDate(endOfWeekIso(selectedDate))
    const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return `${startLabel} - ${endLabel}`
  }, [selectedDate])

  const monthLabel = useMemo(() => {
    const current = fromIsoDate(selectedDate)
    return current.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }, [selectedDate])

  const topbarPrimaryLabel = viewMode === 'day'
    ? dateLabel.day
    : viewMode === 'week'
      ? 'Week Overview'
      : 'Month Overview'

  const topbarSecondaryLabel = viewMode === 'day'
    ? dateLabel.full
    : viewMode === 'week'
      ? weekRangeLabel
      : monthLabel

  const visibleQuarterMarks = useMemo(() => {
    if (!draggingTaskId || dragPreviewMins === null) return []
    return QUARTER_MARKS.filter((mins) =>
      Math.abs(mins - dragPreviewMins) <= DRAG_VISIBLE_WINDOW_MINS
    )
  }, [draggingTaskId, dragPreviewMins])

  // ── Tag handlers ───────────────────────────────────────────────
  const handleAddTag = (): void => {
    if (!newTagName.trim()) return
    setTags((prev) => [...prev, { id: crypto.randomUUID(), name: newTagName.trim(), color: newTagColor }])
    setNewTagName('')
  }

  const handleDeleteTag = (id: string): void => {
    setTags((prev) => prev.filter((t) => t.id !== id))
    setTasks((prev) => prev.map((t) => (t.tagId === id ? { ...t, tagId: null } : t)))
    if (tagFilter === id) setTagFilter(null)
  }

  // ── Task handlers ──────────────────────────────────────────────
  const openNewTask = (startTime?: string): void => {
    const start   = startTime ?? '09:00'
    const startM  = timeToMins(start)
    const endTime = minsToTime(Math.min(startM + 45, TIMELINE_END * 60 - 5))
    setEditState({
      isNew: true,
      task: {
        id: crypto.randomUUID(),
        title: '',
        taskDate: selectedDate,
        startTime: start,
        endTime,
        tagId: tagFilter ?? tags[0]?.id ?? null,
        notes: '',
        fixed: false,
        done: false
      }
    })
  }

  const handleSaveTask = (task: Task): void => {
    if (editState?.isNew) {
      setTasks((prev) => [...prev, task])
    } else {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
    }
    setEditState(null)
  }

  const handleDeleteTask = (): void => {
    if (!editState) return
    setTasks((prev) => prev.filter((t) => t.id !== editState.task.id))
    setEditState(null)
  }

  const handleTaskMouseDown = (e: React.MouseEvent<HTMLDivElement>, task: Task): void => {
    if (e.button !== 0) return

    e.preventDefault()
    e.stopPropagation()

    const originalStart = timeToMins(task.startTime)
    const duration = Math.max(15, timeToMins(task.endTime) - originalStart)

    dragStateRef.current = {
      taskId: task.id,
      startClientY: e.clientY,
      originalStart,
      duration,
      moved: false,
      currentStart: originalStart
    }
    setDraggingTaskId(task.id)
    setDragPreviewMins(Math.round(originalStart / 15) * 15)

    let latestClientY = e.clientY
    let frameRequested = false

    const applyDragFrame = (): void => {
      frameRequested = false
      const drag = dragStateRef.current
      if (!drag || drag.taskId !== task.id) return

      const deltaMinutesRaw = (latestClientY - drag.startClientY) / DRAG_PX_PER_MIN
      drag.moved = drag.moved || Math.abs(latestClientY - drag.startClientY) > 3

      const minStart = TIMELINE_START * 60
      const maxStart = TIMELINE_END * 60 - drag.duration
      const nextStart = Math.max(minStart, Math.min(maxStart, drag.originalStart + deltaMinutesRaw))
      const nextStartSmoothed = Math.round(nextStart / 5) * 5
      const nextEnd = nextStartSmoothed + drag.duration
      drag.currentStart = nextStartSmoothed
      const quarterSnap = Math.round(nextStartSmoothed / 15) * 15
      setDragPreviewMins((prev) => (prev === quarterSnap ? prev : quarterSnap))

      const nextStartTime = minsToTime(nextStartSmoothed)
      const nextEndTime = minsToTime(nextEnd)

      setTasks((prev) => {
        let changed = false
        const updated = prev.map((item) => {
          if (item.id !== drag.taskId) return item
          if (item.startTime === nextStartTime && item.endTime === nextEndTime) return item
          changed = true
          return { ...item, startTime: nextStartTime, endTime: nextEndTime }
        })
        return changed ? updated : prev
      })
    }

    const onMouseMove = (moveEvent: MouseEvent): void => {
      latestClientY = moveEvent.clientY
      if (!frameRequested) {
        frameRequested = true
        window.requestAnimationFrame(applyDragFrame)
      }
    }

    const onMouseUp = (): void => {
      const drag = dragStateRef.current
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      dragStateRef.current = null
      setDraggingTaskId(null)
      setDragPreviewMins(null)

      if (drag?.moved) {
        const snappedStart = Math.round(drag.currentStart / 15) * 15
        const minStart = TIMELINE_START * 60
        const maxStart = TIMELINE_END * 60 - drag.duration
        const finalStart = Math.max(minStart, Math.min(maxStart, snappedStart))
        const finalEnd = finalStart + drag.duration
        const finalStartTime = minsToTime(finalStart)
        const finalEndTime = minsToTime(finalEnd)

        setTasks((prev) =>
          prev.map((item) =>
            item.id === task.id
              ? { ...item, startTime: finalStartTime, endTime: finalEndTime }
              : item
          )
        )

        suppressTimelineClickRef.current = true
        window.setTimeout(() => {
          suppressTimelineClickRef.current = false
        }, 0)
        return
      }

      if (!drag?.moved) {
        setEditState({ task, isNew: false })
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // Click on timeline grid → open new task at snapped time
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (viewMode !== 'day') return

    if (suppressTimelineClickRef.current) {
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const y    = e.clientY - rect.top
    const rawMins  = y / effectivePxPerMin + TIMELINE_START * 60
    const snapped  = Math.round(rawMins / 15) * 15                          // snap to 15 min
    const clamped  = Math.max(TIMELINE_START * 60, Math.min(TIMELINE_END * 60 - 45, snapped))
    openNewTask(minsToTime(clamped))
  }

  // ── Chat handlers ──────────────────────────────────────────────
  const sendChat = async (): Promise<void> => {
    const prompt = chatInput.trim()
    if (!prompt || aiTyping) return
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: prompt }])
    setChatInput('')
    setAiTyping(true)
    try {
      const reply = await window.planner.chat(prompt, toDbState(tags, tasks))
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply || 'No response received. Is Ollama running?'
      }])
    } catch {
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Cannot reach a local AI provider. Ensure embedded assets are bundled or Ollama is running.'
      }])
    } finally {
      setAiTyping(false)
    }
  }

  // ── Optimization handlers ──────────────────────────────────────
  const requestOptimization = async (): Promise<void> => {
    setOptimizing(true)
    try {
      const result = await window.planner.optimize(toDbState(tags, tasks))
      setOptimization({
        tasks:   result.tasks.map((t) => ({ ...t, fixed: Boolean(t.fixed), done: Boolean((t as { done?: number }).done ?? 0) })),
        summary: result.summary
      })
    } catch {
      setOptimization({ tasks, summary: 'Could not reach Ollama. Showing a basic local optimization.' })
    } finally {
      setOptimizing(false)
    }
  }

  const applyOptimization = (): void => {
    if (!optimization) return
    setTasks(optimization.tasks)
    setOptimization(null)
  }

  // ── Scroll timeline to current time ───────────────────────────
  const scrollToNow = (): void => {
    const top = getNowTop()
    if (timelineRef.current) {
      timelineRef.current.scrollTo({ top: Math.max(0, top - 160), behavior: 'smooth' })
    }
  }

  // ── Startup error screen ───────────────────────────────────────
  if (startupError) {
    return (
      <div className="startup-error">
        <div className="startup-error-card">
          <h2>Startup Error</h2>
          <p>{startupError}</p>
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="app-shell">

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="app-logo">
            <div className="app-logo-mark">◈</div>
            <span className="app-logo-name">Planner</span>
          </div>
          <div className="section-label">Categories</div>
        </div>

        <div className="sidebar-body">
          {/* Tag filter list */}
          <div className="tag-list">
            <div
              className={`tag-item${tagFilter === null ? ' active' : ''}`}
              onClick={() => setTagFilter(null)}
            >
              <span className="tag-swatch" style={{ background: 'rgba(255,255,255,0.28)' }} />
              <span className="tag-name">All tasks</span>
              <span className="tag-count">{rangeTasks.length}</span>
            </div>

            {tags.map((tag) => (
              <div
                key={tag.id}
                className={`tag-item${tagFilter === tag.id ? ' active' : ''}`}
                onClick={() => setTagFilter((prev) => (prev === tag.id ? null : tag.id))}
              >
                <span className="tag-swatch" style={{ background: tag.color }} />
                <span className="tag-name">{tag.name}</span>
                <span className="tag-count">{tagCounts[tag.id] ?? 0}</span>
                <button
                  className="tag-delete"
                  onClick={(e) => { e.stopPropagation(); handleDeleteTag(tag.id) }}
                  aria-label={`Delete ${tag.name}`}
                >×</button>
              </div>
            ))}
          </div>

          {/* New category form */}
          <div>
            <div className="section-label">New Category</div>
            <div className="add-tag-form">
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                placeholder="Category name"
              />
              <div className="add-tag-row">
                <input
                  type="color"
                  value={newTagColor}
                  onChange={(e) => setNewTagColor(e.target.value)}
                  aria-label="Category color"
                />
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ flex: 1 }}
                  onClick={handleAddTag}
                  disabled={!newTagName.trim()}
                >
                  Add category
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main Area ────────────────────────────────────────────── */}
      <div className="main-area">

        {/* Top bar */}
        <div className="topbar">
          <div className="topbar-date">
            <div className="topbar-day">{topbarPrimaryLabel}</div>
            <div className="topbar-full">{topbarSecondaryLabel}</div>
          </div>

          <div className="date-nav">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const next = shiftDateByView(selectedDate, viewMode, -1)
                setSelectedDate(next < minDateIso ? minDateIso : next)
              }}
              disabled={selectedDate <= minDateIso}
            >
              ◀
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedDate(todayIso)}>
              Today
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const next = shiftDateByView(selectedDate, viewMode, 1)
                setSelectedDate(next > todayIso ? todayIso : next)
              }}
              disabled={selectedDate >= todayIso}
            >
              ▶
            </button>
          </div>

          <div className="view-switch" role="tablist" aria-label="Planner views">
            {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                className={`view-switch-btn${viewMode === mode ? ' active' : ''}`}
                onClick={() => setViewMode(mode)}
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          <div className="topbar-spacer" />

          <div className="topbar-actions">
            <div className="stat-chip">
              <span className="stat-dot" style={{ background: '#43e97b' }} />
              {rangeTasks.filter((t) => t.fixed).length} fixed
            </div>
            <div className="stat-chip">
              <span className="stat-dot" style={{ background: '#a78bfa' }} />
              {rangeTasks.filter((t) => !t.fixed).length} flexible
            </div>
            {rangeTasks.length > 0 && (
              <div className="stat-chip">
                <span className="stat-dot" style={{ background: '#fbbf24' }} />
                {plannedLabel}
              </div>
            )}

            <button className="btn btn-ghost" onClick={() => openNewTask()}>
              + Add task
            </button>

            <button
              className="btn btn-ghost"
              onClick={scrollToNow}
              title="Jump to current time"
              disabled={viewMode !== 'day'}
            >
              ⊙ Now
            </button>

            <button
              className="btn btn-accent"
              onClick={requestOptimization}
              disabled={optimizing || tasks.length === 0}
            >
              {optimizing
                ? <><span className="spinner" /> Optimizing…</>
                : '✦ Optimize day'
              }
            </button>
          </div>
        </div>

        {viewMode === 'day' && (
          <div className={`timeline-wrapper${draggingTaskId ? ' is-zoomed' : ''}`} ref={timelineRef}>
            <div className="timeline-inner">

              {/* Hour labels */}
              <div className="timeline-labels" style={{ height: totalHeight }}>
                {!draggingTaskId && HOURS.map((h) => (
                  <div
                    key={h}
                    className="timeline-hour-label"
                    style={{ top: (h - TIMELINE_START) * effectiveHourHeight }}
                  >
                    {h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`}
                  </div>
                ))}

                {draggingTaskId && visibleQuarterMarks.map((mins) => (
                  <div
                    key={mins}
                    className="timeline-quarter-label"
                    style={{ top: (mins - TIMELINE_START * 60) * effectivePxPerMin }}
                  >
                    {minsTo12HourTimeLabel(mins)}
                  </div>
                ))}

                {draggingTaskId && dragPreviewMins !== null && (
                  <div
                    className="timeline-drag-time"
                    style={{ top: (dragPreviewMins - TIMELINE_START * 60) * effectivePxPerMin }}
                  >
                    {minsTo12HourTimeLabel(dragPreviewMins)}
                  </div>
                )}
              </div>

              {/* Grid */}
              <div
                className="timeline-grid"
                style={{ height: totalHeight }}
                onClick={handleTimelineClick}
              >
                {/* Hour lines */}
                {HOURS.map((h) => (
                  <React.Fragment key={h}>
                    <div
                      className="hour-line"
                      style={{ top: (h - TIMELINE_START) * effectiveHourHeight }}
                    />
                    <div
                      className="hour-line half"
                      style={{ top: (h - TIMELINE_START) * effectiveHourHeight + 30 * effectivePxPerMin }}
                    />
                  </React.Fragment>
                ))}

                {/* Current time indicator */}
                {nowVisible && (
                  <div className="now-line" style={{ top: nowTop }}>
                    <div className="now-dot" />
                    <div className="now-bar" />
                  </div>
                )}

                {/* Empty state */}
                {dayTimelineTasks.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-state-icon">◫</div>
                    <div className="empty-state-text">No tasks scheduled</div>
                    <div className="empty-state-sub">Click anywhere on the timeline to add one</div>
                  </div>
                )}

                {/* Task blocks */}
                {dayTimelineTasks.map((task) => {
                  const tag     = tags.find((t) => t.id === task.tagId)
                  const color   = tag?.color ?? '#6c63ff'
                  const top     = taskTop(task, effectivePxPerMin)
                  const height  = taskHeight(task, effectivePxPerMin)
                  const compact = height < 44
                  const colInfo = columns.get(task.id) ?? { col: 0, totalCols: 1 }
                  const pct     = 100 / colInfo.totalCols
                  const left    = `calc(${colInfo.col * pct}% + 10px)`
                  const width   = `calc(${pct}% - 18px)`

                  return (
                    <div
                      key={task.id}
                      className={`task-block${task.fixed ? ' is-fixed' : ''}${task.done ? ' is-done' : ''}${compact ? ' compact' : ''}${draggingTaskId === task.id ? ' is-dragging' : ''}`}
                      style={{
                        top,
                        height,
                        left,
                        width,
                        right: 'auto',
                        background: task.done ? 'rgba(255,255,255,0.04)' : hexToRgba(color, 0.13),
                        '--task-color': task.done ? 'rgba(255,255,255,0.2)' : color,
                      } as React.CSSProperties}
                      onMouseDown={(event) => handleTaskMouseDown(event, task)}
                      title={task.title}
                    >
                      {task.fixed && <span className="task-block-lock" title="Fixed time">⚑</span>}
                      <div className="task-block-title" style={task.done ? { textDecoration: 'line-through', opacity: 0.45 } : {}}>
                        {task.title || 'Untitled'}
                      </div>
                      <div className="task-block-time">{task.startTime} – {task.endTime}</div>
                      {tag && !compact && <div className="task-block-tag">{tag.name}</div>}
                    </div>
                  )
                })}
              </div>

            </div>
          </div>
        )}

        {viewMode === 'week' && (
          <div className="period-grid week-grid">
            {weekDays.map((iso) => {
              const dayTasks = filteredTasks
                .filter((task) => task.taskDate === iso)
                .sort((a, b) => a.startTime.localeCompare(b.startTime))

              const d = fromIsoDate(iso)
              const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

              return (
                <div key={iso} className="period-column">
                  <button
                    className="period-column-head"
                    onClick={() => {
                      setSelectedDate(iso)
                      setViewMode('day')
                    }}
                    title="Open day view"
                  >
                    {label}
                  </button>
                  <div className="period-column-body">
                    {dayTasks.length === 0 && <div className="period-empty">No tasks</div>}
                    {dayTasks.map((task) => {
                      const tag = tags.find((t) => t.id === task.tagId)
                      return (
                        <div key={task.id} className="period-task" onClick={() => setEditState({ task, isNew: false })}>
                          <span className="period-task-color" style={{ background: tag?.color ?? '#6c63ff' }} />
                          <span className="period-task-title">{task.title}</span>
                          <span className="period-task-time">{task.startTime}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {viewMode === 'month' && (
          <div className="period-grid month-grid-wrap">
            <div className="month-weekdays">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                <div key={day} className="month-weekday">{day}</div>
              ))}
            </div>
            <div className="month-grid">
            {monthDays.days.map((iso) => {
              const isInMonth = isIsoBetween(iso, monthDays.startMonth, monthDays.endMonth)
              const dayTasks = filteredTasks
                .filter((task) => task.taskDate === iso)
                .sort((a, b) => a.startTime.localeCompare(b.startTime))

              return (
                <button
                  key={iso}
                  className={`month-cell${isInMonth ? '' : ' out-of-month'}`}
                  onClick={() => {
                    setSelectedDate(iso)
                    setViewMode('day')
                  }}
                  title="Open day view"
                >
                  <div className="month-cell-day">{fromIsoDate(iso).getDate()}</div>
                  <div className="month-cell-tasks">
                    {dayTasks.slice(0, 3).map((task) => {
                      const tag = tags.find((t) => t.id === task.tagId)
                      return (
                        <span key={task.id} className="month-task-chip">
                          <span className="period-task-color" style={{ background: tag?.color ?? '#6c63ff' }} />
                          <span>{task.title}</span>
                        </span>
                      )
                    })}
                    {dayTasks.length > 3 && <div className="month-more">+{dayTasks.length - 3} more</div>}
                  </div>
                </button>
              )
            })}
            </div>
          </div>
        )}
      </div>

      {/* ── Chat FAB ─────────────────────────────────────────────── */}
      <button
        className="chat-fab"
        onClick={() => setChatOpen((prev) => !prev)}
        aria-label="Open AI chat"
      >
        ✦
      </button>

      {/* ── Chat Drawer ──────────────────────────────────────────── */}
      {chatOpen && (
        <div className="chat-drawer">
          <div className="chat-header">
            <div className="chat-avatar">✦</div>
            <div>
              <div className="chat-header-title">Planner AI</div>
              <div className="chat-header-sub">
                {aiStatus?.provider === 'embedded'
                  ? 'Embedded AI active'
                  : aiStatus?.provider === 'ollama'
                    ? 'Ollama active'
                    : webSearch
                      ? 'Web search enabled'
                      : 'Local AI unavailable'}
              </div>
            </div>
            <button className="chat-close-btn" onClick={() => setChatOpen(false)} aria-label="Close chat">×</button>
          </div>

          <div className="chat-messages">
            {messages.map((msg) => (
              <div key={msg.id} className={`chat-bubble ${msg.role}`}>
                {msg.content}
              </div>
            ))}
            {aiTyping && (
              <div className="chat-typing">
                <div className="chat-typing-dot" />
                <div className="chat-typing-dot" />
                <div className="chat-typing-dot" />
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="chat-input-row">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendChat()}
              placeholder="Ask about your day…"
              disabled={aiTyping}
            />
            <button
              className="btn btn-accent btn-sm"
              onClick={sendChat}
              disabled={aiTyping || !chatInput.trim()}
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* ── Edit / Create Task Modal ──────────────────────────────── */}
      {editState && (
        <EditModal
          editState={editState}
          tags={tags}
          onSave={handleSaveTask}
          onDelete={handleDeleteTask}
          onClose={() => setEditState(null)}
        />
      )}

      {/* ── Optimization Preview Modal ────────────────────────────── */}
      {optimization && (
        <div
          className="modal-overlay"
          onClick={(e) => e.target === e.currentTarget && setOptimization(null)}
        >
          <div className="modal optimize-modal">
            <div className="modal-header">
              <span className="modal-title">✦ AI Optimization Proposal</span>
              <button className="chat-close-btn" onClick={() => setOptimization(null)} aria-label="Close">×</button>
            </div>

            <div className="modal-body">
              <div className="optimize-summary">{optimization.summary}</div>

              <div>
                <label style={{ marginBottom: 10 }}>Proposed schedule</label>
                <div className="optimize-list">
                  {[...optimization.tasks]
                    .sort((a, b) => a.startTime.localeCompare(b.startTime))
                    .map((task) => {
                      const tag = tags.find((t) => t.id === task.tagId)
                      return (
                        <div key={task.id} className="optimize-row">
                          <div
                            className="optimize-swatch"
                            style={{ background: tag?.color ?? '#6c63ff' }}
                          />
                          <span className="optimize-name">{task.title}</span>
                          <span className="optimize-time">
                            {task.startTime} – {task.endTime}
                          </span>
                        </div>
                      )
                    })}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <div className="modal-footer-right">
                <button className="btn btn-ghost btn-sm" onClick={() => setOptimization(null)}>
                  Discard
                </button>
                <button className="btn btn-accent btn-sm" onClick={applyOptimization}>
                  Apply schedule
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default App
