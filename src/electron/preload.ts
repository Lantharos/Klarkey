import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@/electron/constants'
import type { KlarkeyApi } from '@/shared/ipc'

const api: KlarkeyApi = {
  palette: {
    open: () => ipcRenderer.invoke(IPC_CHANNELS.paletteOpen),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.paletteClose),
  },
  command: {
    parse: (raw) => ipcRenderer.invoke(IPC_CHANNELS.commandParse, raw),
  },
  search: {
    resolve: (query) => ipcRenderer.invoke(IPC_CHANNELS.searchResolve, query),
  },
  action: {
    execute: (actionId, modifier) => ipcRenderer.invoke(IPC_CHANNELS.actionExecute, actionId, modifier),
  },
  item: {
    get: (itemId) => ipcRenderer.invoke(IPC_CHANNELS.itemGet, itemId),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.itemCreate, input),
    update: (input) => ipcRenderer.invoke(IPC_CHANNELS.itemUpdate, input),
    delete: (itemId) => ipcRenderer.invoke(IPC_CHANNELS.itemDelete, itemId),
  },
  vault: {
    unlock: () => ipcRenderer.invoke(IPC_CHANNELS.vaultUnlock),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    set: (update) => ipcRenderer.invoke(IPC_CHANNELS.settingsSet, update),
  },
  onPrepareOpen: (callback) => {
    const listener = () => callback()
    ipcRenderer.on(IPC_CHANNELS.palettePrepare, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.palettePrepare, listener)
  },
  onFocusRequest: (callback) => {
    const listener = () => callback()
    ipcRenderer.on(IPC_CHANNELS.paletteFocus, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.paletteFocus, listener)
  },
}

contextBridge.exposeInMainWorld('klarkey', api)
