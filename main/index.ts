import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  net,
  protocol,
  screen,
  type IpcMainInvokeEvent,
  type Tray
} from 'electron'
import { existsSync } from 'node:fs'
import { isAbsolute, join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  IPC_CHANNELS,
  type CapturedScreenshot,
  type ScreenshotError,
  type ShortcutUpdateResult
} from '../shared/ipc'
import {
  getShortcutSettings,
  isValidAccelerator,
  normalizeAccelerator,
  saveShortcut
} from './settings'
import { capturePrimaryScreen } from './screenshot'
import { createTray } from './tray'

const APP_SCHEME = 'snapocr'
const APP_HOST = 'bundle'

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let latestScreenshot: CapturedScreenshot | null = null
let activeShortcut: string | null = null
let isQuitting = false
let captureInFlight: Promise<CapturedScreenshot> | null = null
let openSettingsWhenReady = false

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    void showWindow()
  })

  app.whenReady().then(() => {
    void bootstrap()
  })
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId('com.snapocr.app')
  registerAppProtocol()
  registerIpcHandlers()
  createMainWindow()
  createAppTray()
  registerGlobalShortcut()

  app.on('activate', () => {
    void showWindow()
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('window-all-closed', () => {
    // SnapOCR intentionally remains available in the system tray.
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    tray?.destroy()
    tray = null
  })
}

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, (request) => {
    try {
      const requestUrl = new URL(request.url)
      const decodedPath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '')
      const relativePath = normalize(decodedPath || 'index.html').replace(/\\/g, '/')

      if (
        isAbsolute(relativePath) ||
        relativePath.startsWith('../') ||
        relativePath.includes('/../')
      ) {
        return new Response('Forbidden', { status: 403 })
      }

      const rendererRoot = join(__dirname, '../renderer')
      let filePath = join(rendererRoot, relativePath)

      if (
        app.isPackaged &&
        (relativePath.startsWith('ocr/') || relativePath.startsWith('tessdata/'))
      ) {
        const unpackedPath = join(
          process.resourcesPath,
          'app.asar.unpacked',
          'out',
          'renderer',
          relativePath
        )
        if (existsSync(unpackedPath)) {
          filePath = unpackedPath
        }
      }

      if (!existsSync(filePath)) {
        return new Response('Not Found', { status: 404 })
      }

      return net.fetch(pathToFileURL(filePath).toString())
    } catch (error) {
      console.error('Failed to serve renderer asset:', error)
      return new Response('Internal Server Error', { status: 500 })
    }
  })
}

