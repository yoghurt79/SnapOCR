import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  Check,
  Copy,
  Keyboard,
  LoaderCircle,
  ScanText,
  Settings,
  ShieldCheck,
  Square,
  X
} from 'lucide-react'
import type {
  CapturedScreenshot,
  ShortcutSettings
} from '@shared/ipc'
import { recognizeImage, type OcrProgress } from './ocr'

type Phase = 'idle' | 'capturing' | 'recognizing' | 'done' | 'error'

const EMPTY_SHORTCUT: ShortcutSettings = {
  accelerator: 'Control+Shift+X',
  label: 'Ctrl+Shift+X'
}

export default function App(): React.JSX.Element {
  const [screenshot, setScreenshot] = useState<CapturedScreenshot | null>(null)
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [statusText, setStatusText] = useState('等待截屏')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [shortcut, setShortcut] = useState<ShortcutSettings>(EMPTY_SHORTCUT)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutDraft, setShortcutDraft] = useState(EMPTY_SHORTCUT.accelerator)
  const [shortcutError, setShortcutError] = useState('')
  const [savingShortcut, setSavingShortcut] = useState(false)
  const recognitionRequest = useRef(0)
  const recognitionAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    const removeScreenshotListener = window.snapOCR.onScreenshotCaptured((nextScreenshot) => {
      setError('')
      setCopied(false)
      setScreenshot(nextScreenshot)
    })

    const removeErrorListener = window.snapOCR.onScreenshotError((captureError) => {
      setPhase('error')
      setStatusText('截屏失败')
      setError(captureError.message)
    })

    const removeShortcutListener = window.snapOCR.onShortcutChanged((settings) => {
      setShortcut(settings)
      setShortcutDraft(settings.accelerator)
    })

    const removeSettingsListener = window.snapOCR.onOpenSettings(() => {
      setSettingsOpen(true)
    })

    void window.snapOCR.getLatestScreenshot().then((latest) => {
      if (latest) {
        setScreenshot(latest)
      }
    })

    void window.snapOCR.getShortcut().then((settings) => {
      setShortcut(settings)
      setShortcutDraft(settings.accelerator)
    })

    return () => {
      removeScreenshotListener()
      removeErrorListener()
      removeShortcutListener()
      removeSettingsListener()
    }
  }, [])

  useEffect(() => {
    if (!screenshot) return

    const requestId = recognitionRequest.current + 1
    const controller = new AbortController()
    recognitionRequest.current = requestId
    recognitionAbort.current = controller
    let active = true

    setPhase('recognizing')
    setStatusText('识别中...')
    setProgress(0)
    setError('')
    setCopied(false)
    setText('')

    void recognizeImage(
      screenshot.dataUrl,
      (nextProgress: OcrProgress) => {
        if (!active) return
        setStatusText(`${nextProgress.label}...`)
        setProgress(nextProgress.progress)
      },
      controller.signal
    )
      .then(async (result) => {
        if (!active || recognitionRequest.current !== requestId) return

        setText(result.text)
        setProgress(100)
        setStatusText('识别完成，正在复制')
        await window.snapOCR.copyText(result.text)

        if (!active || recognitionRequest.current !== requestId) return

        recognitionAbort.current = null
        setCopied(true)
        setPhase('done')
        setStatusText(`已复制 · 置信度 ${Math.round(result.confidence)}%`)

        window.setTimeout(() => {
          setCopied(false)
        }, 2200)
      })
      .catch((recognitionError: unknown) => {
        if (!active || recognitionRequest.current !== requestId) return

        recognitionAbort.current = null

        if (recognitionError instanceof DOMException && recognitionError.name === 'AbortError') {
          return
        }

        setPhase('error')
        setStatusText('识别失败')
        setError(
          recognitionError instanceof Error
            ? recognitionError.message
            : 'OCR 识别失败，请确认离线语言包已正确安装。'
        )
      })

    return () => {
      active = false
      controller.abort()
      if (recognitionAbort.current === controller) {
        recognitionAbort.current = null
      }
    }
  }, [screenshot])

  async function handleCapture(): Promise<void> {
    setPhase('capturing')
    setStatusText('正在截屏...')
    setError('')

    try {
      await window.snapOCR.captureScreen()
    } catch (captureError) {
      setPhase('error')
      setStatusText('截屏失败')
      setError(captureError instanceof Error ? captureError.message : '无法截取屏幕。')
    }
  }

  function handleStopRecognition(): void {
    recognitionRequest.current += 1
    recognitionAbort.current?.abort()
    recognitionAbort.current = null
    setPhase('idle')
    setStatusText('已停止识别')
    setProgress(0)
    setError('')
    setCopied(false)
  }
  async function handleCopy(): Promise<void> {
    await window.snapOCR.copyText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  async function handleSaveShortcut(): Promise<void> {
    setSavingShortcut(true)
    setShortcutError('')

    try {
      const result = await window.snapOCR.setShortcut(shortcutDraft)
      if (!result.success) {
        setShortcutError(result.error ?? '快捷键保存失败。')
        return
      }

      setShortcut(result.settings)
      setShortcutDraft(result.settings.accelerator)
      setSettingsOpen(false)
    } finally {
      setSavingShortcut(false)
    }
  }

  const busy = phase === 'capturing' || phase === 'recognizing'

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <ScanText size={18} strokeWidth={2.2} />
          </span>
          <div>
            <strong>SnapOCR</strong>
            <span>本地离线 OCR</span>
          </div>
        </div>

        <div className="status-area">
          <div className={`status-pill status-${phase}`}>
            {busy ? (
              <LoaderCircle className="spin" size={14} />
            ) : phase === 'done' ? (
              <Check size={14} />
            ) : (
              <ShieldCheck size={14} />
            )}
            <span>{statusText}</span>
          </div>
          {phase === 'recognizing' && (
            <button
              className="stop-button"
              type="button"
              title="停止当前 OCR 任务"
              onClick={handleStopRecognition}
            >
              <Square size={11} fill="currentColor" />
              停止
            </button>
          )}
        </div>

        <div className="window-actions">
          <button
            className="icon-button"
            type="button"
            title="设置"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={18} />
          </button>
          <button
            className="icon-button close-button"
            type="button"
            title="关闭界面（继续在托盘运行）"
            onClick={() => void window.snapOCR.hideWindow()}
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {busy && (
        <div className="progress-track" aria-label="OCR 进度">
          <span style={{ width: `${progress}%` }} />
        </div>
      )}

      <section className="content">
        {screenshot ? (
          <div className="workspace">
            <aside className="preview-panel">
              <div className="preview-heading">
                <Camera size={14} />
                <span>截屏预览</span>
              </div>
              <img src={screenshot.dataUrl} alt="待识别截屏" />
              <span className="image-meta">
                {screenshot.width} × {screenshot.height}
              </span>
            </aside>

            <div className="result-panel">
              <div className="result-heading">
                <span>识别结果</span>
                <button
                  className="text-button"
                  type="button"
                  disabled={!text || busy}
                  onClick={() => void handleCopy()}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>

              <textarea
                className="ocr-output"
                value={text}
                readOnly={busy}
                spellCheck={false}
                placeholder={busy ? '正在本地识别文字...' : '未识别到文字'}
                onChange={(event) => setText(event.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <ScanText size={34} />
            </span>
            <h1>截屏，立即提取文字</h1>
            <p>图片和文字不会离开你的电脑。按下快捷键，或点击下方按钮开始。</p>

            <button
              className="capture-button"
              type="button"
              disabled={busy}
              onClick={() => void handleCapture()}
            >
              {busy ? <LoaderCircle className="spin" size={18} /> : <Camera size={18} />}
              {busy ? '处理中...' : '截取屏幕'}
            </button>

            <div className="shortcut-hint">
              <Keyboard size={15} />
              <span>全局快捷键</span>
              <kbd>{shortcut.label}</kbd>
            </div>
          </div>
        )}

        {error && <div className="error-banner">{error}</div>}
      </section>

      <footer className="footer">
        <span className="privacy-note">
          <ShieldCheck size={14} />
          全程本地处理 · 不上传云端
        </span>
        {screenshot && (
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void handleCapture()}
          >
            <Camera size={15} />
            再次截屏
          </button>
        )}
      </footer>

      {settingsOpen && (
        <div className="settings-backdrop">
          <section className="settings-panel" role="dialog" aria-modal="true">
            <div className="settings-heading">
              <div>
                <span className="eyebrow">偏好设置</span>
                <h2>全局快捷键</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                title="关闭"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <label htmlFor="shortcut-input">在任意应用中唤起 SnapOCR</label>
            <input
              id="shortcut-input"
              value={shortcutDraft}
              spellCheck={false}
              placeholder="例如：Control+Shift+X"
              onChange={(event) => setShortcutDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleSaveShortcut()
                }
              }}
            />
            <p className="field-help">
              使用 Ctrl、Alt、Shift、Super 与字母或 F1-F24 组合，例如
              <code>Control+Alt+S</code>。
            </p>
            {shortcutError && <p className="field-error">{shortcutError}</p>}

            <div className="settings-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setShortcutDraft(shortcut.accelerator)
                  setShortcutError('')
                  setSettingsOpen(false)
                }}
              >
                取消
              </button>
              <button
                className="capture-button compact"
                type="button"
                disabled={savingShortcut}
                onClick={() => void handleSaveShortcut()}
              >
                {savingShortcut && <LoaderCircle className="spin" size={16} />}
                保存快捷键
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}