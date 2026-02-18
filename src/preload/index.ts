import { contextBridge, ipcRenderer } from 'electron'
import type { PlannerState } from '../main/db'
import type { AiStatus, OllamaStatus, OptimizeResult } from '../main/ollama'

const plannerApi = {
  getState: (): Promise<PlannerState> => ipcRenderer.invoke('planner:get-state'),
  saveState: (state: PlannerState): Promise<PlannerState> => ipcRenderer.invoke('planner:save-state', state),
  chat: (prompt: string, state: PlannerState): Promise<string> => ipcRenderer.invoke('planner:chat', prompt, state),
  optimize: (state: PlannerState): Promise<OptimizeResult> => ipcRenderer.invoke('planner:optimize', state),
  getCapabilities: (): Promise<{ webSearch: boolean }> => ipcRenderer.invoke('planner:get-capabilities'),
  getAiStatus: (): Promise<AiStatus> => ipcRenderer.invoke('planner:get-ai-status'),
  getOllamaStatus: (): Promise<OllamaStatus> => ipcRenderer.invoke('planner:ollama-status')
}

contextBridge.exposeInMainWorld('planner', plannerApi)

export type PlannerApi = typeof plannerApi
