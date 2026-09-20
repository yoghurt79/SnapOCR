import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type CapturedScreenshot,
  type ScreenshotError,
  type ShortcutSettings,
  type SnapOCRApi
} from '../shared/ipc'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => {
    listener(payload)
  }

  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const api: SnapOCRApi = {
  captureScreen: () => ipcRenderer.invoke(IPC_CHANNELS.captureScreen),
  getLatestScreenshot: () => ipcRenderer.invoke(IPC_CHANNELS.getLatestScreenshot),
  copyText: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.copyText, text),
  hideWindow: () => ipcRenderer.invoke(IPC_CHANNELS.hideWindow),
  getShortcut: () => ipcRenderer.invoke(IPC_CHANNELS.getShortcut),
  setShortcut: (accelerator: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.setShortcut, accelerator),
  onScreenshotCaptured: (listener: (screenshot: CapturedScreenshot) => void) =>
    subscribe(IPC_CHANNELS.screenshotCaptured, listener),
  onScreenshotError: (listener: (error: ScreenshotError) => void) =>
    subscribe(IPC_CHANNELS.screenshotError, listener),
  onShortcutChanged: (listener: (settings: ShortcutSettings) => void) =>
    subscribe(IPC_CHANNELS.shortcutChanged, listener),
  onOpenSettings: (listener: () => void) =>
    subscribe(IPC_CHANNELS.openSettings, listener)
}

contextBridge.exposeInMainWorld('snapOCR', api)