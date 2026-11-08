# 以后直接更新这个应用

## 手机端

收到 `daily-motion-版本-debug.apk` 后，在文件管理器打开，按系统提示覆盖更新。不要先卸载；原训练、饮食和设置保存在同一个应用的数据目录。更新前在“设置 → 备份与恢复”导出一次 JSON 更稳妥。

本轮更新包为 `daily-motion-0.3.0-debug.apk`，版本码 4，沿用原应用标识与测试签名。0.2.0 及更早同签名版本可直接覆盖更新。0.3.0 使用数据版本 2，兼容升级原版本 1 的计划、饮食、体重及缓存；历史缺少碳水资料时继续显示未知，不补成零。迁移和新增功能的最终检查结果见 [VALIDATION.md](VALIDATION.md)。

当前是手动安装更新包，没有应用内在线检查更新、自动下载安装或远程热更新。后续可在同一项目加入这些能力，无需重做应用。华为 HarmonyOS 4.2 的实际更新过程仍需在手机确认；若系统提示签名冲突，保留原应用与记录，不要通过卸载解决。

## 开发端

应用固定标识 `local.dailymotion`，个人签名保存在 `private/signing/personal-debug.keystore`。该文件需要单独保管，不进入源码分享包，也不要重新生成。公开的 `android/update-identity.json` 只记录证书指纹，不包含私钥。

每次迭代在现有代码上修改；更新 `package.json`、`package-lock.json`、界面的显示版本和 `android/app/build.gradle` 的 `versionName`，并递增 `versionCode`。本版为 `0.3.0 / 4`，前一版为 `0.2.0 / 3`。数据结构变更先实现迁移再发版；当前数据版本 2 接受版本 1 并兼容迁移，未知碳水与原营养快照必须保留。无效备份不能覆盖当前记录，未来未知数据版本不能直接当成当前版本读取。

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

按用户约定，每个阶段检查完成后提交 Git；交付应用版本时加对应标签（本轮 `v0.3.0`），并发出新版安装包链接。后续开发规则保存在 `AGENTS.md`。用户已选择新建 GitHub 私有仓库，当前已启动官方设备授权流程；远程备份仍待授权和实际推送完成。不要把本地提交或 Git bundle 称为远程备份成功，最终状态以本轮交付信息为准。

0.2.0 阶段已有 `v0.2.0` 标签和 `artifacts/daily-motion-v0.2.0-git.bundle` 本地历史备份。Git bundle 不递归提交进仓库；需要恢复这个历史版本时可用：

```powershell
git bundle verify artifacts/daily-motion-v0.2.0-git.bundle
git clone artifacts/daily-motion-v0.2.0-git.bundle daily-motion-restored
```

恢复的仓库含源码和已提交的安装包，不包含个人签名、工具缓存、凭据或个人健康记录。后续生成可覆盖安装的更新包，仍需另行保留原签名文件。
