# DOM / 令牌地图

ChatGPT 桌面版是 Tailwind + 设计令牌渲染的 React SPA，类名大量 hash 化（`Navigation-bibgtK`、
`Button-BZrLNX`、`surface-tkBoA3`），**不能拿来做选择器**。皮肤只用两类锚点：

1. 应用自己的 **CSS 自定义属性**（设计令牌）；
2. **稳定结构**：`#root`、`#app-shell-sidebar`、`nav[class*="sidebar-rail"]`、`main`、
   `[class*="ComposerLayoutBody"]`、`#root > div[class*="--app-shell-left-panel-width"]`。

## 1. 外壳结构（1920×1200 截图 / 1152×800 视口）

```
html[data-codex-window-type="electron"][data-theme="light"]
└─ body
   └─ #root                          (position:relative; z-index:1 由皮肤设置)
      └─ div                         flex-col，含 --app-shell-left-panel-width
         ├─ 顶栏 div                 h=36，[role=menubar] 文件/编辑/视图/帮助
         └─ div (内容行)
            ├─ aside.app-shell-left-panel   0..340
            │  ├─ nav.group/sidebar-rail    宽 52 图标轨
            │  └─ #app-shell-sidebar        宽 288 侧栏（ChatGPT / 新聊天 / 置顶 / 项目 / 最近）
            └─ div (主内容区, x=340)
               ├─ div  白板 340,36,812,764
               └─ main 340,44,812,756   ← 聊天/会话正文
```

`#root` 其余直接子元素：拖拽区 `div.pointer-events-none.fixed.inset-x-0`、
`div.pointer-events-none.invisible.fixed`（含隐藏的 Codex/工作视图 main + `webview`）、
`div.pointer-events-none.fixed.inset-0.z-60`（弹层容器）。

## 2. 真正需要"透明"的表面

探测方法：枚举 `#root` 下背景不透明、面积 ≥ 12% 视口的元素（`tools/find-surfaces.mjs`）。

| 元素 | 尺寸 | 说明 |
| --- | --- | --- |
| `div#root > div > main` | 全窗 | 在 `invisible fixed` 容器里，实际不可见 |
| `div#root > div > main > div > div` | 全内容区 | Codex 工作视图，`opacity` 由路由控制 |
| `div#root > div > main > div > webview` | 全内容区 | 同上，`opacity-0` |
| 白板 div（`pointer-events-none absolute inset-y-0 end-0`） | 812×764 | 聊天区底板 |
| `main#_r_46_` | 812×756 | **会话正文所在** |

关键结论：这些元素都通过 Tailwind 的 `bg-surface` 类取色，而 `bg-surface` 读的是
`--app-color-background-surface`。**改这一个变量 = 所有主面板一起变透明**，不用逐个元素打补丁。

另外 `#root > div`（外壳）自身带一层 50% 白蒙版
（`linear-gradient(color(srgb 1 1 1 / 0.5), color(srgb 1 1 1 / 0.5))`），必须显式清掉，否则整窗发白。

## 3. 覆盖的令牌（`src/styles/theme.css`）

> 应用把很多令牌以 **inline style 写在 `<html>` 上**（约 800 字符），所以覆盖必须带
> `!important`；实测不带 `!important` 会被 inline 声明压过去。

