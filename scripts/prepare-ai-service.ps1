# 准备独立 Python 环境，不修改系统 Python 或其他项目依赖。
# 默认安装运行依赖；-Dev 额外安装 pytest/httpx 等测试工具。
param([string]$Python = '3.11', [switch]$Dev)
$ErrorActionPreference = 'Stop'
# 根据脚本位置找到项目根目录，因此从其他工作目录执行也能找到依赖文件。
$root = Split-Path $PSScriptRoot -Parent
$pythonExe = Join-Path $root '.runtime\ai-venv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $pythonExe)) {
    # 虚拟环境存放在忽略目录 .runtime 中，不随源码提交。
    & uv venv --python $Python (Join-Path $root '.runtime\ai-venv')
    if ($LASTEXITCODE -ne 0) { throw 'Creating AI environment failed. Install Python 3.11 or use uv python install 3.11.' }
}
# sync 会使环境与锁文件完全一致；从 Dev 切回运行依赖时会移除测试工具。
# require-hashes 校验下载包是否与锁文件记录一致。
$lockFile = if ($Dev) { 'requirements-dev.txt' } else { 'requirements.txt' }
& uv pip sync --require-hashes --python $pythonExe (Join-Path $root "mianshiya-ai-service\$lockFile")
if ($LASTEXITCODE -ne 0) { throw 'AI dependency installation failed.' }
