# 每日动一动 · 安卓个人运动与饮食监督

找不到上次聊天记录时，先看 [当前进度与继续步骤](PROJECT-STATUS.md)。电脑预览可双击 `start-preview.cmd` 启动，再打开 <http://127.0.0.1:8787>。

第一版个人测试 APK、源码与可运行交互预览。中文、本地优先、无应用注册。已按你确认的“减脂，同时保持肌肉”设置默认目标；热量和蛋白质数值留待个人设置。项目参考与功能取舍见 [RESEARCH.md](RESEARCH.md)。

本轮复审已按“华为 Mate 60 Pro、少录入、强提醒”更新，先看 [第一版开发要求](V1-REQUIREMENTS.md)、[审查与改进](APP-REVIEW.md)、[WHOOP 同步方案](WHOOP-SYNC.md) 和 [完整项目目录](PROJECT-TREE.md)。2026-11-08 已确认系统为 HarmonyOS 4.2.0.198，继续交付安卓 APK；实际安装和系统能力需要真机验收。

## 当前能用什么

- 今日计划、每周重复安排、分类打卡、跳过原因、力量训练组数和重量、实际时长、休息计时。
- 常吃食物与份量换算、最近饮食一键复用、复制昨天饮食、热量/蛋白质汇总和全天完整性检查。
- 系统中文语音入口、文字草稿食物匹配与份量确认；未知项可存待补全备注，不猜热量。系统语音识别需真机验证，浏览器可用输入法语音或文字。
- 近 7 天回顾、体重和感受记录、JSON 备份恢复。
- 安卓强提醒源码：高优先声音/振动、有限次复提醒、稍后提醒、夜间静默、重启恢复、精准权限/降级和完成后停止。
- WHOOP 官方 v2 API 服务端模块和客户端配置入口；需要自建 HTTPS 服务与本人授权。
- 支持设备可选原生 Health Connect，只读 WHOOP 睡眠与运动；本机桥需 Android 14+ 系统服务，华为不默认支持。
- 0.1.1 加入安装自检与 WHOOP 本地连接检查，保留未保存输入和焦点，并补充旧 WebView 的轻量兼容。

2026-11-08 已完成 APK 构建、签名与包内资源校验；安装包为 `artifacts/daily-motion-0.1.1-debug.apk`，使用方法见 [INSTALL-ANDROID.md](INSTALL-ANDROID.md)。0.1.1 可覆盖 0.1.0，变化见 [CHANGELOG.md](CHANGELOG.md)。安卓 lint 通过，仍有少量已审查的警告；这不替代华为真机验收。

尚未连接真实 WHOOP 账号。浏览器预览不提供关闭页面后的原生提醒。WHOOP 目前仅在应用打开、前台每 15 分钟以及手动点击时同步；后台全天推送、拍照识别、条码库尚未实现。

## 立即预览

需要 Node.js 22+，运行应用无需安装 npm 依赖。在本目录运行：

```powershell
node server.mjs
```

在电脑打开 <http://127.0.0.1:8787>，可调整浏览器到手机尺寸。首次使用先在“训练”添加项目，在“饮食”创建常吃食物，在“设置”填个人目标。数据保存在当前浏览器，不与安卓数据自动互通，可使用 JSON 备份转移。

预览默认只监听本机，不自动部署到公网。手机安装需要下文的 APK 构建流程。

## 构建安卓 APK

项目在 `android/`，使用 Android 平台 Java API 与打包在 APK 内的本地界面，无远程页面、无需第三方运行时 UI 库。最低 Android 8.0；需要较新的 Android System WebView（支持 ES modules、structuredClone、dialog）。

