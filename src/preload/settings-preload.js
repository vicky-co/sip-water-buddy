'use strict';
// Bridge for the Settings window. Every call is checked again by the main process.
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke('settings:' + ch, ...a);
contextBridge.exposeInMainWorld('sipSettings', {
  getState: () => call('get'),
  patch: p => call('patch', p),
  addFile: kind => call('add-file', kind),
  removeFile: (kind, id) => call('remove-file', kind, id),
  playSound: id => call('play-sound', id),
  reminderAdd: input => call('reminder-add', input),
  reminderUpdate: (id, patch) => call('reminder-update', id, patch),
  reminderDelete: id => call('reminder-delete', id),
  reminderClearDone: () => call('reminder-clear-done'),
  reminderTest: id => call('reminder-test', id),
  water: op => call('water', op),
  askNow: () => call('ask-now'),
  openLog: () => call('open-log'),
  openLink: key => call('open-link', key),
  onState: cb => ipcRenderer.on('settings:state', (_e, s) => cb(s)),
  onNotice: cb => ipcRenderer.on('settings:notice', (_e, m) => cb(m)),
  onNavigate: cb => ipcRenderer.on('settings:navigate', (_e, t) => cb(t)),
});
