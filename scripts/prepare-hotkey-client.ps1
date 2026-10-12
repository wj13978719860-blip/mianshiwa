param(
    [string]$JavaHome = 'C:\Program Files\Java\jdk1.8.0_341',
    [string]$MavenHome = 'D:\devEnviroment\apache-maven-3.9.4'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$sourceRoot = Join-Path $projectRoot '.runtime\hotkey-src'
$expectedCommit = 'f1c81819c7dcc7cf3421f556698e0fbebd244641'
if (!(Test-Path -LiteralPath "$JavaHome\bin\java.exe")) { throw 'Provide JDK 8 using -JavaHome.' }
if (!(Test-Path -LiteralPath "$MavenHome\bin\mvn.cmd")) { throw 'Provide Maven using -MavenHome.' }
if (!(Test-Path -LiteralPath $sourceRoot)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $sourceRoot -Parent) | Out-Null
    & git clone --branch master-v0.0.4 https://gitee.com/jd-platform-opensource/hotkey.git $sourceRoot
    if ($LASTEXITCODE -ne 0) { throw 'HotKey source download failed.' }
    & git -C $sourceRoot checkout --detach $expectedCommit
    if ($LASTEXITCODE -ne 0) { throw 'Unable to select the pinned HotKey source.' }
}
$actualCommit = & git -C $sourceRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $actualCommit.Trim() -ne $expectedCommit) { throw 'Existing HotKey source does not match the pinned commit.' }
$env:JAVA_HOME = $JavaHome
$env:PATH = "$JavaHome\bin;$env:PATH"
Push-Location $sourceRoot
try {
    & "$MavenHome\bin\mvn.cmd" -B -ntp '-Dmaven.test.skip=true' -pl common,client -am package
    if ($LASTEXITCODE -ne 0) { throw 'HotKey client build failed.' }
} finally { Pop-Location }
$destination = Join-Path $projectRoot 'mianshiya-next-backend\lib'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'client\target\hotkey-client-0.0.4-SNAPSHOT.jar') -Destination $destination
Write-Output 'Prepared the official HotKey client dependency.'
