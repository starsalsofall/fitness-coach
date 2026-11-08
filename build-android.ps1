$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$toolRoot = Join-Path $projectRoot 'private/tooling'
$androidRoot = Join-Path $projectRoot 'android'
$gradleVersion = '8.11.1'
# Pinned against the official Gradle release-checksums page, 2026-11-08.
$gradleSha256 = 'f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6'
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null

function Invoke-NativeChecked {
    param([string]$Executable, [string[]]$Arguments, [string]$FailureMessage)
    $previousPreference = $ErrorActionPreference
    $nativeExit = $null
    try {
        # Windows PowerShell 5.1 can turn native stderr warnings into error records.
        # Keep output visible, and determine success from the actual process exit code.
        $ErrorActionPreference = 'Continue'
        & $Executable @Arguments 2>&1 | ForEach-Object {
            $outputText = $_.ToString()
            # The JVM echoes these environment variables, which may contain user secrets.
            # Acknowledge their use without copying their contents into build logs.
            if ($outputText -match 'Picked up (JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS):') { Write-Output 'Java environment options applied (contents hidden).' }
            else { Write-Output $_ }
        }
        $nativeExit = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousPreference }
    if ($null -eq $nativeExit -or $nativeExit -ne 0) {
        throw "$FailureMessage Exit code: $nativeExit"
    }
}

function Get-BuildProxy {
    param([string]$Value, [string]$VariableName)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    $proxyUri = $null
    if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$proxyUri)) {
        Write-Warning "$VariableName is not a supported proxy URL; configure the proxy manually."
        return $null
    }
    if (-not [string]::IsNullOrEmpty($proxyUri.UserInfo)) {
        Write-Warning "Authenticated $VariableName proxies are not handled. No credentials were copied; configure Gradle authentication manually."
        return $null
    }
    if ($proxyUri.Scheme -ne 'http' -or [string]::IsNullOrEmpty($proxyUri.Host) -or $proxyUri.Port -lt 1) {
        Write-Warning "$VariableName requires an HTTP proxy endpoint (http://host:port). Other proxy transports require manual configuration."
        return $null
    }
    return [pscustomobject]@{ Host = $proxyUri.DnsSafeHost; Port = $proxyUri.Port; Url = $proxyUri.AbsoluteUri }
}

# Respect a usable JAVA_HOME, then discover this project's portable JDK, then PATH.
$jdkCandidates = @()
if ($env:JAVA_HOME) { $jdkCandidates += $env:JAVA_HOME }
$jdkCandidates += @(Get-ChildItem -LiteralPath $toolRoot -Directory -Filter 'jdk-*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | ForEach-Object { $_.FullName })
$pathJava = Get-Command java.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pathJava -and $pathJava.Source) { $jdkCandidates += (Split-Path -Parent (Split-Path -Parent $pathJava.Source)) }
$buildJdkRoot = $null
foreach ($candidate in $jdkCandidates) {
    if ((Test-Path -LiteralPath (Join-Path $candidate 'bin/java.exe')) -and (Test-Path -LiteralPath (Join-Path $candidate 'bin/javac.exe'))) {
        $buildJdkRoot = (Resolve-Path -LiteralPath $candidate).Path
        break
    }
}
if (-not $buildJdkRoot) { throw 'JDK 17 is required. Set JAVA_HOME or extract a JDK into private/tooling/jdk-*.' }

