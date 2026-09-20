# Conventional Commits 提交记录

以下提交序列适合按功能评审，也可以拆成更小的 PR。

```text
chore: initialize electron-vite with React 19 and TypeScript

feat(main): add secure window and typed IPC preload bridge

feat(capture): add primary screen capture and global shortcut

feat(tray): keep SnapOCR running in the system tray

feat(ocr): recognize English and Simplified Chinese with Tesseract.js

feat(clipboard): copy OCR result through the Electron clipboard API

feat(settings): allow users to change the global shortcut

feat(ui): add frameless spotlight panel and progress states

build(ocr): bundle worker, core, and traineddata assets for offline use

build(win): add NSIS packaging configuration

docs: document setup, privacy model, packaging, and MIT license
```

提交正文建议使用祈使句，并说明变更原因。例如：

```text
feat(ocr): recognize English and Simplified Chinese offline

Load Tesseract.js in a browser Web Worker and bundle traineddata with
the installer so recognition never requires a network request.
```