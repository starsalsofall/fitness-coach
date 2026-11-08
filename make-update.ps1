$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$signingKey = Join-Path $projectRoot 'private/signing/personal-debug.keystore'
if (-not (Test-Path -LiteralPath $signingKey)) {
    throw 'The existing personal signing key is required. Restore private/signing/personal-debug.keystore; do not generate a different key for an update.'
}
$packageInfo = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($packageInfo.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Use a numeric project version, e.g. 0.2.0.' }
Push-Location $projectRoot
try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot 'build-android.ps1') -Check
    if ($LASTEXITCODE -ne 0) { throw 'Build or Android lint failed; no update package was published.' }
    $builtApk = Join-Path $projectRoot 'android/app/build/outputs/apk/debug/app-debug.apk'
    & node (Join-Path $projectRoot 'test/verify-apk.mjs') $builtApk
    if ($LASTEXITCODE -ne 0) { throw 'Signing, version or packaged asset verification failed; no update package was published.' }
    $artifactRoot = Join-Path $projectRoot 'artifacts'
    New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
    $updateApk = Join-Path $artifactRoot ('daily-motion-' + $packageInfo.version + '-debug.apk')
    Copy-Item -LiteralPath $builtApk -Destination $updateApk -Force
    Write-Output ('Update APK: ' + $updateApk)
    Write-Output ('SHA256: ' + (Get-FileHash -LiteralPath $updateApk -Algorithm SHA256).Hash.ToLowerInvariant())
}
finally { Pop-Location }
