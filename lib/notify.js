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

/** 主任务正常完成。 */
export const EVENT_TASK_COMPLETE = 'task-complete'
/** 子任务（子代理会话）正常完成。 */
export const EVENT_SUBTASK_COMPLETE = 'subtask-complete'
/** 任务未正常完成（被中止、报错、超出 token 上限、崩溃遗留等）。 */
export const EVENT_TASK_INTERRUPTED = 'task-interrupted'
/** 工具调用需要用户审批。 */
export const EVENT_APPROVAL_REQUIRED = 'approval-required'
/** 助手向用户提问，等待回答。 */
export const EVENT_QUESTION_REQUIRED = 'question-required'

/** 全部事件，按配置页的展示顺序排列。 */
export const EVENTS = [
  EVENT_TASK_COMPLETE,
  EVENT_SUBTASK_COMPLETE,
  EVENT_TASK_INTERRUPTED,
  EVENT_APPROVAL_REQUIRED,
  EVENT_QUESTION_REQUIRED,
]

/**
 * 默认勾选的事件。
 *
 * 子任务完成不在其中：子代理的完成通知量大，默认不勾，需要时再打开。
 */
export const DEFAULT_EVENTS = [
  EVENT_TASK_COMPLETE,
  EVENT_TASK_INTERRUPTED,
  EVENT_APPROVAL_REQUIRED,
  EVENT_QUESTION_REQUIRED,
]

/** 事件的中文标题，进入通知正文。 */
export const EVENT_TITLES = {
  [EVENT_TASK_COMPLETE]: '任务完成',
  [EVENT_SUBTASK_COMPLETE]: '子任务完成',
  [EVENT_TASK_INTERRUPTED]: '任务中断',
  [EVENT_APPROVAL_REQUIRED]: '需要审批',
  [EVENT_QUESTION_REQUIRED]: '需要回答问题',
}

/** 提问工具的名字；工具调用事件用它识别「等待用户回答」。 */
export const QUESTION_TOOL_NAME = 'ask_user_question'

/**
 * 卡片样式下每个事件对应的卡片头颜色。
 *
 * ntfy 与 Gotify 的协议里都没有颜色字段，卡片头的颜色只能靠一个彩色圆点表示：
 * ntfy 客户端会把圆点排在标题前面，Gotify 直接把圆点写进标题。
 * 颜色按事件类型区分，语义比按优先级档位更稳定。
 */
export const EVENT_CARD_STYLES = {
  [EVENT_TASK_COMPLETE]: { emoji: '🟢', color: 'green' },
  [EVENT_SUBTASK_COMPLETE]: { emoji: '🔵', color: 'blue' },
  [EVENT_TASK_INTERRUPTED]: { emoji: '🔴', color: 'red' },
  [EVENT_APPROVAL_REQUIRED]: { emoji: '🟠', color: 'orange' },
  [EVENT_QUESTION_REQUIRED]: { emoji: '🟣', color: 'purple' },
}

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
  '"parentTitle":"{{parentTitle}}",',
  '"timestamp":"{{timestamp}}"}',
].join('')

/**
 * 判断一条会话事件属于哪一类通知。
 *
 * 主会话与子代理会话（子任务）分开归类：主会话正常完成是「任务完成」，
 * 子任务正常完成是「子任务完成」，两者互斥，一条完成事件只归一类。
 * @param {object} event 会话事件（SessionEvent）。
 * @param {object} [options] 归类用的额外信息。
 * @param {boolean} [options.isSubagent] 这条事件是否来自子代理会话。
 * @returns {string|undefined} 事件类别；不属于通知范围时返回 undefined。
 */
