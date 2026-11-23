# 背景库（backgrounds）

内置 18 张壁纸：`bg-01.webp … bg-18.webp`，名称与顺序记在 [`index.json`](index.json)。
应用内右下角"图片"按钮打开背景面板（缩略图 + 名称 + 循环播放），面板直接读这份清单。

## 规格

- 16:9（如 1920×1080 / 1672×941 / 1600×900），主体人物放左右两侧、中间偏浅，正文才看得清；
- 统一存 WebP（`--width 1600 --quality 78`，单张约 150–300 KB）；
- 文件名 `bg-NN.webp`（两位序号，决定面板顺序与轮换顺序）。

## 加自己的图

1. 源图（PNG/JPG 均可）放到 `assets/backgrounds/_src/`，命名 `NN-中文名.png`，
   例如 `19-海边黄昏.png`；
2. 运行：

   ```powershell
   python tools\import_backgrounds.py                 # 转 WebP + 重建 index.json
   python tools\import_backgrounds.py --width 1440 --quality 74   # 想更小
   ```

3. 脚本会打印每张的尺寸/体积与**载荷估算**；确认没问题后，`_src/` 可以不打包
   （`pack.ps1` 不会带它）。

## 配置

```jsonc
"background": {
  "mode": "rotate",            // fixed 固定 | random 每次注入随机 | rotate 定时轮换
  "rotateMs": 60000,           // rotate 停留时间（毫秒）
  "picker": true,              // 右下角背景按钮 + 面板
  "list": ["assets/backgrounds/bg-01.webp", "…"],  // 顺序 = 轮换顺序 = 面板顺序
  "asset": "assets/backgrounds/bg-01.webp",        // fixed / 兜底
  "opacity": 1,
  "position": "center 18%"
}
```

说明：

- `random` 只在**重新注入**时抽取（刷新页面、重启应用、守护进程重装）；
- `rotate` 由页面内运行时轮换，面板里可以随时开/关、改间隔；窗口隐藏时暂停；
- `index.json` 损坏时退回用 `list` 的文件名当名称；
- 所有图都会以 base64 内联进页面：18 张约 5 MB 载荷、首次注入约 1 秒。
  超过 6 MB 时 `injector` 会告警，`doctor` 也会把总量打在"background library"一行里。