| 令牌 | 皮肤值来源 | 作用 |
| --- | --- | --- |
| `--app-color-background-surface` | `palette.surface` | 聊天主面板、白板、webview 底色 |
| `--color-token-main-surface-primary` | `palette.surface` | 主表面 |
| `--color-token-side-bar-background` | `palette.sidebar` | 侧栏底色 |
| `--wallpaper-chrome-fill` | `palette.chrome` | 顶栏/窗口 chrome |
| `--app-shell-sidebar-docked-background` | `transparent` | 侧栏停靠底板 |
| `--color-token-border-default` / `-heavy` | `palette.border*` | 分割线 |
| `--color-text-primary` / `-surface` / `-soft-alt` | `palette.ink` | 正文 |
| `--color-token-text-secondary` | `palette.inkSoft` | 次要文字 |
| `--codex-theme-accent-color` / `--codex-base-accent` / `--color-accent` | `palette.accent` | 主强调 |
| `--codex-theme-accent-text` / `-icon` / `--color-text-accent` | `palette.accentStrong` | 强调文字/图标 |
| `--codex-theme-accent-background-*` / `--app-color-background-accent*` | `palette.accentSoft*` | 强调底（选中项、"升级订阅"胶囊） |
| `--color-ring-accent` | `palette.accentStrong` | 焦点环 |
| `--color-background-info-*` / `--color-background-tip-soft` | `palette.accent*` | 提示条 |
| `--app-color-text-tip-badge` / `--color-text-header-upgrade` | `palette.accentStrong` | Work 视图右上"获取 Plus"文字 |
| `--color-background-header-upgrade*` | `palette.accentSoft*` | "获取 Plus"胶囊底色（默认是 13% 蓝混合） |
| `--color-button-accent*` / `--color-background-composer-primary` | `palette.accent*` | 主操作按钮（默认 `#2c67c5` 蓝） |
| `--color-background-user-message` / `--color-text-user-message` | `accentSoft` / `accentStrong` | 用户消息气泡（默认 `#e8f3fe` 蓝） |
| `--switch-track-color-checked` | `palette.accent` | 开关选中态（默认 `#0285ff`） |
| `--sidebar-upgrade-glass-ink` / `--color-text-composer-reference` | `palette.accentStrong` | 侧栏升级入口、输入框引用提示 |
| `--color-token-on-accent` / `--color-text-on-accent` | `#ffffff` | 强调底上的文字 |

结构性规则（不走令牌）：

- 清掉外壳 50% 白蒙版：`body > #root > div[class*="--app-shell-left-panel-width"]`；
- `#root { position: relative; z-index: 1 }`：让应用内容落在装饰层之上；
- 侧栏：`#app-shell-sidebar { background: var(--ccs-sidebar); backdrop-filter: blur(9px) }`；
- 图标轨：`nav[class*="sidebar-rail"]`；
- 圆角：`main { border-radius: var(--ccs-radius) }`；
- 输入框底板：`[class*="ComposerLayoutBody"]` 用 `color-mix` 提高不透明度，保证打字清晰；
- 焦点：`:focus-visible { outline-color: var(--ccs-accent-strong) }`。

## 4. 装饰层

```
body
├─ #ccs-skin-layers   (position:fixed; inset:0; z-index:0; pointer-events:none)
│  ├─ .ccs-bg         壁纸 + 顶部柔光蒙版（::after）
│  └─ .ccs-char       后排立绘（mix-blend-mode:multiply + 纵向遮罩）
└─ #ccs-skin-front    (position:fixed; inset:0; z-index:2; pointer-events:none)
   └─ .ccs-chibi      侧栏 Q 版
```

- 壁纸用 `data:` URL 内联（CSP 允许），`background-size: cover`；
- 立绘尺寸用 `vh`，窗口缩放时跟随；`offset` 为负值可以把边缘裁到屏幕外；
- 后排立绘用 `multiply` 混合，避免被半透明白面板冲成"粉白"；
- `pointer-events:none` + `aria-hidden="true"`，不影响任何点击与读屏。

## 5. 重新侦察（应用更新后）

```powershell
node tools\dom-dump.mjs --label after-update   # 结构、CSP 探针、landmarks
node tools\find-surfaces.mjs                   # 不透明大表面 + :root 令牌
node tools\eval.mjs --file recon\probe-tokens.js   # 关键令牌的实际生效值
node tools\theme-lab.mjs --status              # 皮肤是否挂载
node tools\verify.mjs --shot shots\verify.png  # 15 项验收
```

产物：`recon/dom-<label>.html`、`recon/recon-<label>.json`、`recon/surfaces-*.json`。

