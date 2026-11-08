/**
 * 通知事件、载荷构造与通道发送。
 *
 * 这里只放纯逻辑与两个通道的 HTTP 调用，便于单元测试直接覆盖；
 * 插件入口（index.js）负责把会话事件接到这些函数上。
 */

/** 通知通道：Gotify、通用 Webhook 与 ntfy。 */
export const CHANNEL_GOTIFY = 'gotify'
export const CHANNEL_WEBHOOK = 'webhook'
export const CHANNEL_NTFY = 'ntfy'

/** 全部通道，按配置页的展示顺序排列。 */
export const CHANNELS = [CHANNEL_GOTIFY, CHANNEL_WEBHOOK, CHANNEL_NTFY]

/** 任务正常完成。 */
export const EVENT_TASK_COMPLETE = 'task-complete'
/** 任务未正常完成（被中止、报错、超出 token 上限、崩溃遗留等）。 */
export const EVENT_TASK_INTERRUPTED = 'task-interrupted'
/** 工具调用需要用户审批。 */
export const EVENT_APPROVAL_REQUIRED = 'approval-required'
/** 助手向用户提问，等待回答。 */
export const EVENT_QUESTION_REQUIRED = 'question-required'

/** 全部事件，按配置页的展示顺序排列。 */
export const EVENTS = [
  EVENT_TASK_COMPLETE,
  EVENT_TASK_INTERRUPTED,
  EVENT_APPROVAL_REQUIRED,
  EVENT_QUESTION_REQUIRED,
]

/** 事件的中文标题，进入通知正文。 */
export const EVENT_TITLES = {
  [EVENT_TASK_COMPLETE]: '任务完成',
  [EVENT_TASK_INTERRUPTED]: '任务中断',
  [EVENT_APPROVAL_REQUIRED]: '需要审批',
  [EVENT_QUESTION_REQUIRED]: '需要回答问题',
}

/** 提问工具的名字；工具调用事件用它识别「等待用户回答」。 */
export const QUESTION_TOOL_NAME = 'ask_user_question'

/**
 * ntfy 的优先级档位。
 *
 * ntfy 只认 1-5 五个整数：1 最低、3 默认、5 最高（urgent）。
 */
export const NTFY_PRIORITY_LEVELS = [
  { value: 1, key: 'min' },
  { value: 2, key: 'low' },
  { value: 3, key: 'default' },
  { value: 4, key: 'high' },
  { value: 5, key: 'max' },
]

/** ntfy 优先级缺省值：default。 */
export const NTFY_DEFAULT_PRIORITY = 3
/** Gotify 优先级缺省值。 */
export const GOTIFY_DEFAULT_PRIORITY = 5

/** Webhook 请求体的默认模板，占位符用 {{name}}。 */
export const DEFAULT_WEBHOOK_BODY = [
  '{"event":"{{event}}",',
  '"title":"{{title}}",',
  '"message":"{{message}}",',
  '"sessionId":"{{sessionId}}",',
  '"sessionTitle":"{{sessionTitle}}",',
  '"timestamp":"{{timestamp}}"}',
].join('')

/**
 * 判断一条会话事件属于哪一类通知。
 * @param {object} event 会话事件（SessionEvent）。
 * @returns {string|undefined} 事件类别；不属于通知范围时返回 undefined。
 */
export function classifyEvent(event) {
  if (!event || typeof event !== 'object') return undefined
  switch (event.type) {
    case 'turn/end': {
      const kind = event.data?.reason?.kind
      if (kind === 'completed') return EVENT_TASK_COMPLETE
      // fork 是分叉种子构造的收尾，不是用户视角的任务结束。
      if (kind === 'forked') return undefined
      return EVENT_TASK_INTERRUPTED
    }
    case 'approval/asked':
      return EVENT_APPROVAL_REQUIRED
    case 'tool/call':
      return event.data?.name === QUESTION_TOOL_NAME ? EVENT_QUESTION_REQUIRED : undefined
    default:
      return undefined
  }
}

/**
 * 把结束原因翻译成一句中文说明。
 * @param {object} reason TurnEndReason。
 * @returns {string} 说明文本。
 */
export function describeTurnEnd(reason) {
  if (!reason) return ''
  switch (reason.kind) {
    case 'completed':
      return '任务正常完成'
    case 'aborted':
      return `任务被中止（${describeCancelCause(reason.reason)}）`
    case 'blocked':
      return '任务被阻塞，等待外部条件'
    case 'error':
      return `任务出错：${reason.error?.message ?? '未知错误'}`
    case 'max-tokens':
      return '任务达到输出 token 上限后结束'
    case 'interrupted':
      return '任务被中断（崩溃遗留的回合）'
    case 'forked':
      return '任务被分叉'
    default:
      return String(reason.kind ?? '未知原因')
  }
}

