# 北京 H5 英文语音导览应用 — 设计文档（Spec）

- 日期：2026-11-21
- 状态：待用户审阅
- 项目代号：TravelTrips（北京英文 Audio Guide MVP）

## 1. 目标与成功标准

**目标**：为来北京的外国游客提供一个免注册、点开即用的 H5 网页应用——游客走进某个景点（圆形地理围栏）后，自动播放该景点的英文语音讲解，并同步显示英文文字对照；讲解以**方位引导句开场**，结合游客实时朝向播报景点参照地标的相对方位（如 *"On your right stands the Tiananmen Rostrum…"*），再接正文。

**核心假设（MVP 需验证）**：外国游客会打开、会听完、会分享这个导览页面。

**成功标准（MVP 阶段）**：
- 完整体验链路真机可用：iOS Safari 与 Android Chrome 均能授权定位 → 走入围栏自动播放 → 方位句按朝向正确播报 → 文字对照正常显示
- 首批内容：25 个景点的英文讲解上线（每景点 = 8 方位引导句变体 + 1 段正文；讲解词草稿见 `content/narrations-draft.md`，分批上线顺序实施阶段可调）
- 免注册、免费、无服务器运维负担（纯静态托管，月成本约 0）
- 托管平台自带分析可观测访问量与独立访客

**非目标（明确不做）**：账号体系、付费、中文界面、地图视图、进度列表、手动点播、分享按钮（均留待后续版本，见 §11）。

## 2. 目标用户与分发渠道

- **用户**：来华/在华外国游客（iPhone 或带完整 Google 服务的安卓机，网络多为国际漫游/eSIM，海外网站可达）
- **渠道**：海外社交平台（Instagram / TikTok / YouTube 简介链接）、景点二维码、旅游攻略站点
- **界面语言**：全英文
- **可用性前提**：免注册、无安装、浏览器直接打开

## 3. 技术方案（已确认）

**纯静态站点**：纯前端 HTML/JS + 景点内容 JSON + 预生成 TTS MP3，托管于免费静态平台（推荐 Cloudflare Pages，备选 Vercel / Netlify）。无后端、无数据库、无账号。

选定理由：预生成音频天然是静态文件；MVP 验证核心假设不需要后端；零成本零运维、上线最快。后续可平滑升级（§11）。

**技术栈**：
- 前端：Vite + 原生 TypeScript（不用 UI 框架，单屏应用无需框架）
- 测试：vitest（纯函数单元测试）
- 内容管线：Python 3.11 脚本（TTS 生成与内容校验）

## 4. 目录结构

```
TravelTrips/
├── index.html              # 单页入口
├── src/
│   ├── main.ts             # 应用状态机：落地页 → 监听 → 播放 循环
│   ├── geo.ts              # 定位监听、精度过滤、haversine 围栏判定、冷却管理
│   ├── compass.ts          # 朝向监听（iOS/Android 双路径）、中值滤波、GPS 轨迹降级
│   ├── direction.ts        # bearing 计算、朝向+方位角 → 8 方位映射
│   ├── player.ts           # 音频播放管理（方位句→正文顺序播放、互斥、结束回调）
│   ├── ui.ts               # 状态卡、方位徽标、文字对照、错误提示渲染
│   └── testmode.ts         # 模拟定位+模拟朝向测试面板（URL ?test=1 激活）
├── content/
│   ├── spots.json          # 景点数据（见 §5 schema）
│   └── audio/
│       ├── spot-*.mp3          # 每景点主讲解正文
│       └── dir/spot-*-*.mp3    # 每景点 8 个方位引导句变体（-n/-ne/-e/-se/-s/-sw/-w/-nw）
├── scripts/
│   ├── tts_generate.py     # spots.json → TTS API → 正文 + 8 方位句音频
│   └── validate_content.py # 内容完整性校验（含方位句齐全性、landmark 合法性）
├── tests/
│   ├── geo.test.ts         # 距离/围栏/精度过滤
│   ├── direction.test.ts   # bearing 计算/8 方位映射边界
│   └── state.test.ts       # 触发/冷却/互斥状态机
├── docs/superpowers/specs/ # 本文档
├── vite.config.ts
├── package.json
└── tsconfig.json
```

## 5. 景点数据 Schema（content/spots.json）

```json
{
  "version": 1,
  "spots": [
    {
      "id": "forbidden-city",
      "name": "The Forbidden City (Palace Museum)",
      "summary": "One-line teaser shown in the nearest-spot status line",
      "lat": 39.9163,
      "lng": 116.3972,
      "radiusMeters": 250,
      "audio": "audio/spot-forbidden-city.mp3",
      "transcript": "Full English narration text, shown as synchronized transcript",
      "landmark": {
        "name": "the Hall of Supreme Harmony",
        "lat": 39.9185,
        "lng": 116.3905
      }
    }
  ]
}
```

