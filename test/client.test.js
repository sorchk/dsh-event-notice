/**
 * 客户端接线测试。
 *
 * client.js 是浏览器 bundle，用假的 window.__ModuleLoader__ 与假的 require
 * 在 Node 里跑一遍 apply()，检查「设置页左侧导航」那一项的注册与注销：
 * 「在设置页显示」关掉后导航项消失，打开后重新出现。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

/** 只需要在渲染时用到的最小 React 替身；apply() 本身不渲染任何组件。 */
const reactStub = {
  createElement: (type, props) => ({ type, props }),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useState: (value) => [value, () => {}],
}

/**
 * 在 Node 里加载 client.js，取出它的 inject / apply。
 * @returns {{inject: string[], apply: Function}} 客户端入口。
 */
function loadClient() {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const loaded = {}
  const window = { __ModuleLoader__: { load: (options) => { loaded.options = options } } }
  const require_ = (name) => {
    if (name === 'react') return reactStub
    throw new Error(`测试里没有 ${name}`)
  }
  // eslint-disable-next-line no-new-func
  new Function('window', 'require', source)(window, require_)
  const factory = loaded.options.factory(require_)
  return factory
}

/**
 * 造一个假的浏览器插件上下文。
 * @param {object} value 配置表单当前的值。
 * @returns {object} 上下文、槽位注册表与表单订阅者。
 */
function fakeBrowser(value) {
  /** 已注册的槽位项。 */
  const entries = []
  /** 配置表单的订阅者。 */
  const listeners = []
  const scope = {
    getSnapshot: () => ({ status: 'ready', value, revision: 1, writable: true }),
    subscribe: (listener) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
    mutate: async () => true,
  }
  const ctx = {
    locale: {
      bind: () => (key) => key,
      register: () => () => {},
    },
    slots: {
      inject: (_name, callback) => {
        const dispose = callback()
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      },
      register: (options, _component) => {
        entries.push(options)
        return () => {
          const index = entries.indexOf(options)
          if (index >= 0) entries.splice(index, 1)
        }
      },
    },
    configForms: { get: () => scope },
    effect: (fn) => { fn() },
  }
  return {
    ctx,
    entries,
    /** 模拟配置表单值变化后触发订阅者。 */
    change(next) {
      Object.assign(value, next)
      for (const listener of [...listeners]) listener()
    },
    /** 当前是否注册了设置页导航项。 */
    hasSection() {
      return entries.some((entry) => entry.name === 'settings.section')
    },
  }
}

test('默认注册设置页导航项', () => {
  const browser = fakeBrowser({})
  const { apply } = loadClient()
  apply(browser.ctx)
  assert.equal(browser.hasSection(), true)
})

test('「在设置页显示」为关时不注册设置页导航项', () => {
  const browser = fakeBrowser({ showInSettings: false })
  const { apply } = loadClient()
  apply(browser.ctx)
  assert.equal(browser.hasSection(), false)
})

test('关掉开关后导航项消失，打开后重新出现', () => {
  const browser = fakeBrowser({ showInSettings: true })
  const { apply } = loadClient()
  apply(browser.ctx)
  assert.equal(browser.hasSection(), true)

  browser.change({ showInSettings: false })
  assert.equal(browser.hasSection(), false)

  browser.change({ showInSettings: true })
  assert.equal(browser.hasSection(), true)
})

test('其它配置变化不影响导航项', () => {
  const browser = fakeBrowser({ showInSettings: true })
  const { apply } = loadClient()
  apply(browser.ctx)
  browser.change({ titlePrefix: 'DSH' })
  assert.equal(browser.hasSection(), true)
})
