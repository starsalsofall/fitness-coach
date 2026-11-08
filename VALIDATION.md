# 0.2.0 验证记录

日期：2026-11-08。设备是用户已试用旧版的华为 Mate 60 Pro / HarmonyOS 4.2.0.198；以下为本轮开发环境的检查，不把它们当作新增版本真机验收。

## 已通过

- `npm.cmd test`：50/50 项业务与接口测试。
- `node test/ui-smoke.mjs`：手机尺寸基础完整流程通过。
- `node test/ui-audit.mjs`：6/6，快速饮食、语音文字确认、待补全备注、周模板复用、写入失败回滚、恢复备份移除旧连接信息。
- `node test/ui-readiness.mjs`：8/8。模拟原生自检、草稿/焦点、按日期日志、备份、旧 WebView；带旧服务地址和两类缓存切换五页并快进 16 分钟，原生 API 与 Health Connect 同步调用均为零。
- `node test/ui-weekly.mjs`：5/5，覆盖聊天 Markdown 和肌群分组、独立预览勾选、组次保留、单周与每周重复、今日独立完成/撤销、原记录保留、去重、未知星期阻断、已浏览未来日期补齐、保存失败后同一预览重试。
- 412×915 页面和导入弹窗无横向溢出，无测试内 JavaScript 异常；已人工查看周计划与导入截图。
- `make-update.ps1` 实际执行：`assembleDebug`、`lintDebug` 通过，校验后生成 `artifacts/daily-motion-0.2.0-debug.apk`。使用项目内 JDK 17.0.21、Gradle 8.11.1、SDK Platform 35 / Build Tools 35.0.0。
- `test/verify-apk.mjs`：签名 v2、原签名证书、原应用标识、版本 0.2.0 / 版本码 3、中文名称、最低 API 26 / 目标 API 35 通过。7 个打包页面资源与源码逐字节一致，无私有配置或签名密钥。
- 新版证书指纹与 0.1.0 / 0.1.1 一致；旧版本报告缺少版本码时，从对应实际 APK 读取后比较。本版旧数据兼容测试通过，数据格式仍为 1，计划的生效日/说明字段可选。

50 项中包含之前保留的 WHOOP 服务模块模拟检查；它们不代表本版启用了同步或已经连接真实账号。客户端同步已经暂停。

## 检查边界

- 新增导入与覆盖安装后记录保留，还需在手机上用实际整周计划确认；自动化使用隔离测试数据。
- 原生通知文本与调度通过编译和 lint；声音、振动、锁屏、重启、省电、勿扰、精准授权与次数上限仍按 `android/REMINDERS_TEST_PLAN.md` 真机检查。不会保证提醒必然到达或目标必然完成。
- 系统中文语音、系统文件备份/恢复与特定 WebView 仍待手机确认。语音识别中 Activity 重建可能需要重试。浏览器文本识别检查不等于麦克风识别通过。
- 本版依据本地勾选与饮食记录给出确定性反馈，不测量训练负荷、身体恢复或真实热量消耗，不自动改目标。没有应用内在线更新或远程热更新。
- WHOOP / Health Connect 原模块与缓存保留，本轮无需账号授权与公网服务；没有部署外部服务或使用本人凭据。

最终 lint 为 0 个错误、4 个已审查警告：AGP 可升级、API 隔离注解选择、可信本地页面需要启用 JavaScript、中文字符串拼接。SDK XML 版本提示未影响构建。Java 读取 SDK JAR 的沙箱限制通过自动审查允许的本地沙箱外构建解决，输出仅在项目内。

## 交付与复现

- 安装与导入：`INSTALL-ANDROID.md`、`WEEKLY-PLAN.md`。
- 后续更新：`UPDATE.md`；`make-update.ps1` 缺少原签名或校验失败时不会发布更新包。
- `artifacts/apk-verification.json` 与各版本报告记录真实 SHA-256；`artifacts/SHA256SUMS.txt` 记录安装包与源码包校验值。
- `package-source.ps1` 排除 `private/`、`node_modules/`、构建缓存、`.env` 与签名密钥。源码包包含更新脚本、整周导入模块、测试和完整目录。
- `mobile-weekly-plan.png`、`mobile-weekly-import.png` 有自动化测试格式示例标记，不是个人训练建议；其他预览截图也仅使用测试记录。
