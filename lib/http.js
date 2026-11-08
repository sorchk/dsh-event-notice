/**
 * 配置页用到的 HTTP 路由：发送测试通知。
 *
 * 路由挂在 DSH 自带的 webServer 上，只接受同源请求，
 * 避免其它站点借浏览器把通知发到用户配置的服务器。
 */

/** 路由前缀。 */
export const BASE_PATH = '/dsh-event-notice'

/**
 * 判断请求是否来自同源的回环地址。
 * @param {object} request Node 风格请求对象。
 * @returns {boolean} 是否放行。
 */
export function sameOrigin(request) {
  const host = request.headers?.host
  if (host !== undefined && !loopbackAuthority(host)) return false
  if (request.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers?.origin
  if (origin === undefined) return true
  try {
    const originUrl = new URL(origin)
    if (originUrl.host === host) return true
    if (originUrl.port === '' && host !== undefined && loopbackAuthority(host)) {
      const hostname = host.startsWith('[')
        ? host.slice(0, host.indexOf(']') + 1)
        : host.split(':')[0]
      return originUrl.hostname === hostname
    }
    return false
  } catch {
    return false
  }
}

/**
 * 判断 authority 是否是回环地址。
 * @param {string} authority host 头。
 * @returns {boolean} 是否回环。
 */
function loopbackAuthority(authority) {
  const hostname = authority.startsWith('[')
    ? authority.slice(1, authority.indexOf(']'))
    : authority.split(':')[0]
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

/**
 * 以 JSON 形式回应请求。
 * @param {object} response Node 风格响应对象。
 * @param {number} status HTTP 状态码。
 * @param {object} body 响应体。
 */
export function sendJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

/**
 * 注册本插件的 HTTP 路由。
 * @param {object} webServer DSH 的 webServer 服务。
 * @param {() => Promise<object>} sendTest 发送测试通知并返回结果汇总。
 * @returns {() => void} 注销路由的函数。
 */
export function registerRoutes(webServer, sendTest) {
  const disposer = webServer.register({
    kind: 'exact',
    path: `${BASE_PATH}/test`,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST' })
        response.end()
        return
      }
      if (!sameOrigin(request)) {
        sendJson(response, 403, { error: 'cross-origin request refused' })
        return
      }
      try {
        sendJson(response, 200, await sendTest())
      } catch (error) {
        sendJson(response, 500, { error: String(error?.message ?? error) })
      }
    },
  })
  return () => disposer()
}
