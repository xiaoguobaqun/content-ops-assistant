/* eslint-disable prefer-promise-reject-errors */
import app from './server'
import http from "http";
const port = process.env.userConfig.BuiltInServerPort
var server = null
app.set('port', port)

// 端口被短暂占用（例如上一个实例刚被强杀、Windows TIME_WAIT 未释放）时自动重试，
// 避免内置服务悄悄启动失败，导致渲染进程读不到账号数据。
const MAX_BIND_RETRY = 5;

function tryListen(remaining, resolve, reject) {
  const srv = http.createServer(app)

  function onError(error) {
    srv.removeListener('listening', onListening)
    if (error && error.code === 'EADDRINUSE' && remaining > 0) {
      console.log(
        `内置服务端口 ${port} 被占用，1.5s 后重试（还剩 ${remaining} 次）`
      )
      setTimeout(() => tryListen(remaining - 1, resolve, reject), 1500)
      return
    }
    switch (error.code) {
      case 'EACCES':
        reject('权限不足内置服务器启动失败，请使用管理员权限运行。')
        break
      default:
        reject(error)
    }
  }

  function onListening() {
    srv.removeListener('error', onError)
    server = srv
    resolve('服务端运行中' + port)
  }

  srv.on('error', onError)
  srv.on('listening', onListening)
  // 只绑定回环地址：内置服务仅服务本机界面与本地 HTTP API，不向局域网暴露。
  srv.listen(port, '127.0.0.1')
}

export default {
  StatrServer () {
    return new Promise((resolve, reject) => {
      console.log('启动服务--------', port)
      tryListen(MAX_BIND_RETRY, resolve, reject)
    })
  },
  StopServer () {
    return new Promise((resolve, reject) => {
      if (server) {
        server.close()
        server.on('close', () => {
          server = null
          resolve(1)
        })
      } else {
        reject('服务端尚未开启')
      }
    })
  }
}
