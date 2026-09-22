import { app, Notification } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { UpdateDownloadedEvent } from 'electron-updater/out/types'
import type { UpdateStatusKind, UpdateStatusSnapshot } from '@shared/updates'
import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import { createLogger } from '../logger'
import { emitIpcEvent } from '../ipc/events'
import { getMainWindow } from '../windows/mainWindow'

const log = createLogger('updates')

const UPDATE_SOURCE = {
  provider: 'github' as const,
  owner: 'thpiroc' as const,
  repo: 'FluvixNexus' as const
}

let configured = false
let startupCheckScheduled = false

let snapshot: UpdateStatusSnapshot = createSnapshot('idle')

function createSnapshot(
  status: UpdateStatusKind,
  update: Partial<Omit<UpdateStatusSnapshot, 'status' | 'currentVersion' | 'source'>> = {}
): UpdateStatusSnapshot {
  return {
    status,
    currentVersion: app.getVersion(),
    updateVersion: null,
    releaseName: null,
    releaseDate: null,
    message: null,
    lastCheckedAt: null,
    progress: null,
    source: UPDATE_SOURCE,
    ...update
  }
}

function updateSnapshot(
  status: UpdateStatusKind,
  update: Partial<Omit<UpdateStatusSnapshot, 'status' | 'currentVersion' | 'source'>> = {}
): UpdateStatusSnapshot {
  snapshot = createSnapshot(status, {
    updateVersion: snapshot.updateVersion,
    releaseName: snapshot.releaseName,
    releaseDate: snapshot.releaseDate,
    message: snapshot.message,
    lastCheckedAt: snapshot.lastCheckedAt,
    progress: snapshot.progress,
    ...update
  })

  emitIpcEvent(IPC_EVENT_CHANNELS.UPDATES_STATUS_CHANGED, snapshot)

  return snapshot
}

function configureUpdater(): void {
  if (configured) {
    return
  }

  configured = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.disableWebInstaller = true
  autoUpdater.logger = {
    info: (message?: unknown) => log.info(String(message ?? '')),
    warn: (message?: unknown) => log.warn(String(message ?? '')),
    error: (message?: unknown) => log.error(String(message ?? ''))
  }

  autoUpdater.setFeedURL(UPDATE_SOURCE)

  autoUpdater.on('checking-for-update', () => {
    log.info('checking for updates.')
    updateSnapshot('checking', {
      message: null,
      progress: null
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    log.info(`no update available. latest=${info.version}`)
    updateSnapshot('not-available', {
      updateVersion: info.version,
      releaseName: info.releaseName ?? null,
      releaseDate: info.releaseDate ?? null,
      lastCheckedAt: Date.now(),
      message: null,
      progress: null
    })
  })

  autoUpdater.on('update-available', (info) => {
    log.info(`update available. version=${info.version}`)
    updateSnapshot('available', updateInfoSnapshot(info))
    showUpdateAvailableNotification(info)
  })

  autoUpdater.on('download-progress', (progress) => {
    updateSnapshot('downloading', {
      progress: progressSnapshot(progress),
      message: null
    })
  })

  autoUpdater.on('update-downloaded', (event) => {
    log.info(`update downloaded. version=${event.version}`)
    updateSnapshot('downloaded', {
      ...updateInfoSnapshot(event),
      message: null,
      progress: null
    })
  })

  autoUpdater.on('error', (error) => {
    log.warn('update operation failed.', error)
    updateSnapshot('error', {
      message: describeUpdateError(error),
      progress: null,
      lastCheckedAt: snapshot.status === 'checking' ? Date.now() : snapshot.lastCheckedAt
    })
  })
}

function updateInfoSnapshot(
  info: UpdateInfo | UpdateDownloadedEvent
): Pick<
  UpdateStatusSnapshot,
  'updateVersion' | 'releaseName' | 'releaseDate' | 'lastCheckedAt' | 'progress'
> {
  return {
    updateVersion: info.version,
    releaseName: info.releaseName ?? null,
    releaseDate: info.releaseDate ?? null,
    lastCheckedAt: Date.now(),
    progress: null
  }
}

function progressSnapshot(progress: ProgressInfo): UpdateStatusSnapshot['progress'] {
  return {
    percent: clampProgressPercent(progress.percent),
    transferred: Math.max(0, progress.transferred),
    total: Math.max(0, progress.total),
    bytesPerSecond: Math.max(0, progress.bytesPerSecond)
  }
}

function clampProgressPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(100, Math.max(0, value))
}

function describeUpdateError(error: Error): string {
  if (error.message.trim().length > 0) {
    return error.message
  }

  return 'The update operation failed.'
}

function showUpdateAvailableNotification(info: UpdateInfo): void {
  if (!Notification.isSupported()) {
    return
  }

  try {
    const notification = new Notification({
      title: 'Fluvix Nexus update available',
      body: `Version ${info.version} is ready to download.`
    })

    notification.on('click', () => {
      const window = getMainWindow()
      if (window === null) {
        return
      }

      if (window.isMinimized()) {
        window.restore()
      }
      window.focus()
    })

    notification.show()
  } catch (cause) {
    log.warn('failed to show update notification.', cause)
  }
}

export function startUpdateService(): void {
  configureUpdater()

  if (startupCheckScheduled) {
    return
  }

  startupCheckScheduled = true

  setTimeout(() => {
    void checkForUpdates()
  }, 5000)
}

export function getUpdateStatus(): UpdateStatusSnapshot {
  configureUpdater()
  return snapshot
}

export async function checkForUpdates(): Promise<UpdateStatusSnapshot> {
  configureUpdater()

  if (!app.isPackaged) {
    log.info('skipping update check in development mode.')
    return updateSnapshot('unsupported', {
      message: 'Updates are available only in the packaged Windows app.',
      progress: null,
      lastCheckedAt: Date.now()
    })
  }

  if (snapshot.status === 'checking' || snapshot.status === 'downloading') {
    return snapshot
  }

  try {
    const result = await autoUpdater.checkForUpdates()

    if (result === null) {
      return updateSnapshot('unsupported', {
        message: 'The updater is not active in this environment.',
        progress: null,
        lastCheckedAt: Date.now()
      })
    }

    if (!result.isUpdateAvailable) {
      return updateSnapshot('not-available', {
        ...updateInfoSnapshot(result.updateInfo),
        message: null
      })
    }

    return updateSnapshot('available', {
      ...updateInfoSnapshot(result.updateInfo),
      message: null
    })
  } catch (cause) {
    log.warn('update check failed.', cause)
    return updateSnapshot('error', {
      message: describeUpdateError(cause instanceof Error ? cause : new Error(String(cause))),
      progress: null,
      lastCheckedAt: Date.now()
    })
  }
}

export async function downloadUpdate(): Promise<UpdateStatusSnapshot> {
  configureUpdater()

  if (snapshot.status === 'downloaded') {
    return snapshot
  }

  if (snapshot.status !== 'available' && snapshot.status !== 'error') {
    return snapshot
  }

  try {
    updateSnapshot('downloading', {
      message: null,
      progress: null
    })

    await autoUpdater.downloadUpdate()

    return snapshot
  } catch (cause) {
    log.warn('update download failed.', cause)
    return updateSnapshot('error', {
      message: describeUpdateError(cause instanceof Error ? cause : new Error(String(cause))),
      progress: null
    })
  }
}

export function installDownloadedUpdate(): void {
  configureUpdater()

  if (snapshot.status !== 'downloaded') {
    return
  }

  log.info('installing downloaded update after user request.')
  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true)
  })
}
