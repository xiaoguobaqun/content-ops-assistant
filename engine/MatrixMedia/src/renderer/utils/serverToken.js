/**
 * 内置服务（localhost:30088）访问令牌。
 *
 * 打包后渲染进程以 file:// 加载，fetch 不携带 Origin，必须带上
 * 主进程签发的随机令牌（X-Matrix-Token）才能通过 /changeData 守卫。
 * dev 模式页面带 http://localhost Origin，即使令牌为空也能通行。
 * 令牌只在内存缓存，失败降级为空字符串，不阻塞请求流程。
 */
let cachedToken = null;
let pending = null;

export function getServerToken() {
  if (cachedToken !== null) return Promise.resolve(cachedToken);
  if (!pending) {
    pending = new Promise((resolve) => {
      try {
        const { ipcRenderer } = require("electron");
        ipcRenderer
          .invoke("matrix:server-token")
          .then((token) => {
            cachedToken = String(token || "");
            resolve(cachedToken);
          })
          .catch(() => {
            cachedToken = "";
            resolve("");
          });
      } catch (e) {
        cachedToken = "";
        resolve("");
      }
    });
  }
  return pending;
}
