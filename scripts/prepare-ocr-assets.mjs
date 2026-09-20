import { constants } from 'node:fs'
import {
  access,
  copyFile,
  mkdir,
  readdir,
  stat,
  writeFile
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const publicDirectory = join(projectRoot, 'src', 'renderer', 'public')
const ocrDirectory = join(publicDirectory, 'ocr')
const coreDirectory = join(ocrDirectory, 'core')
const tessdataDirectory = join(publicDirectory, 'tessdata')
const dependenciesDirectory = join(projectRoot, 'node_modules')
const languages = ['eng', 'chi_sim']
const minimumLanguageFileSize = 10_000
const defaultDataPackageBaseUrl = 'https://tessdata.projectnaptha.com'
const defaultDataVersion = '4.0.0'
const forceAssetRefresh = process.env.SNAPOCR_FORCE_OCR_ASSETS === '1'

async function exists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function copyIfPresent(source, destination, label) {
  if (!(await exists(source))) {
    throw new Error(
      `Missing ${label}: ${source}\nRun your package manager install command before preparing OCR assets.`
    )
  }

  await copyFile(source, destination)
  console.log(`[ocr] copied ${label}`)
}

async function copyWorker() {
  const source = join(dependenciesDirectory, 'tesseract.js', 'dist', 'worker.min.js')
  const destination = join(ocrDirectory, 'worker.min.js')
  await copyIfPresent(source, destination, 'tesseract.js worker')
}

async function findCoreDirectory() {
  const tesseractPackage = join(dependenciesDirectory, 'tesseract.js', 'package.json')
  const requireFromTesseract = createRequire(tesseractPackage)

  try {
    return dirname(requireFromTesseract.resolve('tesseract.js-core'))
  } catch {
    const pnpmDirectory = join(dependenciesDirectory, '.pnpm')
    const entries = await readdir(pnpmDirectory, { withFileTypes: true }).catch(() => [])
    const corePackage = entries.find(
      (entry) => entry.isDirectory() && entry.name.startsWith('tesseract.js-core@')
    )

    if (corePackage) {
      return join(pnpmDirectory, corePackage.name, 'node_modules', 'tesseract.js-core')
    }

    return join(dependenciesDirectory, 'tesseract.js-core')
  }
}

async function copyCore() {
  const sourceDirectory = await findCoreDirectory()
  const entries = await readdir(sourceDirectory, { withFileTypes: true }).catch(() => [])
  const runtimeFiles = entries.filter(
    (entry) =>
      entry.isFile() &&
      (entry.name.endsWith('.js') || entry.name.endsWith('.wasm')) &&
      !entry.name.endsWith('.map')
  )

  if (runtimeFiles.length === 0) {
    throw new Error(
      `Missing tesseract.js-core runtime files: ${sourceDirectory}\nRun your package manager install command before preparing OCR assets.`
    )
  }

  for (const entry of runtimeFiles) {
    await copyFile(join(sourceDirectory, entry.name), join(coreDirectory, entry.name))
  }

  console.log(`[ocr] copied ${runtimeFiles.length} tesseract core runtime files`)
}

async function isUsableLanguageFile(path) {
  try {
    const file = await stat(path)
    return file.isFile() && file.size >= minimumLanguageFileSize
  } catch {
    return false
  }
}

function languageSourceCandidates(fileName) {
  const configuredPaths = [
    process.env.SNAPOCR_TESSDATA_PATH,
    process.env.TESSDATA_PREFIX
  ].filter(Boolean)

  return [
    ...configuredPaths.map((directory) => join(directory, fileName)),
    join(projectRoot, 'tessdata', fileName)
  ]
}

async function prepareLanguage(language) {
  const fileName = `${language}.traineddata`
  const destination = join(tessdataDirectory, fileName)

  if (!forceAssetRefresh && (await isUsableLanguageFile(destination))) {
    console.log(`[ocr] using existing ${fileName}`)
    return
  }

  for (const source of languageSourceCandidates(fileName)) {
    if (await isUsableLanguageFile(source)) {
      await copyFile(source, destination)
      console.log(`[ocr] copied ${fileName}`)
      return
    }
  }

  const configuredBaseUrl = process.env.SNAPOCR_TESSDATA_URL?.replace(/\/$/, '')
  let compressedData = null
  let plainData = null
  let lastStatus = 0

  for (const suffix of ['.gz', '']) {
    const downloadUrl = configuredBaseUrl
      ? `${configuredBaseUrl}/${fileName}${suffix}`
      : `${defaultDataPackageBaseUrl}/${language}/${defaultDataVersion}/${fileName}${suffix}`
    console.log(`[ocr] downloading ${downloadUrl}`)
    const response = await fetch(downloadUrl, { redirect: 'follow' })

    if (!response.ok) {
      lastStatus = response.status
      continue
    }

    const data = Buffer.from(await response.arrayBuffer())
    if (suffix === '.gz') {
      compressedData = data
    } else {
      plainData = data
    }
    break
  }

  const data = compressedData ? gunzipSync(compressedData) : plainData
  if (!data) {
    throw new Error(`Failed to download ${fileName}: HTTP ${lastStatus || 'unknown'}`)
  }
  if (data.byteLength < minimumLanguageFileSize) {
    throw new Error(`Downloaded ${fileName} looks invalid (${data.byteLength} bytes).`)
  }

  await writeFile(destination, data)
  console.log(`[ocr] saved ${fileName} (${(data.byteLength / 1024 / 1024).toFixed(1)} MiB)`)
}

async function validateAssets() {
  const requiredFiles = [
    join(ocrDirectory, 'worker.min.js'),
    ...languages.map((language) => join(tessdataDirectory, `${language}.traineddata`))
  ]

  for (const file of requiredFiles) {
    if (!(await isUsableLanguageFile(file))) {
      throw new Error(`OCR asset validation failed: ${file}`)
    }
  }
}

await Promise.all([
  mkdir(coreDirectory, { recursive: true }),
  mkdir(tessdataDirectory, { recursive: true })
])

await copyWorker()
await copyCore()
await Promise.all(languages.map((language) => prepareLanguage(language)))
await validateAssets()

console.log('[ocr] offline OCR assets are ready')