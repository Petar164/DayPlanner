import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (!value) return defaultValue
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return defaultValue
}

const EMBEDDED_ENABLED = parseBoolean(process.env.EMBEDDED_AI_ENABLED, true)
const EMBEDDED_PORT = Number(process.env.EMBEDDED_AI_PORT ?? 11435)
const EMBEDDED_HOST = process.env.EMBEDDED_AI_HOST ?? '127.0.0.1'
const STARTUP_TIMEOUT_MS = Number(process.env.EMBEDDED_AI_STARTUP_TIMEOUT_MS ?? 15000)
const HEALTH_URL = `http://${EMBEDDED_HOST}:${EMBEDDED_PORT}/health`
const CHAT_URL = `http://${EMBEDDED_HOST}:${EMBEDDED_PORT}/v1/chat/completions`

const MODEL_FILE_NAME = process.env.EMBEDDED_MODEL_FILE ?? 'planner-model.gguf'
const RUNTIME_FILE_NAME = process.env.EMBEDDED_RUNTIME_FILE ?? 'llama-server.exe'

const resourceAiDir = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ai')
  }
  return path.join(process.cwd(), 'ai')
}

const writableAiDir = (): string => path.join(app.getPath('userData'), 'ai')

const bundledModelPath = (): string => path.join(resourceAiDir(), MODEL_FILE_NAME)
const bundledRuntimePath = (): string => path.join(resourceAiDir(), RUNTIME_FILE_NAME)
const localModelPath = (): string => path.join(writableAiDir(), MODEL_FILE_NAME)
const localRuntimePath = (): string => path.join(writableAiDir(), RUNTIME_FILE_NAME)

let runtimeProcess: ChildProcessWithoutNullStreams | null = null
let runtimeStarted = false
let lastRuntimeError: string | undefined

const copyIfDifferent = (sourcePath: string, targetPath: string): void => {
  const sourceStat = fs.statSync(sourcePath)
  const targetExists = fs.existsSync(targetPath)

  if (!targetExists) {
    fs.copyFileSync(sourcePath, targetPath)
    return
  }

  const targetStat = fs.statSync(targetPath)
  const sameSize = sourceStat.size === targetStat.size
  const sourceMtime = Math.floor(sourceStat.mtimeMs)
  const targetMtime = Math.floor(targetStat.mtimeMs)

  if (!sameSize || sourceMtime !== targetMtime) {
    fs.copyFileSync(sourcePath, targetPath)
  }
}

const ensureBundledAssetsCopied = (): { ok: boolean; reason?: string } => {
  if (!EMBEDDED_ENABLED) {
    return {
      ok: false,
      reason: 'Embedded AI is disabled via EMBEDDED_AI_ENABLED.'
    }
  }

  const sourceModel = bundledModelPath()
  const sourceRuntime = bundledRuntimePath()

  if (!fs.existsSync(sourceModel) || !fs.existsSync(sourceRuntime)) {
    return {
      ok: false,
      reason: `Missing bundled AI assets in ${resourceAiDir()}. Expected ${RUNTIME_FILE_NAME} and ${MODEL_FILE_NAME}.`
    }
  }

  const targetDir = writableAiDir()
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })

  const targetModel = localModelPath()
  const targetRuntime = localRuntimePath()

  copyIfDifferent(sourceModel, targetModel)
  copyIfDifferent(sourceRuntime, targetRuntime)

  return { ok: true }
}

const isHealthy = async (): Promise<boolean> => {
  try {
    const response = await fetch(HEALTH_URL)
    return response.ok
  } catch {
    return false
  }
}

export type EmbeddedRuntimeStatus = {
  enabled: boolean
  reachable: boolean
  running: boolean
  host: string
  port: number
  source: string
  modelPath: string
  runtimePath: string
  error?: string
}

export const getEmbeddedRuntimeStatus = async (): Promise<EmbeddedRuntimeStatus> => {
  if (!EMBEDDED_ENABLED) {
    return {
      enabled: false,
      reachable: false,
      running: false,
      host: EMBEDDED_HOST,
      port: EMBEDDED_PORT,
      source: app.isPackaged ? 'packaged' : 'development',
      modelPath: localModelPath(),
      runtimePath: localRuntimePath(),
      error: 'Embedded AI is disabled via EMBEDDED_AI_ENABLED.'
    }
  }

  const reachable = await isHealthy()
  return {
    enabled: EMBEDDED_ENABLED,
    reachable,
    running: runtimeProcess !== null,
    host: EMBEDDED_HOST,
    port: EMBEDDED_PORT,
    source: app.isPackaged ? 'packaged' : 'development',
    modelPath: localModelPath(),
    runtimePath: localRuntimePath(),
    error: lastRuntimeError
  }
}

export const initEmbeddedRuntime = async (): Promise<EmbeddedRuntimeStatus> => {
  if (!EMBEDDED_ENABLED) {
    return getEmbeddedRuntimeStatus()
  }

  const copied = ensureBundledAssetsCopied()
  if (!copied.ok) {
    return {
      enabled: EMBEDDED_ENABLED,
      reachable: false,
      running: false,
      host: EMBEDDED_HOST,
      port: EMBEDDED_PORT,
      source: app.isPackaged ? 'packaged' : 'development',
      modelPath: localModelPath(),
      runtimePath: localRuntimePath(),
      error: copied.reason
    }
  }

  if (await isHealthy()) {
    runtimeStarted = true
    lastRuntimeError = undefined
    return getEmbeddedRuntimeStatus()
  }

  if (!runtimeProcess) {
    const runtime = localRuntimePath()
    const model = localModelPath()

    runtimeProcess = spawn(runtime, ['-m', model, '--host', EMBEDDED_HOST, '--port', `${EMBEDDED_PORT}`], {
      windowsHide: true,
      cwd: writableAiDir(),
      stdio: 'pipe'
    })

    runtimeProcess.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString().trim()
      if (message.length > 0) {
        lastRuntimeError = message
      }
    })

    runtimeProcess.on('error', (error) => {
      lastRuntimeError = error.message
    })

    runtimeProcess.on('exit', (code, signal) => {
      runtimeProcess = null
      runtimeStarted = false
      if (code !== null && code !== 0) {
        lastRuntimeError = `Embedded runtime exited with code ${code}.`
      } else if (signal) {
        lastRuntimeError = `Embedded runtime exited due to signal ${signal}.`
      }
    })
  }

  const startWait = Date.now()
  while (Date.now() - startWait < STARTUP_TIMEOUT_MS) {
    if (await isHealthy()) {
      runtimeStarted = true
      lastRuntimeError = undefined
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  const status = await getEmbeddedRuntimeStatus()
  if (!status.reachable && !status.error) {
    status.error = 'Embedded runtime failed to start or did not become healthy.'
  }
  return status
}

export const stopEmbeddedRuntime = (): void => {
  if (runtimeProcess) {
    runtimeProcess.kill()
    runtimeProcess = null
  }
  runtimeStarted = false
}

export const chatWithEmbeddedRuntime = async (
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): Promise<string> => {
  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'embedded',
      messages,
      temperature: 0.4,
      stream: false
    })
  })

  if (!response.ok) {
    throw new Error(`Embedded runtime responded with ${response.status}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

export const hasEmbeddedAssets = (): boolean => {
  if (!EMBEDDED_ENABLED) return false
  return fs.existsSync(bundledModelPath()) && fs.existsSync(bundledRuntimePath())
}
