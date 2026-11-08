# WHOOP 同步审查与第一版接入方案

核查日期：2026-11-07；设备信息更新：2026-11-08。用户手机为华为 Mate 60 Pro，HarmonyOS 4.2.0.198，采用安卓 APK 路线。本文区分“官方支持该能力”“已写入源码”和“已用本人账号成功同步”，不能把前两者当成第三者。

## 对这台手机的建议

第一版优先采用 **WHOOP 官方云端 API → 一个个人用同步服务 → 本应用**。本应用的 HTTPS 客户端不依赖 Google Play services；不要求为了同步安装 GMS 或虚拟化工具。日常操作只保留“连接 WHOOP / 立即同步”和最近成功时间，开发者参数放到一次性配置或高级设置中。

这条路线仍需要 WHOOP 设备先把数据传到 WHOOP 官方云端；手机上的数据可用性、WHOOP 会员和授权范围均以实际账号为准。它不意味着手机能直接从手环读取连续心率。

WHOOP 官方说明，新开发者应用默认属于最多连接 10 名成员的 Sandbox，在该范围内开发测试无需先申请扩容；个人自用 1 名成员可以先完成授权和联调。仍须遵守 API 条款并创建应用、登记正确回调地址。[WHOOP App Approval](https://developer.whoop.com/docs/developing/app-approval/)

另一条官方路线是 **WHOOP → Android Health Connect → 本应用**。它不需要这个同步服务，但不能因为手机属于安卓生态就认定华为一定支持。Health Connect 的官方设备要求包括 Android 9+ 和 Google Play services；Android 14+ 集成于系统，较早版本需另外安装。本项目的轻量实现只接入 Android 14+ 原生接口，低版本或系统服务不可用时明确回退手动记录。[Android 可用性说明](https://developer.android.com/health-and-fitness/health-connect/availability)

## 数据是否真的能调取

结论：官方开放接口确实存在，具备本人授权后读取的技术路径；当前项目没有你的授权，因此尚未证明你的账号已经同步成功。只有真机看到来自 WHOOP 的真实记录、日期、来源和更新时间，并通过刷新和撤销权限检查后，才能标记接入验收完成。

| 数据 | WHOOP 云端 v2 API | Health Connect 官方导出边界 | 第一版处理 |
| --- | --- | --- | --- |
| 睡眠 | 可读取睡眠及分期 | 官方列出 Sleep | 读取，分期缺失时不把整段时间冒充实际睡眠 |
| 运动类型、时间、时长 | 可读取 workout | 官方列出 Exercise | 读取，只作运动证据，不代替具体动作/组数打卡 |
| 热量消耗 | cycle/workout 可包含能量数据 | 官方列出 Calories，但具体记录类型需真机核实 | 暂不自动加回饮食目标，避免混用全天与运动消耗 |
| 恢复百分比分数 | recovery 接口提供 | 具体导出清单没有明确列出该专有分数 | 仅官方云端授权成功后展示；不伪造 |
| WHOOP strain 分数 | cycle/workout 接口提供 | 不能把概览中的 Strain 字样当成专有分数导出的证明 | 暂不作为轻量版必须项 |
| HRV、静息心率 | recovery 中可有相应字段 | 导出明确列出 RHR，未明确列出 HRV | 当前转换函数未保存这些字段，后续可加 |
| 心率 | workout/cycle 可含汇总值 | 当前导出清单未明确列连续心率流 | 不承诺逐秒监控 |

云端字段依据 [WHOOP API reference](https://developer.whoop.com/api/)。Health Connect 的官方导出清单包括运动、热量、步数、睡眠、静息心率、呼吸率和血氧；没有据此保证恢复百分比、strain 分数或 HRV 可用。某些健康监测类别与会员等级有关，最终以账号可授权数据为准。[WHOOP Health Connect 说明](https://support.whoop.com/s/article/Google-Health-Integration-For-Android)

## 当前代码实际上做了什么

- `whoop.mjs`：官方 OAuth 授权码流程、offline 刷新、令牌轮换保存、分页读取。当前仅把恢复分数、主睡眠时长和运动时段转换为应用快照；并没有把 API 所有字段都接入首页。
- `server.mjs`：个人连接密钥保护的授权/同步/撤销接口。WHOOP Client Secret 和访问令牌留在服务端；访问令牌以认证加密形式保存在服务端私有文件中。
- 0.1.1 增加 `/api/status`：需个人密钥，只读本地配置和凭据，不联网、不刷新；`upstreamVerified` 固定为 false，不能当成已同步真实数据。
- `HealthConnectBridge.java`：新增可选本机只读桥，API 34+ 才加载平台实现；检查系统服务、逐次检查权限；只查询 `com.whoop.android` 来源的睡眠和运动，分页并去重。不读其他设备的数据，不请求健康数据写权限。
- Health Connect 只读最近 7 个当地日的主睡眠和运动；睡眠按结束日、运动按开始日归档。主睡眠选当天最长会话。有已知睡眠分期时用分期时长，缺分期时仅返回会话时长另行标注，`sleepHours` 保留为空。
- Health Connect 的运动类型编号与 WHOOP 的 sport_id 不是同一套编号；界面应优先显示记录名称。
- 以上不是本人账号联调成功的证据。原生权限流程、平台返回值、华为系统兼容性均须真机验证。

## 最简单的云端使用流程

开发者只做一次配置：

1. 在 WHOOP Developer Dashboard 创建个人 Sandbox 应用，登记 HTTPS 回调地址。
2. 部署现有的单进程 Node 服务，通过 HTTPS 提供接口；设置 Client ID、Client Secret、令牌加密密钥和个人连接密钥，保持服务端私有文件不对外暴露。
3. 在应用的一次性连接设置填写服务地址和个人连接密钥。WHOOP Client Secret 不进入手机，也不需要发到聊天中。

本人只做一次授权：

1. 点“连接 WHOOP”，在 WHOOP 官方登录页授权。
2. 返回应用点击“同步”，核对一条真实睡眠和运动记录。
3. 此后打开应用自动检查，前台定时刷新，也保留手动同步。第一版不部署全天高频轮询或 Webhook 推送链。

刷新令牌需要 `offline` scope，并且 WHOOP 轮换刷新令牌；服务端必须保存最新令牌、避免多个并发刷新请求。Client Secret 只应在服务端使用。[WHOOP OAuth](https://developer.whoop.com/docs/developing/oauth/)、[开发者入门](https://developer.whoop.com/docs/developing/getting-started/)

## 设备支持 Health Connect 时的可选流程

1. 在 WHOOP 的 More → Integrations 中找到 Health Connect，允许分享睡眠和运动；具体菜单以已安装版本为准。
2. 回到本应用，允许只读睡眠和运动，再点击同步。
3. 若提示系统不支持、权限拒绝或没有 WHOOP 记录，保留手动记录与云端方案入口，不要求换机、安装 GMS 或从不明来源补装系统组件。

本机桥使用 Android 14+ `HealthConnectManager`，无需额外 Kotlin、AndroidX Health Connect 或 UI 框架。原生 API 的 [读取方法](https://developer.android.com/reference/android/health/connect/HealthConnectManager)、[按时间和来源查询](https://developer.android.com/reference/android/health/connect/ReadRecordsRequestUsingFilters.Builder) 均已在官方文档核实。权限说明页面按 [官方入门要求](https://developer.android.com/health-and-fitness/health-connect/get-started) 注册。

## 离线和低频备用

无网络时，本地训练和饮食照常记录；显示上次成功同步时间，不把旧数据标成今天的新数据。

WHOOP 官方另有 CSV 导出：在 App 的 Data Export 发起请求，通常在 24 小时内收到邮件下载链接，链接保留 7 天。可用于历史备份或以后做一次性导入，不适合当天自动监督。当前应用没有完成 WHOOP CSV 导入器，因此不把“WHOOP 可以导出”写成“本 App 已能导入”。[WHOOP 数据导出说明](https://support.whoop.com/s/article/How-to-Export-Your-Data)

## 第一版验收清单

1. 手机的系统版本与应用安装形式确认；无法原生运行 APK 的系统不能以浏览器交互测试替代安装验收。
2. 本人 WHOOP 数据确已上传，云端授权后展示至少一条真实睡眠/运动，日期和时长可对照。
3. 重复同步不重复叠加；跨午夜记录归档一致；修改或删除上游记录后能更新快照。
4. 断网/撤销授权有明确提示，手动记录不受影响；不因同步失败清空训练或饮食。
5. 恢复分数和热量没取到时展示未知；不会用模拟值或零补齐。
6. Health Connect 仅在服务可用的真机验收，不把华为健康或其他来源当成 WHOOP。
7. “同步成功”表示此次取数成功，不保证手环刚刚采样的数据已经在云端完成处理，更不是秒级连续监测。