/**
 * 把取消原因翻译成一句中文说明。
 * @param {object} cause TurnEndCancelCause。
 * @returns {string} 说明文本。
 */
export function describeCancelCause(cause) {
  if (!cause) return '未知原因'
  switch (cause.kind) {
    case 'user':
      return '用户中止'
    case 'parent':
      return '上级代理中止'
    case 'hook':
      return cause.reason ?? '钩子中止'
    case 'disposed':
      return '代理已释放'
    case 'legacy':
      return '历史记录未记录原因'
    default:
      return cause.reason ?? String(cause.kind ?? '未知原因')
  }
}

/**
 * 判断某个会话的某个事件是否应当通知。
 *
 * 优先级：总开关 → 事件是否在默认事件列表 → 会话级覆盖 → 全局默认。
 * @param {{get: () => any}} config 插件配置（volatile 字段）。
 * @param {string} sessionId 会话 ID。
 * @param {string} kind 事件类别。
 * @returns {boolean} 是否发送。
 */
export function decideNotification(config, sessionId, kind) {
  if (config.enabled?.get() !== true) return false
  const events = config.events?.get() ?? []
  if (!Array.isArray(events) || !events.includes(kind)) return false
  const overrides = config.sessionOverrides?.get() ?? {}
  if (overrides && typeof overrides === 'object' && Object.prototype.hasOwnProperty.call(overrides, sessionId)) {
    return overrides[sessionId] === true
  }
  return config.defaultNotify?.get() === true
}

/**
 * 取某个事件在某个通道上的优先级。
 *
 * 不同事件类型可以各自设置优先级：ntfy 用 1-5 五档，Gotify 用 0-10。
 * 配置里没写这个事件时，用该通道的缺省优先级。
 * @param {string} channel 通知通道。
 * @param {string} kind 事件类别。
 * @param {object} options 各通道的优先级表。
 * @param {object} [options.ntfyPriorities] ntfy 优先级表：事件 → 1-5。
 * @param {object} [options.gotifyPriorities] Gotify 优先级表：事件 → 0-10。
 * @returns {number|undefined} 优先级；Webhook 这类没有优先级的通道返回 undefined。
 */
export function priorityForChannel(channel, kind, options) {
  if (channel === CHANNEL_NTFY) {
    const raw = options?.ntfyPriorities?.[kind]
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 5) return raw
    return NTFY_DEFAULT_PRIORITY
  }
  if (channel === CHANNEL_GOTIFY) {
    const raw = options?.gotifyPriorities?.[kind]
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 10) return raw
    return GOTIFY_DEFAULT_PRIORITY
  }
  return undefined
}

/**
 * 构造通知载荷。
 *
 * 通知内容由「会话标题」「事件细节」「工作目录」几项组成，逐行拼接；
 * 会话标题缺失时退回会话 ID。
 * @param {object} options 载荷来源。
 * @param {string} options.kind 事件类别。
 * @param {string} [options.sessionId] 会话 ID。
 * @param {string} [options.sessionTitle] 会话标题。
 * @param {string} [options.cwd] 会话工作目录。
 * @param {string} [options.detail] 事件细节（结束原因、工具名等）。
 * @param {string} [options.prefix] 通知标题前缀。
 * @param {string} [options.timestamp] ISO 时间戳。
 * @returns {object} 通知载荷。
 */
export function buildPayload(options) {
  const kind = options.kind
  const label = EVENT_TITLES[kind] ?? kind
  const prefix = options.prefix ? `${options.prefix} · ` : ''
  const sessionTitle = options.sessionTitle ?? ''
  // 会话标题是通知内容里的一项；没有标题时退回会话 ID，至少让用户认得出是哪次会话。
  const titleLine = sessionTitle !== '' ? sessionTitle : (options.sessionId ?? '')
  const lines = []
  if (titleLine !== '') lines.push(`会话标题：${titleLine}`)
  if (options.detail) lines.push(options.detail)
  if (options.cwd) lines.push(`目录：${options.cwd}`)
  const message = lines.length > 0 ? lines.join('\n') : label
  return {
    event: kind,
    title: `${prefix}${label}`,
    message,
    sessionId: options.sessionId ?? '',
    sessionTitle,
    cwd: options.cwd ?? '',
    detail: options.detail ?? '',
    timestamp: options.timestamp ?? new Date().toISOString(),
  }
}

/**
 * 把载荷填进模板占位符。
 *
 * 字符串按 JSON 字面量转义后再去掉外层引号，这样带引号或换行的正文
 * 填进 JSON 模板也不会破坏请求体。
 * @param {string} template 模板文本。
 * @param {object} payload 通知载荷。
 * @returns {string} 渲染后的文本。
 */
