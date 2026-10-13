# 阶段 0 验收入口；依赖及数据库配置与已运行的 AI 服务隔离。
param([switch]$Prepare, [switch]$MySql, [switch]$Elasticsearch)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$pythonExe = Join-Path $root '.runtime\ai-workflow-venv\Scripts\python.exe'
if ($Prepare -or !(Test-Path -LiteralPath $pythonExe)) {
    # 单独的虚拟环境不改变 .runtime/ai-venv，也不重启当前服务。
    if (!(Test-Path -LiteralPath $pythonExe)) {
        & uv venv --python 3.11 (Join-Path $root '.runtime\ai-workflow-venv')
        if ($LASTEXITCODE -ne 0) { throw 'Creating workflow environment failed.' }
    }
    & uv pip sync --require-hashes --python $pythonExe (Join-Path $root 'mianshiya-ai-service\requirements-workflow.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Installing workflow dependencies failed.' }
}
# 本文件只存于忽略目录；不要将密码放进命令行参数或提交到 Git。
$privateFile = Join-Path $root '.runtime\ai-foundation.env'
$savedEnvironment = @{}
$managedKeys = @('PYTHONPATH', 'PYTHONIOENCODING', 'AI_MYSQL_INTEGRATION', 'AI_ES_INTEGRATION')
try {
    if (Test-Path -LiteralPath $privateFile) {
        foreach ($line in Get-Content -LiteralPath $privateFile -Encoding UTF8) {
            if ($line -match '^((?:AI_MYSQL_|AI_ES_)[A-Z_]+)=(.*)$') {
                $key = $Matches[1]
                if (!$savedEnvironment.ContainsKey($key)) {
                    $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
                }
                if (![Environment]::GetEnvironmentVariable($key, 'Process')) {
                    [Environment]::SetEnvironmentVariable($key, $Matches[2], 'Process')
                }
            }
        }
    }
    foreach ($key in $managedKeys) {
        if (!$savedEnvironment.ContainsKey($key)) {
            $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        }
    }
    $env:PYTHONPATH = Join-Path $root 'mianshiya-ai-service'
    $env:PYTHONIOENCODING = 'utf-8'
    # 默认只运行无外部依赖的测试，真实连接必须明确选择开关。
    $env:AI_MYSQL_INTEGRATION = $MySql.IsPresent.ToString().ToLowerInvariant()
    $env:AI_ES_INTEGRATION = $Elasticsearch.IsPresent.ToString().ToLowerInvariant()
    & $pythonExe -m pytest (Join-Path $root 'mianshiya-ai-service\tests') -q -p no:cacheprovider
    if ($LASTEXITCODE -ne 0) { throw 'AI foundation acceptance failed.' }
} finally {
    # 验收后恢复当前 PowerShell 环境，避免测试开关影响后续启动命令。
    foreach ($key in $savedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($key, $savedEnvironment[$key], 'Process')
    }
}
