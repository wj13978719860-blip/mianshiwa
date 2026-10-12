param(
    [string]$JavaHome = 'C:\Program Files\Java\jdk1.8.0_341',
    [string]$MavenHome = 'D:\devEnviroment\apache-maven-3.9.4',
    [switch]$Build,
    [switch]$DisableNacos
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$backendRoot = Join-Path $projectRoot 'mianshiya-next-backend'
$runtimeRoot = Join-Path $projectRoot '.runtime'
$javaPath = Join-Path $JavaHome 'bin\java.exe'
$mavenPath = Join-Path $MavenHome 'bin\mvn.cmd'
$jarPath = Join-Path $backendRoot 'target\mianshiya-next-backend-0.0.1-SNAPSHOT.jar'
if (!(Test-Path -LiteralPath $javaPath)) { throw "Java not found: $javaPath" }
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$env:JAVA_HOME = $JavaHome
$env:PATH = "$JavaHome\bin;$env:PATH"
Push-Location $backendRoot
try {
    if ($Build -or !(Test-Path -LiteralPath $jarPath)) {
        if (!(Test-Path -LiteralPath $mavenPath)) { throw "Maven not found: $mavenPath" }
        & $mavenPath -B -ntp '-DskipTests' package
        if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
    }
    $javaArguments = @('-Dfile.encoding=UTF-8', "-Dcsp.sentinel.log.dir=$runtimeRoot/sentinel", '-jar', $jarPath)
    $privateConfig = Join-Path $runtimeRoot 'backend-private.yml'
    if (Test-Path -LiteralPath $privateConfig) {
        $javaArguments += "--spring.config.additional-location=file:$privateConfig"
    }
    if ($DisableNacos) { $javaArguments += '--nacos.config.bootstrap.enable=false' }
    & $javaPath @javaArguments
    if ($LASTEXITCODE -ne 0) { throw "Backend exited with code $LASTEXITCODE" }
} finally { Pop-Location }
