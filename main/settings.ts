import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ShortcutSettings } from '../shared/ipc'

const DEFAULT_SHORTCUT = 'Control+Shift+X'

interface PersistedSettings {
  shortcut?: string
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function readSettings(): PersistedSettings {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8')) as PersistedSettings
  } catch {
    return {}
  }
}

export function normalizeAccelerator(input: string): string | null {
  const value = input.trim()
  if (!value || value.length > 64 || value.includes(',')) {
    return null
  }

  const tokens = value.split(/\s*\+\s*/).filter(Boolean)
  if (tokens.length === 0) {
    return null
  }

  const normalized = tokens.map((token) => {
    const key = token.toLowerCase()

    if (key === 'ctrl' || key === 'control') return 'Control'
    if (key === 'cmdorctrl' || key === 'commandorcontrol') return 'CommandOrControl'
    if (key === 'cmd' || key === 'command' || key === 'meta' || key === 'super') return 'Super'
    if (key === 'alt' || key === 'option') return 'Alt'
    if (key === 'shift') return 'Shift'
    if (/^f([1-9]|1\d|2[0-4])$/.test(key)) return key.toUpperCase()
    if (key.length === 1) return key.toUpperCase()
    return token.charAt(0).toUpperCase() + token.slice(1)
  })

  if (new Set(normalized.map((token) => token.toLowerCase())).size !== normalized.length) {
    return null
  }

  return normalized.join('+')
}

function hasModifier(accelerator: string): boolean {
  return /(?:Control|CommandOrControl|Super|Alt|Shift)\+/.test(accelerator)
}

export function isValidAccelerator(accelerator: string): boolean {
  return /^[A-Z0-9+]+$/.test(accelerator) && hasModifier(accelerator)
}

export function loadShortcut(): string {
  const stored = readSettings().shortcut
  if (!stored) return DEFAULT_SHORTCUT

  const normalized = normalizeAccelerator(stored)
  return normalized && isValidAccelerator(normalized) ? normalized : DEFAULT_SHORTCUT
}

export function saveShortcut(accelerator: string): void {
  const file = settingsPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ shortcut: accelerator }, null, 2)}\n`, 'utf8')
}

export function formatShortcut(accelerator: string): string {
  if (process.platform === 'darwin') {
    return accelerator
      .replace(/CommandOrControl|Control|Super/g, '⌘')
      .replace(/Alt/g, '⌥')
      .replace(/Shift/g, '⇧')
  }

  return accelerator.replace(/CommandOrControl|Control/g, 'Ctrl')
}

export function getShortcutSettings(): ShortcutSettings {
  const accelerator = loadShortcut()
  return {
    accelerator,
    label: formatShortcut(accelerator)
  }
}