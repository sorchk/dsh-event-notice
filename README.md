# dsh-event-notice

DSH 事件通知插件。当任务完成、任务中断、需要审批、需要回答问题时，把通知发到你配置的 **Gotify**、通用 **Webhook** 或 **ntfy**。

通知正文只包含会话标题、事件细节与工作目录，**不包含会话正文**。发送失败只写日志，不会打断会话或工具执行。

---

## 功能

| 通知事件 | 触发来源 | 说明 |
| --- | --- | --- |
| 任务完成 `task-complete` | 会话事件 `turn/end`，结束原因 `completed` | 一轮任务正常跑完 |
| 任务中断 `task-interrupted` | 会话事件 `turn/end`，结束原因为中止 / 阻塞 / 报错 / 达到 token 上限 | 附上具体原因，例如「任务被中止（用户中止）」 |
| 需要审批 `approval-required` | 会话事件 `approval/asked` | 附上工具名与审批原因 |
| 需要回答问题 `question-required` | 会话事件 `tool/call`，工具名为 `ask_user_question` | 助手正在等你回答 |

三个通道可以同时启用：Gotify 走 `POST <服务器地址>/message?token=<应用令牌>`，Webhook 走自定义方法与自定义请求体，ntfy 走 JSON 发布接口（主题放在请求体里，所以标题里的中文不会坏掉请求头）。

## 安装

插件是一个 Cordis bundle，同时包含宿主端（`index.js`）与浏览器端（`client.js`）。

```bash
# 从 npm 安装（发布后可用，支持指定版本）
plugin_manager install_bundle dsh-event-notice
plugin_manager install_bundle dsh-event-notice@0.5.1

# 在 DSH 里安装本地 bundle
plugin_manager install_bundle target=/绝对路径/dsh-event-notice
```

安装后：

- 宿主端会注册一行插件（行 id 与设置命名空间都是 `dsh-event-notice`）；
- 浏览器端会在「插件 → 事件通知」里出现一张配置页，同时在插件详情页挂一个概览区块；
- 浏览器端还会在 **设置弹窗左侧导航**（排在「侧边卡片」之后）加一个「事件通知」入口，点开就是同一张配置页；这个入口可以用配置页里的「在设置页显示」关掉，关掉后导航里就没有这一项了；
- 浏览器端会在 **会话输入框**（模型选择器左边）加一个铃铛按钮，用来单独开关当前会话的通知。

插件自带的 `node_modules/@deepseek-ai/schemastery` 会被一起链接，宿主的 ESM 解析器因此可以正常找到依赖。

## 配置页

在 Web GUI 的「设置 → 事件通知」或「插件 → 事件通知」里配置，所有字段都是即改即生效的。

配置页沿用 DSH「通用设置」的排版：每一项是「左边标题加说明、右边控件」的一行，行间一条细线；三个通道用标签页组织，标签依次是 **ntfy、Gotify、Webhook**。

### 通用

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 启用通知 | 开 | 总开关。关闭后不发任何通知 |
| 所有会话默认通知 | **关** | 所有会话的默认行为。会话级覆盖优先于它 |
| 默认通知方式 | Gotify + Webhook + ntfy | 勾选实际使用的通道 |
| 在设置页显示 | **开** | 关掉后设置弹窗左侧导航不再出现「事件通知」，只能从「插件 → 事件通知 → 配置」进入 |
| 默认通知的事件 | 四项全开 | 勾选需要通知的事件 |
| 通知标题前缀 | `DSH` | 通知标题形如 `DSH · 任务完成` |
| 请求超时（毫秒） | `10000` | 单次请求超时 |

### ntfy / Gotify / Webhook

三个通道各占一个标签页，标签顺序是 ntfy、Gotify、Webhook。下面三节分别说明各通道的配置项。

### Gotify

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 服务器地址 | 空 | 例如 `https://gotify.example.com` |
| 凭据引用名 | `DSH_EVENT_NOTICE_GOTIFY_TOKEN` | 应用令牌在凭据存储里的键名 |
| 应用令牌 | 空 | 写入凭据存储，不随设置明文落盘；留空表示保持原值 |
| 按事件设置优先级 | 四项都是 `5` | 每种事件单独设 Gotify 优先级（0–10），没写的用缺省值 5 |

令牌也可以用环境变量提供：凭据存储解析不到时不会回退到环境变量，需要环境变量时请把引用名设成同名变量并自行写入凭据存储。

