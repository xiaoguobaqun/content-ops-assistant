import { BrowserWindow } from "electron";
import { buildAccountPartition } from "../../shared/accountPartition.js";
import { collectDyWorksInPage } from "./douyinWorksPage.js";

export async function queryDouyinWorks({ phone, workId, timeoutMs = 90000 }) {
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: {
    partition: buildAccountPartition(phone, "抖音"), backgroundThrottling: false,
    nodeIntegration: false, contextIsolation: true,
  } });
  let timer;
  try {
    return await Promise.race([
      (async () => {
        await win.loadURL("https://creator.douyin.com/creator-micro/content/manage");
        if (/login|passport/.test(win.webContents.getURL())) throw Error("登录态失效，请先登录");
        await new Promise(resolve => setTimeout(resolve, 6000));
        const result=await win.webContents.executeJavaScript(`(${collectDyWorksInPage.toString()})()`, true);
        return result;
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error("作品回查超时")), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); if (!win.isDestroyed()) win.destroy(); }
}
