import type { UpdateStatusSnapshot } from '../../updates'

export type UpdateStatusChangedEvent = UpdateStatusSnapshot

export interface UpdatesIpcEventContract {
  'updates:status-changed': UpdateStatusChangedEvent
}
