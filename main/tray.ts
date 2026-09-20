import { Menu, nativeImage, Tray } from 'electron'

const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAHzSURBVFhH1Ve9TsMwEM7I2LGqg8IjMDL2ERgZGRlBqkTtDOUJYOwjsCAxMiE2MjKylZERMXW7Q1/SpMnZTtwqjcQnfVJb37/tuzqK/iuUoTOV8rROKdMrkhmPJ4aulKGX2DB7qSlTmufJLZ9IG3shWfBIab5TmtaWsy5qWiJwaTMYeWk1/ViGd2AeuKYLabsTx4Yv98raQ1RR+vACzqWBXpjSg/RlYVP23jKXxEGWPivgwLj2/OaJ+X21Jb5LmVA5JDcxfCp950CJpAKMZCtu4P7VNgzi9zqg5wzC0LP0XWZvlR6ZAL/r9szAegUgD+CzlAOtKqB5SKF6AD5DPnbqaVo2AkAHs4RCDHnYpacMfVfO0e2kQEmUFXvrK7uPIXrVNmCwyMVBWHbIWPO5tTgA1Zyu8wDQHOTiEKzaM0ohF4cgbl5xBlKeysUhiJlT3IIZj+ViyZDT7GKIHg7/5iJGUWzoSwqAXffZxy49dN1kwUfbABxzIMSQj1161jxAU5BCdUN9zwJc/UYAAKKSgoeYhrGmD+k7h68K9cxCK9Am58y+hG8q9kY5BV1Qhh4txT6oKWucfB8g1HsQhfOR9NUK9GrL0D7EAyUkcxeKNk1vltEg0mfrgdsFMIRtcf1vlMT7serzh0DxduB58WasMeXprqX+A5ekygU8EPjaAAAAAElFTkSuQmCC'

export interface TrayActions {
  onToggleWindow: () => void
  onCaptureScreen: () => void
  onOpenSettings: () => void
  onQuit: () => void
}

export function createTray(actions: TrayActions): Tray {
  const icon = nativeImage
    .createFromDataURL(TRAY_ICON_DATA_URL)
    .resize({ width: 16, height: 16, quality: 'best' })

  const tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '截取屏幕',
      click: actions.onCaptureScreen
    },
    {
      label: '显示/隐藏窗口',
      click: actions.onToggleWindow
    },
    {
      label: '设置...',
      click: actions.onOpenSettings
    },
    { type: 'separator' },
    {
      label: '退出 SnapOCR',
      click: actions.onQuit
    }
  ])

  tray.setToolTip('SnapOCR - 本地离线 OCR')
  tray.setContextMenu(contextMenu)
  tray.on('click', actions.onToggleWindow)

  return tray
}