export function classifyEvent(event, options) {
  if (!event || typeof event !== 'object') return undefined
  const isSubagent = options?.isSubagent === true
  switch (event.type) {
    case 'turn/end': {
      const kind = event.data?.reason?.kind
      if (kind === 'completed') return isSubagent ? EVENT_SUBTASK_COMPLETE : EVENT_TASK_COMPLETE
      // fork 是分叉种子构造的收尾，不是用户视角的任务结束。
      if (kind === 'forked') return undefined
      // 子任务的中断沿用「任务中断」：本次只把「完成」拆出来单独归类。
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
 * 从工作目录推出工作区名称。
 *
 * 工作区默认就叫它所在的目录名，所以拿不到注册表里的显示名时，用路径的
 * 最后一段顶上；Windows 路径与结尾多余的分隔符也一并处理。
 * @param {string} path 工作目录。
 * @returns {string} 工作区名称；路径为空时返回空串。
 */
export function workspaceNameFromPath(path) {
  if (typeof path !== 'string') return ''
  const parts = path.trim().split(/[\\/]+/).filter((part) => part !== '')
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

/**
 * 构造通知载荷。
 *
 * 通知内容由「会话标题」「事件细节」「工作区」几项组成，逐行拼接；
 * 会话标题缺失时退回会话 ID，工作区名称缺失时不写这一行。
 *
 * 子代理会话没有真正的会话标题（它的标题是从提示词里截出来的），因此单独
 * 走一条分支：正文第一行写子代理标签，第二行写它所属的主会话。
 * @param {object} options 载荷来源。
 * @param {string} options.kind 事件类别。
 * @param {string} [options.sessionId] 会话 ID。
 * @param {string} [options.sessionTitle] 会话标题；子代理会话里放的是子代理标签。
 * @param {string} [options.parentTitle] 子代理所属的主会话标题。
 * @param {boolean} [options.isSubagent] 这条通知是否来自子代理会话。
 * @param {string} [options.workspace] 会话所属工作区的名称。
 * @param {string} [options.cwd] 会话工作目录；只进载荷，不进正文。
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
  const parentTitle = options.parentTitle ?? ''
  const isSubagent = options.isSubagent === true
  // 通知项：纯文本样式按 plain 逐行拼接，卡片样式按 cardFields 紧凑排版。
  const fields = []
  const cardFields = []
  if (isSubagent) {
    // 子代理的会话标题是从提示词里截出来的，不能当标题用；这里改用子代理标签。
    const titleLine = sessionTitle !== '' ? sessionTitle : (options.sessionId ?? '')
    if (titleLine !== '') {
      fields.push({ label: '子代理', value: titleLine })
      cardFields.push({ label: '标题', value: titleLine })
    }
    if (parentTitle !== '') {
      fields.push({ label: '主会话', value: parentTitle })
      cardFields.push({ label: '主会话', value: parentTitle })
    }
  } else {
    // 会话标题是通知内容里的一项；没有标题时退回会话 ID，至少让用户认得出是哪次会话。
    const titleLine = sessionTitle !== '' ? sessionTitle : (options.sessionId ?? '')
    if (titleLine !== '') {
      fields.push({ label: '会话标题', value: titleLine })
      cardFields.push({ label: '标题', value: titleLine })
    }
  }
  // 细节在纯文本里直接单独成行，卡片样式里给它一个「信息」标签。
  if (options.detail) {
    fields.push({ label: '细节', value: options.detail, plain: options.detail })
    cardFields.push({ label: '信息', value: options.detail })
  }
  if (options.workspace) fields.push({ label: '工作区', value: options.workspace })
  const lines = fields.map((field) => field.plain ?? `${field.label}：${field.value}`)
  const message = lines.length > 0 ? lines.join('\n') : label
  const payload = {
    event: kind,
    title: `${prefix}${label}`,
    // 卡片头自己拼：前缀、事件名与工作区放一行里。
    label,
    prefix: options.prefix ?? '',
    message,
    sessionId: options.sessionId ?? '',
    // 子代理的载荷标题带上「子代理：」前缀，单独看一条通知也知道它是子代理。
    sessionTitle: isSubagent ? (sessionTitle !== '' ? `子代理：${sessionTitle}` : '') : sessionTitle,
    parentTitle,
    isSubagent,
    workspace: options.workspace ?? '',
    cwd: options.cwd ?? '',
    detail: options.detail ?? '',
    timestamp: options.timestamp ?? new Date().toISOString(),
    fields,
    cardFields,
  }
  // 卡片样式用的标题与正文：ntfy 与 Gotify 都按这个结构渲染。
  payload.card = buildCard(payload)
  payload.cardTitle = payload.card.title
  payload.cardMessage = payload.card.message
  return payload
}

/**
 * 构造卡片内容。
 *
 * ntfy 与 Gotify 的协议里都没有颜色字段，卡片头的颜色只能靠一个彩色圆点表示：
 * ntfy 把圆点写进标题，客户端会把它排在标题最前面；Gotify 直接显示在标题里。
 * 卡片头把前缀、事件名与工作区挤在一行里；正文用 Markdown 的引用块排版，
 * 各项之间用硬换行分隔，渲染出来是一张紧凑的卡片，没有多余的空白行。
 * @param {object} payload 通知载荷。
 * @returns {object} 卡片标题与正文。
 */
export function buildCard(payload) {
  const style = EVENT_CARD_STYLES[payload?.event]
  const emoji = style?.emoji ?? '⚪'
  const prefix = String(payload?.prefix ?? '').trim()
  const label = String(payload?.label ?? '').trim()
  const workspace = String(payload?.workspace ?? '').trim()
  // 卡片头：圆点 + 前缀 + 事件名 + 工作区。
  const head = prefix !== '' && label !== ''
    ? `${prefix} · ${label}`
    : (label !== '' ? label : (prefix !== '' ? prefix : String(payload?.title ?? '').trim()))
  const fields = Array.isArray(payload?.cardFields) ? payload.cardFields : []
  // 行尾两个空格是 Markdown 的硬换行：各项各占一行，行与行之间没有空行。
  const lines = fields.map((field) => `> ${field.label}：${field.value}`)
  return {
    title: `${emoji} ${head}${workspace !== '' ? ` (${workspace})` : ''}`.trim(),
    message: lines.length > 0 ? lines.join('  \n') : `> ${payload?.message ?? ''}`.trim(),
    emoji,
    color: style?.color ?? 'gray',
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
 *
 * 卡片样式下正文用 Markdown 排版，并带上 contentType 的 extras，
 * 让客户端按 Markdown 而不是纯文本渲染。
 * @param {object} options 通道参数。
 * @param {string} options.url Gotify 服务器地址。
 * @param {string} options.token 应用令牌。
 * @param {number} options.priority 优先级。
 * @param {number} options.timeoutMs 超时毫秒数。
 * @param {boolean} [options.card] 是否使用卡片样式。
 * @param {object} payload 通知载荷。
 * @returns {Promise<{ok: true, channel: string}>} 发送结果。
 */
export async function sendGotify(options, payload) {
  const base = String(options.url ?? '').trim().replace(/\/+$/, '')
  if (base === '') throw new Error('未配置 Gotify 服务器地址')
  const token = String(options.token ?? '').trim()
  if (token === '') throw new Error('未配置 Gotify 应用令牌')
  const endpoint = `${base}/message?token=${encodeURIComponent(token)}`
  const card = options.card === true && payload.card
  const body = JSON.stringify({
    title: card ? payload.card.title : payload.title,
    message: card ? payload.card.message : payload.message,
    priority: options.priority ?? 5,
    ...(card ? { extras: { 'client::display': { contentType: 'text/markdown' } } } : {}),
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
 *
 * 卡片样式下正文用 Markdown 排版（markdown: true），标题里的彩色圆点表示卡片头颜色。
 * @param {object} options 通道参数。
 * @param {string} options.url ntfy 服务器地址。
 * @param {string} options.topic 主题。
 * @param {string} options.token 访问令牌；为空则匿名发布。
 * @param {number} options.priority 优先级，1-5。
 * @param {number} options.timeoutMs 超时毫秒数。
 * @param {boolean} [options.card] 是否使用卡片样式。
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
  const card = options.card === true && payload.card
  const body = JSON.stringify({
    topic,
    title: card ? payload.card.title : payload.title,
    message: card ? payload.card.message : payload.message,
    priority: options.priority ?? NTFY_DEFAULT_PRIORITY,
    ...(card ? { markdown: true } : {}),
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