## 6. 助手 Sol 的信号（`src/runtime/assistant.mjs`）

状态机靠页面里这几个锚点判断"你在输入 / 正在生成 / 生成完了"。应用改版后优先检查这里：

| 信号 | 选择器 | 注意 |
| --- | --- | --- |
| 输入框 | `[role="textbox"][contenteditable="true"]` | 页面里通常有**两个**：一个 0×0 的隐藏 composer（另一个视图留下的），一个可见的。必须取 `getBoundingClientRect()` 宽高 > 2 的那个，否则永远读到空文本 |
| 发送按钮 | `button[type="submit"]` | 输入框为空时 `disabled=true`；有文字才可点。同样要筛可见的 |
| 停止按钮 | `button[aria-label*="停止"]`（兼容 `Stop`） | 生成过程中出现，是"正在生成"的最强信号 |
| 当前回复 | `[data-message-author-role="assistant"]`，旧版回退到生成中新增的 `[class*="MarkdownRoot"]` | 发送前记录历史节点或消息 ID，只测本轮新回复的长度 |
| 提交事件 | 可见输入框对应的表单、发送按钮或 `Enter` | 中文输入法组词时的 Enter 跳过，手动点停止则取消本轮跟踪 |

停止按钮消失后，确认本轮新增回复有正文且安静满 `quiescenceMs`（默认 1200ms），才显示完成。生成太快时，也可以通过本轮新增的用户消息和之后的助手消息确认。会话切换或信号不足时回到中性状态。

调试入口：`window.__ccsAssistant.setState('thinking')`（手动接管 20s）、`.signals()` 返回 `{ state, hidden, boxChars, sendDisabled, stop, mainChars, sawStop }`。

### 显隐开关

| 项 | 值 |
| --- | --- |
| 根标记 | `html[data-ccs-sol="on" \| "off"]` |
| 记忆 | `localStorage['ccs-sol-visible']`（`'1'` 显示 / `'0'` 隐藏；没有值时用配置 `assistant.visible`） |
| 按钮 | `#ccs-sol-toggle`（`#ccs-skin-front` 的子节点，`pointer-events:auto !important`），`aria-pressed` 与 `aria-label` 跟随状态；隐藏时按钮里那条 `.ccs-sol-slash` 显示 |
| 隐藏样式 | `html[data-ccs-sol='off'] #ccs-assistant { opacity:0; visibility:hidden; transform:…; }` |
| 命令行 | `node tools\sol-toggle.mjs [--hide\|--show] [--shot …]` |
| 控制台 | `window.__ccsAssistant.setVisible(false)` / `.toggle()` / `.visible` |

隐藏后 `tick()` 直接 return（不采样、不空转）；点击事件用文档级捕获 + `closest('#ccs-sol-toggle')`，不依赖按钮被重新渲染。

### 互动（点击 / 拖动 / 问候）

| 项 | 值 |
| --- | --- |
| 热区 | `#ccs-assistant .ccs-sol-hit`（绝对定位，覆盖立绘下 78%，`pointer-events:auto !important`、`cursor:grab`）；**唯一**可交互点，容器与其它装饰层仍是 `pointer-events:none` |
| 台词 | `.ccs-sol-caption`（`right:34%; bottom:150%; width:max-content; max-width:190px`），`say(text, ms)` 写入并淡入，`captionMs` 后淡出 |
| 爱心 | `.ccs-sol-hearts`（三颗 `♥`），抚摸到里程碑时加 `is-on` 播放 `ccs-sol-heart` |
| 状态属性 | `data-ccs-react="idle\|hug"`（临时情绪）、`data-ccs-hover="on"`、`data-ccs-idle="on"`、`data-ccs-shifted="on"`、`data-ccs-interactive="on\|off"` |
| 记忆 | `localStorage['ccs-sol-pos']`（`{right,bottom}` px）、`['ccs-sol-pets']`（次数）、`sessionStorage['ccs-sol-greeted']`（本小时是否已问候） |
| 拖动 | `pointerdown/move/up/cancel` + `setPointerCapture`；位移 > 3px 视为拖拽并抑制随后的 click；`dblclick` 复位；`resize` 150ms 防抖后按新视口 clamp（8px 边距） |
| 让位 | 懒挂 `#ccs-bg-panel` 的 `MutationObserver`（观察 `hidden`/`class`，tick 里补挂），面板打开时 `data-ccs-shifted="on"` → `#ccs-assistant` 左移 `min(360px, 100vw-320px)`、`scale(.92)`、`opacity .32` |
| 控制台 | `window.__ccsAssistant.say('hi')` / `.react('hug')` / `.pets` / `.position` / `.resetPosition()` / `.interactive` |
| 命令行 | `node tools\assistant-interact.mjs`（点击→拖动→复位→开面板截"让位"） |

