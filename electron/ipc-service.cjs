const path = require('node:path');
const { fileURLToPath } = require('node:url');

function createIpcService(nativeIpcMain, { applicationFile, devServerUrl = '' }) {
  const expectedFile = path.resolve(applicationFile);
  const devOrigin = devServerUrl ? new URL(devServerUrl).origin : '';

  function trusted(event) {
    const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
    try {
      const parsed = new URL(senderUrl);
      if (devOrigin) return parsed.origin === devOrigin;
      return parsed.protocol === 'file:' && path.resolve(fileURLToPath(parsed)) === expectedFile;
    } catch {
      return false;
    }
  }

  return {
    handle(channel, listener) {
      nativeIpcMain.handle(channel, (event, ...args) => {
        if (!trusted(event)) throw new Error('拒绝来自非应用页面的 IPC 调用');
        return listener(event, ...args);
      });
    },
  };
}

module.exports = { createIpcService };
