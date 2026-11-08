$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$artifactRoot = Join-Path $projectRoot 'artifacts'
$stagingRoot = Join-Path $projectRoot ('private/source-package-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $artifactRoot, $stagingRoot | Out-Null
$skipDirectories = @('build', '.gradle', '.git', 'node_modules', 'private', 'artifacts')
function Copy-SourceTree([string]$Source, [string]$Destination) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    foreach ($entry in Get-ChildItem -LiteralPath $Source -Force) {
        if ($entry.PSIsContainer) {
            if ($entry.Name -notin $skipDirectories) { Copy-SourceTree $entry.FullName (Join-Path $Destination $entry.Name) }
        } elseif ($entry.Name -ne 'local.properties' -and $entry.Name -ne '.env' -and $entry.Extension -notin @('.keystore', '.jks', '.lock')) {
            Copy-Item -LiteralPath $entry.FullName -Destination (Join-Path $Destination $entry.Name)
        }
    }
}
foreach ($directory in @('android', 'web', 'test', '.github')) { Copy-SourceTree (Join-Path $projectRoot $directory) (Join-Path $stagingRoot $directory) }
$rootFiles = @('.env.example','.gitignore','AGENTS.md','package.json','package-lock.json','server.mjs','whoop.mjs','README.md','RESEARCH.md','VALIDATION.md','APP-REVIEW.md','V1-REQUIREMENTS.md','WHOOP-SYNC.md','WHOOP-SETUP.md','PROJECT-TREE.md','PROJECT-STATUS.md','INSTALL-ANDROID.md','CHANGELOG.md','UPDATE.md','WEEKLY-PLAN.md','build-android.ps1','make-update.ps1','setup-whoop.ps1','start-preview.cmd','package-source.ps1')
foreach ($name in $rootFiles) { Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination (Join-Path $stagingRoot $name) }
$archivePath = Join-Path $artifactRoot 'daily-motion-source.zip'
Compress-Archive -Path (Join-Path $stagingRoot '*') -DestinationPath $archivePath -Force
Write-Output $archivePath
Write-Output ('SHA256 ' + (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant())
