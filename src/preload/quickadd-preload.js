'use strict';
// Bridge for the quick-add window: add one to-do, or close. The main program checks both again.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sipQuick', {
  add: text => ipcRenderer.invoke('quick:add', text),
  close: () => ipcRenderer.send('quick:close'),
});
