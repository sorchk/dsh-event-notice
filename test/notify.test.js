/**
 * 事件通知的纯逻辑单元测试。
 *
 * 覆盖事件分类、通知决策、模板渲染与两个通道的请求构造。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CHANNEL_GOTIFY,
  CHANNEL_NTFY,
  CHANNEL_WEBHOOK,
  DEFAULT_EVENTS,
  DEFAULT_WEBHOOK_BODY,
  EVENT_APPROVAL_REQUIRED,
  EVENT_QUESTION_REQUIRED,
  EVENT_SUBTASK_COMPLETE,
  EVENT_TASK_COMPLETE,
  EVENT_TASK_INTERRUPTED,
  EVENTS,
  EVENT_CARD_STYLES,
  GOTIFY_DEFAULT_PRIORITY,
  NTFY_DEFAULT_PRIORITY,
  buildCard,
  buildPayload,
  classifyEvent,
  decideNotification,
  describeCancelCause,
  describeTurnEnd,
  escapeTemplateValue,
  parseHeaderLines,
  priorityForChannel,
  renderTemplate,
  sendGotify,
  sendNtfy,
  sendWebhook,
  workspaceNameFromPath,
} from '../lib/notify.js'

/**
 * 构造一个可读的 volatile 配置替身。
 * @param {Record<string, unknown>} values 字段值。
 * @returns {Record<string, {get: () => unknown}>} 配置替身。
 */
function volatileConfig(values) {
  const config = {}
  for (const [key, value] of Object.entries(values)) {
    config[key] = { get: () => value }
  }
  return config
}

test('turn/end 的 completed 归为任务完成', () => {
  assert.equal(classifyEvent({ type: 'turn/end', data: { reason: { kind: 'completed' } } }), EVENT_TASK_COMPLETE)
})

test('子代理会话的 completed 归为子任务完成', () => {
  const event = { type: 'turn/end', data: { reason: { kind: 'completed' } } }
  assert.equal(classifyEvent(event, { isSubagent: true }), EVENT_SUBTASK_COMPLETE)
  assert.equal(classifyEvent(event, { isSubagent: false }), EVENT_TASK_COMPLETE)
})

test('子代理会话的中断仍归为任务中断', () => {
  const event = { type: 'turn/end', data: { reason: { kind: 'aborted' } } }
  assert.equal(classifyEvent(event, { isSubagent: true }), EVENT_TASK_INTERRUPTED)
})

test('子任务完成属于全部事件，但默认不勾选', () => {
  assert.ok(EVENTS.includes(EVENT_SUBTASK_COMPLETE))
  assert.ok(!DEFAULT_EVENTS.includes(EVENT_SUBTASK_COMPLETE))
  assert.ok(DEFAULT_EVENTS.includes(EVENT_TASK_COMPLETE))
})

test('turn/end 的非完成原因归为任务中断', () => {
  for (const kind of ['aborted', 'blocked', 'error', 'max-tokens', 'interrupted']) {
    assert.equal(classifyEvent({ type: 'turn/end', data: { reason: { kind } } }), EVENT_TASK_INTERRUPTED, kind)
  }
})

test('turn/end 的 forked 不通知', () => {
  assert.equal(classifyEvent({ type: 'turn/end', data: { reason: { kind: 'forked' } } }), undefined)
})

test('approval/asked 归为需要审批', () => {
  assert.equal(classifyEvent({ type: 'approval/asked', data: { id: 'a', toolName: 'bash' } }), EVENT_APPROVAL_REQUIRED)
})

test('提问工具调用归为需要回答问题', () => {
  assert.equal(classifyEvent({ type: 'tool/call', data: { name: 'ask_user_question' } }), EVENT_QUESTION_REQUIRED)
  assert.equal(classifyEvent({ type: 'tool/call', data: { name: 'read_file' } }), undefined)
})

test('无关事件不通知', () => {
  assert.equal(classifyEvent({ type: 'step/start' }), undefined)
  assert.equal(classifyEvent(undefined), undefined)
})

test('总开关关闭时不通知', () => {
  const config = volatileConfig({
    enabled: false,
    events: [EVENT_TASK_COMPLETE],
    sessionOverrides: {},
    defaultNotify: true,
  })
  assert.equal(decideNotification(config, 's1', EVENT_TASK_COMPLETE), false)
})

