import { desktopCapturer, screen } from 'electron'
import type { CapturedScreenshot } from '../shared/ipc'

export async function capturePrimaryScreen(): Promise<CapturedScreenshot> {
  const display = screen.getPrimaryDisplay()
  const scale = display.scaleFactor || 1
  const width = Math.max(1, Math.round(display.bounds.width * scale))
  const height = Math.max(1, Math.round(display.bounds.height * scale))

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
    fetchWindowIcons: false
  })

  const source =
    sources.find((candidate) => candidate.display_id === String(display.id)) ??
    sources[0]

  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('无法读取屏幕画面，请检查系统屏幕录制权限。')
  }

  let thumbnail = source.thumbnail
  const actualSize = thumbnail.getSize()
  if (actualSize.width !== width || actualSize.height !== height) {
    thumbnail = thumbnail.resize({ width, height, quality: 'best' })
  }

  const finalSize = thumbnail.getSize()
  return {
    dataUrl: thumbnail.toDataURL(),
    width: finalSize.width,
    height: finalSize.height,
    displayId: source.display_id || String(display.id),
    capturedAt: Date.now()
  }
}