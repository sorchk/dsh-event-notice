/**
 * 宿主端插件的接线测试。
 *
 * 用假的 ctx 跑一遍 apply()：捕获 session/event 监听器，喂进一条会话事件，
 * 检查最终发出的 HTTP 请求。覆盖「配置 → 决策 → 载荷 → 通道」的整条链路。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { Config, apply } from '../index.js'
import { CHANNEL_NTFY, DEFAULT_EVENTS, EVENT_SUBTASK_COMPLETE } from '../lib/notify.js'

/** 勾上全部事件（含子任务完成）的配置：子任务的通知默认不勾，这里显式打开。 */
const WITH_SUBTASK = { events: [...DEFAULT_EVENTS, EVENT_SUBTASK_COMPLETE] }

/**
 * 造一个假的插件上下文。
 * @param {Record<string, unknown>} values 配置字段值。
 * @param {Record<string, unknown>} services 假的 DSH 服务（sessionTitle / sessionProjections / sessions）。
 * @returns {{ctx: object, emit: Function, calls: object[]}} 上下文、事件触发器与请求记录。
 */
function fakeHost(values, services = {}) {
  const calls = []
  const handlers = []
  const ctx = {
    logger: { warn() {}, info() {}, debug() {}, error() {} },
    fiber: { ctx: { fiber: {} } },
    get(name) {
      if (name === 'credentials') {
        return { resolve: async () => ({ value: 'tk_test', source: 'file' }) }
      }
      return services[name]
    },
    on(event, handler) {
      handlers.push({ event, handler })
      return () => {}
    },
    inject(_names, _callback) {
      // 这个测试不装 settings / webServer 服务。
      return () => {}
    },
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, text: async () => '' }
  }
  const config = Config(values)
  const dispose = apply(ctx, config)
  return {
    ctx,
    calls,
    dispose,
    /** 触发一条会话事件，等异步派发完成。 */
    async emit(session, event) {
      for (const entry of handlers) {
        if (entry.event === 'session/event') entry.handler(session, event)
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    },
    restore() {
      globalThis.fetch = originalFetch
      dispose()
    },
  }
}

/** 一个最小可用的会话替身。 */
const session = { id: 'session-1', header: { cwd: '/tmp/demo' } }

test('「在设置页显示」默认打开，可以显式关掉', () => {
  assert.equal(Config({}).showInSettings.get(), true)
  assert.equal(Config({ showInSettings: false }).showInSettings.get(), false)
})

test('turn/end 完成后按事件优先级发到 ntfy', async (t) => {
  const host = fakeHost({
    ntfyUrl: 'https://ntfy.example.com:52',
    ntfyTopic: 'dsh',
    defaultNotify: true,
    ntfyPriorities: { 'task-complete': 5 },
  })
  t.after(() => host.restore())

  await host.emit(session, { type: 'session/title', data: { title: '示例会话' } })
  await host.emit(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

  assert.equal(host.calls.length, 1)
  const call = host.calls[0]
  assert.equal(call.url, 'https://ntfy.example.com:52')
  assert.equal(call.init.headers['authorization'], 'Bearer tk_test')
  const body = JSON.parse(call.init.body)
  assert.equal(body.topic, 'dsh')
  assert.equal(body.priority, 5)
  assert.equal(body.title, 'DSH · 任务完成')
  assert.match(body.message, /会话标题：示例会话/)
  assert.match(body.message, /任务正常完成/)
})

test('中断事件用自己那条优先级', async (t) => {
  const host = fakeHost({
    ntfyUrl: 'https://ntfy.example.com',
    ntfyTopic: 'dsh',
    defaultNotify: true,
    ntfyPriorities: { 'task-complete': 3, 'task-interrupted': 4 },
  })
  t.after(() => host.restore())

  await host.emit(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } })

  assert.equal(host.calls.length, 1)
  const body = JSON.parse(host.calls[0].init.body)
  assert.equal(body.priority, 4)
  assert.equal(body.title, 'DSH · 任务中断')
  assert.match(body.message, /任务被中止（用户中止）/)
})

