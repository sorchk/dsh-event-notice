/**
 * 「发送测试通知」路由的同源判定测试。
 *
 * 覆盖三类场景：
 *   1. 回环地址上的同源请求放行；
 *   2. 非回环地址（局域网 IP、主机名、反代域名）上的同源请求同样放行；
 *   3. 真正的跨站请求拒绝。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { BASE_PATH, registerRoutes, sameOrigin, sendJson } from '../lib/http.js'

/**
 * 造一个带请求头的假请求。
 * @param {Record<string, string>} headers 请求头。
 * @returns {object} 假请求。
 */
function fakeRequest(headers) {
  return { method: 'POST', headers }
}

/**
 * 造一个记录写入内容的假响应。
 * @returns {{response: object, status: number, body: string}} 响应与记录。
 */
function fakeResponse() {
  const record = { status: 0, body: '' }
  return {
    record,
    response: {
      writeHead(status) {
        record.status = status
      },
      end(payload) {
        record.body = payload ?? ''
      },
    },
  }
}

test('回环地址上的同源请求放行', () => {
  assert.equal(sameOrigin(fakeRequest({
    host: '127.0.0.1:3080',
    origin: 'http://127.0.0.1:3080',
  })), true)
  assert.equal(sameOrigin(fakeRequest({
    host: 'localhost:3080',
    origin: 'http://localhost:3080',
  })), true)
})

test('非回环地址上的同源请求同样放行', () => {
  // 通过局域网 IP 访问 DSH Web。
  assert.equal(sameOrigin(fakeRequest({
    host: '192.168.1.5:3080',
    origin: 'http://192.168.1.5:3080',
  })), true)
  // 通过主机名访问。
  assert.equal(sameOrigin(fakeRequest({
    host: 'dsh.lan:3080',
    origin: 'http://dsh.lan:3080',
  })), true)
  // 通过反向代理域名访问。
  assert.equal(sameOrigin(fakeRequest({
    host: 'dsh.example.com',
    origin: 'https://dsh.example.com',
  })), true)
})

test('跨站请求拒绝', () => {
  // 别的站点的 Origin。
  assert.equal(sameOrigin(fakeRequest({
    host: '127.0.0.1:3080',
    origin: 'http://evil.example.com',
  })), false)
  // 浏览器明确标记跨站。
  assert.equal(sameOrigin(fakeRequest({
    host: '192.168.1.5:3080',
    origin: 'http://192.168.1.5:3080',
    'sec-fetch-site': 'cross-site',
  })), false)
  // Origin 不是合法 URL。
  assert.equal(sameOrigin(fakeRequest({
    host: '127.0.0.1:3080',
    origin: 'not-a-url',
  })), false)
})

test('没有 Origin 时只放行回环地址', () => {
  assert.equal(sameOrigin(fakeRequest({ host: '127.0.0.1:3080' })), true)
  assert.equal(sameOrigin(fakeRequest({ host: 'localhost:3080' })), true)
  assert.equal(sameOrigin(fakeRequest({ host: '192.168.1.5:3080' })), false)
})

test('origin 不带端口、host 是回环带端口时视作同源', () => {
  assert.equal(sameOrigin(fakeRequest({
    host: '127.0.0.1:3080',
    origin: 'http://127.0.0.1',
  })), true)
  assert.equal(sameOrigin(fakeRequest({
    host: '127.0.0.1:3080',
    origin: 'http://192.168.1.5',
  })), false)
})

test('路由对跨站请求返回 403，对同源请求返回 200', async () => {
  const registered = []
  const webServer = {
    register(route) {
      registered.push(route)
      return () => {}
    },
  }
  let sent = 0
  const dispose = registerRoutes(webServer, async () => {
    sent += 1
    return { ok: true, results: [] }
  })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].path, `${BASE_PATH}/test`)

  // 跨站请求：403，不发送通知。
  const refused = fakeResponse()
  await registered[0].handler(fakeRequest({
    host: '192.168.1.5:3080',
    origin: 'http://evil.example.com',
  }), refused.response)
  assert.equal(refused.record.status, 403)
  assert.match(refused.record.body, /cross-origin/)
  assert.equal(sent, 0)

  // 非回环同源请求：200，正常发送通知。
  const allowed = fakeResponse()
  await registered[0].handler(fakeRequest({
    host: '192.168.1.5:3080',
    origin: 'http://192.168.1.5:3080',
  }), allowed.response)
  assert.equal(allowed.record.status, 200)
  assert.equal(sent, 1)

  // 非 POST 方法：405。
  const wrongMethod = fakeResponse()
  await registered[0].handler({ method: 'GET', headers: {} }, wrongMethod.response)
  assert.equal(wrongMethod.record.status, 405)

  dispose()
})

test('sendJson 写回 JSON 响应体', () => {
  const { response, record } = fakeResponse()
  sendJson(response, 200, { ok: true })
  assert.equal(record.status, 200)
  assert.deepEqual(JSON.parse(record.body), { ok: true })
})
