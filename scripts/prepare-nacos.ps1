param([string]$LocalJar = 'D:\devEnviroment\nacos\target\nacos-server.jar')
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $LocalJar)) { throw 'Provide a Nacos 2.5.2 server JAR using -LocalJar.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($LocalJar)
try {
    if (!$archive.GetEntry('BOOT-INF/lib/nacos-core-2.5.2.jar')) {
        throw 'The local fallback expects Nacos 2.5.2.'
    }
} finally { $archive.Dispose() }
$projectRoot = Split-Path $PSScriptRoot -Parent
$destination = Join-Path $projectRoot 'docker\nacos\nacos-server.jar'
Copy-Item -LiteralPath $LocalJar -Destination $destination
Write-Output "Prepared: $destination"
