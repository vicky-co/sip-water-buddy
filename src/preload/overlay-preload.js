'use strict';
// Bridge for the character window. It exposes a few named functions only, never the raw IPC object.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sip', {
  platform: process.platform,
  move: (x, y, w, h) => ipcRenderer.send('move', x, y, w, h),
  logGlass: () => ipcRenderer.invoke('log-glass'),
  done: info => ipcRenderer.send('done', info),
  onAppear: cb => ipcRenderer.on('appear', (_e, d) => cb(d)),
  onSettings: cb => ipcRenderer.on('settings', (_e, d) => cb(d)),
  setSetting: s => ipcRenderer.send('set-setting', s),
  loadAvatar: id => ipcRenderer.invoke('load-avatar', id),
  loadPet: id => ipcRenderer.invoke('load-pet', id),
  loadSound: id => ipcRenderer.invoke('load-sound', id),
  petError: (id, msg) => ipcRenderer.send('pet-error', id, msg),
  avatarError: (id, msg) => ipcRenderer.send('avatar-error', id, msg),
  onTestSound: cb => ipcRenderer.on('test-sound', (_e, id) => cb(id)),
  reportStatus: st => ipcRenderer.send('status', st),
  setClickThrough: ignore => ipcRenderer.send('click-through', ignore),
  openSettings: () => ipcRenderer.send('open-settings'),
});