test('事件不在列表里时不通知', () => {
  const config = volatileConfig({
    enabled: true,
    events: [EVENT_TASK_COMPLETE],
    sessionOverrides: {},
    defaultNotify: true,
  })
  assert.equal(decideNotification(config, 's1', EVENT_APPROVAL_REQUIRED), false)
})

test('会话级覆盖优先于全局默认', () => {
  const config = volatileConfig({
    enabled: true,
    events: [EVENT_TASK_COMPLETE],
    sessionOverrides: { s1: true, s2: false },
    defaultNotify: false,
  })
  assert.equal(decideNotification(config, 's1', EVENT_TASK_COMPLETE), true)
  assert.equal(decideNotification(config, 's2', EVENT_TASK_COMPLETE), false)
  assert.equal(decideNotification(config, 's3', EVENT_TASK_COMPLETE), false)
})

test('全局默认为通知时，未覆盖的会话都通知', () => {
  const config = volatileConfig({
    enabled: true,
    events: [EVENT_TASK_COMPLETE],
    sessionOverrides: { s2: false },
    defaultNotify: true,
  })
  assert.equal(decideNotification(config, 's3', EVENT_TASK_COMPLETE), true)
  assert.equal(decideNotification(config, 's2', EVENT_TASK_COMPLETE), false)
})

test('会话级覆盖为关时覆盖全局默认的开启', () => {
  const config = volatileConfig({
    enabled: true,
    events: [EVENT_TASK_COMPLETE],
    sessionOverrides: { s1: false },
    defaultNotify: true,
  })
  assert.equal(decideNotification(config, 's1', EVENT_TASK_COMPLETE), false)
  assert.equal(decideNotification(config, 's2', EVENT_TASK_COMPLETE), true)
})

test('缺少标题与工作区时正文回落到事件名', () => {
  const payload = buildPayload({ kind: EVENT_APPROVAL_REQUIRED })
  assert.equal(payload.title, '需要审批')
  assert.equal(payload.message, '需要审批')
  assert.equal(payload.sessionId, '')
})

test('结束原因与取消原因都有中文说明', () => {
  assert.equal(describeTurnEnd({ kind: 'completed' }), '任务正常完成')
  assert.equal(describeTurnEnd({ kind: 'aborted', reason: { kind: 'user' } }), '任务被中止（用户中止）')
  assert.equal(describeTurnEnd({ kind: 'error', error: { message: 'boom' } }), '任务出错：boom')
  assert.equal(describeCancelCause({ kind: 'parent' }), '上级代理中止')
  assert.equal(describeCancelCause({ kind: 'hook', reason: '策略拦截' }), '策略拦截')
})

test('载荷包含标题、正文与会话信息', () => {
  const payload = buildPayload({
    kind: EVENT_TASK_COMPLETE,
    sessionId: 's1',
    sessionTitle: '写周报',
    workspace: 'demo',
    cwd: '/tmp/work',
    detail: '任务正常完成',
    prefix: 'DSH',
  })
  assert.equal(payload.title, 'DSH · 任务完成')
  assert.match(payload.message, /写周报/)
  assert.match(payload.message, /工作区：demo/)
  assert.equal(payload.workspace, 'demo')
  // 工作目录不进正文，只留在载荷里给自定义模板用。
  assert.doesNotMatch(payload.message, /\/tmp\/work/)
  assert.equal(payload.cwd, '/tmp/work')
  assert.equal(payload.sessionId, 's1')
  assert.equal(payload.event, EVENT_TASK_COMPLETE)
})

test('工作区名称取路径的最后一段', () => {
  assert.equal(workspaceNameFromPath('/home/sorc/workspaces/dsh-event-notice'), 'dsh-event-notice')
  assert.equal(workspaceNameFromPath('/home/sorc/workspaces/dsh-event-notice/'), 'dsh-event-notice')
  assert.equal(workspaceNameFromPath('C:\\work\\demo'), 'demo')
  assert.equal(workspaceNameFromPath(''), '')
  assert.equal(workspaceNameFromPath(undefined), '')
})

test('通知内容里有「会话标题」这一项', () => {
  const payload = buildPayload({
    kind: EVENT_TASK_COMPLETE,
    sessionId: 's1',
    sessionTitle: '写周报',
    detail: '任务正常完成',
  })
  assert.equal(payload.message, '会话标题：写周报\n任务正常完成')
  assert.equal(payload.sessionTitle, '写周报')
})