export function renderTemplate(template, payload) {
  const text = typeof template === 'string' && template.trim() !== '' ? template : DEFAULT_WEBHOOK_BODY
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, key) => escapeTemplateValue(payload?.[key]))
}

/**
 * 把一个值转成可以放进模板的文本。
 * @param {unknown} value 载荷中的一个值。
 * @returns {string} 文本。
 */
export function escapeTemplateValue(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const text = String(value)
  if (text === '') return ''
  try {
    return JSON.stringify(text).slice(1, -1)
  } catch {
    return text
  }
}

/**
 * 解析「每行一个请求头」的文本。
 * @param {string} text 请求头文本。
 * @returns {Record<string, string>} 请求头对象。
 */
export function parseHeaderLines(text) {
  const headers = {}
  if (typeof text !== 'string') return headers
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf(':')
    if (index <= 0) continue
    const name = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim()
    if (name === '') continue
    headers[name] = value
  }
  return headers
}

/**
 * 发送一条 Gotify 通知。
 * @param {object} options 通道参数。
 * @param {string} options.url Gotify 服务器地址。
 * @param {string} options.token 应用令牌。
 * @param {number} options.priority 优先级。
 * @param {number} options.timeoutMs 超时毫秒数。
 * @param {object} payload 通知载荷。
 * @returns {Promise<{ok: true, channel: string}>} 发送结果。
 */
export async function sendGotify(options, payload) {
  const base = String(options.url ?? '').trim().replace(/\/+$/, '')
  if (base === '') throw new Error('未配置 Gotify 服务器地址')
  const token = String(options.token ?? '').trim()
  if (token === '') throw new Error('未配置 Gotify 应用令牌')
  const endpoint = `${base}/message?token=${encodeURIComponent(token)}`
  const body = JSON.stringify({
    title: payload.title,
    message: payload.message,
    priority: options.priority ?? 5,
  })
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Gotify 返回 ${response.status}${detail === '' ? '' : `：${detail.slice(0, 200)}`}`)
  }
  return { ok: true, channel: CHANNEL_GOTIFY }
}

/**
 * 发送一条 Webhook 通知。
 * @param {object} options 通道参数。
 * @param {string} options.url Webhook 地址。
 * @param {string} options.method 请求方法。
 * @param {string} options.headers 额外请求头文本。
 * @param {string} options.bodyTemplate 请求体模板。
 * @param {string} options.contentType 请求体类型。
 * @param {number} options.timeoutMs 超时毫秒数。
 * @param {object} payload 通知载荷。
 * @returns {Promise<{ok: true, channel: string}>} 发送结果。
 */
export async function sendWebhook(options, payload) {
  const url = String(options.url ?? '').trim()
  if (url === '') throw new Error('未配置 Webhook 地址')
  const method = String(options.method ?? 'POST').toUpperCase()
  const headers = {
    'content-type': options.contentType ?? 'application/json',
    ...parseHeaderLines(options.headers),
  }
  const body = renderTemplate(options.bodyTemplate, payload)
  const response = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Webhook 返回 ${response.status}${detail === '' ? '' : `：${detail.slice(0, 200)}`}`)
  }
  return { ok: true, channel: CHANNEL_WEBHOOK }
}

/**
 * 发送一条 ntfy 通知。
 *
 * 用 ntfy 的 JSON 发布接口：请求体带 topic，因此服务器地址可以带路径前缀
 * （例如 https://host/ntfy），也不会因为标题里的中文而坏掉请求头。
 * @param {object} options 通道参数。
 * @param {string} options.url ntfy 服务器地址。
 * @param {string} options.topic 主题。
 * @param {string} options.token 访问令牌；为空则匿名发布。
 * @param {number} options.priority 优先级，1-5。
 * @param {number} options.timeoutMs 超时毫秒数。
 * @param {object} payload 通知载荷。
 * @returns {Promise<{ok: true, channel: string}>} 发送结果。
 */
export async function sendNtfy(options, payload) {
  const base = String(options.url ?? '').trim().replace(/\/+$/, '')
  if (base === '') throw new Error('未配置 ntfy 服务器地址')
  const topic = String(options.topic ?? '').trim()
  if (topic === '') throw new Error('未配置 ntfy 主题')
  const token = String(options.token ?? '').trim()
  const headers = { 'content-type': 'application/json' }
  if (token !== '') headers['authorization'] = `Bearer ${token}`
  const body = JSON.stringify({
    topic,
    title: payload.title,
    message: payload.message,
    priority: options.priority ?? NTFY_DEFAULT_PRIORITY,
  })
  const response = await fetch(base, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`ntfy 返回 ${response.status}${detail === '' ? '' : `：${detail.slice(0, 200)}`}`)
  }
  return { ok: true, channel: CHANNEL_NTFY }
}
