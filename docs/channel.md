# 调试通道（CDP）

本项目不依赖 WebView2、不写注册表、不改 `app.asar`：直接让 ChatGPT 的 Electron 主进程开一个本机调试端口，再用 CDP 连上去。

## 1. 为什么不是 WebView2

最初以为桌面版是 WebView2（很多"网页套壳"应用都是），实测是 **Electron**：

```
app\ChatGPT.exe              OriginalFilename=chrome.exe, FileVersion 158.0.8127.37
app\chrome.dll
app\resources\app.asar       443,800,006 bytes
app\chrome_pwa_launcher.exe
app\owl-electron-app.json
```

所以微软文档里那套 `HKCU\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments`
或 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 的注入方式**不适用**，改用 Chromium 自带的
`--remote-debugging-port`。

## 2. 必须用"包身份"启动

Store/MSIX 应用有两种启动方式，效果完全不同：

| 启动方式 | 结果 |
| --- | --- |
| `%LOCALAPPDATA%\Microsoft\WindowsApps\chatgpt-desktop.exe`（执行别名） | 保留包身份，沿用真实登录态：`...\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\Codex\web\Codex` |
| `C:\Program Files\WindowsApps\OpenAI.Codex_...\app\ChatGPT.exe`（直连 exe） | **丢包身份**，userData 落到 `%APPDATA%\Codex\web`，等于全新 profile（要重新登录） |

因此启动脚本固定用别名：

```powershell
& "$env:LOCALAPPDATA\Microsoft\WindowsApps\chatgpt-desktop.exe" `
  --remote-debugging-port=9335 `
  --remote-debugging-address=127.0.0.1
```

参数是"每次启动"生效的：正常双击图标启动仍然没有调试端口，也就没有任何注入。

## 3. 验证通道

```powershell
# 端点
Invoke-RestMethod http://127.0.0.1:9335/json/version
# -> { "Browser": "Chrome/158.0.8127.37", "webSocketDebuggerUrl": "ws://127.0.0.1:9335/devtools/browser/..." }

# 目标列表
.\tools\probe.ps1
```

跑起来后 `/json/list` 会是这个样子（节选）：

```
page     app://-/index.html
page     app://-/index.html?initialRoute=%2Favatar-overlay   # 头像悬浮小窗，别选它
webview  https://chatgpt.com/api/auth/session
iframe   https://cdn.platform.openai.com/deployments/dil/v15/runner.html
```

**主窗口的选择规则**：`app://-/` 前缀 + 排除 `devtools://` + 优先**不带 query** 的
`app://-/index.html`。这条规则写在 `src/cdp.mjs` 的 `isShellTarget` / `findShellTarget` 里；
只按前缀匹配会先命中头像悬浮窗，注入到错误的页面。

## 4. 注入为什么不需要 Fetch 拦截

计划里原本准备用 `Fetch.enable` 把 `__skin__/*` 请求映射到本地文件，实测页面 CSP（写在 meta 里）已经够用：

```
img-src 'self' app: blob: data: https:;
style-src 'self' 'unsafe-inline';
```

探针结果：内联 `<style>` ✅、`style` 属性 ✅、`data:` 图片 ✅、`eval` ✅。

所以素材直接以 `data:` URL 内联，样式直接 `Runtime.evaluate` 注入，不必劫持网络。

## 5. 安全边界

- 只绑 `127.0.0.1`；不加 `--remote-allow-origins=*`，避免任意网页连上调试端口。
- 端口只在带参数启动的那一次存在；退出应用即消失。
- 守护进程只做三件事：`Page.enable` / `Runtime.enable` / `Runtime.evaluate`，不读 Cookie、不改网络请求。

## 6. 已知限制

- 调试端口是**本次启动**的开关。想每次都有皮肤，就用 `setup.cmd`（或 `node tools\doctor.mjs --repair`）生成的快捷方式，别用系统托盘里的原始图标。
- 应用自动更新后 Electron/前端结构可能变化：先 `node tools\dom-dump.mjs` 重新侦察，再对照 `docs\dom-map.md` 调整；注入失败时 `verify.mjs` 会给出具体失败项。
- 多窗口（头像悬浮窗、Codex "工作"面板里的 `webview`）各自是独立 target；皮肤只注入主窗口。