test('没有会话标题时正文回落到会话 ID', () => {
  const payload = buildPayload({
    kind: EVENT_TASK_COMPLETE,
    sessionId: 's1',
    detail: '任务正常完成',
  })
  assert.equal(payload.message, '会话标题：s1\n任务正常完成')
  assert.equal(payload.sessionTitle, '')
})

test('子代理通知用子代理标签与主会话，不写「会话标题」', () => {
  const payload = buildPayload({
    kind: EVENT_TASK_COMPLETE,
    sessionId: 'child-1',
    sessionTitle: '分析M01就业网站模块冲突',
    parentTitle: '就业管理实现冲突分析',
    isSubagent: true,
    detail: '任务正常完成',
  })
  assert.equal(payload.message, '子代理：分析M01就业网站模块冲突\n主会话：就业管理实现冲突分析\n任务正常完成')
  assert.equal(payload.sessionTitle, '子代理：分析M01就业网站模块冲突')
  assert.equal(payload.parentTitle, '就业管理实现冲突分析')
  assert.equal(payload.isSubagent, true)
})

test('子代理没有标签时回落到会话 ID', () => {
  const payload = buildPayload({
    kind: EVENT_TASK_COMPLETE,
    sessionId: 'child-1',
    isSubagent: true,
    detail: '任务正常完成',
  })
  assert.equal(payload.message, '子代理：child-1\n任务正常完成')
  assert.equal(payload.sessionTitle, '')
  assert.equal(payload.parentTitle, '')
})

test('卡片标题按事件类型带对应颜色的圆点', () => {
  const payload = buildPayload({
    kind: EVENT_TASK_COMPLETE,
    sessionId: 's1',
    sessionTitle: '写周报',
    detail: '任务正常完成',
    prefix: 'DSH',
  })
  assert.equal(payload.card.title, '🟢 DSH * 任务完成')
  assert.equal(payload.card.emoji, '🟢')
  assert.equal(payload.card.color, 'green')
  // 正文按 Markdown 引用块排版，客户端里渲染成一张带底色的卡片；各项之间用硬换行，不留空行。
  assert.equal(payload.card.message, '> 标题：写周报  \n> 信息：任务正常完成')
})

test('卡片头把工作区名称写进括号里', () => {
  const payload = buildPayload({
    kind: EVENT_TASK_COMPLETE,
    sessionId: 's1',
    sessionTitle: '写周报',
    detail: '任务正常完成',
    workspace: 'dsh-event-notice',
    prefix: 'DSH',
  })
  assert.equal(payload.card.title, '🟢 DSH * 任务完成 (dsh-event-notice)')
  // 工作区只在卡片头出现一次，正文里不再重复。
  assert.equal(payload.card.message, '> 标题：写周报  \n> 信息：任务正常完成')
})

test('每个事件都有自己的一套卡片头颜色', () => {
  const emojis = Object.values(EVENT_CARD_STYLES).map((style) => style.emoji)
  assert.equal(new Set(emojis).size, emojis.length)
  assert.equal(EVENT_CARD_STYLES[EVENT_TASK_COMPLETE].emoji, '🟢')
  assert.equal(EVENT_CARD_STYLES[EVENT_SUBTASK_COMPLETE].emoji, '🔵')
  assert.equal(EVENT_CARD_STYLES[EVENT_TASK_INTERRUPTED].emoji, '🔴')
  assert.equal(EVENT_CARD_STYLES[EVENT_APPROVAL_REQUIRED].emoji, '🟠')
  assert.equal(EVENT_CARD_STYLES[EVENT_QUESTION_REQUIRED].emoji, '🟣')
})

test('没有对应样式的事件退回中性圆点', () => {
  const card = buildCard({ event: 'unknown-event', title: '标题', message: '正文', fields: [] })
  assert.equal(card.emoji, '⚪')
  assert.equal(card.color, 'gray')
  assert.equal(card.title, '⚪ 标题')
  assert.equal(card.message, '> 正文')
})

test('模板渲染会转义引号与换行', () => {
  const payload = { message: '他说"你好"\n第二行', title: '标题', event: 'task-complete' }
  const rendered = renderTemplate('{"m":"{{message}}"}', payload)
  assert.deepEqual(JSON.parse(rendered), { m: '他说"你好"\n第二行' })
})

test('模板占位符允许空格并忽略未知键', () => {
  assert.equal(renderTemplate('{{ event }}-{{nope}}', { event: 'x' }), 'x-')
})

