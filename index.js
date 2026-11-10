/**
 * DSH 插件：事件通知。
 *
 * 监听会话事件，在任务完成、任务中断、需要审批、需要回答问题时，
 * 把通知发到用户配置的 Gotify、通用 Webhook 或 ntfy。
 *
 * 通知内容只包含会话标题、子代理标签、工作目录、结束原因与事件类型，不包含会话正文。
 * 发送失败只写日志，不会影响会话与工具执行。
 */
import z from '@deepseek-ai/schemastery'
import {
  CHANNEL_GOTIFY,
  CHANNEL_NTFY,
  CHANNEL_WEBHOOK,
  CHANNELS,
  EVENT_APPROVAL_REQUIRED,
  EVENT_QUESTION_REQUIRED,
  EVENT_TASK_COMPLETE,
  EVENT_TASK_INTERRUPTED,
  EVENTS,
  DEFAULT_WEBHOOK_BODY,
  buildPayload,
  classifyEvent,
  decideNotification,
  describeTurnEnd,
  priorityForChannel,
  sendGotify,
  sendNtfy,
  sendWebhook,
} from './lib/notify.js'
import { registerRoutes } from './lib/http.js'

/** 插件名；同时也是 profile 里的插件行 id 与设置命名空间。 */
export const name = 'dsh-event-notice'

/** 本插件不依赖其它服务；webServer 走后置注入，只用于「发送测试通知」。 */
export const inject = []

/** Gotify 应用令牌默认存放的凭据引用名。 */
export const DEFAULT_GOTIFY_TOKEN_REF = 'DSH_EVENT_NOTICE_GOTIFY_TOKEN'
/** ntfy 访问令牌默认存放的凭据引用名。 */
export const DEFAULT_NTFY_TOKEN_REF = 'DSH_EVENT_NOTICE_NTFY_TOKEN'
/** ntfy 默认主题。 */
export const DEFAULT_NTFY_TOPIC = 'dsh'

/**
 * 插件配置。
 *
 * 全部字段都是 volatile 的：设置页可以直接编辑，改动即时生效，
 * 不需要重新加载插件。
 */
export const Config = z.object({
  /** 通知总开关。 */
  enabled: z.boolean().default(true).volatile(),
  /** 所有会话是否默认通知；会话级覆盖优先于它。 */
  defaultNotify: z.boolean().default(false).volatile(),
  /** 是否在设置页左侧导航里显示本插件的页面。 */
  showInSettings: z.boolean().default(true).volatile(),
  /** 启用的通知通道。 */
  channels: z.array(z.union([
    z.const(CHANNEL_GOTIFY),
    z.const(CHANNEL_WEBHOOK),
    z.const(CHANNEL_NTFY),
  ])).default([...CHANNELS]).volatile(),
  /** 默认通知的事件。 */
  events: z.array(z.union([
    z.const(EVENT_TASK_COMPLETE),
    z.const(EVENT_TASK_INTERRUPTED),
    z.const(EVENT_APPROVAL_REQUIRED),
    z.const(EVENT_QUESTION_REQUIRED),
  ])).default([...EVENTS]).volatile(),
  /** 通知标题前缀。 */
  titlePrefix: z.string().default('DSH').volatile(),
  /** 单次请求的超时时间（毫秒）。 */
  timeoutMs: z.number().step(1).min(1).max(600000).default(10000).volatile(),
  /** Gotify 服务器地址，例如 https://gotify.example.com。 */
  gotifyUrl: z.string().default('').volatile(),
  /** Gotify 应用令牌所在的凭据引用名。 */
  gotifyTokenRef: z.string().role('credential-ref').default(DEFAULT_GOTIFY_TOKEN_REF).volatile(),
  /** Gotify 各事件的消息优先级，事件 → 0-10；没写的用缺省值 5。 */
  gotifyPriorities: z.dict(z.number().step(1).min(0).max(10)).default({}).volatile(),
  /** ntfy 服务器地址，例如 https://ntfy.example.com。 */
  ntfyUrl: z.string().default().volatile(),
  /** ntfy 主题。 */
  ntfyTopic: z.string().default(DEFAULT_NTFY_TOPIC).volatile(),
  /** ntfy 访问令牌所在的凭据引用名。 */
  ntfyTokenRef: z.string().role('credential-ref').default(DEFAULT_NTFY_TOKEN_REF).volatile(),
  /** ntfy 各事件的优先级，事件 → 1-5；没写的用缺省值 3。 */
  ntfyPriorities: z.dict(z.number().step(1).min(1).max(5)).default({}).volatile(),
  /** Webhook 地址。 */
  webhookUrl: z.string().default('').volatile(),
  /** Webhook 请求方法。 */
  webhookMethod: z.union([z.const('POST'), z.const('PUT')]).default('POST').volatile(),
  /** Webhook 额外请求头，每行一个「名称: 值」。 */
  webhookHeaders: z.string().default('').volatile(),
  /** Webhook 请求体模板，占位符形如 {{event}}。 */
  webhookBody: z.string().default(DEFAULT_WEBHOOK_BODY).volatile(),
  /** Webhook 请求体的 Content-Type。 */
  webhookContentType: z.string().default('application/json').volatile(),
  /** 会话级覆盖：会话 ID → 是否通知。 */
  sessionOverrides: z.dict(z.boolean()).volatile(),
})

