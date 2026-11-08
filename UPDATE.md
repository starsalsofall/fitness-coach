# 以后直接更新这个应用

## 手机端

收到 `daily-motion-版本-debug.apk` 后，在文件管理器打开，按系统提示覆盖更新。不要先卸载；原训练、饮食和设置保存在同一个应用的数据目录。更新前在“设置 → 备份与恢复”导出一次 JSON 更稳妥。

当前是手动安装更新包，没有应用内在线检查更新、自动下载安装或远程热更新。后续可在同一项目加入这些能力，无需重做应用。华为 HarmonyOS 4.2 的实际更新过程仍需在手机确认；若系统提示签名冲突，保留原应用与记录，不要通过卸载解决。

## 开发端

应用固定标识 `local.dailymotion`，个人签名保存在 `private/signing/personal-debug.keystore`。该文件需要单独保管，不进入源码分享包，也不要重新生成。公开的 `android/update-identity.json` 只记录证书指纹，不包含私钥。

每次迭代在现有代码上修改；更新 `package.json`、`package-lock.json`、`web/app.js` 的显示版本和 `android/app/build.gradle` 的 `versionName`，并递增 `versionCode`。本版为 `0.2.0 / 3`。如数据结构将来有破坏性变更，先实现迁移再发版；当前保持数据版本 1，新计划字段为可选，兼容原记录。

先运行业务和相应界面检查：

```powershell
npm.cmd test
node test/ui-smoke.mjs
node test/ui-audit.mjs
node test/ui-readiness.mjs
node test/ui-weekly.mjs
```

再用一条命令构建更新包：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\make-update.ps1
```

脚本复用便携 JDK/SDK/Gradle，构建并运行 Android lint，检查原签名、应用标识、版本号和打包资源。签名丢失或变化时不交付更新包；新版本的 Android 版本码必须高于已有发布报告。输出为 `artifacts/daily-motion-版本-debug.apk`。签名校验报告位于 `artifacts/apk-verification.json`，保留各版本报告便于比较。源码打包使用 `package-source.ps1`，不包含签名、个人记录或密钥。

GitHub 工作流仅检查编译，使用临时 CI 签名；其 `ci-build-check-apk` 不能用于更新当前手机上的个人版本。个人更新包在持有原签名的开发环境生成。

Android 对更新签名和版本的规则见 [应用签名官方说明](https://developer.android.com/studio/publish/app-signing) 和 [版本管理官方说明](https://developer.android.com/studio/publish/versioning)。

## 每个阶段的 Git 备份与交付

按用户约定，每个阶段检查完成后提交 Git；交付应用版本时加版本标签，并发出新版安装包链接。后续开发规则保存在 `AGENTS.md`。当前仓库尚未配置远程地址，因此本次使用本地提交、`v0.2.0` 标签和 Git bundle 备份，不等于远程备份。

完整 Git 历史备份放在 `artifacts/daily-motion-v0.2.0-git.bundle`，不会递归提交进仓库。可用 Git 检查和恢复：

```powershell
git bundle verify artifacts/daily-motion-v0.2.0-git.bundle
git clone artifacts/daily-motion-v0.2.0-git.bundle daily-motion-restored
```

恢复的仓库含源码和已提交的安装包，不包含个人签名、工具缓存、凭据或个人健康记录。后续生成可覆盖安装的更新包，仍需另行保留原签名文件。
