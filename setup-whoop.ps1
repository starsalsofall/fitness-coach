[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [switch]$NoWrite,
    [string]$CheckFile
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$configPath = Join-Path $projectRoot '.env'
$privatePrefix = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'private')) + [System.IO.Path]::DirectorySeparatorChar

if ($CheckOnly -and $NoWrite) { throw 'CheckOnly 和 NoWrite 不能同时使用。' }
if ($CheckFile) {
    if (-not $CheckOnly) { throw 'CheckFile 仅能用于只读检查。' }
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $CheckFile))
    if ($candidate -ne $configPath -and -not $candidate.StartsWith($privatePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw '检查文件必须位于本项目 .env 或 private 目录内。'
    }
    $configPath = $candidate
}

function Read-EnvSettings([string]$Path) {
    $result = @{}
    $duplicates = @()
    foreach ($line in [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)) {
        if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $name = $Matches[1]
            $value = $Matches[2].Trim()
            if ($result.ContainsKey($name)) { $duplicates += $name }
            if ($value.Length -ge 2 -and $value[0] -eq $value[$value.Length - 1] -and ([int]$value[0] -in @(34, 39, 96))) {
                $value = $value.Substring(1, $value.Length - 2)
            } else {
                $value = ($value -split '#', 2)[0].Trim()
            }
            $result[$name] = $value
        }
    }
    return @{ Values = $result; Duplicates = $duplicates }
}