### ntfy

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 服务器地址 | `https://ntfy.sorc.fun:52` | 例如 `https://ntfy.example.com`；插件向根路径发布，主题放在请求体里，所以地址可以带路径前缀 |
| 主题 | `dsh` | 通知发布到哪个主题 |
| 凭据引用名 | `DSH_EVENT_NOTICE_NTFY_TOKEN` | 访问令牌在凭据存储里的键名 |
| 访问令牌 | 空 | 写入凭据存储，不随设置明文落盘；留空表示保持原值。留空且服务器允许匿名发布时可以匿名发 |
| 按事件设置优先级 | 见下表 | 每种事件单独设 ntfy 优先级（1–5） |

ntfy 用 JSON 发布接口，请求体形如：

```json
{
  "topic": "dsh",
  "title": "DSH · 任务完成",
  "message": "会话标题：收到\n任务正常完成",
  "priority": 3
}
```

### 按事件设置优先级

Gotify 与 ntfy 都支持「每种事件一个优先级」，互不影响。

ntfy 的五档优先级：

| 值 | 档位 | 效果 |
| --- | --- | --- |
| 1 | min | 不震动不响铃，折叠在「其它通知」里 |
| 2 | low | 不震动不响铃，拉下通知抽屉才看到 |
| 3 | default | 短震动 + 默认提示音 |
| 4 | high | 长震动 + 提示音，弹出通知 |
| 5 | max | 很长的震动 + 弹出通知（urgent） |

配置页里 ntfy 用下拉框给这五档命名，Gotify 用 0–10 的数字。某一事件没单独设置时，用通道缺省值（ntfy 为 3，Gotify 为 5）。

一个常见搭配：

| 事件 | ntfy | Gotify |
| --- | --- | --- |
| 任务完成 | 3 default | 5 |
| 任务中断 | 4 high | 8 |
| 需要审批 | 5 max | 9 |
| 需要回答问题 | 5 max | 9 |

### Webhook

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 地址 | 空 | 完整的 Webhook 地址 |
| 请求方法 | `POST` | `POST` 或 `PUT` |
| 额外请求头 | 空 | 每行一个 `名称: 值`，`#` 开头为注释 |
| 请求体模板 | JSON 模板 | 占位符 `{{event}}` `{{title}}` `{{message}}` `{{sessionId}}` `{{sessionTitle}}` `{{cwd}}` `{{detail}}` `{{timestamp}}` |
| 请求体类型 | `application/json` | `Content-Type` |

请求体模板里的字符串值按 JSON 字面量转义后再填入，带引号或换行的正文也不会破坏请求体。

### 会话级覆盖

有三种方式改单个会话的通知行为：

1. **输入框里的铃铛按钮**（模型选择器左边）——最快。按钮显示的是这个会话**实际生效**的状态：
   - 没有小圆点：跟随「所有会话默认通知」；
   - 有小圆点：这个会话被单独改过。
   - 铃铛按钮是输入框里的圆形图标按钮（和「＋」按钮同款外形），悬停时弹出外壳统一的提示气泡；
   - 铃铛图标的颜色也跟着状态走：通知关闭时是浅蓝色，开启时是蓝色（与发送按钮、停止按钮同一个色系）。

   点一下就切换；点回与全局默认一致时，会把覆盖记录删掉、重新跟随默认（所以是「跟随默认 → 关 → 跟随默认 → 关」这样循环）。覆盖写在设置里的 `sessionOverrides` 字典，键是会话 ID。
2. **配置页的「会话级覆盖」卡片**——列出已经设过覆盖的会话，每一项显示**会话名**（会话标题），可以直接开关或删除。开关旁边的文字是「通知」/「不通知」，只描述这一个会话的状态。
3. 直接改配置文件里的 `sessionOverrides`。

会话级覆盖只影响那一个会话，其它会话仍按「所有会话默认通知」走。

### 测试通知

「发送测试通知」会对每个已启用且配置完整的通道各发一条测试消息，结果直接显示在按钮下方。

通知正文（`message`）依次是「会话标题」「事件细节」「工作目录」三行，会话标题取自会话自己的标题，拿不到时退回会话 ID。

## 通知载荷

Webhook 默认请求体：

```json
{
  "event": "task-complete",
  "title": "DSH · 任务完成",
  "message": "会话标题：收到\n任务正常完成\n目录：/home/sorc",
  "sessionId": "session-…",
  "sessionTitle": "收到",
  "timestamp": "2026-11-08T06:12:25.603Z"
}
```

Gotify 请求体：

```json
{
  "title": "DSH · 任务完成",
  "message": "会话标题：收到\n任务正常完成\n目录：/home/sorc",
  "priority": 5
}
```

