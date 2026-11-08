# 开发项目完整目录

以当前源码为准。排除依赖安装目录、下载的工具、构建缓存与生成产物；这些不是应用源文件。

```text
fitness-coach/
├── .github/
│   └── workflows/
│       └── android.yml
├── android/
│   ├── app/
│   │   ├── src/
│   │   │   └── main/
│   │   │       ├── java/
│   │   │       │   └── local/
│   │   │       │       └── dailymotion/
│   │   │       │           ├── BootReceiver.java
│   │   │       │           ├── HealthConnectBridge.java
│   │   │       │           ├── HealthPermissionsActivity.java
│   │   │       │           ├── MainActivity.java
│   │   │       │           └── ReminderReceiver.java
│   │   │       ├── res/
│   │   │       │   ├── drawable/
│   │   │       │   │   ├── ic_launcher.xml
│   │   │       │   │   └── ic_motion.xml
│   │   │       │   └── xml/
│   │   │       │       └── data_extraction_rules.xml
│   │   │       └── AndroidManifest.xml
│   │   └── build.gradle
│   ├── gradle/
│   │   └── wrapper/
│   │       ├── gradle-wrapper.jar
│   │       └── gradle-wrapper.properties
│   ├── build.gradle
│   ├── gradlew
│   ├── gradlew.bat
│   ├── REMINDERS_TEST_PLAN.md
│   ├── settings.gradle
│   └── update-identity.json
├── test/
│   ├── coaching.test.mjs
│   ├── core.test.mjs
│   ├── nutrition.test.mjs
│   ├── quick-log.test.mjs
│   ├── ui-audit.mjs
│   ├── ui-nutrition.mjs
│   ├── ui-readiness.mjs
│   ├── ui-smoke.mjs
│   ├── ui-weekly.mjs
│   ├── verify-apk.mjs
│   ├── weekly-plan.test.mjs
│   ├── weight-trends.test.mjs
│   └── whoop.test.mjs
├── web/
│   ├── app.js
│   ├── coaching.js
│   ├── core.js
│   ├── index.html
│   ├── nutrition-ui.js
│   ├── quick-log.js
│   ├── style.css
│   ├── today-view.js
│   ├── ui-shared.js
│   ├── weekly-plan.js
│   └── weight-trends.js
├── .env.example
├── .gitignore
├── AGENTS.md
├── APP-REVIEW.md
├── build-android.ps1
├── CHANGELOG.md
├── INSTALL-ANDROID.md
├── make-update.ps1
├── package-lock.json
├── package-source.ps1
├── package.json
├── PROJECT-STATUS.md
├── PROJECT-TREE.md
├── README.md
├── RESEARCH.md
├── server.mjs
├── setup-whoop.ps1
├── start-preview.cmd
├── UPDATE.md
├── V1-REQUIREMENTS.md
├── VALIDATION.md
├── WEEKLY-PLAN-TEMPLATE.txt
├── WEEKLY-PLAN.md
├── WHOOP-SETUP.md
├── WHOOP-SYNC.md
└── whoop.mjs
```

## 模块责任

| 路径 | 责任 |
| --- | --- |
| web/app.js | 页面、打卡、饮食确认、语音草稿、整周导入界面、备份与失败提示；同步暂停 |
| web/core.js | 日期、v1→v2迁移、计划快照、碳水汇总/目标、来源与备份校验 |
| web/today-view.js | 精简首页、待完成安排与一键记餐入口 |
| web/nutrition-ui.js | 碳水目标、未知营养提示与模式表单 |
| web/weight-trends.js | 实测体重、7日均值、7/30天安全SVG图 |
| web/ui-shared.js | HTML转义与显示格式 |
| web/weekly-plan.js | 整周文字解析、分项、单周/重复导入、生效日期、去重及历史保留 |
| web/coaching.js | 今日饮食与前两天实际训练勾选的只读反馈 |
| web/quick-log.js | 最近饮食复用、文字中的食物/份量匹配、静默时间判断；不调用云模型 |
| android/.../MainActivity.java | 打包本地界面、私有存储、系统文件/语音/设置入口、HTTPS桥 |
| android/.../ReminderReceiver.java | 每日检查、次数上限、复提醒、稍后提醒、静默与完成状态 |
| android/.../BootReceiver.java | 重启、时区和精准权限变化后恢复安排 |
| android/.../HealthConnectBridge.java | 保留的可选 Health Connect 桥，当前同步暂停 |
| android/.../HealthPermissionsActivity.java | 本机健康权限的中文用途说明 |
| server.mjs | 本机预览；保留的个人同步接口当前不由客户端调用 |
| whoop.mjs | 暂停接入的官方 OAuth、令牌刷新/加密与数据转换模块 |
| test/ | 业务、接口和手机尺寸交互回归 |
| V1-REQUIREMENTS.md | 一期功能、取舍、设备前提和交付验收 |
| WHOOP-SYNC.md | 原同步技术资料，当前阶段暂停 |
| WEEKLY-PLAN.md、WEEKLY-PLAN-TEMPLATE.txt | 导入说明与可直接粘贴的整周模板 |
| UPDATE.md、make-update.ps1 | 同应用同签名版本迭代与更新包生成 |
| android/update-identity.json | 公开证书指纹与最低版本码，不含私钥 |
| APP-REVIEW.md | 本轮查出的问题、修复和未完成项 |
| android/REMINDERS_TEST_PLAN.md | 华为原生提醒与语音真机验收 |

## 不进入源码包的目录

- node_modules/：仅开发用浏览器测试依赖。
- private/：下载工具、私有令牌、缓存与本地辅助脚本，不能对外发布。
- artifacts/：手机截图与源码压缩包，独立交付。
- android/**/build/、.gradle/：本机构建产物与缓存。
- .env、签名密钥：任何真实配置不打包；仅提供.env.example。
