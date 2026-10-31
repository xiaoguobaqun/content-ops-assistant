// 主进程侧的内置服务客户端（与渲染进程 utils/dataRequest 对应）。
// Node fetch 不带 Origin，必须带上启动令牌才能通过 /changeData 守卫。
import { SERVER_REQUEST_TOKEN } from "../server/requestGuard";

export default function (data) {
  return new Promise((resFn) => {
    fetch("http://localhost:30088/changeData", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Matrix-Token": SERVER_REQUEST_TOKEN,
      },
      body: JSON.stringify(data),
    })
      .then((r) => r.json())
      .then((r) => resFn(r))
      .catch((err) => {
        console.warn("[dataRequest] self", (err && err.message) || err);
        resFn({ success: false, message: "本地服务请求失败" });
      });
  });
}
