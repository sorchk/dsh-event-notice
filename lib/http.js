/**
 * 配置页用到的 HTTP 路由：发送测试通知。
 *
 * 路由挂在 DSH 自带的 webServer 上，只接受同源请求，
 * 避免其它站点借浏览器把通知发到用户配置的服务器。
 */

/** 路由前缀。 */
export const BASE_PATH = '/dsh-event-notice'

/**
 * 判断请求是否来自同源。
 *
 * 判定以「Origin 与 Host 完全一致」为准：浏览器发起的同源 POST 一定会带上
 * Origin 头，跨站请求的 Origin 则是攻击者自己的域名，两者对不上直接拒绝。
 * 不能把「Host 必须是回环地址」当作放行条件，否则通过局域网 IP、主机名、
 * Tailscale 地址或反向代理域名访问 DSH Web 时，同源请求也会被误判为跨站。
 *
 * @param {object} request Node 风格请求对象。
 * @returns {boolean} 是否放行。
 */
export function sameOrigin(request) {
  const headers = request.headers ?? {}
  // 浏览器明确标记为跨站的请求一律拒绝。
  if (headers['sec-fetch-site'] === 'cross-site') return false
  const host = headers.host
  const origin = headers.origin
  if (origin === undefined) {
    // 没有 Origin 头：只放行回环地址上的请求（本地 curl、命令行自测）。
    return host === undefined || loopbackAuthority(host)
  }
  let originUrl
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }
  if (host === undefined) return loopbackHostname(originUrl.hostname)
  if (originUrl.host === host) return true
  // origin 没写端口、host 是回环地址带端口：视作同一个回环地址。
  if (originUrl.port === '' && loopbackAuthority(host)) {
    return originUrl.hostname === hostnameOf(host)
  }
  return false
}

/**
 * 从 host 头里取出主机名。
 * @param {string} authority host 头。
 * @returns {string} 主机名，IPv6 不带方括号。
 */
function hostnameOf(authority) {
  return authority.startsWith('[')
    ? authority.slice(1, authority.indexOf(']'))
    : authority.split(':')[0]
}

/**
 * 判断主机名是否是回环地址。
 * @param {string} hostname 主机名。
 * @returns {boolean} 是否回环。
 */
function loopbackHostname(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

/**
 * 判断 authority 是否是回环地址。
 * @param {string} authority host 头。
 * @returns {boolean} 是否回环。
 */
function loopbackAuthority(authority) {
  return loopbackHostname(hostnameOf(authority))
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
