'use strict';
// Bridge for the quick-add window: add one to-do, or close. The main program checks both again.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sipQuick', {
  add: (text, due) => ipcRenderer.invoke('quick:add', text, due),
  close: () => ipcRenderer.send('quick:close'),
});
