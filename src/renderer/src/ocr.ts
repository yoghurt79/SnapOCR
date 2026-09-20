import { createWorker, OEM, type Worker as TesseractWorker } from 'tesseract.js'

export interface OcrProgress {
  label: string
  progress: number
}

export interface OcrResult {
  text: string
  confidence: number
}

interface TesseractLoggerMessage {
  status: string
  progress: number
}

const WORKER_INIT_TIMEOUT_MS = 45_000
let workerPromise: Promise<TesseractWorker> | null = null
let activeProgressListener: ((progress: OcrProgress) => void) | null = null

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    'loading tesseract core': '加载 OCR 内核',
    'initializing tesseract': '初始化 OCR 引擎',
    'loading language traineddata': '加载中英文语言包',
    'initializing api': '准备识别服务',
    'recognizing text': '识别文字'
  }

  return labels[status] ?? '准备 OCR'
}

function assetUrl(relativePath: string): string {
  return new URL(relativePath, window.location.href).toString()
}

function createAbortError(): DOMException {
  return new DOMException('OCR recognition was stopped.', 'AbortError')
}

async function createOcrWorker(): Promise<TesseractWorker> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const pendingWorker = createWorker(['eng', 'chi_sim'], OEM.LSTM_ONLY, {
    workerPath: assetUrl('ocr/worker.min.js'),
    corePath: assetUrl('ocr/core'),
    langPath: assetUrl('tessdata'),
    cacheMethod: 'none',
    gzip: false,
    errorHandler: (error: unknown) => {
      console.error('Tesseract worker error:', error)
    },
    logger: (message: TesseractLoggerMessage) => {
      activeProgressListener?.({
        label: statusLabel(message.status),
        progress: Math.max(0, Math.min(100, Math.round(message.progress * 100)))
      })
    }
  })

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          'OCR 引擎初始化超时。请检查离线资源是否完整，或停止后重试。'
        )
      )
    }, WORKER_INIT_TIMEOUT_MS)
  })

  try {
    const worker = await Promise.race([pendingWorker, timeout])
    await worker.setParameters({
      preserve_interword_spaces: '1'
    })
    return worker
  } catch (error) {
    void pendingWorker
      .then((worker) => worker.terminate())
      .catch(() => undefined)
    throw error
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createOcrWorker().catch((error) => {
      workerPromise = null
      throw error
    })
  }

  return workerPromise
}

export function stopRecognition(): void {
  activeProgressListener = null

  const pendingWorker = workerPromise
  workerPromise = null

  if (!pendingWorker) {
    return
  }

  void pendingWorker
    .then((worker) => worker.terminate())
    .catch(() => undefined)
}

export async function recognizeImage(
  dataUrl: string,
  onProgress: (progress: OcrProgress) => void,
  signal?: AbortSignal
): Promise<OcrResult> {
  if (signal?.aborted) {
    throw createAbortError()
  }

  const progressListener = onProgress
  const handleAbort = (): void => {
    stopRecognition()
  }

  activeProgressListener = progressListener
  signal?.addEventListener('abort', handleAbort, { once: true })
  onProgress({ label: '唤醒本地 OCR 引擎', progress: 2 })

  try {
    const worker = await getWorker()
    if (signal?.aborted) {
      throw createAbortError()
    }

    const result = await worker.recognize(dataUrl)
    if (signal?.aborted) {
      throw createAbortError()
    }

    return {
      text: result.data.text.trim(),
      confidence: result.data.confidence
    }
  } catch (error) {
    if (signal?.aborted) {
      throw createAbortError()
    }
    throw error
  } finally {
    signal?.removeEventListener('abort', handleAbort)
    if (activeProgressListener === progressListener) {
      activeProgressListener = null
    }
  }
}