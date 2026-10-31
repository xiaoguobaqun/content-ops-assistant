import { getServerToken } from "./serverToken";

export default function (data) {
  return new Promise((resFn) => {
    getServerToken()
      .catch(() => "")
      .then((token) => {
        const headers = {
          Accept: "application/json",
          "Content-Type": "application/json",
        };
        // 有空令牌才附带：空自定义头同样会触发 CORS 预检，多此一举
        if (token) headers["X-Matrix-Token"] = token;
        return fetch("http://localhost:30088/changeData", {
          method: "POST",
          headers,
          body: JSON.stringify(data),
        });
      })
      .then((r) => r.json())
      .then((r) => {
        resFn(r);
      })
      .catch((err) => {
        console.warn("[dataRequest] 请求失败:", (err && err.message) || err);
        resFn({ success: false, message: "本地服务请求失败" });
      });
  });
}