function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow
  }

  mainWindow = new BrowserWindow({
    width: 720,
    height: 540,
    minWidth: 620,
    minHeight: 460,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged
    }
  })

  mainWindow.setAlwaysOnTop(true, 'floating')
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  mainWindow.on('blur', () => {
    if (!isQuitting && !mainWindow?.webContents.isDevToolsOpened()) {
      mainWindow?.hide()
    }
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (openSettingsWhenReady) {
      openSettingsWhenReady = false
      sendToRenderer(IPC_CHANNELS.openSettings)
    }
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`)
  }

  return mainWindow
}

function createAppTray(): void {
  tray = createTray({
    onToggleWindow: () => {
      if (mainWindow?.isVisible()) {
        mainWindow.hide()
      } else {
        void showWindow()
      }
    },
    onCaptureScreen: () => {
      void captureAndDeliver().catch(() => undefined)
    },
    onOpenSettings: () => {
      void showWindow(true)
    },
    onQuit: () => {
      isQuitting = true
      app.quit()
    }
  })
}

function registerGlobalShortcut(): void {
  const settings = getShortcutSettings()
  const registered = globalShortcut.register(settings.accelerator, () => {
    void captureAndDeliver().catch(() => undefined)
  })

  if (registered) {
    activeShortcut = settings.accelerator
  } else {
    console.error(`Unable to register global shortcut: ${settings.accelerator}`)
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.captureScreen, (event) => {
    assertTrustedSender(event)
    return captureAndDeliver()
  })

  ipcMain.handle(IPC_CHANNELS.getLatestScreenshot, (event) => {
    assertTrustedSender(event)
    return latestScreenshot
  })

  ipcMain.handle(IPC_CHANNELS.copyText, (event, text: unknown) => {
    assertTrustedSender(event)
    if (typeof text !== 'string') {
      throw new TypeError('Clipboard content must be a string.')
    }
    if (text.length > 5_000_000) {
      throw new RangeError('Clipboard content is too large.')
    }
    clipboard.writeText(text)
  })

  ipcMain.handle(IPC_CHANNELS.hideWindow, (event) => {
    assertTrustedSender(event)
    mainWindow?.hide()
  })

  ipcMain.handle(IPC_CHANNELS.getShortcut, (event) => {
    assertTrustedSender(event)
    return getShortcutSettings()
  })

  ipcMain.handle(
    IPC_CHANNELS.setShortcut,
    (event, accelerator: unknown): ShortcutUpdateResult => {
      assertTrustedSender(event)

      if (typeof accelerator !== 'string') {
        return {
          success: false,
          settings: getShortcutSettings(),
          error: '快捷键格式无效。'
        }
      }

      const normalized = normalizeAccelerator(accelerator)
      if (!normalized || !isValidAccelerator(normalized)) {
        return {
          success: false,
          settings: getShortcutSettings(),
          error: '请使用至少包含 Ctrl、Alt、Shift 或 Super 的组合键。'
        }
      }

      if (normalized === activeShortcut) {
        return {
          success: true,
          settings: getShortcutSettings()
        }
      }

      const registered = globalShortcut.register(normalized, () => {
        void captureAndDeliver().catch(() => undefined)
      })

      if (!registered) {
        return {
          success: false,
          settings: getShortcutSettings(),
          error: '该快捷键已被系统或其他应用占用。'
        }
      }

      try {
        saveShortcut(normalized)
      } catch (error) {
        globalShortcut.unregister(normalized)
        return {
          success: false,
          settings: getShortcutSettings(),
          error: error instanceof Error ? error.message : '设置保存失败。'
        }
      }

      if (activeShortcut) {
        globalShortcut.unregister(activeShortcut)
      }
      activeShortcut = normalized

      const settings = getShortcutSettings()
      sendToRenderer(IPC_CHANNELS.shortcutChanged, settings)
      return { success: true, settings }
    }
  )
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Rejected IPC call from an untrusted renderer.')
  }
}

async function captureAndDeliver(): Promise<CapturedScreenshot> {
  if (captureInFlight) {
    return captureInFlight
  }

  captureInFlight = (async () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
      await delay(120)
    }

    try {
      const screenshot = await capturePrimaryScreen()
      latestScreenshot = screenshot
      await showWindow()
      sendToRenderer(IPC_CHANNELS.screenshotCaptured, screenshot)
      return screenshot
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '截屏失败，请稍后重试。'
      await showWindow()
      sendToRenderer(IPC_CHANNELS.screenshotError, { message } satisfies ScreenshotError)
      throw error
    } finally {
      captureInFlight = null
    }
  })()

  return captureInFlight
}

async function showWindow(openSettings = false): Promise<void> {
  if (openSettings && !mainWindow) {
    openSettingsWhenReady = true
  }

  const window = createMainWindow()
  positionWindowOnActiveDisplay(window)

  if (window.isMinimized()) {
    window.restore()
  }

  window.show()
  window.focus()

  if (openSettings) {
    if (window.webContents.isLoadingMainFrame()) {
      openSettingsWhenReady = true
    } else {
      sendToRenderer(IPC_CHANNELS.openSettings)
    }
  }
}

function positionWindowOnActiveDisplay(window: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const bounds = window.getBounds()
  const x = Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2)
  const y = Math.round(display.workArea.y + (display.workArea.height - bounds.height) / 2)
  window.setPosition(x, y, false)
}

function sendToRenderer(channel: string, payload?: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const send = (): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload)
    }
  }

  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}