ntfy 请求体：

```json
{
  "topic": "dsh",
  "title": "DSH · 任务完成",
  "message": "会话标题：收到\n任务正常完成\n目录：/home/sorc",
  "priority": 3
}
```

## 权限与隐私

- 只监听会话事件，不读取会话正文；
- 只向用户在配置页填写的 Gotify 服务器、Webhook 地址与 ntfy 服务器发起请求；
- Gotify 应用令牌与 ntfy 访问令牌都存在凭据存储（`~/.dsh/.credentials.yaml`），不写进设置文件。

## 开发

```bash
npm test          # node --test（自动发现 test/ 下的 *.test.js，兼容 Node 20）
node --check index.js
node --check client.js
```

目录结构：

```
index.js        宿主端：配置、事件监听、通道分发
lib/notify.js   纯逻辑：事件分类、通知决策、载荷构造、通道发送
lib/http.js     「发送测试通知」用的本地路由
client.js       浏览器端：配置页
locale/         en / zh 文案
test/           单元测试（notify.test.js 纯逻辑，plugin.test.js 宿主端接线）
```

## GitHub Actions

仓库内置两个工作流：

| 工作流 | 触发方式 | 做什么 |
| --- | --- | --- |
| [.github/workflows/ci.yml](./.github/workflows/ci.yml) | 每次 push、每个 PR | 语法检查 + 单元测试（`npm ci` → `node --check` → `npm test`） |
| [.github/workflows/publish.yml](./.github/workflows/publish.yml) | 仅手动触发 | 打包（产出 tarball artifact），勾选 `publish` 时才真正发布到 npm |

## 发布到 npm（GitHub Actions 手动触发）

发布工作流**只在 GitHub Actions 页面点击「Run workflow」时执行**，没有任何自动触发器
（不打 tag、不随 push 构建、不定时发布）。

### 前置配置（一次性）

1. 在 npm 上确认包名 `dsh-event-notice` 可用（未被占用）。
2. 在仓库 **Settings → Secrets and variables → Actions** 新建 secret：

   | Secret | 值 | 用途 |
   | --- | --- | --- |
   | `NPM_TOKEN` | npm 的 Automation Token（Classic Token 勾选 publish） | 发布权限 |

3. npm 账号需要开通 **Two-factor authentication**（npm 现在强制要求）。

### 执行方式

在 GitHub 仓库页 → **Actions** → 左侧选择「打包并发布到 npm」→ 右侧 **Run workflow**，
勾选输入项：

| 输入项 | 默认 | 说明 |
| --- | --- | --- |
| `publish` | `false` | 是否真正发布到 npm；`false` 时只打包并产出 `dsh-event-notice-<version>.tgz` 供下载 |
| `dry_run` | `false` | 发布演练：`npm publish --dry-run`，不真正上传（需同时勾选 `publish`）；演练模式不会回查 npm 上的版本，因为演练不会真的发布 |
| `provenance` | `false` | 启用 npm provenance 签名（需仓库为公开仓库，且工作流已申请 `id-token: write`） |

### 工作流做了什么

| 阶段 | 步骤 |
| --- | --- |
| 打包 | 检出代码 → Node.js 20 → `npm ci` → `node --check` 语法检查 → `npm test` 单元测试 → 校验 `package.json`（无 `private`、有 `version`、包名为 `dsh-event-notice`）→ `npm pack` → 上传 tarball artifact |
| 发布 | 仅当 `publish = true`：校验 `NPM_TOKEN` 存在 → 下载 tarball → 检查该版本是否已发布（已发布则报错退出）→ `npm publish --access public` → 回查 npm 上的版本与 tarball 地址（最多重试 20 次 × 15 秒；`dry_run` 模式跳过回查） |

> 版本号来自 `package.json`。重复发布同一版本会被 npm 拒绝，工作流也会提前拦截，
> 因此每次发布前请先提升 `package.json` 的版本号并打上同名 tag。

> **注意**：发布时传给 npm 的 tarball 路径必须以 `./` 开头（如 `./dist/dsh-event-notice-0.5.1.tgz`）。
> npm 会把 `dist/xxx.tgz` 这种「斜杠分隔」参数当成 GitHub 简写（`owner/repo`），
> 转成 `ssh://git@github.com/dist/xxx.tgz.git` 去克隆；CI 没有 SSH key 会报
> `Permission denied (publickey)`、`npm error code 128`。

发布后即可通过 `plugin_manager install_bundle dsh-event-notice` 安装。

## 许可

MIT