构建要求：JDK 17、Android SDK Platform 35、Build Tools 35.0.0，以及 Gradle 8.11.1。版本依据 [AGP 8.10 官方兼容表](https://developer.android.com/build/releases/agp-8-10-0-release-notes)，项目使用 AGP 8.10.1。

1. 安装 Android Studio 和所需 SDK，并设置 `JAVA_HOME`、`ANDROID_HOME`（或在 `android/local.properties` 配置 `sdk.dir`）。
2. 项目已附固定 SHA-256 的 Gradle wrapper，可在项目根目录执行 `android\gradlew.bat -p android assembleDebug`。
3. 或在项目根目录运行下面脚本；它发现现有 JDK / SDK / Gradle，复用本项目 `private/tooling/` 的便携工具，并保持测试签名、缓存和 Android 偏好目录都位于项目内：

```powershell
powershell -ExecutionPolicy Bypass -File .\build-android.ps1
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`。这是个人测试包，需在手机允许对应文件来源安装。后续更新要沿用 `private/signing/personal-debug.keystore`，不要覆盖或分享该私有文件；正式发布签名暂未配置。首次构建脚本仅在密钥缺失时创建，不轮换现有密钥。

仓库另附 `.github/workflows/android.yml`，将完整项目放到你自己的 GitHub 仓库后可以手动触发构建并下载 APK artifact；本次未上传或运行 GitHub Actions。

## 安卓使用与提醒

“设置”启用提醒并保存，Android 13+ 允许通知，可选授权精准提醒。每日训练与饮食检查默认 18:30/20:30，每类每天最多 3 次（含首次）、未完成后间隔 30 分钟复提醒，默认 22:30–07:00 静默。检查时间需要在静默时段外。通知支持打开记录和稍后提醒，完成后停止；无训练安排不催练。动作计划时间目前仅展示，不是每项独立闹钟。

原生提醒不依赖 WebView 持续打开。手机省电、勿扰和权限可能阻止或延迟提醒，系统强行停止后需重新打开。华为须检查应用启动管理与后台活动；详细真机验收见 [REMINDERS_TEST_PLAN.md](android/REMINDERS_TEST_PLAN.md)。

所有训练和饮食记录保存在应用私有 SharedPreferences JSON；连接密钥存于另一份私有偏好。Android 系统云备份已关闭，没有分析 SDK。当前没有额外的数据库加密或生物识别锁。可在系统文件选择器导出/恢复 JSON；健康记录备份本身不加密，请自行保管。

## 配置真实 WHOOP 连接

不需要把密码或 Client Secret 发给聊天，也不要写进 APK。

Windows 本机可使用 [setup-whoop.ps1](setup-whoop.ps1) 首次配置向导；已有 `.env` 或加密令牌会被保留。极简流程见 [WHOOP-SETUP.md](WHOOP-SETUP.md)。这只准备本地配置，不代替 HTTPS 部署和本人授权。

1. 在 [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com/) 创建应用，开启 `read:recovery`、`read:sleep`、`read:workout`。授权请求另外包含 `offline` 以获取刷新令牌。
2. 将 `.env.example` 复制为 `.env`，在你控制的服务器上填写 Client ID / Client Secret，以及已在 WHOOP 注册的完整回调地址，例如 `https://your-domain/oauth/callback`。
3. 分别生成两个不同的随机值，填写 `TOKEN_ENCRYPTION_KEY` 与 `PAIR_TOKEN`：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

4. 使用有持久化磁盘的 Node.js 服务，通过可信 HTTPS 反向代理暴露，保持 `.env` 和 `private/` 不被静态托管。服务默认仅监听 127.0.0.1。不要将预览服务器直接以 HTTP 暴露到公网。
5. 在手机“设置 → WHOOP 同步”填写 HTTPS 服务根地址和 `PAIR_TOKEN`，保存。点击“前往 WHOOP 授权”，在系统浏览器完成授权，返回应用点“立即同步”。

只读数据在后端获取，令牌使用 AES-256-GCM 加密保存在 `private/whoop-token.enc`，刷新请求串行处理并保存新令牌。授权 state 单次使用、10 分钟有效；同步接口需要 Bearer 连接密钥。服务不保存训练或饮食记录。连接密钥应视为敏感信息；浏览器预览只放在当前会话 sessionStorage，安卓放在私有偏好。

跨域浏览器预览时，将 `APP_ORIGIN` 配为精确的页面 HTTPS origin；不使用通配 CORS。安卓由原生 HTTPS 请求，不受浏览器跨域约束。生产部署仍需配置访问控制、代理日志过滤、进程自启动和备份；当前服务面向单人、单进程使用。

同步范围是最近约 31 天，恢复数据按主睡眠结束的手机当地日期归档，小睡不替换主睡眠；跨午夜运动按开始日归档。同步得到新快照会替换本机 WHOOP 缓存，超过范围的 WHOOP 记录不长期留存，手动训练和饮食历史保留。删除/更正 WHOOP 记录以新的查询快照为准。已有手动身体状态优先展示，清空手动两项即可使用同步数据。

华为的第一版优先使用上面的官方云接口，不要求 GMS。其他具备 Android 14+ Health Connect 服务的设备，可用本机共享省去同步服务；没有服务会明确回退。Health Connect 不提供 WHOOP 专有恢复分数的保证，只有运动和睡眠已接入。两条通道的数据分开缓存、不重复叠加。详见 [WHOOP-SYNC.md](WHOOP-SYNC.md)。

“断开并清除缓存”会先撤销服务端 WHOOP 授权，删除服务端令牌，再清除本机 WHOOP 缓存和连接配置；若服务端不可达会明确失败，可稍后重试。应用不是 WHOOP 设备的秒级心率监控器。

## 验证

```powershell
node --test test/*.test.mjs
npm ci
node test/ui-smoke.mjs
node test/ui-audit.mjs
node test/ui-readiness.mjs
node test/verify-apk.mjs
```

手机交互测试通过开发依赖 playwright-core 使用已安装的 Chrome，不下载浏览器。默认路径为 `C:\Program Files\Google\Chrome\Application\chrome.exe`，可通过 `CHROME_PATH` 改路径。测试使用临时浏览器上下文，不使用你的日常浏览器数据。截图保存在 `artifacts/`；测试食物数值仅供交互验证，不是营养建议。

安卓真机验收还需要：允许/拒绝通知、锁屏提醒、跨日、重启恢复、强行停止后重新打开、文件备份恢复、离线记录、真实 WHOOP 授权/刷新/撤销。本机编译、签名与静态检查已通过；不能用它们替代这些手机上的检查。

## 目录

- `web/`：共享交互界面与业务逻辑。
- `android/`：本地资源 WebView、私有存储、系统文件选择器、HTTPS 桥和提醒。
- `server.mjs`、`whoop.mjs`：本机预览与可选 WHOOP 服务端。
- `test/`：业务、接口授权、令牌、分页和手机尺寸交互检查。

完整目录树、模块责任和发布包排除项见 [PROJECT-TREE.md](PROJECT-TREE.md)。

本项目没有复制调研项目的代码或素材。后续如直接合并开源实现，需按对应项目及其资源的许可处理。
