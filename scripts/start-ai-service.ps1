# 启动 Python AI 服务；-Prepare 表示启动前同步运行依赖。
param([switch]$Prepare)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$pythonExe = Join-Path $root '.runtime\ai-venv\Scripts\python.exe'
if ($Prepare -or !(Test-Path -LiteralPath $pythonExe)) { & "$PSScriptRoot\prepare-ai-service.ps1" }
# 从被 Git 忽略的文件加载内部凭证和 Nacos 参数，不将真实凭证写进源码。
$privateFile = Join-Path $root '.runtime\ai-service.env'
if (Test-Path -LiteralPath $privateFile) {
    foreach ($line in Get-Content -LiteralPath $privateFile) {
        if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$' -and !$line.StartsWith('#')) {
            # 只补充未设置的变量，调用者提前设置的环境变量优先。
            if (![Environment]::GetEnvironmentVariable($Matches[1], 'Process')) {
                [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
            }
        }
    }
}
# 使用 UTF-8 输出中文日志；切换目录以便 Python 能找到 app 包。
$env:PYTHONIOENCODING = 'utf-8'
Push-Location (Join-Path $root 'mianshiya-ai-service')
try {
    # -m app 执行 app/__main__.py；最终由 Uvicorn 运行 app/main.py 的应用。
    & $pythonExe -m app
    if ($LASTEXITCODE -ne 0) { throw "AI service exited with code $LASTEXITCODE" }
} finally { Pop-Location }
