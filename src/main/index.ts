import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import dotenv from 'dotenv'
import { initDb, getState, saveState, type PlannerState } from './db'
import { chatWithPlanner, optimizePlanWithOllama, getAiStatus, getOllamaStatus } from './ollama'
import { initEmbeddedRuntime, stopEmbeddedRuntime } from './ai-runtime'
import { isSearchEnabled } from './search'

dotenv.config()

const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: '#0b0b0b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initDb()
  initEmbeddedRuntime().catch(() => undefined)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopEmbeddedRuntime()
})

ipcMain.handle('planner:get-state', () => getState())
ipcMain.handle('planner:save-state', (_event, state: PlannerState) => saveState(state))
ipcMain.handle('planner:chat', async (_event, prompt: string, state: PlannerState) => {
  return chatWithPlanner(prompt, state)
})
ipcMain.handle('planner:optimize', async (_event, state: PlannerState) => {
  return optimizePlanWithOllama(state)
})
ipcMain.handle('planner:get-capabilities', () => ({
  webSearch: isSearchEnabled()
}))
ipcMain.handle('planner:get-ai-status', async () => {
  return getAiStatus()
})
ipcMain.handle('planner:ollama-status', async () => {
  return getOllamaStatus()
})
