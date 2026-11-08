/**
 * 宿主端插件的接线测试。
 *
 * 用假的 ctx 跑一遍 apply()：捕获 session/event 监听器，喂进一条会话事件，
 * 检查最终发出的 HTTP 请求。覆盖「配置 → 决策 → 载荷 → 通道」的整条链路。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { Config, apply } from '../index.js'
import { CHANNEL_NTFY } from '../lib/notify.js'

/**
 * 造一个假的插件上下文。
 * @param {Record<string, unknown>} values 配置字段值。
 * @returns {{ctx: object, emit: Function, calls: object[]}} 上下文、事件触发器与请求记录。
 */
function fakeHost(values) {
  const calls = []
  const handlers = []
  const ctx = {
    logger: { warn() {}, info() {}, debug() {}, error() {} },
    fiber: { ctx: { fiber: {} } },
    get(name) {
      if (name === 'credentials') {
        return { resolve: async () => ({ value: 'tk_test', source: 'file' }) }
      }
      return undefined
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