test('默认不通知时没有请求', async (t) => {
  const host = fakeHost({ ntfyUrl: 'https://ntfy.example.com', ntfyTopic: 'dsh', defaultNotify: false })
  t.after(() => host.restore())

  await host.emit(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  assert.equal(host.calls.length, 0)
})

test('会话级覆盖优先于全局默认', async (t) => {
  const host = fakeHost({
    ntfyUrl: 'https://ntfy.example.com',
    ntfyTopic: 'dsh',
    defaultNotify: false,
    sessionOverrides: { 'session-1': true },
  })
  t.after(() => host.restore())

  await host.emit(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  assert.equal(host.calls.length, 1)
})

test('没填服务器信息的通道被跳过，不算失败', async (t) => {
  const host = fakeHost({
    channels: ['gotify', 'webhook', CHANNEL_NTFY],
    ntfyUrl: 'https://ntfy.example.com',
    ntfyTopic: 'dsh',
    defaultNotify: true,
  })
  t.after(() => host.restore())

  await host.emit(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  // 只有 ntfy 真正发了请求；gotify 与 webhook 没有地址，直接跳过。
  assert.equal(host.calls.length, 1)
  assert.equal(host.calls[0].url, 'https://ntfy.example.com')
})

/**
 * 一个主会话与它的子代理会话。
 * @returns {{main: object, child: object}} 两个会话替身。
 */
function sessionPair() {
  return {
    main: { id: 'session-main', header: { cwd: '/home/sorc/workspace/employment' } },
    child: {
      id: 'session-child',
      header: {
        cwd: '/home/sorc/workspace/employment',
        origin: 'subagent',
        parentSession: 'session-main',
      },
    },
  }
}

test('子代理的通知用子代理标签与主会话标题，不显示提示词截出来的标题', async (t) => {
  const host = fakeHost({ ntfyUrl: 'https://ntfy.example.com', ntfyTopic: 'dsh', defaultNotify: true, ...WITH_SUBTASK })
  t.after(() => host.restore())
  const { main, child } = sessionPair()

  await host.emit(main, {
    type: 'session/title',
    data: { title: '就业管理实现冲突分析', source: { kind: 'provider' } },
  })
  await host.emit(child, {
    type: 'subagent/descriptor',
    data: { mode: 'continuable', label: '分析M01就业网站模块冲突' },
  })
  // 子代理自己的会话标题是从提示词里截出来的兜底标题，不能拿来做通知标题。
  await host.emit(child, {
    type: 'session/title',
    data: { title: '你是只读分析员，禁止修改任', source: { kind: 'fallback' } },
  })
  await host.emit(child, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

  assert.equal(host.calls.length, 1)
  const body = JSON.parse(host.calls[0].init.body)
  assert.match(body.message, /子代理：分析M01就业网站模块冲突/)
  assert.match(body.message, /主会话：就业管理实现冲突分析/)
  assert.doesNotMatch(body.message, /你是只读分析员/)
})

test('主会话只有兜底标题时不写「主会话」这一行', async (t) => {
  const host = fakeHost({ ntfyUrl: 'https://ntfy.example.com', ntfyTopic: 'dsh', defaultNotify: true, ...WITH_SUBTASK })
  t.after(() => host.restore())
  const { main, child } = sessionPair()

  await host.emit(main, {
    type: 'session/title',
    data: { title: '你是只读分析员，禁止修改任', source: { kind: 'fallback' } },
  })
  await host.emit(child, {
    type: 'subagent/descriptor',
    data: { mode: 'continuable', label: '分析M01就业网站模块冲突' },
  })
  await host.emit(child, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

  assert.equal(host.calls.length, 1)
  const body = JSON.parse(host.calls[0].init.body)
  assert.match(body.message, /子代理：分析M01就业网站模块冲突/)
  assert.doesNotMatch(body.message, /主会话：/)
})

test('插件重启后仍从标题服务读到会话标题，不会退化成会话 ID', async (t) => {
  // 会话在插件加载之前就已经建好，标题事件早就过去了：只能问标题服务。
  const host = fakeHost(
    { ntfyUrl: 'https://ntfy.example.com', ntfyTopic: 'dsh', defaultNotify: true },
    {
      sessionTitle: {
        get() {
          return { title: '就业管理实现冲突分析', source: { kind: 'provider' } }
        },
      },
    },
  )
  t.after(() => host.restore())

  await host.emit(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

  assert.equal(host.calls.length, 1)
  const body = JSON.parse(host.calls[0].init.body)
  assert.match(body.message, /会话标题：就业管理实现冲突分析/)
  assert.doesNotMatch(body.message, /session-1/)
})

test('插件重启后子代理仍能拿到标签与主会话标题', async (t) => {
  const { main, child } = sessionPair()
  const host = fakeHost(
    { ntfyUrl: 'https://ntfy.example.com', ntfyTopic: 'dsh', defaultNotify: true, ...WITH_SUBTASK },
    {
      sessionTitle: {
        get(target) {
          if (target?.id === 'session-child') {
            // 子代理的标题是从提示词里截出来的兜底标题。
            return { title: '你是只读分析员，禁止修改任', source: { kind: 'fallback' } }
          }
          return { title: '就业管理实现冲突分析', source: { kind: 'provider' } }
        },
      },
      sessionProjections: {
        snapshot(target, keys) {
          const values = {}
          for (const key of keys) {
            if (key === 'subagent' && target?.id === 'session-child') {
              values.subagent = { mode: 'continuable', label: '分析M01就业网站模块冲突', seq: 1 }
            }
          }
          return { asOfSeq: 1, values }
        },
      },
      sessions: {
        get(id) {
          if (id === 'session-main') return main
          if (id === 'session-child') return child
          return undefined
        },
      },
    },
  )
  t.after(() => host.restore())

  await host.emit(child, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

  assert.equal(host.calls.length, 1)
  const body = JSON.parse(host.calls[0].init.body)
  assert.match(body.message, /子代理：分析M01就业网站模块冲突/)
  assert.match(body.message, /主会话：就业管理实现冲突分析/)
  assert.doesNotMatch(body.message, /你是只读分析员/)
  assert.doesNotMatch(body.message, /session-child/)
})

test('主会话只有兜底标题时（有标题服务）不写「主会话」这一行', async (t) => {
  const { main, child } = sessionPair()
  const host = fakeHost(
    { ntfyUrl: 'https://ntfy.example.com', ntfyTopic: 'dsh', defaultNotify: true, ...WITH_SUBTASK },
    {
      sessionTitle: {
        get(target) {
          if (target?.id === 'session-child') {
            return { title: '你是只读分析员，禁止修改任', source: { kind: 'fallback' } }
          }
          return { title: '你是只读分析员，禁止修改任', source: { kind: 'fallback' } }
        },
      },
      sessions: {
        get(id) {
          if (id === 'session-main') return main
          if (id === 'session-child') return child
          return undefined
        },
      },
    },
  )
  t.after(() => host.restore())

  await host.emit(child, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

  assert.equal(host.calls.length, 1)
  const body = JSON.parse(host.calls[0].init.body)
  assert.doesNotMatch(body.message, /主会话：/)
})

test('子任务完成默认不通知', async (t) => {
  const host = fakeHost({ ntfyUrl: 'https://ntfy.example.com', ntfyTopic: 'dsh', defaultNotify: true })
  t.after(() => host.restore())
  const { child } = sessionPair()

  await host.emit(child, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

  assert.equal(host.calls.length, 0)
})

test('勾上子任务完成后发子任务完成通知', async (t) => {
  const host = fakeHost({ ntfyUrl: 'https://ntfy.example.com', ntfyTopic: 'dsh', defaultNotify: true, ...WITH_SUBTASK })
  t.after(() => host.restore())
  const { main, child } = sessionPair()

  await host.emit(main, {
    type: 'session/title',
    data: { title: '就业管理实现冲突分析', source: { kind: 'provider' } },
  })
  await host.emit(child, {
    type: 'subagent/descriptor',
    data: { mode: 'continuable', label: '分析M01就业网站模块冲突' },
  })
  await host.emit(child, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

  assert.equal(host.calls.length, 1)
  const body = JSON.parse(host.calls[0].init.body)
  assert.equal(body.title, 'DSH · 子任务完成')
  assert.match(body.message, /子代理：分析M01就业网站模块冲突/)
  assert.match(body.message, /子任务正常完成/)
})

test('勾上子任务完成不影响主会话的任务完成通知', async (t) => {
  const host = fakeHost({ ntfyUrl: 'https://ntfy.example.com', ntfyTopic: 'dsh', defaultNotify: true, ...WITH_SUBTASK })
  t.after(() => host.restore())

  await host.emit(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

  assert.equal(host.calls.length, 1)
  const body = JSON.parse(host.calls[0].init.body)
  assert.equal(body.title, 'DSH · 任务完成')
})

test('子任务中断仍归为任务中断', async (t) => {
  const host = fakeHost({ ntfyUrl: 'https://ntfy.example.com', ntfyTopic: 'dsh', defaultNotify: true, ...WITH_SUBTASK })
  t.after(() => host.restore())
  const { child } = sessionPair()

  await host.emit(child, { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } })

  assert.equal(host.calls.length, 1)
  const body = JSON.parse(host.calls[0].init.body)
  assert.equal(body.title, 'DSH · 任务中断')
})