test('空模板回落到默认模板', () => {
  assert.equal(renderTemplate('   ', {}), renderTemplate(DEFAULT_WEBHOOK_BODY, {}))
})

test('模板值转义保持数字与布尔原样', () => {
  assert.equal(escapeTemplateValue(3), '3')
  assert.equal(escapeTemplateValue(true), 'true')
  assert.equal(escapeTemplateValue(undefined), '')
})

test('请求头按行解析，忽略注释与空行', () => {
  const headers = parseHeaderLines('# 注释\nX-Token: abc\nX-Empty:\nBad\n')
  assert.deepEqual(headers, { 'X-Token': 'abc', 'X-Empty': '' })
})

test('Gotify 请求带上令牌与优先级', async (t) => {
  const calls = []
  t.after(() => { globalThis.fetch = undefined })
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, text: async () => '' }
  }
  const result = await sendGotify({
    url: 'https://gotify.example.com/',
    token: 'tok en',
    priority: 7,
    timeoutMs: 1000,
  }, { title: '标题', message: '正文' })
  assert.equal(result.channel, CHANNEL_GOTIFY)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://gotify.example.com/message?token=tok%20en')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), { title: '标题', message: '正文', priority: 7 })
})

test('Gotify 缺少地址或令牌时报错', async () => {
  await assert.rejects(() => sendGotify({ url: '', token: 'x' }, {}), /Gotify 服务器地址/)
  await assert.rejects(() => sendGotify({ url: 'https://x.example', token: '' }, {}), /Gotify 应用令牌/)
})

test('Webhook 请求使用配置的方法、请求头与模板', async (t) => {
  const calls = []
  t.after(() => { globalThis.fetch = undefined })
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 204, text: async () => '' }
  }
  const result = await sendWebhook({
    url: 'https://hook.example/notify',
    method: 'put',
    headers: 'X-Token: abc',
    bodyTemplate: '{"e":"{{event}}"}',
    contentType: 'application/json',
    timeoutMs: 1000,
  }, { event: 'task-complete' })
  assert.equal(result.channel, CHANNEL_WEBHOOK)
  assert.equal(calls[0].init.method, 'PUT')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.equal(calls[0].init.headers['X-Token'], 'abc')
  assert.deepEqual(JSON.parse(calls[0].init.body), { e: 'task-complete' })
})

test('Webhook 失败时抛出带状态码的错误', async (t) => {
  t.after(() => { globalThis.fetch = undefined })
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' })
  await assert.rejects(
    () => sendWebhook({ url: 'https://hook.example', timeoutMs: 1000 }, {}),
    /Webhook 返回 500/,
  )
})

test('Webhook 缺少地址时报错', async () => {
  await assert.rejects(() => sendWebhook({ url: '  ' }, {}), /Webhook 地址/)
})

test('ntfy 请求带主题、优先级与令牌', async (t) => {
  const calls = []
  t.after(() => { globalThis.fetch = undefined })
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, text: async () => '' }
  }
  const result = await sendNtfy({
    url: 'https://ntfy.example.com:52/',
    topic: 'dsh',
    token: 'tk_abc',
    priority: 5,
    timeoutMs: 1000,
  }, { title: 'DSH · 任务完成', message: '正文' })
  assert.equal(result.channel, CHANNEL_NTFY)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://ntfy.example.com:52')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['authorization'], 'Bearer tk_abc')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    topic: 'dsh',
    title: 'DSH · 任务完成',
    message: '正文',
    priority: 5,
  })
})

test('ntfy 卡片通知声明 Markdown 并带上卡片内容', async (t) => {
  const calls = []
  t.after(() => { globalThis.fetch = undefined })
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, text: async () => '' }
  }
  const payload = buildPayload({
    kind: EVENT_TASK_COMPLETE,
    sessionId: 's1',
    sessionTitle: '写周报',
    detail: '任务正常完成',
    prefix: 'DSH',
  })
  await sendNtfy({ url: 'https://ntfy.example.com', topic: 'dsh', timeoutMs: 1000, card: true }, payload)
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.markdown, true)
  assert.equal(body.title, '🟢 DSH * 任务完成')
  assert.equal(body.message, '> 标题：写周报  \n> 信息：任务正常完成')
})

