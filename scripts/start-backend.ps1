param(
    [string]$JavaHome = 'C:\Program Files\Java\jdk1.8.0_341',
    [string]$MavenHome = 'D:\devEnviroment\apache-maven-3.9.4',
    [switch]$Build,
    [switch]$DisableNacos,
    # 只有显式传入此参数才启用独立 AI 服务调用；不传时保留原业务运行方式。
    [switch]$EnableAiService
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
if ($EnableAiService) {
    # 与 Python 读取同一个私有文件，保证服务名、注册空间、分组和凭证一致。
    $privateAiEnv = Join-Path $runtimeRoot 'ai-service.env'
    if (Test-Path -LiteralPath $privateAiEnv) {
        foreach ($line in Get-Content -LiteralPath $privateAiEnv) {
            if ($line -match '^(AI_SERVICE_TOKEN|AI_SERVICE_NAME|NACOS_SERVER_ADDR|NACOS_NAMESPACE|NACOS_GROUP|BACKEND_REGISTER_IP)=(.*)$') {
                if (![Environment]::GetEnvironmentVariable($Matches[1], 'Process')) {
                    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
                }
            }
        }
    }
}
Push-Location $backendRoot
try {
    if ($Build -or !(Test-Path -LiteralPath $jarPath)) {
        if (!(Test-Path -LiteralPath $mavenPath)) { throw "Maven not found: $mavenPath" }
        & $mavenPath -B -ntp '-DskipTests' package
        if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
    }
    # 命令行配置明确覆盖环境变量，避免上一轮启动留下 true 导致意外启用。
    $aiEnabled = $EnableAiService.IsPresent.ToString().ToLowerInvariant()
    $javaArguments = @('-Dfile.encoding=UTF-8', "-Dcsp.sentinel.log.dir=$runtimeRoot/sentinel", '-jar', $jarPath,
        "--ai.service.enabled=$aiEnabled")
    $privateConfig = Join-Path $runtimeRoot 'backend-private.yml'
    if (Test-Path -LiteralPath $privateConfig) {
        $javaArguments += "--spring.config.additional-location=file:$privateConfig"
    }
    if ($DisableNacos) { $javaArguments += '--nacos.config.bootstrap.enable=false' }
    & $javaPath @javaArguments
    if ($LASTEXITCODE -ne 0) { throw "Backend exited with code $LASTEXITCODE" }
} finally { Pop-Location }
