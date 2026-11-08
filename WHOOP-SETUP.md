# WHOOP 一次配置，日常点同步

适用设备：你的华为 Mate 60 Pro，HarmonyOS 4.2.0.198。第一版采用 APK 与 WHOOP 官方云 API 小服务；不要求安装 GMS 或改用 Health Connect。此处只准备本机配置，不会部署到公网，也不代表已经接入你的账号。

## 开发服务只配置一次

1. 在 [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com/) 创建个人应用，启用 `read:recovery`、`read:sleep`、`read:workout`。个人自用可以先在默认 Sandbox 内开发测试。[官方 Sandbox 说明](https://developer.whoop.com/docs/developing/app-approval/)
2. 在项目目录运行下面向导。准备好之后要使用的 HTTPS 服务根地址、Client ID 和 Client Secret；Secret 使用隐藏输入，不要粘贴到聊天或命令参数中。

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-whoop.ps1
```

3. 向导首次创建本机 `.env`，独立随机生成个人连接密钥和令牌加密键，固定仅监听 `127.0.0.1`。它不联网、不自动启动服务、不更改防火墙。按提示将完整 `/oauth/callback` 回调地址登记到 WHOOP 应用中。
4. 后续由开发者将这个单进程 Node 服务配置在你控制的 HTTPS 环境中，保持 `.env`、`private/` 和代理日志不泄露凭据。首次可直接使用现有 `server.mjs` 与 `whoop.mjs`；真实公网部署尚未执行。

`.env` 是本机明文配置文件；向导在写入前将 Windows 文件权限限制为当前用户和 SYSTEM。如果权限设置失败，可能留下尚未写入凭据的空 `.env`，应先在本机检查该文件。向导不会自动覆盖它。项目已经忽略 `.env` 和 `private/`，仍不要把它们加入分享包。

**已有 `.env` 时，向导只检查，不覆盖或补写任何内容，也不重置加密键。**如果已有 `private/whoop-token.enc` 却缺少 `.env`，向导会停止，要求恢复原配置。`TOKEN_ENCRYPTION_KEY` 用于读取已有令牌，保留原值；不要为了修复连接而重新生成。要调整配置，用本机编辑器只改所需字段。

## 手机只做一次授权

HTTPS 服务就绪后，在应用连接设置填写服务地址及 `.env` 中的 `PAIR_TOKEN`，点“保存连接”，再点“检查连接”。自检只检查服务配置和本地凭据，不请求 WHOOP，也不证明授权有效。

接着点“前往 WHOOP 授权”，在官方页面完成本人授权，返回点“立即同步”，核对一条真实睡眠和运动记录。Client Secret、`TOKEN_ENCRYPTION_KEY` 均不填入手机。服务端需使用本次更新的 `server.mjs` / `whoop.mjs` 才有 `/api/status` 接口；更新并重启服务时保留原 `.env` 和 `private/whoop-token.enc`。

以后日常打开应用即可检查同步，必要时点一次“立即同步”。具体是否自动刷新、后台能力与错误提示，以当前已完成的软件版本为准。只有本人授权后核对过一条真实睡眠和运动记录，才算真实同步通过；模拟测试或字段检查不能替代这一步。

## 不填写凭据也能先检查

```powershell
# 演练：不输入凭据、不生成密钥、不写文件、不联网
powershell -ExecutionPolicy Bypass -File .\setup-whoop.ps1 -NoWrite

# 只检查已有 .env 的字段，绝不输出其值；通过返回 0，缺项返回 2
powershell -ExecutionPolicy Bypass -File .\setup-whoop.ps1 -CheckOnly
```

用于开发测试的空白配置可放在项目 `private/` 下，再使用 `-CheckOnly -CheckFile private/测试目录/empty.env`；只读检查不生成真实密钥，也不调用 WHOOP。

已用独立的本机测试目录验证：空白配置返回缺项状态、合成配置可被 Node 正确读取、重复运行不改变文件或加密键、生成文件的 ACL 不继承外部访问权限。测试没有使用真实 WHOOP 凭据，也没有创建本项目的正式 `.env`。

更完整的数据边界、华为与 Health Connect 的区别见 [WHOOP-SYNC.md](WHOOP-SYNC.md)。当前没有自动公网部署、设备端直连连续心率或已经完成本人授权的承诺。
