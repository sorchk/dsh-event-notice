/**
 * DSH 插件客户端：事件通知的配置页。
 *
 * 页面挂在插件管理器的插件行与插件包详情上，用 Host 的 settings form
 * 直接读写本插件的 volatile 配置字段；Gotify 令牌走凭据存储，不落在配置里。
 */
window.__ModuleLoader__.load({
  id: 'dsh-event-notice',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React
    // 外壳的浮层提示组件：和发送/停止按钮同一套提示样式。取不到时退回原生 title。
    const primitives = (() => {
      try {
        return require('@deepseek-ai/dsh-client-ui-primitives')
      } catch {
        return null
      }
    })()
    const Tooltip = primitives?.Tooltip

    /** 本插件的设置命名空间，也是 profile 里的插件行 id。 */
    const ENTRY_ID = 'dsh-event-notice'
    /** 插件包名。 */
    const PACKAGE_NAME = 'dsh-event-notice'
    /** 插件行在插件管理器里的配置插槽 key。 */
    const ROW_KEY = `${PACKAGE_NAME}#${ENTRY_ID}`
    /** 本地化命名空间。 */
    const NS = 'settings.eventNotice'

    const CHANNEL_ITEMS = [
      { id: 'ntfy', label: 'Ntfy' },
      { id: 'gotify', label: 'Gotify' },
      { id: 'webhook', label: 'Webhook' },
    ]

    /** 事件选项；label 由字典提供，随界面语言切换。 */
    const EVENT_ITEMS = [
      { id: 'task-complete', labelKey: 'eventTaskComplete' },
      { id: 'task-interrupted', labelKey: 'eventTaskInterrupted' },
      { id: 'approval-required', labelKey: 'eventApprovalRequired' },
      { id: 'question-required', labelKey: 'eventQuestionRequired' },
    ]

    /** ntfy 的五档优先级；标签由字典提供。 */
    const NTFY_LEVELS = [
      { value: 1, labelKey: 'priorityMin' },
      { value: 2, labelKey: 'priorityLow' },
      { value: 3, labelKey: 'priorityDefault' },
      { value: 4, labelKey: 'priorityHigh' },
      { value: 5, labelKey: 'priorityMax' },
    ]

    /** Gotify 的优先级：0-10，纯数字。 */
    const GOTIFY_LEVELS = Array.from({ length: 11 }, (_unused, index) => ({ value: index, label: String(index) }))

    const en = {
      title: 'Event notice',
      nav: 'Event notifications',
      sessionToggle: 'Notifications',
      sessionToggleOn: 'Notifications are on for this session.',
      sessionToggleOff: 'Notifications are off for this session.',
      sessionToggleFollowing: 'Following the global default.',
      sessionToggleDisabled: 'Notifications are disabled.',
      enabled: 'Enable notifications',
      enabledHint: 'Master switch. When off, no notification is sent.',
      defaultNotify: 'Notify for every session by default',
      defaultNotifyHint: 'On: every session notifies unless a session-level override says otherwise. Off: only sessions with an explicit override notify.',
      channels: 'Notification channels',
      channelsHint: 'Which channels are used. A channel without server settings is skipped.',
      showInSettings: 'Show in settings',
      showInSettingsHint: 'When off, the settings sidebar no longer lists Event notifications. Turn it back on from the plugin page.',
      events: 'Events to notify',
      eventsHint: 'Which events trigger a notification by default.',
      eventTaskComplete: 'Task completed',
      eventTaskInterrupted: 'Task interrupted',
      eventApprovalRequired: 'Approval required',
      eventQuestionRequired: 'A question needs an answer',
      gotify: 'Gotify',
      gotifyUrl: 'Server URL',
      gotifyUrlHint: 'For example https://gotify.example.com.',
      gotifyTokenRef: 'Token reference',
      gotifyTokenRefHint: 'Name of the credential holding the Gotify application token.',
      gotifyToken: 'Application token',
      gotifyTokenHint: 'Stored in the credential store, not in the settings file. Leave blank to keep the current token.',
      gotifyTokenSet: 'A token is configured.',
      gotifyTokenUnset: 'No token is configured.',
      gotifyPriority: 'Priority',
      gotifyPriorityHint: 'Gotify priority, 0 (lowest) to 10 (highest).',
      priorities: 'Priority per event',
      prioritiesHint: 'Each event type can have its own priority.',
      priorityMin: 'Min (1)',
      priorityLow: 'Low (2)',
      priorityDefault: 'Default (3)',
      priorityHigh: 'High (4)',
      priorityMax: 'Max (5)',
      ntfy: 'ntfy',
      ntfyUrl: 'Server URL',
      ntfyUrlHint: 'For example https://ntfy.example.com.',
      ntfyTopic: 'Topic',
      ntfyTopicHint: 'The topic the notifications are published to.',
      ntfyTokenRef: 'Token reference',
      ntfyTokenRefHint: 'Name of the credential holding the ntfy access token.',
      ntfyToken: 'Access token',
      ntfyTokenHint: 'Stored in the credential store, not in the settings file. Leave blank to keep the current token.',
      ntfyTokenSet: 'A token is configured.',
      ntfyTokenUnset: 'No token is configured.',
      webhook: 'Webhook',
      webhookUrl: 'Webhook URL',
      webhookUrlHint: 'The address that receives the notification.',
      webhookMethod: 'Method',
      webhookHeaders: 'Extra headers',
      webhookHeadersHint: 'One "Name: value" per line.',
      webhookBody: 'Body template',
      webhookBodyHint: 'Placeholders such as {{event}}, {{title}}, {{message}}, {{sessionId}}, {{sessionTitle}} and {{timestamp}}.',
      webhookContentType: 'Content type',
      common: 'Common',
      titlePrefix: 'Title prefix',
      titlePrefixHint: 'Prepended to every notification title.',
      timeoutMs: 'Timeout (ms)',
      timeoutHint: 'How long a single request may take before it is aborted.',
      sessions: 'Session overrides',
      sessionsHint: 'Overrides win over the default. Each switch controls only that one session.',
      overridesList: 'Current overrides',
      overrideNotify: 'Notify',
      overrideMute: 'Do not notify',
      remove: 'Remove',
      noOverrides: 'No session-level overrides.',
      test: 'Send test notification',
      testing: 'Sending…',
      testOk: 'Test notification sent.',
      testPartial: 'Some channels failed.',
      testFailed: 'Test notification failed.',
      saving: 'Saving…',
      saveFailed: 'The deployment rejected this change.',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      readonly: 'This deployment stores settings read-only.',
      summary: 'Notify on {events}; channels: {channels}; default: {mode}.',
      summaryModeOn: 'all sessions',
      summaryModeOff: 'opt-in only',
      summaryChannelsNone: 'none',
      summaryEventNames: {
        'task-complete': 'complete',
        'task-interrupted': 'interrupted',
        'approval-required': 'approval',
        'question-required': 'question',
      },
    }

    const zh = {
      title: '事件通知',
      nav: '事件通知',
      sessionToggle: '通知',
      sessionToggleOn: '当前会话的通知已开启。',
      sessionToggleOff: '当前会话的通知已关闭。',
      sessionToggleFollowing: '跟随全局默认设置。',
      sessionToggleDisabled: '通知功能已关闭。',
      enabled: '启用通知',
      enabledHint: '总开关。关闭后不发送任何通知。',
      defaultNotify: '所有会话默认通知',
      defaultNotifyHint: '开启：所有会话都会通知，除非该会话有单独的覆盖设置。关闭：只有显式设置过的会话才会通知。',
      channels: '通知通道',
      channelsHint: '启用哪些通道。没有填写服务器信息的通道会被跳过。',
      showInSettings: '在设置页显示',
      showInSettingsHint: '关闭后，设置页左侧导航不再显示「事件通知」。可以从「插件 → 事件通知 → 配置」重新打开。',
      events: '默认通知的事件',
      eventsHint: '哪些事件会触发通知。',
      eventTaskComplete: '任务完成',
      eventTaskInterrupted: '任务中断',
      eventApprovalRequired: '需要审批',
      eventQuestionRequired: '需要回答问题',
      gotify: 'Gotify',
      gotifyUrl: '服务器地址',
      gotifyUrlHint: '例如 https://gotify.example.com，插件会自动追加 /message。',
      gotifyTokenRef: '令牌引用名',
      gotifyTokenRefHint: '保存 Gotify 应用令牌的凭据名称。',
      gotifyToken: '应用令牌',
      gotifyTokenHint: '保存在凭据存储里，不写进设置文件。留空表示保持当前令牌不变。',
      gotifyTokenSet: '已经配置了令牌。',
      gotifyTokenUnset: '还没有配置令牌。',
      gotifyPriority: '优先级',
      gotifyPriorityHint: 'Gotify 优先级，0（最低）到 10（最高）。',
      priorities: '按事件设置优先级',
      prioritiesHint: '每种事件类型可以单独设置优先级。',
      priorityMin: '最低（1）',
      priorityLow: '低（2）',
      priorityDefault: '默认（3）',
      priorityHigh: '高（4）',
      priorityMax: '最高（5）',
      ntfy: 'Ntfy',
      ntfyUrl: '服务器地址',
      ntfyUrlHint: '例如 https://ntfy.example.com。',
      ntfyTopic: '主题',
      ntfyTopicHint: '通知发布到哪个主题。',
      ntfyTokenRef: '令牌引用名',
      ntfyTokenRefHint: '保存 ntfy 访问令牌的凭据名称。',
      ntfyToken: '访问令牌',
      ntfyTokenHint: '保存在凭据存储里，不写进设置文件。留空表示保持当前令牌不变。',
      ntfyTokenSet: '已经配置了令牌。',
      ntfyTokenUnset: '还没有配置令牌。',
      webhook: 'Webhook',
      webhookUrl: 'Webhook 地址',
      webhookUrlHint: '接收通知的地址。',
      webhookMethod: '请求方法',
      webhookHeaders: '额外请求头',
      webhookHeadersHint: '每行一个「名称: 值」。',
      webhookBody: '请求体模板',
      webhookBodyHint: '可用占位符：{{event}}、{{title}}、{{message}}、{{sessionId}}、{{sessionTitle}}、{{timestamp}}。',
      webhookContentType: '内容类型',
      common: '通用',
      titlePrefix: '标题前缀',
      titlePrefixHint: '加在每条通知标题前面。',
      timeoutMs: '超时（毫秒）',
      timeoutHint: '单次请求允许的最长等待时间。',
      sessions: '会话级覆盖',
      sessionsHint: '会话级覆盖优先于全局默认。每一项的开关只作用于该会话本身。',
      overridesList: '当前覆盖',
      overrideNotify: '通知',
      overrideMute: '不通知',
      remove: '删除',
      noOverrides: '还没有会话级覆盖。',
      test: '发送测试通知',
      testing: '发送中…',
      testOk: '测试通知已发送。',
      testPartial: '部分通道发送失败。',
      testFailed: '测试通知发送失败。',
      saving: '保存中…',
      saveFailed: '本次修改没有生效，请检查填写的值。',
      unavailable: '插件没有加载，暂时无法配置。',
      readonly: '当前部署只允许读取设置。',
      summary: '通知事件：{events}；通道：{channels}；默认：{mode}。',
      summaryModeOn: '所有会话',
      summaryModeOff: '仅显式开启的会话',
      summaryChannelsNone: '无',
      summaryEventNames: {
        'task-complete': '完成',
        'task-interrupted': '中断',
        'approval-required': '审批',
        'question-required': '提问',
      },
    }

    const STYLE = `
      .den-root { display: flex; flex-direction: column; gap: 20px; width: 100%; color: var(--dsw-alias-label-primary); font-size: 13px; }
      .den-heading { margin: 0; font-size: 15px; font-weight: 600; line-height: 22px; }
      .den-subheading { margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
      .den-section { display: flex; flex-direction: column; width: 100%; }
      .den-row { display: flex; align-items: center; gap: 8px; padding: 16px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
      .den-row:last-child { border-bottom: none; }
      .den-row-stack { flex-direction: column; align-items: stretch; gap: 10px; }
      .den-rowText { display: flex; flex-direction: column; flex: 1 1 0; gap: 4px; min-width: 0; padding-right: 48px; }
      .den-row-stack > .den-rowText { padding-right: 0; }
      .den-title { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 400; line-height: 22px; }
      .den-desc { color: var(--dsw-alias-label-tertiary); font-size: 12px; font-weight: 400; line-height: 18px; }
      .den-control { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex: 0 1 auto; min-width: 0; }
      .den-control-wide { flex: 1; justify-content: flex-start; flex-wrap: wrap; }
      /* 独占一行的控件占满整行并左对齐，避免右侧留出大块空白。 */
      .den-row-stack > .den-control { width: 100%; justify-content: flex-start; }
      .den-input, .den-select, .den-textarea { box-sizing: border-box; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); border: none; border-radius: var(--dsw-radius-md); font: inherit; font-size: 14px; line-height: 22px; outline: none; }
      .den-input { width: 220px; max-width: 100%; height: 36px; padding: 0 14px; }
      .den-select { height: 36px; padding: 0 10px; cursor: pointer; min-width: 118px; }
      .den-textarea { width: 100%; min-height: 76px; padding: 8px 12px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 18px; }
      .den-input:focus, .den-select:focus, .den-textarea:focus { outline: var(--dsw-focus-ring-width, 1px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
      .den-checks { display: flex; flex-wrap: wrap; gap: 8px 16px; }
      .den-check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; color: var(--dsw-alias-label-primary); }
      .den-check input { accent-color: var(--dsw-alias-brand-primary); width: 14px; height: 14px; }
      .den-switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--dsw-alias-label-primary); }
      .den-switch-control { border: 0; background: none; padding: 0; cursor: pointer; display: inline-flex; flex: none; }
      .den-switch-control[disabled] { cursor: not-allowed; opacity: 0.45; }
      .den-switch-control:focus-visible { outline: var(--dsw-focus-ring-width, 1px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; border-radius: var(--dsw-radius-sm); }
      .den-switch-track { display: inline-block; position: relative; width: 24px; height: 14px; border-radius: 7px; background: var(--dsw-alias-border-l2); transition: background-color .12s var(--ds-ease-in-out); }
      .den-switch-track[data-on="true"] { background: var(--dsw-alias-state-business-primary); }
      .den-switch-thumb { position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--dsw-alias-bg-layer-1); transition: transform .12s var(--ds-ease-in-out); }
      .den-switch-track[data-on="true"] .den-switch-thumb { transform: translate(10px); }
      .den-button { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); border: none; border-radius: var(--dsw-radius-md); height: 36px; padding: 0 14px; cursor: pointer; font: inherit; font-size: 13px; }
      .den-button:hover:not([disabled]) { background: var(--dsw-alias-button-primary-hover); }
      .den-button[disabled] { opacity: 0.5; cursor: not-allowed; }
      /* 独占一行、左对齐的动作区（例如「发送测试通知」按钮）。 */
      .den-actionRow { display: flex; align-items: center; gap: 8px; justify-content: flex-start; padding: 12px 0; }
      .den-button-quiet { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); }
      .den-tabs { display: flex; align-items: flex-end; gap: 22px; border-bottom: .5px solid var(--dsw-alias-border-l2); margin-top: 2px; }
      .den-tab { color: var(--dsw-alias-label-tertiary); font: inherit; cursor: pointer; background: none; border: 0; padding: 7px 1px 9px; font-size: 13px; line-height: 20px; position: relative; }
      .den-tab:hover { color: var(--dsw-alias-label-primary); }
      .den-tab[data-active="true"] { color: var(--dsw-alias-label-primary); }
      .den-tab[data-active="true"]::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; border-radius: 2px 2px 0 0; background: var(--dsw-alias-label-primary); }
      .den-tab:focus-visible { outline: var(--dsw-focus-ring-width, 1px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; border-radius: 2px; }
      .den-tabPanel { min-width: 0; padding-top: 2px; }
      .den-status { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
      .den-status-error { color: var(--dsw-alias-state-error-primary); }
      .den-status-ok { color: var(--dsw-alias-state-success-primary); }
      .den-list { display: flex; flex-direction: column; }
      .den-list-item { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
      .den-list-item:last-child { border-bottom: none; }
      .den-session-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }
      /* 优先级：宽屏时两列并排，每格一个描边卡片，窄屏时自动折成一列。 */
      .den-priorities { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px 24px; width: 100%; }
      .den-priority-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 16px; min-width: 0; padding: 10px 14px; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); }
      .den-priority-label { font-size: 13px; color: var(--dsw-alias-label-primary); min-width: 0; }
      /* 铃铛按钮：外壳图标按钮的外形（28px 圆形、悬停浅灰底）；图标颜色跟着通知状态走：关闭是浅蓝（同发送按钮禁用时的浅蓝），打开是蓝（同停止按钮的蓝）。 */
      .den-toggle { position: relative; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 999px; corner-shape: round; background: transparent; color: color-mix(in srgb, var(--dsw-alias-button-info-fill) 40%, transparent); cursor: pointer; }
      @media (hover: hover) { .den-toggle:hover:not([disabled]) { background: var(--dsw-alias-interactive-bg-hover-solid); } }
      .den-toggle-on { color: var(--dsw-alias-button-info-fill); }
      .den-toggle[disabled] { opacity: 0.5; cursor: default; }
      .den-toggle:focus-visible { outline: var(--dsh-focus-ring-width, 1px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
      .den-toggle-dot { position: absolute; top: 1px; right: 1px; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-button-info-fill); }
    `

    /** 全局样式表的 DOM id：注入过就不再重复挂载。 */
    const STYLE_ID = 'dsh-event-notice-style'

    /**
     * 把样式表挂进 document.head。
     *
     * 铃铛按钮挂在输入框插槽里，和设置面板不是同一处渲染，
     * 样式必须全局注入一次，否则按钮会退回浏览器默认样式。
     */
    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLE
      document.head.appendChild(style)
    }

    ensureStyle()

    /**
     * 读取一份表单快照并订阅变化。
     * @param {object} ctx 客户端上下文。
     * @returns {[object, object|null]} 快照与表单控制器。
     */
    function useFormState(ctx) {
      const scope = useMemo(() => {
        try {
          return ctx.configForms.get(ENTRY_ID)
        } catch {
          return undefined
        }
      }, [ctx])
      const [snapshot, setSnapshot] = useState(() => scope?.getSnapshot?.() ?? null)
      useEffect(() => {
        if (scope === undefined) {
          setSnapshot({ status: 'unavailable', value: {}, revision: 0, writable: false })
          return undefined
        }
        const update = () => setSnapshot(scope.getSnapshot())
        update()
        return scope.subscribe(update)
      }, [scope])
      return [snapshot, scope]
    }

    /**
     * 一行「标题 + 说明 + 控件」的布局，与宿主通用设置页一致。
     *
     * 默认左侧是标题与说明、右侧是控件；stack 模式把控件放到标题下面并占满整行。
     * @param {object} props 组件属性。
     * @param {string} props.label 标题。
     * @param {string} [props.hint] 说明文字。
     * @param {boolean} [props.stack] 控件是否独占一行。
     * @param {boolean} [props.wide] 控件区是否靠左并允许换行。
     */
    function Row(props) {
      return h('div', { className: props.stack === true ? 'den-row den-row-stack' : 'den-row' },
        h('div', { className: 'den-rowText' },
          h('div', { className: 'den-title' }, props.label),
          props.hint ? h('div', { className: 'den-desc' }, props.hint) : null),
        h('div', { className: props.wide === true ? 'den-control den-control-wide' : 'den-control' }, props.children))
    }

    /**
     * 一组标签页。
     * @param {object} props 组件属性。
     * @param {Array<{id: string, label: string}>} props.tabs 标签页列表。
     * @param {string} props.active 当前标签页 id。
     * @param {Function} props.onChange 切换回调。
     * @param {object} props.panel 当前标签页的内容。
     */
    function Tabs(props) {
      return h('div', null,
        h('div', { className: 'den-tabs', role: 'tablist' }, props.tabs.map((tab) => h('button', {
          className: 'den-tab',
          key: tab.id,
          type: 'button',
          role: 'tab',
          'data-active': tab.id === props.active ? 'true' : 'false',
          'aria-selected': tab.id === props.active,
          onClick: () => props.onChange(tab.id),
        }, tab.label))),
        h('div', { className: 'den-tabPanel', role: 'tabpanel' }, props.panel))
    }

    /**
     * 文本输入框：失焦或回车时提交。
     */
    function TextField(props) {
      const [draft, setDraft] = useState(props.value ?? '')
      const [focused, setFocused] = useState(false)
      useEffect(() => {
        if (!focused) setDraft(props.value ?? '')
      }, [props.value, focused])
      const commit = () => {
        const next = draft
        if (next === (props.value ?? '')) return
        props.onCommit(next)
      }
      return h('input', {
        className: 'den-input',
        type: props.type ?? 'text',
        value: draft,
        placeholder: props.placeholder,
        disabled: props.disabled,
        min: props.min,
        max: props.max,
        step: props.step,
        onChange: (event) => {
          setDraft(event.target.value)
          props.onChange?.(event.target.value)
        },
        onFocus: () => setFocused(true),
        onBlur: () => { setFocused(false); commit() },
        onKeyDown: (event) => { if (event.key === 'Enter') { event.currentTarget.blur() } },
      })
    }

    /**
     * 多行文本框：失焦时提交。
     */
    function TextArea(props) {
      const [draft, setDraft] = useState(props.value ?? '')
      const [focused, setFocused] = useState(false)
      useEffect(() => {
        if (!focused) setDraft(props.value ?? '')
      }, [props.value, focused])
      return h('textarea', {
        className: 'den-textarea',
        value: draft,
        placeholder: props.placeholder,
        disabled: props.disabled,
        onChange: (event) => setDraft(event.target.value),
        onFocus: () => setFocused(true),
        onBlur: () => { setFocused(false); if (draft !== (props.value ?? '')) props.onCommit(draft) },
      })
    }

    /**
     * 开关：一个小滑块，样式照抄宿主设置页的开关。
     * @param {object} props 组件属性。
     * @param {boolean} props.checked 是否打开。
     * @param {boolean} [props.disabled] 是否禁用。
     * @param {string} [props.text] 开关旁边的文字。
     * @param {Function} props.onChange 切换回调。
     */
    function Switch(props) {
      const on = props.checked === true
      const control = h('button', {
        className: 'den-switch-control',
        type: 'button',
        role: 'switch',
        'aria-checked': on,
        'aria-label': props.ariaLabel ?? props.text,
        disabled: props.disabled,
        onClick: () => props.onChange(!on),
      }, h('span', { className: 'den-switch-track', 'data-on': on ? 'true' : 'false' },
        h('span', { className: 'den-switch-thumb' })))
      if (props.text === undefined) return control
      return h('span', { className: 'den-switch' }, control, h('span', null, props.text))
    }

    /**
     * 复选框组。
     */
    function CheckGroup(props) {
      const selected = Array.isArray(props.selected) ? props.selected : []
      return h('div', { className: 'den-checks' },
        props.options.map((option) => h('label', { className: 'den-check', key: option.id },
          h('input', {
            type: 'checkbox',
            checked: selected.includes(option.id),
            disabled: props.disabled,
            onChange: (event) => {
              const next = event.target.checked
                ? [...selected, option.id]
                : selected.filter((item) => item !== option.id)
              props.onChange(next)
            },
          }),
          h('span', null, option.label))))
    }

    /**
     * 下拉选择。
     */
    function Select(props) {
      return h('select', {
        className: 'den-select',
        value: props.value,
        disabled: props.disabled,
        onChange: (event) => props.onChange(event.target.value),
      }, props.options.map((option) => h('option', { key: option.id, value: option.id }, option.label)))
    }

    /**
     * 按事件列出优先级选择器。
     *
     * 每个事件一行，选中值写进同一个优先级表（事件 → 数字）。
     */
    function PriorityRows(props) {
      const { t, levels, selected, disabled, onChange, fallback } = props
      const options = levels.map((level) => ({
        id: String(level.value),
        label: level.labelKey === undefined ? level.label : t(level.labelKey),
      }))
      return h('div', { className: 'den-priorities' }, EVENT_ITEMS.map((event) => h('div', {
        className: 'den-priority-row',
        key: event.id,
      },
      h('span', { className: 'den-priority-label' }, t(event.labelKey)),
      h(Select, {
        value: String(selected[event.id] ?? fallback),
        options,
        disabled,
        onChange: (next) => onChange(event.id, Number(next)),
      }))))
    }

    /**
     * 事件通知配置页。
     */
    function ConfigPanel(props) {
      const ctx = props.ctx
      const t = useMemo(() => ctx.locale.bind(NS), [ctx])
      const [snapshot, scope] = useFormState(ctx)
      const [status, setStatus] = useState(null)
      const [testState, setTestState] = useState(null)
      const [channelTab, setChannelTab] = useState('ntfy')
      const value = (snapshot?.value ?? {})
      const writable = snapshot?.writable !== false && snapshot?.status === 'ready'

      const commit = useCallback(async (ops) => {
        if (scope === undefined || scope === null) return
        setStatus({ kind: 'saving', text: t('saving') })
        try {
          const ok = await scope.mutate(ops)
          setStatus(ok === true ? null : { kind: 'error', text: t('saveFailed') })
        } catch {
          setStatus({ kind: 'error', text: t('saveFailed') })
        }
      }, [scope, t])

      const setField = useCallback((field, next) => {
        void commit([{ op: 'set', path: [field], value: next }])
      }, [commit])

      if (snapshot === null) return h('div', { className: 'den-root' }, h('style', null, STYLE))
      if (snapshot.status === 'unavailable') {
        return h('div', { className: 'den-root' },
          h('style', null, STYLE),
          h('div', { className: 'den-status' }, t('unavailable')))
      }

      const channelTabs = [
        { id: 'ntfy', label: t('ntfy') },
        { id: 'gotify', label: t('gotify') },
        { id: 'webhook', label: t('webhook') },
      ]
      const activeChannel = channelTabs.some((tab) => tab.id === channelTab)
        ? channelTab
        : channelTabs[0].id

      return h('div', { className: 'den-root' },
        h('style', null, STYLE),
        h('div', { className: 'den-section' },
          h('h3', { className: 'den-heading' }, t('title')),
          h(Row, { label: t('enabled'), hint: t('enabledHint') },
            h(Switch, {
              checked: value.enabled === true,
              disabled: !writable,
              onChange: (next) => setField('enabled', next),
            })),
          h(Row, { label: t('defaultNotify'), hint: t('defaultNotifyHint') },
            h(Switch, {
              checked: value.defaultNotify === true,
              disabled: !writable,
              onChange: (next) => setField('defaultNotify', next),
            })),
          h(Row, { label: t('showInSettings'), hint: t('showInSettingsHint') },
            h(Switch, {
              checked: value.showInSettings !== false,
              disabled: !writable,
              onChange: (next) => setField('showInSettings', next),
            })),
          h(Row, { label: t('channels'), hint: t('channelsHint'), stack: true },
            h(CheckGroup, {
              options: CHANNEL_ITEMS,
              selected: value.channels ?? [],
              disabled: !writable,
              onChange: (next) => setField('channels', next),
            })),
          h(Row, { label: t('events'), hint: t('eventsHint'), stack: true },
            h(CheckGroup, {
              options: EVENT_ITEMS.map((item) => ({ id: item.id, label: t(item.labelKey) })),
              selected: value.events ?? [],
              disabled: !writable,
              onChange: (next) => setField('events', next),
            }))),
        h('div', { className: 'den-section' },
          h(Tabs, {
            tabs: channelTabs,
            active: activeChannel,
            onChange: (next) => setChannelTab(next),
            panel: activeChannel === 'ntfy'
              ? h(NtfyPanel, { ctx, t, value, writable, commit })
              : activeChannel === 'gotify'
                ? h(GotifyPanel, { ctx, t, value, writable, commit })
                : h(WebhookPanel, { t, value, writable, commit }),
          })),
        h('div', { className: 'den-section' },
          h('h3', { className: 'den-subheading' }, t('common')),
          h(Row, { label: t('titlePrefix'), hint: t('titlePrefixHint') },
            h(TextField, {
              value: value.titlePrefix ?? '',
              disabled: !writable,
              onCommit: (next) => setField('titlePrefix', next),
            })),
          h(Row, { label: t('timeoutMs'), hint: t('timeoutHint') },
            h(TextField, {
              value: String(value.timeoutMs ?? 10000),
              type: 'number',
              min: 1,
              max: 600000,
              step: 1,
              disabled: !writable,
              onCommit: (next) => {
                const parsed = Number(next)
                setField('timeoutMs', Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 10000)
              },
            }))),
        h('div', { className: 'den-section' },
          h('div', { className: 'den-actionRow' },
            h('button', {
              className: 'den-button',
              disabled: testState?.busy === true,
              onClick: async () => {
                setTestState({ busy: true, kind: 'busy', text: t('testing') })
                try {
                  const response = await fetch('/dsh-event-notice/test', { method: 'POST' })
                  const body = await response.json().catch(() => ({}))
                  if (response.ok && body.ok === true) setTestState({ kind: 'ok', text: t('testOk') })
                  else if (response.ok) setTestState({ kind: 'error', text: t('testPartial') })
                  else setTestState({ kind: 'error', text: `${t('testFailed')} ${body.error ?? ''}`.trim() })
                } catch (error) {
                  setTestState({ kind: 'error', text: `${t('testFailed')} ${String(error?.message ?? error)}`.trim() })
                }
              },
            }, t('test'))),
          testState === null ? null : h('div', {
            className: testState.kind === 'error' ? 'den-status den-status-error' : 'den-status den-status-ok',
          }, testState.text)),
        h('div', { className: 'den-section' },
          h('h3', { className: 'den-subheading' }, t('sessions')),
          h(SessionsSection, { ctx, t, value, writable, commit })),
        status === null ? null : h('div', {
          className: status.kind === 'error' ? 'den-status den-status-error' : 'den-status',
        }, status.text))
    }

    /**
     * Gotify 通道设置。
     */
    function GotifyPanel(props) {
      const { ctx, t, value, writable, commit } = props
      const [token, setToken] = useState('')
      const [credential, setCredential] = useState(null)
      const ref = value.gotifyTokenRef ?? 'DSH_EVENT_NOTICE_GOTIFY_TOKEN'

      useEffect(() => {
        let cancelled = false
        const load = async () => {
          try {
            const result = await ctx.remote.credentials.describe([ref])
            if (cancelled) return
            setCredential(result?.value?.[ref] ?? null)
          } catch {
            if (!cancelled) setCredential(null)
          }
        }
        void load()
        return () => { cancelled = true }
      }, [ctx, ref])

      return h('div', { className: 'den-section' },
        h(Row, { label: t('gotifyUrl'), hint: t('gotifyUrlHint') },
          h(TextField, {
            value: value.gotifyUrl ?? '',
            placeholder: 'https://gotify.example.com',
            disabled: !writable,
            onCommit: (next) => void commit([{ op: 'set', path: ['gotifyUrl'], value: next }]),
          })),
        h(Row, { label: t('gotifyTokenRef'), hint: t('gotifyTokenRefHint') },
          h(TextField, {
            value: ref,
            disabled: !writable,
            onCommit: (next) => void commit([{ op: 'set', path: ['gotifyTokenRef'], value: next.trim() }]),
          })),
        h(Row, { label: t('gotifyToken'), hint: t('gotifyTokenHint') },
          h('div', { className: 'den-control den-control-wide', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
            h(TextField, {
              value: token,
              type: 'password',
              placeholder: '••••••••',
              disabled: !writable,
              onCommit: async (next) => {
                if (next === '') return
                try {
                  await ctx.remote.credentials.set(ref, next)
                  setToken('')
                  const result = await ctx.remote.credentials.describe([ref])
                  setCredential(result?.value?.[ref] ?? null)
                } catch {
                  setToken('')
                }
              },
            }),
            h('div', { className: 'den-status' }, credential?.configured === true ? t('gotifyTokenSet') : t('gotifyTokenUnset')),
            credential?.configured === true
              ? h('button', {
                className: 'den-button den-button-quiet',
                onClick: async () => {
                  try {
                    await ctx.remote.credentials.unset(ref)
                    const result = await ctx.remote.credentials.describe([ref])
                    setCredential(result?.value?.[ref] ?? null)
                  } catch { /* 保持现状 */ }
                },
              }, t('remove'))
              : null)),
        h(Row, { label: t('priorities'), hint: t('prioritiesHint'), stack: true },
          h(PriorityRows, {
            t,
            levels: GOTIFY_LEVELS,
            selected: value.gotifyPriorities ?? {},
            disabled: !writable,
            fallback: 5,
            onChange: (kind, priority) => {
              const next = { ...(value.gotifyPriorities ?? {}), [kind]: priority }
              void commit([{ op: 'set', path: ['gotifyPriorities'], value: next }])
            },
          })))
    }

    /**
     * ntfy 通道设置。
     */
    function NtfyPanel(props) {
      const { ctx, t, value, writable, commit } = props
      const [token, setToken] = useState('')
      const [credential, setCredential] = useState(null)
      const ref = value.ntfyTokenRef ?? 'DSH_EVENT_NOTICE_NTFY_TOKEN'

      useEffect(() => {
        let cancelled = false
        const load = async () => {
          try {
            const result = await ctx.remote.credentials.describe([ref])
            if (cancelled) return
            setCredential(result?.value?.[ref] ?? null)
          } catch {
            if (!cancelled) setCredential(null)
          }
        }
        void load()
        return () => { cancelled = true }
      }, [ctx, ref])

      return h('div', { className: 'den-section' },
        h(Row, { label: t('ntfyUrl'), hint: t('ntfyUrlHint') },
          h(TextField, {
            value: value.ntfyUrl ?? '',
            placeholder: 'https://ntfy.example.com',
            disabled: !writable,
            onCommit: (next) => void commit([{ op: 'set', path: ['ntfyUrl'], value: next.trim() }]),
          })),
        h(Row, { label: t('ntfyTopic'), hint: t('ntfyTopicHint') },
          h(TextField, {
            value: value.ntfyTopic ?? '',
            placeholder: 'dsh',
            disabled: !writable,
            onCommit: (next) => void commit([{ op: 'set', path: ['ntfyTopic'], value: next.trim() }]),
          })),
        h(Row, { label: t('ntfyTokenRef'), hint: t('ntfyTokenRefHint') },
          h(TextField, {
            value: ref,
            disabled: !writable,
            onCommit: (next) => void commit([{ op: 'set', path: ['ntfyTokenRef'], value: next.trim() }]),
          })),
        h(Row, { label: t('ntfyToken'), hint: t('ntfyTokenHint') },
          h('div', { className: 'den-control den-control-wide', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
            h(TextField, {
              value: token,
              type: 'password',
              placeholder: '••••••••',
              disabled: !writable,
              onCommit: async (next) => {
                if (next === '') return
                try {
                  await ctx.remote.credentials.set(ref, next)
                  setToken('')
                  const result = await ctx.remote.credentials.describe([ref])
                  setCredential(result?.value?.[ref] ?? null)
                } catch {
                  setToken('')
                }
              },
            }),
            h('div', { className: 'den-status' }, credential?.configured === true ? t('ntfyTokenSet') : t('ntfyTokenUnset')),
            credential?.configured === true
              ? h('button', {
                className: 'den-button den-button-quiet',
                onClick: async () => {
                  try {
                    await ctx.remote.credentials.unset(ref)
                    const result = await ctx.remote.credentials.describe([ref])
                    setCredential(result?.value?.[ref] ?? null)
                  } catch { /* 保持现状 */ }
                },
              }, t('remove'))
              : null)),
        h(Row, { label: t('priorities'), hint: t('prioritiesHint'), stack: true },
          h(PriorityRows, {
            t,
            levels: NTFY_LEVELS,
            selected: value.ntfyPriorities ?? {},
            disabled: !writable,
            fallback: 3,
            onChange: (kind, priority) => {
              const next = { ...(value.ntfyPriorities ?? {}), [kind]: priority }
              void commit([{ op: 'set', path: ['ntfyPriorities'], value: next }])
            },
          })))
    }

    /**
     * Webhook 通道设置。
     */
    function WebhookPanel(props) {
      const { t, value, writable, commit } = props
      return h('div', { className: 'den-section' },
        h(Row, { label: t('webhookUrl'), hint: t('webhookUrlHint') },
          h(TextField, {
            value: value.webhookUrl ?? '',
            placeholder: 'https://example.com/hook',
            disabled: !writable,
            onCommit: (next) => void commit([{ op: 'set', path: ['webhookUrl'], value: next }]),
          })),
        h(Row, { label: t('webhookMethod') },
          h(Select, {
            value: value.webhookMethod ?? 'POST',
            options: [{ id: 'POST', label: 'POST' }, { id: 'PUT', label: 'PUT' }],
            disabled: !writable,
            onChange: (next) => void commit([{ op: 'set', path: ['webhookMethod'], value: next }]),
          })),
        h(Row, { label: t('webhookHeaders'), hint: t('webhookHeadersHint'), stack: true },
          h(TextArea, {
            value: value.webhookHeaders ?? '',
            placeholder: 'X-Token: abc123',
            disabled: !writable,
            onCommit: (next) => void commit([{ op: 'set', path: ['webhookHeaders'], value: next }]),
          })),
        h(Row, { label: t('webhookBody'), hint: t('webhookBodyHint'), stack: true },
          h(TextArea, {
            value: value.webhookBody ?? '',
            disabled: !writable,
            onCommit: (next) => void commit([{ op: 'set', path: ['webhookBody'], value: next }]),
          })),
        h(Row, { label: t('webhookContentType') },
          h(TextField, {
            value: value.webhookContentType ?? 'application/json',
            disabled: !writable,
            onCommit: (next) => void commit([{ op: 'set', path: ['webhookContentType'], value: next }]),
          })))
    }

    /**
     * 会话级覆盖。
     *
     * 覆盖项显示会话名（会话标题），拿不到标题时才退回会话 ID。
     */
    function SessionsSection(props) {
      const { ctx, t, value, writable, commit } = props
      const overrides = value.sessionOverrides ?? {}
      const ids = Object.keys(overrides)
      const list = useSessionList(ctx)

      const items = ids.length === 0
        ? h('div', { className: 'den-status' }, t('noOverrides'))
        : h('div', { className: 'den-list' }, ids.map((id) => h('div', { className: 'den-list-item', key: id },
          h('span', { className: 'den-session-name', title: id }, sessionNameOf(list, id)),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h(Switch, {
              checked: overrides[id] === true,
              text: overrides[id] === true ? t('overrideNotify') : t('overrideMute'),
              disabled: !writable,
              onChange: (next) => void commit([{ op: 'set', path: ['sessionOverrides', id], value: next }]),
            }),
            h('button', {
              className: 'den-button den-button-quiet',
              disabled: !writable,
              onClick: () => void commit([{ op: 'unset', path: ['sessionOverrides', id] }]),
            }, t('remove'))))))

      return h('div', { className: 'den-section' },
        h(Row, { label: t('overridesList'), hint: t('sessionsHint'), stack: true }, items))
    }

    /**
     * 订阅客户端的会话列表，让覆盖项上的会话名随会话标题更新。
     * @param {object} ctx 客户端上下文。
     * @returns {object|undefined} 会话列表快照。
     */
    function useSessionList(ctx) {
      const [snapshot, setSnapshot] = useState(() => readSessionList(ctx))
      useEffect(() => {
        const store = sessionListStore(ctx)
        if (store === undefined) return undefined
        const update = () => setSnapshot(store.getSnapshot())
        update()
        return typeof store.subscribe === 'function' ? store.subscribe(update) : undefined
      }, [ctx])
      return snapshot
    }

    /**
     * 取会话显示名：会话标题，其次工作目录名，最后才是会话 ID。
     * @param {object|undefined} list 会话列表快照。
     * @param {string} id 会话 ID。
     * @returns {string} 会话名。
     */
    function sessionNameOf(list, id) {
      const row = list?.byId?.[id]
      const name = row?.displayTitle ?? row?.title
      return typeof name === 'string' && name !== '' ? name : id
    }

    /**
     * 尽力读取客户端可见的会话列表；没有该服务时返回 undefined。
     * @param {object} ctx 客户端上下文。
     * @returns {object|undefined} 会话列表快照。
     */
    function readSessionList(ctx) {
      try {
        const store = sessionListStore(ctx)
        return store?.getSnapshot?.()
      } catch {
        return undefined
      }
    }

    /**
     * 找出客户端的会话列表存储。
     * @param {object} ctx 客户端上下文。
     * @returns {object|undefined} 会话列表存储。
     */
    function sessionListStore(ctx) {
      try {
        const sessions = (typeof ctx.get === 'function' ? ctx.get('sessions', false) : undefined) ?? ctx.sessions
        const store = sessions?.list
        return store !== undefined && typeof store.getSnapshot === 'function' ? store : undefined
      } catch {
        return undefined
      }
    }

    /**
     * 铃铛图标。
     */
    const BELL_ICON = h('svg', {
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    h('path', { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }),
    h('path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' }))

    /**
     * 会话级通知开关：输入框里的铃铛按钮。
     *
     * 打开时给当前会话写一条覆盖值；没有覆盖时跟随全局默认。
     */
    function SessionToggle(props) {
      const { ctx, sessionId } = props
      const t = useMemo(() => ctx.locale.bind(NS), [ctx])
      const [snapshot, scope] = useFormState(ctx)
      const [busy, setBusy] = useState(false)
      if (typeof sessionId !== 'string' || sessionId === '') return null
      const value = snapshot?.value ?? {}
      const overrides = value.sessionOverrides ?? {}
      const overridden = Object.prototype.hasOwnProperty.call(overrides, sessionId)
      const effective = overridden ? overrides[sessionId] === true : value.defaultNotify === true
      const masterOn = value.enabled === true
      const title = !masterOn
        ? t('sessionToggleDisabled')
        : effective
          ? (overridden ? t('sessionToggleOn') : `${t('sessionToggleOn')} ${t('sessionToggleFollowing')}`)
          : t('sessionToggleOff')
      const toggle = () => {
        if (scope === undefined || scope === null || busy) return
        setBusy(true)
        const next = !effective
        // 与全局默认一致时删掉覆盖值，让这个会话重新跟随默认。
        const op = next === (value.defaultNotify === true)
          ? { op: 'unset', path: ['sessionOverrides', sessionId] }
          : { op: 'set', path: ['sessionOverrides', sessionId], value: next }
        Promise.resolve(scope.mutate([op]))
          .catch(() => undefined)
          .finally(() => setBusy(false))
      }
      const button = h('button', {
        className: `den-toggle${effective && masterOn ? ' den-toggle-on' : ''}`,
        type: 'button',
        // 有外壳的浮层提示时不再挂原生 title，避免两种提示同时出现。
        ...(Tooltip === undefined ? { title } : {}),
        'aria-label': t('sessionToggle'),
        'aria-pressed': effective && masterOn,
        disabled: !masterOn || busy,
        onClick: toggle,
      }, BELL_ICON, overridden ? h('span', { className: 'den-toggle-dot' }) : null)
      if (Tooltip === undefined) return button
      // 提示用外壳的浮层组件，位置与延迟和发送/停止按钮一致。
      return h(Tooltip, { label: title, side: 'top', portal: true, children: button })
    }

    /**
     * 详情页插槽 plugins.detail.section 会在每个插件包、插件行和官方插件的页面上
     * 各渲染一次，所以这个概览只在自己家的页面上出现，别人的页面返回 null。
     * @param {{kind?: string, pkg?: {name?: string}, row?: {rowId?: string}, id?: string}} subject 页面主体。
     * @returns {boolean} 是否是本插件自己的页面。
     */
    function isOwnSubject(subject) {
      if (!subject) return false
      if (subject.kind === 'bundle') return subject.pkg?.name === PACKAGE_NAME
      if (subject.kind === 'row') {
        return subject.pkg?.name === PACKAGE_NAME && subject.row?.rowId === ENTRY_ID
      }
      if (subject.kind === 'item') return subject.id === PACKAGE_NAME
      return false
    }

    /**
     * 插件行的摘要。
     */
    function Summary(props) {
      const { ctx, entryKey, subject } = props
      if (!isOwnSubject(subject)) return null
      const t = ctx.locale.bind(NS)
      const scope = ctx.configForms.get(ENTRY_ID)
      const snapshot = scope?.getSnapshot?.()
      const value = snapshot?.value ?? {}
      const names = t('summaryEventNames')
      const events = (value.events ?? []).map((id) => names?.[id] ?? id).join(', ')
      const channels = (value.channels ?? []).length === 0 ? t('summaryChannelsNone') : (value.channels ?? []).join(', ')
      const mode = value.defaultNotify === true ? t('summaryModeOn') : t('summaryModeOff')
      return h('div', { className: 'den-status' }, t('summary', { events, channels, mode }))
    }

    /** 本客户端需要的服务。 */
    const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms', 'sessions']

    /**
     * 客户端入口。
     * @param {object} ctx 浏览器插件上下文。
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, {
        zh,
        en,
        ja: { ...en },
        es: { ...en },
        fr: { ...en },
        de: { ...en },
        ru: { ...en },
        pt: { ...en },
      }), 'dsh-event-notice: dictionaries')

      const Panel = (props) => h(ConfigPanel, { ...props, ctx })
      const RowSummary = (props) => h(Summary, { ...props, ctx })

      ctx.effect(() => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
        name: 'plugins.row.config',
        key: ROW_KEY,
        order: 10,
        label: () => t('title'),
        locale: NS,
      }, Panel)), 'dsh-event-notice: row config')

      ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: PACKAGE_NAME,
        order: 10,
        label: () => t('title'),
        locale: NS,
      }, Panel)), 'dsh-event-notice: bundle config')

      ctx.effect(() => ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
        name: 'plugins.detail.section',
        id: 'dsh-event-notice.summary',
        order: 30,
        label: () => t('title'),
        locale: NS,
      }, RowSummary)), 'dsh-event-notice: detail summary')

      // 设置弹窗左侧导航里的「事件通知」页面（排在「侧边卡片」之后）。
      // 「在设置页显示」关掉时把注册项注销掉，导航里就没有这一项了。
      ctx.effect(() => ctx.slots.inject('settings.section', () => {
        const scope = ctx.configForms.get(ENTRY_ID)
        /** 当前注册项的注销函数；为 null 表示没有注册。 */
        let dispose = null
        /** 按配置里的「在设置页显示」同步导航项的注册状态。 */
        const sync = () => {
          const current = scope?.getSnapshot?.()?.value ?? {}
          const visible = current.showInSettings !== false
          if (visible && dispose === null) {
            dispose = ctx.slots.register({
              name: 'settings.section',
              id: 'event-notice',
              order: 110,
              label: () => t('nav'),
              locale: NS,
            }, Panel)
            return
          }
          if (!visible && dispose !== null) {
            dispose()
            dispose = null
          }
        }
        sync()
        const off = scope?.subscribe?.(sync)
        return () => {
          if (typeof off === 'function') off()
          if (dispose !== null) {
            dispose()
            dispose = null
          }
        }
      }), 'dsh-event-notice: settings section')

      // 输入框里的会话级通知开关，位置在模型选择器左侧。
      ctx.effect(() => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'dsh-event-notice',
        order: 10,
        label: () => t('sessionToggle'),
        locale: NS,
      }, (props) => h(SessionToggle, { ...props, ctx }))), 'dsh-event-notice: session toggle')
    }

    return { inject, apply }
  },
})
