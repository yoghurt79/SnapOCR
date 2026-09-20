import type { SnapOCRApi } from '@shared/ipc'

declare global {
  interface Window {
    snapOCR: SnapOCRApi
  }
}

export {}