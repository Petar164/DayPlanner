import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const EMBEDDED_PORT = Number(process.env.EMBEDDED_AI_PORT ?? 11435)
const EMBEDDED_HOST = process.env.EMBEDDED_AI_HOST ?? '127.0.0.1'
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

const ensureBundledAssetsCopied = (): { ok: boolean; reason?: string } => {
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

  if (!fs.existsSync(targetModel)) fs.copyFileSync(sourceModel, targetModel)
  if (!fs.existsSync(targetRuntime)) fs.copyFileSync(sourceRuntime, targetRuntime)

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
  const reachable = await isHealthy()
  return {
    enabled: true,
    reachable,
    running: runtimeProcess !== null,
    host: EMBEDDED_HOST,
    port: EMBEDDED_PORT,
    source: app.isPackaged ? 'packaged' : 'development',
    modelPath: localModelPath(),
    runtimePath: localRuntimePath()
  }
}

export const initEmbeddedRuntime = async (): Promise<EmbeddedRuntimeStatus> => {
  const copied = ensureBundledAssetsCopied()
  if (!copied.ok) {
    return {
      enabled: true,
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
    return getEmbeddedRuntimeStatus()
  }

  if (!runtimeProcess) {
    const runtime = localRuntimePath()
    const model = localModelPath()

    runtimeProcess = spawn(runtime, ['-m', model, '--host', EMBEDDED_HOST, '--port', `${EMBEDDED_PORT}`], {
      windowsHide: true,
      stdio: 'pipe'
    })

    runtimeProcess.on('exit', () => {
      runtimeProcess = null
      runtimeStarted = false
    })
  }

  for (let i = 0; i < 20; i += 1) {
    if (await isHealthy()) {
      runtimeStarted = true
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
  return fs.existsSync(bundledModelPath()) && fs.existsSync(bundledRuntimePath())
}