/**
 * 插件入口。
 * @param {object} ctx 插件上下文。
 * @param {object} config 解析后的配置。
 */
export function apply(ctx, config) {
  const logger = ctx.logger
  /** 本插件所在的 fiber：设置服务的页面策略要挂在它上面。 */
  const pluginFiber = ctx.fiber
  /** 会话标题：事件流里的 session/title 只在标题生成时出现一次。 */
  const titles = new Map()
  /** 正式标题：来源是标题生成服务或用户改名，而不是提示词截断出来的兜底标题。 */
  const realTitles = new Map()
  /** 标题来源：会话 ID → 标题的来源类别（provider / user / fallback）。 */
  const titleKinds = new Map()
  /** 子代理标签：子会话 ID → 子代理的名字（任务管理面板上的卡片名）。 */
  const labels = new Map()
  /** 会话父子关系：子会话 ID → 父会话 ID；只有子代理会话才有父会话。 */
  const parents = new Map()

  /** 读取一个 volatile 字段的当前值。 */
  const read = (field, fallback) => {
    const value = config[field]?.get()
    return value === undefined ? fallback : value
  }

  /** 取凭据里的令牌：优先凭据存储，其次环境变量。 */
  const resolveToken = async (ref) => {
    const name = String(ref ?? '').trim()
    if (name === '') return ''
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return ''
    try {
      const record = await credentials.resolve(name)
      return record?.value ?? ''
    } catch (error) {
      logger.warn(`[dsh-event-notice] 读取凭据 ${name} 失败：${String(error?.message ?? error)}`)
      return ''
    }
  }

  /**
   * 把一条通知发到所有已启用的通道。
   * @param {object} payload 通知载荷。
   * @returns {Promise<object[]>} 每个通道的结果。
   */
  const dispatch = async (payload) => {
    const channels = read('channels', [])
    const timeoutMs = read('timeoutMs', 10000)
    const results = []
    for (const channel of channels) {
      try {
        if (channel === CHANNEL_GOTIFY) {
          // 没填服务器信息的通道直接跳过，不当成失败。
          if (String(read('gotifyUrl', '') ?? '').trim() === '') {
            results.push({ channel, ok: true, skipped: true })
            continue
          }
          await sendGotify({
            url: read('gotifyUrl', ''),
            token: await resolveToken(read('gotifyTokenRef', '')),
            priority: priorityForChannel(CHANNEL_GOTIFY, payload.event, {
              gotifyPriorities: read('gotifyPriorities', {}),
            }),
            timeoutMs,
          }, payload)
          results.push({ channel, ok: true })
          continue
        }
        if (channel === CHANNEL_NTFY) {
          if (String(read('ntfyUrl', '') ?? '').trim() === '' || String(read('ntfyTopic', '') ?? '').trim() === '') {
            results.push({ channel, ok: true, skipped: true })
            continue
          }
          await sendNtfy({
            url: read('ntfyUrl', ''),
            topic: read('ntfyTopic', ''),
            token: await resolveToken(read('ntfyTokenRef', '')),
            priority: priorityForChannel(CHANNEL_NTFY, payload.event, {
              ntfyPriorities: read('ntfyPriorities', {}),
            }),
            timeoutMs,
          }, payload)
          results.push({ channel, ok: true })
          continue
        }
        if (channel === CHANNEL_WEBHOOK) {
          if (String(read('webhookUrl', '') ?? '').trim() === '') {
            results.push({ channel, ok: true, skipped: true })
            continue
          }
          await sendWebhook({
            url: read('webhookUrl', ''),
            method: read('webhookMethod', 'POST'),
            headers: read('webhookHeaders', ''),
            bodyTemplate: read('webhookBody', DEFAULT_WEBHOOK_BODY),
            contentType: read('webhookContentType', 'application/json'),
            timeoutMs,
          }, payload)
          results.push({ channel, ok: true })
          continue
        }
        results.push({ channel, ok: false, error: `未知通道 ${channel}` })
      } catch (error) {
        const message = String(error?.message ?? error)
        logger.warn(`[dsh-event-notice] ${channel} 通知发送失败：${message}`)
        results.push({ channel, ok: false, error: message })
      }
    }
    return results
  }

  /**
   * 事件细节：一句中文说明。
   * @param {string} kind 事件类别。
   * @param {object} event 会话事件。
   * @returns {string} 细节文本。
   */
  const detailOf = (kind, event) => {
    if (kind === EVENT_TASK_COMPLETE || kind === EVENT_TASK_INTERRUPTED) {
      return describeTurnEnd(event.data?.reason)
    }
    if (kind === EVENT_APPROVAL_REQUIRED) {
      const toolName = event.data?.toolName ?? '工具'
      const reason = event.data?.reason
      return `${toolName} 需要审批${reason ? `：${reason}` : ''}`
    }
    return '助手提出了问题，等待你回答'
  }

  /**
   * 记住会话的父会话：只有子代理会话的头里带 parentSession。
   * @param {object} session 会话。
   */
  const rememberParent = (session) => {
    const sessionId = session?.id ?? ''
    const parentId = session?.header?.parentSession
    if (sessionId !== '' && typeof parentId === 'string' && parentId !== '') {
      parents.set(sessionId, parentId)
    }
  }

  /**
   * 读会话投影的当前值。
   *
   * 投影是会话状态的权威视图。事件缓存只在插件看见那条事件时才有值，
   * 插件重启后就是空的；投影能补上这部分空白。
   * @param {object} session 会话对象。
   * @param {string} key 投影键，如 title、subagent。
   * @returns {unknown} 视图值；没有这一项时返回 undefined。
   */
  const projectedValue = (session, key) => {
    if (session === undefined || session === null) return undefined
    const registry = ctx.get('sessionProjections')
    if (registry === undefined) return undefined
    try {
      return registry.snapshot(session, [key])?.values?.[key]
    } catch (error) {
      logger.warn(`[dsh-event-notice] 读取会话投影 ${key} 失败：${String(error?.message ?? error)}`)
      return undefined
    }
  }

  /**
   * 取会话的当前标题。
   *
   * 优先问标题服务：它同时给出标题的来源，能分清「标题生成服务或用户改的
   * 正式标题」和「从第一条用户消息里截出来的兜底标题」。其次看投影视图，
   * 最后才用事件缓存。
   * @param {object} session 会话对象；拿不到时传 undefined。
   * @param {string} sessionId 会话 ID。
   * @returns {{title: string, kind: string}} 标题文本与来源（provider / user / fallback）。
   */
  const titleInfoOf = (session, sessionId) => {
    const service = ctx.get('sessionTitle')
    if (service !== undefined && session !== undefined) {
      try {
        const snapshot = service.get(session)
        const title = typeof snapshot?.title === 'string' ? snapshot.title : ''
        if (title !== '') return { title, kind: snapshot?.source?.kind ?? '' }
      } catch (error) {
        logger.warn(`[dsh-event-notice] 读取会话标题失败：${String(error?.message ?? error)}`)
      }
    }
    const projected = projectedValue(session, 'title')
    if (typeof projected === 'string' && projected !== '') {
      return { title: projected, kind: titleKinds.get(sessionId) ?? '' }
    }
    return { title: titles.get(sessionId) ?? '', kind: titleKinds.get(sessionId) ?? '' }
  }

  /**
   * 取子代理的标签：任务管理面板上卡片的名字。
   * @param {object} session 会话对象。
   * @param {string} sessionId 会话 ID。
   * @returns {string} 标签文本；没有时返回空串。
   */
  const labelOf = (session, sessionId) => {
    const identity = projectedValue(session, 'subagent')
    const label = typeof identity?.label === 'string' ? identity.label : ''
    if (label !== '') return label
    return labels.get(sessionId) ?? ''
  }

  /**
   * 取会话存储里的实时会话。
   * @param {string} sessionId 会话 ID。
   * @returns {object|undefined} 会话对象；取不到时返回 undefined。
   */
  const sessionOf = (sessionId) => {
    const store = ctx.get('sessions')
    if (store === undefined || typeof sessionId !== 'string' || sessionId === '') return undefined
    try {
      return store.get(sessionId)
    } catch (error) {
      logger.warn(`[dsh-event-notice] 读取会话 ${sessionId} 失败：${String(error?.message ?? error)}`)
      return undefined
    }
  }

  /**
   * 找出会话所属的主会话，并取它的标题。
   *
   * 沿父会话链往上走：链顶（没有父会话的那一层）就是主会话。主会话的标题
   * 要用正式标题——兜底标题是从第一条用户消息里截出来的，等于提示词片段。
   * @param {string} sessionId 会话 ID。
   * @returns {string} 主会话标题；没有时返回空串。
   */
  const mainTitleOf = (sessionId) => {
    const visited = new Set()
    let currentId = sessionId
    for (;;) {
      const current = sessionOf(currentId)
      const parentId = current?.header?.parentSession ?? parents.get(currentId)
      if (typeof parentId !== 'string' || parentId === '' || visited.has(parentId)) {
        // 链顶就是主会话；会话本身没有父会话时没有主会话可言。
        if (currentId === sessionId) return ''
        const info = titleInfoOf(current, currentId)
        if (info.kind === 'fallback') {
          // 兜底标题是提示词片段：只有更早的正式标题能用，没有就不写这一行。
          const real = realTitles.get(currentId)
          return real !== undefined && real !== '' ? real : ''
        }
        return info.title
      }
      visited.add(currentId)
      currentId = parentId
    }
  }

  /** 会话事件入口。 */
  const onSessionEvent = (session, event) => {
    const sessionId = session?.id ?? ''
    rememberParent(session)
    if (event.type === 'session/title') {
      const title = event.data?.title
      if (typeof title === 'string' && title !== '') {
        const source = event.data?.source?.kind ?? ''
        titles.set(sessionId, title)
        titleKinds.set(sessionId, source)
        // 兜底标题是从第一条用户消息里截出来的，等于提示词片段，不算正式标题。
        if (source !== 'fallback') realTitles.set(sessionId, title)
      }
      return
    }
    if (event.type === 'subagent/descriptor') {
      // 子代理的身份信息：卡片上的名字就来自这里。
      const label = event.data?.label
      if (typeof label === 'string' && label !== '') labels.set(sessionId, label)
      return
    }
    const kind = classifyEvent(event)
    if (kind === undefined) return
    if (!decideNotification(config, sessionId, kind)) return
    // 子代理会话的标题是从提示词里截出来的，不能当标题用：改用子代理标签，
    // 并补上它所属的主会话。
    const isSubagent = session?.header?.origin === 'subagent'
    let sessionTitle = ''
    let parentTitle = ''
    if (isSubagent) {
      sessionTitle = labelOf(session, sessionId)
      parentTitle = mainTitleOf(sessionId)
    } else {
      const info = titleInfoOf(session, sessionId)
      sessionTitle = info.title
      // 兜底标题是提示词片段，能拿到正式标题时优先用正式的。
      if (info.kind === 'fallback') {
        const real = realTitles.get(sessionId)
        if (real !== undefined && real !== '') sessionTitle = real
      }
    }
    const payload = buildPayload({
      kind,
      sessionId,
      sessionTitle,
      parentTitle,
      isSubagent,
      cwd: session?.header?.cwd ?? '',
      detail: detailOf(kind, event),
      prefix: read('titlePrefix', ''),
    })
    void dispatch(payload)
  }

  const disposeListener = ctx.on('session/event', onSessionEvent, { global: true })

  // 本插件自带配置页，关掉设置服务的自动页面，避免两处入口重复。
  // 策略挂在插件自己的 fiber 上；settings 晚加载或被替换时会自动重新注册。
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, pluginFiber))
  })

  // 「发送测试通知」按钮用的路由。
  ctx.inject(['webServer'], (serverCtx) => {
    const dispose = registerRoutes(serverCtx.webServer, async () => {
      const payload = buildPayload({
        kind: EVENT_TASK_COMPLETE,
        sessionId: 'test',
        sessionTitle: '测试通知',
        detail: '这是一条来自事件通知插件的测试通知。',
        prefix: read('titlePrefix', ''),
      })
      const results = await dispatch(payload)
      return { ok: results.every((item) => item.ok), results }
    })
    return () => dispose()
  })

  return () => {
    disposeListener()
    titles.clear()
    realTitles.clear()
    titleKinds.clear()
    labels.clear()
    parents.clear()
  }
}
