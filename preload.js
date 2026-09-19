const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('careerWings', {
  connect: () => ipcRenderer.invoke('connect'),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  sendCampaign: payload => ipcRenderer.invoke('send-campaign', payload),
  stopCampaign: () => ipcRenderer.invoke('stop-campaign'),
  importCsv: () => ipcRenderer.invoke('import-csv'),
  onState: callback => ipcRenderer.on('state', (_event, state) => callback(state))
});