# local.properties takes precedence in AGP, so do not silently ignore its sdk.dir.
$localProperties = Join-Path $androidRoot 'local.properties'
$localSdk = $null
if (Test-Path -LiteralPath $localProperties) {
    $sdkLine = Get-Content -LiteralPath $localProperties -Encoding UTF8 | Where-Object { $_ -match '^\s*sdk\.dir\s*[:=]' } | Select-Object -Last 1
    if ($sdkLine) {
        $localSdk = ($sdkLine -replace '^\s*sdk\.dir\s*[:=]\s*', '').Trim().Replace('\:', ':').Replace('\\', '\').Replace('\ ', ' ')
        if (-not [IO.Path]::IsPathRooted($localSdk)) { $localSdk = Join-Path $androidRoot $localSdk }
    }
}
$buildSdkRoot = $localSdk
if (-not $buildSdkRoot) {
    foreach ($candidate in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $toolRoot 'android-sdk'))) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Container)) { $buildSdkRoot = $candidate; break }
    }
}
if (-not $buildSdkRoot -or -not (Test-Path -LiteralPath (Join-Path $buildSdkRoot 'platforms/android-35/android.jar'))) {
    throw 'Android SDK Platform 35 is required. Check android/local.properties, ANDROID_HOME or private/tooling/android-sdk.'
}
if (-not (Test-Path -LiteralPath (Join-Path $buildSdkRoot 'build-tools/35.0.0/aapt2.exe'))) { throw 'Android SDK Build Tools 35.0.0 are required in the selected SDK.' }
$buildSdkRoot = (Resolve-Path -LiteralPath $buildSdkRoot).Path

$httpBuildProxy = Get-BuildProxy -Value $env:HTTP_PROXY -VariableName 'HTTP_PROXY'
$httpsBuildProxy = Get-BuildProxy -Value $env:HTTPS_PROXY -VariableName 'HTTPS_PROXY'
if (-not $httpsBuildProxy) { $httpsBuildProxy = $httpBuildProxy }
if (-not $httpBuildProxy) { $httpBuildProxy = $httpsBuildProxy }
$proxyArguments = @()
if ($httpBuildProxy) { $proxyArguments += @("-Dhttp.proxyHost=$($httpBuildProxy.Host)", "-Dhttp.proxyPort=$($httpBuildProxy.Port)") }
if ($httpsBuildProxy) { $proxyArguments += @("-Dhttps.proxyHost=$($httpsBuildProxy.Host)", "-Dhttps.proxyPort=$($httpsBuildProxy.Port)") }

# Reuse installed portable Gradle so a newly added wrapper does not download it again.
# Otherwise use a complete wrapper only with an official URL and a pinned SHA-256.
$wrapperExe = Join-Path $androidRoot 'gradlew.bat'
$wrapperJar = Join-Path $androidRoot 'gradle/wrapper/gradle-wrapper.jar'
$wrapperProperties = Join-Path $androidRoot 'gradle/wrapper/gradle-wrapper.properties'
$portableGradleExe = Join-Path $toolRoot "gradle-$gradleVersion/bin/gradle.bat"
$gradleExe = $null
if (Test-Path -LiteralPath $portableGradleExe) { $gradleExe = $portableGradleExe }
if (-not $gradleExe -and (Test-Path -LiteralPath $wrapperExe) -and (Test-Path -LiteralPath $wrapperJar) -and (Test-Path -LiteralPath $wrapperProperties)) {
    $properties = Get-Content -LiteralPath $wrapperProperties -Encoding UTF8
    $shaLine = $properties | Where-Object { $_ -match '^\s*distributionSha256Sum\s*=' } | Select-Object -Last 1
    $urlLine = $properties | Where-Object { $_ -match '^\s*distributionUrl\s*=' } | Select-Object -Last 1
    $pinnedHash = ($shaLine -replace '^\s*distributionSha256Sum\s*=\s*', '').Trim()
    $distributionUrl = ($urlLine -replace '^\s*distributionUrl\s*=\s*', '').Trim().Replace('\:', ':')
    if ($pinnedHash -match '^[a-fA-F0-9]{64}$' -and $distributionUrl -match '^https://(services|downloads)\.gradle\.org/distributions/gradle-[0-9][0-9A-Za-z.\-]*-bin\.zip$') { $gradleExe = $wrapperExe }
    else { Write-Warning 'The wrapper is not SHA-256 pinned to an official distribution; checking portable Gradle instead.' }
}
if (-not $gradleExe) {
    $gradleExe = $portableGradleExe
    if (-not (Test-Path -LiteralPath $gradleExe)) {
        $archive = Join-Path $toolRoot "gradle-$gradleVersion-bin.zip"
        $archiveValid = (Test-Path -LiteralPath $archive) -and ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -eq $gradleSha256)
        if (-not $archiveValid) {
            $downloadOptions = @{ UseBasicParsing = $true; ErrorAction = 'Stop' }
            if ($httpsBuildProxy) { $downloadOptions.Proxy = $httpsBuildProxy.Url }
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest @downloadOptions -Uri "https://downloads.gradle.org/distributions/gradle-$gradleVersion-bin.zip" -OutFile $archive
            if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $gradleSha256) { throw 'Gradle SHA-256 verification failed. The archive was not extracted or executed.' }
        }
        Expand-Archive -LiteralPath $archive -DestinationPath $toolRoot -Force
    }
}