- 坐标系：**WGS-84**（与浏览器 Geolocation API 返回值同系，零转换）
- 坐标来源：Wikipedia/Wikidata 公开坐标或 Google Maps 取点；实施阶段逐一核定，半径按景点实际占地给出建议值（默认 200 米，可每景点单独调整）
- `landmark` 为**方位参照地标**：方位引导句描述的对象（如故宫→太和殿、天坛→祈年殿、天安门广场→天安门城楼），取景点内最具辨识度的建筑精确坐标；`name` 为讲解句中使用的英文名称
- 音频文件命名约定：正文 `audio/spot-{id}.mp3`；方位句 `audio/dir/spot-{id}-{dir}.mp3`，`dir ∈ {n, ne, e, se, s, sw, w, nw}`，每景点 8 个（约 3-5 秒/段）
- 景点清单（25 个，全部有 Wikipedia 英文条目支撑；Wikipedia/Wikidata 全量盘点见会话记录 2026-11-21）：
  - 城区核心 14：天安门广场、故宫、景山、北海、什刹海、南锣鼓巷、雍和宫、国子监+孔庙（合并 1 点）、天坛、前门大栅栏、颐和园、圆明园、798、王府井
  - 延伸与郊区 11：八达岭长城、慕田峪长城、明十三陵、恭王府、钟鼓楼、后海、琉璃厂、潘家园、古观象台、奥林匹克公园、香山

## 6. 页面流程与状态机

```
[landing 未开始] --点击 Start Audio Tour--> [requesting 请求授权（定位+朝向）]
    --授权成功--> [listening 监听中]
    --定位授权被拒--> [permission-denied 终态提示页]
    --朝向授权被拒/不可用--> [listening]（朝向降级链，见 §7，不阻塞）
[listening] --入围栏--> [playing 播放中] --音频结束--> [listening]
任何状态 --页面刷新--> [landing]
```

**界面元素**（单屏，全英文）：
1. 落地页：应用名 + 一句话价值说明 + 大按钮「Start Audio Tour」+ 定位与朝向用途说明（点击时同一手势内请求定位权限与 iOS 朝向权限）
2. 监听态：状态卡 *“Listening — walk near a spot to hear its story”* + 最近景点名称与实时距离（如 *“Nearest: Temple of Heaven · 400m”*）。此距离反馈是自动触发的必要引导，非进度列表功能
3. 播放态：景点名 + 方位徽标（如 *“→ Hall of Supreme Harmony is on your RIGHT”*，与方位句同步显示）+ 音频控件（暂停/重播/进度条）+ 可折叠英文文字对照
4. 错误态：权限被拒/定位不可用的专用提示（§9）

## 7. 围栏触发规则（geo.ts 核心）

| 规则 | 设计 |
|---|---|
| 定位监听 | `navigator.geolocation.watchPosition` + `enableHighAccuracy: true` |
| 触发条件 | 到景点中心 haversine 距离 ≤ `radiusMeters` |
| 精度过滤 | `coords.accuracy > 100` 米的坐标更新直接丢弃（GPS 漂移防护） |
| 播放互斥 | 同一时刻仅播放一段；播放中其他景点触发**不打断、直接忽略** |
| 多围栏重叠 | 监听态同时处于多个景点围栏内时，触发**距离最近**的景点 |
| 冷却机制 | 景点播放后冷却 30 分钟（内存计时），期间不重复触发；刷新页面重置所有冷却 |
| 持久化 | 无（不做 localStorage 记录，与砍掉进度功能的范围决定一致） |
| 坐标系 | WGS-84 全链路一致（浏览器定位与 spots.json 同系） |

### 7.1 朝向获取与方位播报（compass.ts + direction.ts）

| 规则 | 设计 |
|---|---|
| iOS 朝向 | `deviceorientation` 事件的 `webkitCompassHeading`（真北航向）；iOS 13+ 须在 Start 按钮手势内调用 `DeviceOrientationEvent.requestPermission()` |
| Android 朝向 | `deviceorientationabsolute` 事件（Chrome Android 50+ 全支持），由 `alpha` 换算真北航向；需设备含磁力计 |
| 平滑滤波 | 采样滑动窗口（约 2 秒）取中值，抑制指南针抖动后才用于方位判定 |
| 方位计算 | 游客→`landmark` 的 initial bearing（haversine 配套公式）− 当前航向，归一化后映射 8 方位：n / ne / e / se / s / sw / w / nw（每格 45°） |
| 触发定格 | 方位句在**触发瞬间**按当时的朝向选定，播放期间不随朝向变化重选 |
| 降级链 | 指南针不可用（权限被拒/无磁力计）→ 改用 GPS 轨迹移动方向（相邻定位点速度向量，步速下≈朝向，需连续两有效定位点）→ 仍不可用（静止且无指南针）→ **跳过方位句直接播正文**，方位徽标显示 *“Walk toward the landmark”* |
| 播放拼接 | 触发时顺序播放 `dir/spot-{id}-{dir}.mp3` → `spot-{id}.mp3`（前端连续播放，无缝衔接，不合并文件） |

## 8. 内容管线（Python 3.11）

