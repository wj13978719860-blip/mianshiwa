param([string]$LocalJar = 'D:\devEnviroment\sentinel-dashboard-1.8.6\sentinel-dashboard.jar')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$targetJar = Join-Path $projectRoot 'docker\sentinel\sentinel-dashboard.jar'
if (Test-Path -LiteralPath $LocalJar) {
    Copy-Item -LiteralPath $LocalJar -Destination $targetJar
} else {
    Invoke-WebRequest 'https://github.com/alibaba/Sentinel/releases/download/1.8.6/sentinel-dashboard-1.8.6.jar' -OutFile $targetJar
}
Write-Output "Prepared: $targetJar"