$buildAndroidUser = Join-Path $toolRoot 'android-user'
$buildJavaUser = Join-Path $toolRoot 'java-home'
$buildGradleUser = Join-Path $toolRoot 'gradle-cache'
New-Item -ItemType Directory -Force -Path $buildAndroidUser, $buildGradleUser, $buildJavaUser, (Join-Path $buildJavaUser '.android') | Out-Null
$savedEnvironment = @{}
foreach ($name in @('JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'ANDROID_USER_HOME', 'ANDROID_SDK_HOME', 'ANDROID_PREFS_ROOT', 'GRADLE_USER_HOME', 'JAVA_TOOL_OPTIONS', 'DEBUG')) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:JAVA_HOME = $buildJdkRoot
    $env:DEBUG = $null
    $env:ANDROID_HOME = $buildSdkRoot
    $env:ANDROID_SDK_ROOT = $buildSdkRoot
    $env:ANDROID_USER_HOME = $buildAndroidUser
    # AGP rejects multiple preference variables that resolve to different folders.
    # Modern tools use ANDROID_USER_HOME; legacy analytics follows Java user.home.
    $env:ANDROID_SDK_HOME = $null
    $env:ANDROID_PREFS_ROOT = $null
    $scopedJavaOptions = '-Duser.home="' + $buildJavaUser.Replace('\', '/') + '" -Dfile.encoding=UTF-8'
    $env:JAVA_TOOL_OPTIONS = (@($savedEnvironment['JAVA_TOOL_OPTIONS'], $scopedJavaOptions) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ' '
    $env:GRADLE_USER_HOME = $buildGradleUser

    # Personal test signing only. A custom path avoids AGP's default-keystore lock.
    # Never replace this key: updates need the same signer. Preserve an older key first.
    $signingRoot = Join-Path $projectRoot 'private/signing'
    $debugKeystore = Join-Path $signingRoot 'personal-debug.keystore'
    if (-not (Test-Path -LiteralPath $debugKeystore)) {
        New-Item -ItemType Directory -Force -Path $signingRoot | Out-Null
        $previousDebugKeystore = Join-Path $buildAndroidUser 'debug.keystore'
        if (Test-Path -LiteralPath $previousDebugKeystore) {
            # File.Copy with overwrite=false also preserves a key created by another process.
            try { [IO.File]::Copy($previousDebugKeystore, $debugKeystore, $false) }
            catch { if (-not (Test-Path -LiteralPath $debugKeystore)) { throw } }
        }
    }
    if (-not (Test-Path -LiteralPath $debugKeystore)) {
        $keytoolExe = Join-Path $buildJdkRoot 'bin/keytool.exe'
        if (-not (Test-Path -LiteralPath $keytoolExe)) {
            $keytoolCommand = Get-Command keytool.exe -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $keytoolCommand) { throw 'keytool is required to create the personal debug signing key.' }
            $keytoolExe = $keytoolCommand.Source
        }
        Invoke-NativeChecked -Executable $keytoolExe -Arguments @('-genkeypair', '-noprompt', '-keystore', $debugKeystore, '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey', '-dname', 'CN=Android Debug,O=Android,C=US', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000') -FailureMessage 'Debug signing key creation failed.'
    }
    Write-Host 'Building a personal test APK. Keep private/signing/personal-debug.keystore for future updates.'
    Push-Location $androidRoot
    try { Invoke-NativeChecked -Executable $gradleExe -Arguments (@('--no-daemon') + $proxyArguments + @('assembleDebug')) -FailureMessage 'Android APK build failed.' }
    finally { Pop-Location }
}
finally {
    foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
Write-Host (Join-Path $androidRoot 'app/build/outputs/apk/debug/app-debug.apk')