1. 维护 `content/spots.json`：景点元数据 + 英文讲解词 + 方位参照地标（AI 生成初稿 → 用户审校定稿）
2. `scripts/tts_generate.py`：逐景点生成音频并输出到 `content/audio/`
   - **正文**：`audio/spot-{id}.mp3`（1 段/景点）
   - **方位引导句**：按 8 方位模板（*"Ahead of you…" / “On your right…” / “Behind you…” 等）+ 景点 `landmark.name` 生成 8 个变体 → `audio/dir/spot-{id}-{dir}.mp3`（3-5 秒/段）
   - TTS 供应商：默认 **OpenAI TTS**（`tts-1`，音色可配；12 景点正文 + 96 段方位句总成本 < 2 美元）；脚本设计为供应商可切换（备选 Azure Speech / ElevenLabs）
   - API key 通过环境变量注入（`OPENAI_API_KEY` 等），不进代码库
3. `scripts/validate_content.py` 校验：坐标与 landmark 坐标在北京市界内、半径合理（50-1000 米）、transcript 非空、正文音频存在且时长 30 秒-10 分钟、8 个方位句音频齐全且时长 1-15 秒、landmark 位于对应景点围栏内
4. 内容更新流程：改 JSON → 重跑脚本 → `git push` 自动部署，全程约 5 分钟

## 9. 错误处理

| 场景 | 处理 |
|---|---|
| 定位权限被拒 | 终态提示页：说明定位是自动播放前提 + 各平台授权操作指引 + 重试按钮 |
| 定位不可用/超时 | 状态区显示提示，10 秒自动重试，连续失败升级为手动重试按钮 |
| 朝向权限被拒/设备无磁力计 | 不阻塞主流程：走 §7.1 降级链（GPS 轨迹方向 → 跳过方位句），界面轻提示 *"Direction info unavailable"* |
| 音频加载失败 | transcript 照常显示 + 重播按钮；方位句加载失败则直接播正文（不等不阻塞） |
| 锁屏/切后台 | 系统自动暂停音频；回前台恢复监听，音频自暂停点继续 |
| 非 HTTPS 环境 | 明确报错提示（部署环境自带 HTTPS，仅本地 file:// 调试会遇到） |

## 10. 测试模式与测试策略

**模拟定位+模拟朝向测试模式**（用户明确要求，支持不亲临景点测试）：
- URL 加 `?test=1` 显示悬浮测试面板：
  - 每景点一个 **Teleport** 按钮：把模拟位置设为该景点圆心，立即走完整触发链路
  - 任意经纬度手动输入框
  - **模拟朝向**：8 个方位快捷按钮（Face N/NE/E/…）+ 手动角度输入，无需原地转圈即可验证各方位句的选择与播放
- 面板激活时**完全绕过真实 GPS 与指南针**；无参数则一切走真实传感器
- 面板含实时状态日志（收到坐标/航向 → 计算距离/bearing → 触发/被过滤原因、选定方位），便于排查未触发与方位错误问题

**测试策略**：
- 单元测试（vitest）：haversine 计算、bearing 计算、heading+bearing→8 方位映射（含 0°/45°/360° 边界与负角归一化）、围栏判定边界（恰在半径上）、精度过滤、冷却/互斥状态机全部边界
- 手动 E2E：`?test=1` 面板传送 + 模拟朝向走通全链路（含降级链：模拟无朝向场景）
- 真机检查单（iOS Safari + Android Chrome）：定位与朝向双授权弹窗 → 首次点击后自动连播 → 方位句与实际朝向一致（原地转圈验证 8 方位）→ 锁屏恢复 → 音量键行为

## 11. 部署与演进路线

**部署**：`git push` → Cloudflare Pages 自动构建上线；MVP 使用平台免费域名（`*.pages.dev`），后续可换自定义短域名。外国游客经国际漫游访问海外托管无障碍。

**演进路线**（均不在 MVP 范围）：
- V1.1：地图视图（Leaflet + OpenStreetMap 瓦片，WGS-84 零转换）、手动点播列表、一键分享（WhatsApp/X/复制链接）、PWA 离线缓存
- V2（验证成功后）：轻后端（FastAPI）支撑内容热更新与服务端完播率统计
- 远期：真人配音重点景点升级、更多城市复制

## 12. 风险与对策

| 风险 | 对策 |
|---|---|
| 故宫等高墙区域 GPS 漂移导致误触发/漏触发 | 100 米精度过滤 + 200 米宽松半径 + 冷却机制；`?test=1` 日志辅助现场调参 |
| 游客拒绝定位授权 | 明确的价值说明前置（落地页告知用途）；错误页给出清晰指引 |
| 浏览器自动播放限制 | 首播必须经「Start Audio Tour」点击手势，之后同会话内自动连播合法 |
| 城区定位精度退化为 WiFi/基站级 | 精度过滤确保不基于劣质坐标触发；漏触发由游客走动持续监听自然补上 |
| 磁干扰（地铁口/汽车/钢筋建筑）导致指南针偏差 | 8 方位每格 45° 容错 + 滑动窗口中值滤波；GPS 轨迹方向互补；方位句误差仅影响开场句不影响正文 |