## 7. 背景面板与轮播（`src/runtime/backgrounds.mjs`）

| 项 | 值 |
| --- | --- |
| 图片数据 | 全部以 data URL 放在 `payload.backgrounds`（`[{id,name,url}]`），只存一份，markup 与网格共用；`payload.backgroundState` 记 `mode/opacity/position/index/playing` |
| 当前壁纸 | `#ccs-skin-layers .ccs-bg` 的 `background-image`；切换时新建 `.ccs-bg-next` 叠加层做 420ms 交叉淡入后替换 |
| 按钮 | `#ccs-bg-toggle`（`#ccs-skin-front` 子节点，位置 `right: calc(var(--ccs-sol-right) + 38px)`、`bottom: calc(var(--ccs-sol-bottom) - 42px)`，`pointer-events:auto !important`） |
| 面板 | `#ccs-bg-panel`（`z-index:4`，`hidden` 属性控制开合）；内部 `.ccs-bg-grid` 每项 `.ccs-bg-item[data-index]` 含 `.ccs-bg-thumb` + `.ccs-bg-name`，当前项带 `is-active`；底部 `.ccs-bg-switch`（循环播开关）与 `.ccs-bg-interval`（30s/1m/5m/15m） |
| 记忆 | `localStorage['ccs-bg-index']`（0 基）、`['ccs-bg-play']`（`'1'`/`'0'`）、`['ccs-bg-interval']`（毫秒） |
| 轮播 | `setInterval`，最小 5000ms；`document.visibilityState !== 'visible'` 时跳过并顺延；`prefers-reduced-motion` 只缩短淡入 |
| 控制台 | `window.__ccsBackground.select(i)` / `.play(true)` / `.setIntervalMs(60000)` / `.state` / `.list` |

面板是皮肤自建节点，不依赖应用类名；壁纸切换只改 `.ccs-bg` 的 inline style，因此应用小改版不会导致功能失效（只有背景容器本身被删才会）。

## 8. Codex 浏览器面板

Windows 右侧停靠浏览器由原生 WebContentsView 绘制。主文档中的停靠容器带 `data-browser-sidebar-primary-focus-target` 或 `data-browser-sidebar-chrome-expanded`，启动时预热的 `<webview>` 可以同时存在并保持隐藏。

**现行契约**：

| 项 | 值 |
| --- | --- |
| 运行标记 | 识别视口内的停靠容器或旧版活跃 guest，用 `data-ccs-pane-kind` 区分 `docked` 和 `webview` |
| 面板打开时 | `data-ccs-pane="on"` 暂停主题与互动层，让浏览器使用原生绘制及点击区域 |
| 手动模式 | `codexBrowser.safe:true` 暂时关闭主题与互动层，可用 `node tools\diagnose-browser.mjs --safe on\|off` 切换 |
| 诊断 | `node tools\diagnose-browser.mjs [--safe on\|off] [--uninstall] [--shot]`，报告写 `logs/browser-diagnose.json` |

`verify.mjs` 会检查打开浏览器时两层皮肤都隐藏，以及普通聊天时画布恢复圆角。



