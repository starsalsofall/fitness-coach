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
│   └── settings.gradle
├── test/
│   ├── core.test.mjs
│   ├── quick-log.test.mjs
│   ├── ui-audit.mjs
│   ├── ui-readiness.mjs
│   ├── ui-smoke.mjs
│   ├── verify-apk.mjs
│   └── whoop.test.mjs
├── web/
│   ├── app.js
│   ├── core.js
│   ├── index.html
│   ├── quick-log.js
│   └── style.css
├── .env.example
├── .gitignore
├── APP-REVIEW.md
├── build-android.ps1
├── CHANGELOG.md
├── INSTALL-ANDROID.md
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
├── V1-REQUIREMENTS.md
├── VALIDATION.md
├── WHOOP-SETUP.md
├── WHOOP-SYNC.md
└── whoop.mjs
```

## 模块责任

| 路径 | 责任 |
| --- | --- |
| web/app.js | 页面、打卡、饮食确认、语音草稿、同步入口、备份与失败提示 |
| web/core.js | 日期、计划快照、汇总、目标反馈、来源选择和备份校验 |
| web/quick-log.js | 最近饮食复用、文字中的食物/份量匹配、静默时间判断；不调用云模型 |
| android/.../MainActivity.java | 打包本地界面、私有存储、系统文件/语音/设置入口、HTTPS桥 |
| android/.../ReminderReceiver.java | 每日检查、次数上限、复提醒、稍后提醒、静默与完成状态 |
| android/.../BootReceiver.java | 重启、时区和精准权限变化后恢复安排 |
| android/.../HealthConnectBridge.java | 支持设备的可选HealthConnect只读桥，非华为默认依赖 |
| android/.../HealthPermissionsActivity.java | 本机健康权限的中文用途说明 |
| server.mjs | 本机预览、个人同步接口鉴权和回调 |
| whoop.mjs | 官方OAuth、令牌刷新/加密、分页与数据转换 |
| test/ | 业务、接口和手机尺寸交互回归 |
| V1-REQUIREMENTS.md | 一期功能、取舍、设备前提和交付验收 |
| WHOOP-SYNC.md | 华为同步路线、官方能力、现有实现与真实验收区别 |
| APP-REVIEW.md | 本轮查出的问题、修复和未完成项 |
| android/REMINDERS_TEST_PLAN.md | 华为原生提醒与语音真机验收 |

## 不进入源码包的目录

- node_modules/：仅开发用浏览器测试依赖。
- private/：下载工具、私有令牌、缓存与本地辅助脚本，不能对外发布。
- artifacts/：手机截图与源码压缩包，独立交付。
- android/**/build/、.gradle/：本机构建产物与缓存。
- .env、签名密钥：任何真实配置不打包；仅提供.env.example。
