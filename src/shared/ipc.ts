export const IPC_CHANNELS = {
  captureScreen: 'screenshot:capture',
  screenshotCaptured: 'screenshot:captured',
  screenshotError: 'screenshot:error',
  getLatestScreenshot: 'screenshot:get-latest',
  copyText: 'clipboard:copy-text',
  hideWindow: 'window:hide',
  getShortcut: 'settings:get-shortcut',
  setShortcut: 'settings:set-shortcut',
  shortcutChanged: 'settings:shortcut-changed',
  openSettings: 'ui:open-settings'
} as const

export interface CapturedScreenshot {
  dataUrl: string
  width: number
  height: number
  displayId: string
  capturedAt: number
}

export interface ShortcutSettings {
  accelerator: string
  label: string
}

export interface ShortcutUpdateResult {
  success: boolean
  settings: ShortcutSettings
  error?: string
}

export interface ScreenshotError {
  message: string
}

export interface SnapOCRApi {
  captureScreen: () => Promise<CapturedScreenshot>
  getLatestScreenshot: () => Promise<CapturedScreenshot | null>
  copyText: (text: string) => Promise<void>
  hideWindow: () => Promise<void>
  getShortcut: () => Promise<ShortcutSettings>
  setShortcut: (accelerator: string) => Promise<ShortcutUpdateResult>
  onScreenshotCaptured: (listener: (screenshot: CapturedScreenshot) => void) => () => void
  onScreenshotError: (listener: (error: ScreenshotError) => void) => () => void
  onShortcutChanged: (listener: (settings: ShortcutSettings) => void) => () => void
  onOpenSettings: (listener: () => void) => () => void
}