test('Gotify 卡片通知声明 Markdown 的 extras', async (t) => {
  const calls = []
  t.after(() => { globalThis.fetch = undefined })
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, text: async () => '' }
  }
  const payload = buildPayload({
    kind: EVENT_TASK_INTERRUPTED,
    sessionId: 's1',
    sessionTitle: '写周报',
    detail: '任务被中止（用户中止）',
    prefix: 'DSH',
  })
  await sendGotify({ url: 'https://gotify.example.com', token: 'tok', timeoutMs: 1000, card: true }, payload)
  const body = JSON.parse(calls[0].init.body)
  assert.deepEqual(body.extras, { 'client::display': { contentType: 'text/markdown' } })
  assert.equal(body.title, '🔴 DSH * 任务中断')
})

test('ntfy 没有令牌时匿名发布', async (t) => {
  const calls = []
  t.after(() => { globalThis.fetch = undefined })
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, text: async () => '' }
  }
  await sendNtfy({ url: 'https://ntfy.example.com', topic: 'dsh', token: '', timeoutMs: 1000 }, { title: 't', message: 'm' })
  assert.equal(calls[0].init.headers['authorization'], undefined)
  assert.equal(JSON.parse(calls[0].init.body).priority, NTFY_DEFAULT_PRIORITY)
})

test('ntfy 缺少地址或主题时报错', async () => {
  await assert.rejects(() => sendNtfy({ url: '', topic: 'dsh' }, {}), /ntfy 服务器地址/)
  await assert.rejects(() => sendNtfy({ url: 'https://ntfy.example.com', topic: ' ' }, {}), /ntfy 主题/)
})

test('ntfy 失败时抛出带状态码的错误', async (t) => {
  t.after(() => { globalThis.fetch = undefined })
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => 'forbidden' })
  await assert.rejects(
    () => sendNtfy({ url: 'https://ntfy.example.com', topic: 'dsh', timeoutMs: 1000 }, {}),
    /ntfy 返回 403/,
  )
})

test('不同事件可以用不同的 ntfy 优先级', () => {
  const options = {
    ntfyPriorities: {
      [EVENT_TASK_COMPLETE]: 2,
      [EVENT_APPROVAL_REQUIRED]: 5,
    },
  }
  assert.equal(priorityForChannel(CHANNEL_NTFY, EVENT_TASK_COMPLETE, options), 2)
  assert.equal(priorityForChannel(CHANNEL_NTFY, EVENT_APPROVAL_REQUIRED, options), 5)
  assert.equal(priorityForChannel(CHANNEL_NTFY, EVENT_TASK_INTERRUPTED, options), NTFY_DEFAULT_PRIORITY)
  assert.equal(priorityForChannel(CHANNEL_NTFY, EVENT_QUESTION_REQUIRED, options), NTFY_DEFAULT_PRIORITY)
})

test('不同事件可以用不同的 Gotify 优先级', () => {
  const options = { gotifyPriorities: { [EVENT_TASK_INTERRUPTED]: 8 } }
  assert.equal(priorityForChannel(CHANNEL_GOTIFY, EVENT_TASK_INTERRUPTED, options), 8)
  assert.equal(priorityForChannel(CHANNEL_GOTIFY, EVENT_TASK_COMPLETE, options), GOTIFY_DEFAULT_PRIORITY)
})

test('越界的优先级回落到缺省值', () => {
  assert.equal(priorityForChannel(CHANNEL_NTFY, EVENT_TASK_COMPLETE, { ntfyPriorities: { [EVENT_TASK_COMPLETE]: 9 } }), NTFY_DEFAULT_PRIORITY)
  assert.equal(priorityForChannel(CHANNEL_NTFY, EVENT_TASK_COMPLETE, { ntfyPriorities: { [EVENT_TASK_COMPLETE]: 0 } }), NTFY_DEFAULT_PRIORITY)
  assert.equal(priorityForChannel(CHANNEL_GOTIFY, EVENT_TASK_COMPLETE, { gotifyPriorities: { [EVENT_TASK_COMPLETE]: 11 } }), GOTIFY_DEFAULT_PRIORITY)
  assert.equal(priorityForChannel(CHANNEL_NTFY, EVENT_TASK_COMPLETE, { ntfyPriorities: { [EVENT_TASK_COMPLETE]: '5' } }), NTFY_DEFAULT_PRIORITY)
})

test('Webhook 没有优先级概念', () => {
  assert.equal(priorityForChannel(CHANNEL_WEBHOOK, EVENT_TASK_COMPLETE, {}), undefined)
})