function Test-Settings([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Write-Host '未发现配置文件；没有创建文件，也没有调用 WHOOP。'; return $false }
    $parsed = Read-EnvSettings $Path
    $values = $parsed.Values
    $problems = @()
    foreach ($field in @('HOST', 'PORT', 'WHOOP_CLIENT_ID', 'WHOOP_CLIENT_SECRET', 'WHOOP_REDIRECT_URI', 'TOKEN_ENCRYPTION_KEY', 'PAIR_TOKEN')) {
        if (-not $values.ContainsKey($field) -or [string]::IsNullOrWhiteSpace($values[$field])) { $problems += "$field 未填写" }
    }
    if ($parsed.Duplicates.Count -gt 0) { $problems += ('存在重复字段：' + (($parsed.Duplicates | Select-Object -Unique) -join ', ')) }
    if ($values.ContainsKey('HOST') -and $values.HOST -notin @('127.0.0.1', 'localhost', '::1')) { $problems += 'HOST 应先只监听本机（127.0.0.1）。' }
    $portNumber = 0
    if ($values.ContainsKey('PORT') -and (-not [int]::TryParse($values.PORT, [ref]$portNumber) -or $portNumber -lt 1 -or $portNumber -gt 65535)) { $problems += 'PORT 无效' }
    if ($values.ContainsKey('TOKEN_ENCRYPTION_KEY') -and $values.TOKEN_ENCRYPTION_KEY -notmatch '^[0-9a-fA-F]{64}$') { $problems += 'TOKEN_ENCRYPTION_KEY 应为 64 位十六进制值；不要重新生成已有令牌使用的键。' }
    if ($values.ContainsKey('PAIR_TOKEN') -and $values.PAIR_TOKEN.Length -lt 32) { $problems += 'PAIR_TOKEN 至少需要 32 个字符。' }
    if ($values.ContainsKey('TOKEN_ENCRYPTION_KEY') -and $values.ContainsKey('PAIR_TOKEN') -and $values.TOKEN_ENCRYPTION_KEY -eq $values.PAIR_TOKEN) { $problems += '加密键和个人连接密钥必须不同。' }
    if ($values.ContainsKey('WHOOP_REDIRECT_URI')) {
        $uri = $null
        if (-not [System.Uri]::TryCreate($values.WHOOP_REDIRECT_URI, [System.UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https' -or $uri.AbsolutePath -ne '/oauth/callback' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.Host -match 'YOUR-DOMAIN|example\.(com|org|net)$') { $problems += 'WHOOP_REDIRECT_URI 应为实际 HTTPS 服务的 /oauth/callback 地址。' }
    }
    if ($problems.Count -gt 0) {
        Write-Host '配置检查尚未通过（不显示任何密钥内容）：'
        foreach ($problem in $problems) { Write-Host ('- ' + $problem) }
        return $false
    }
    Write-Host '本地字段检查通过。未联网、未授权，也没有证明真实同步成功。'
    return $true
}

function ConvertTo-EnvValue([string]$Value) {
    if ($Value.IndexOfAny([char[]]@([char]0, [char]10, [char]13)) -ge 0) { throw '输入不能包含换行或空字符。' }
    # Node dotenv does not interpolate single/backtick-quoted values. Avoid changing credential bytes.
    foreach ($quoteCode in @(39, 96, 34)) {
        $quote = [string][char]$quoteCode
        if (-not $Value.Contains($quote) -and -not ($quoteCode -eq 34 -and $Value.Contains('\'))) { return $quote + $Value + $quote }
    }
    throw '凭据含有无法安全写入单行 dotenv 的引号组合；未写入配置。请在本机编辑器手动配置。'
}

function New-RandomHex {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

if ($NoWrite) {
    Write-Host '本地演练：不提示输入凭据、不生成密钥、不写文件、不联网、不启动服务。'
    Write-Host '正式向导只会在项目根目录首次创建 .env；已存在时绝不覆盖。'
    Write-Host '配置将保持 HOST=127.0.0.1；服务器 HTTPS 部署与本人 WHOOP 授权仍需另外完成。'
    if (Test-Path -LiteralPath $configPath) { Write-Host '已发现现有配置，正式运行也只会检查，不会修改。' }
    return
}

if ($CheckOnly) { if (Test-Settings $configPath) { exit 0 } else { exit 2 } }

if (Test-Path -LiteralPath $configPath) {
    Write-Host '已存在 .env。为保留现有配置与令牌加密键，本向导不会覆盖、补写或轮换任何值。'
    $null = Test-Settings $configPath
    Write-Host '需要调整时，请仅在本机编辑器中修改相应字段，并保留已有 TOKEN_ENCRYPTION_KEY。'
    return
}

$knownTokenPath = Join-Path $projectRoot 'private/whoop-token.enc'
if ((Test-Path -LiteralPath $knownTokenPath) -or (Test-Path -LiteralPath ($knownTokenPath + '.tmp'))) {
    throw '发现已有 WHOOP 加密令牌但缺少 .env。请先恢复原配置和原 TOKEN_ENCRYPTION_KEY；向导不会生成替代加密键。'
}

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) { throw '此向导面向 Windows PowerShell；其他环境请按 WHOOP-SETUP.md 手动配置。' }
Write-Host '此向导只准备本机配置，不会部署公网服务或调用 WHOOP。'
Write-Host '请先在 WHOOP 开发者后台创建个人应用，并准备之后要使用的 HTTPS 服务地址。'
$baseInput = (Read-Host 'HTTPS 服务根地址（例如 https://fitness.your-domain.cn，不含路径）').Trim().TrimEnd('/')
$baseUri = $null
if (-not [System.Uri]::TryCreate($baseInput, [System.UriKind]::Absolute, [ref]$baseUri) -or $baseUri.Scheme -ne 'https' -or $baseUri.AbsolutePath -ne '/' -or $baseUri.UserInfo -or $baseUri.Query -or $baseUri.Fragment -or $baseUri.Host -match 'YOUR-DOMAIN|example\.(com|org|net)$') { throw '请填写实际 HTTPS 服务根地址。没有写入文件。' }
$clientId = (Read-Host 'WHOOP Client ID（不是账号密码）').Trim()
if ([string]::IsNullOrWhiteSpace($clientId)) { throw 'Client ID 不能为空。没有写入文件。' }
$secureSecret = Read-Host 'WHOOP Client Secret（安全输入，不回显）' -AsSecureString
$secretPointer = [System.IntPtr]::Zero
$clientSecret = $null
$text = $null
$stream = $null
try {
    $secretPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
    $clientSecret = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    if ([string]::IsNullOrWhiteSpace($clientSecret) -or $clientSecret -ne $clientSecret.Trim()) { throw 'Client Secret 为空或首尾有空白。没有写入文件。' }
    $redirect = $baseInput + '/oauth/callback'
    $idValue = ConvertTo-EnvValue $clientId
    $secretValue = ConvertTo-EnvValue $clientSecret
    $redirectValue = ConvertTo-EnvValue $redirect
    $encryptionKey = New-RandomHex
    do { $pairToken = New-RandomHex } while ($pairToken -eq $encryptionKey)
    $text = @(
        '# Local personal WHOOP configuration. Never commit or paste into chat.'
        'HOST=127.0.0.1'
        'PORT=8787'
        ('WHOOP_CLIENT_ID=' + $idValue)
        ('WHOOP_CLIENT_SECRET=' + $secretValue)
        ('WHOOP_REDIRECT_URI=' + $redirectValue)
        ('TOKEN_ENCRYPTION_KEY=' + $encryptionKey)
        ('PAIR_TOKEN=' + $pairToken)
        'APP_ORIGIN='
        ''
    ) -join [System.Environment]::NewLine
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($identity.User, 'FullControl', 'Allow')))
    $systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($systemSid, 'FullControl', 'Allow')))
    # CreateNew and the restricted ACL are applied atomically at file creation.
    # This Windows PowerShell 5.1 constructor avoids both overwrite races and a
    # separate ACL update requiring WRITE_DAC on an already-open write handle.
    $stream = [System.IO.FileStream]::new($configPath, [System.IO.FileMode]::CreateNew, [System.Security.AccessControl.FileSystemRights]::Write, [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::None, $acl)
    $encoding = New-Object System.Text.UTF8Encoding($false)
    $bytesToWrite = $encoding.GetBytes($text)
    $stream.Write($bytesToWrite, 0, $bytesToWrite.Length)
    $stream.Flush()
    Write-Host '.env 已创建；文件只允许当前用户和 SYSTEM 访问。密钥没有打印，也没有发送到网络。'
    Write-Host ('请在 WHOOP 后台登记这个回调地址：' + $redirect)
    Write-Host 'HTTPS 服务部署好以后，在手机填写服务根地址与 .env 中的 PAIR_TOKEN；不要填写 Client Secret 或加密键。'
    Write-Host '本人 OAuth 授权后才能测试真实同步。现有服务进程需要手动重启才会读取新配置。'
} finally {
    if ($stream) { $stream.Dispose() }
    if ($secretPointer -ne [System.IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
    if ($secureSecret) { $secureSecret.Dispose() }
    $clientSecret = $null; $secretValue = $null; $text = $null; $bytesToWrite = $null; $encryptionKey = $null; $pairToken = $null
}
