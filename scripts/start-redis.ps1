param([string]$RedisHome = 'D:\devEnviroment\Redis-x64-3.0.504')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$dataRoot = Join-Path $projectRoot '.runtime\redis'
$redisPath = Join-Path $RedisHome 'redis-server.exe'
if (!(Test-Path -LiteralPath $redisPath)) { throw "Redis not found: $redisPath" }
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
# Use only project-local data; do not load the installed Redis dump or service config.
& $redisPath --bind 127.0.0.1 --port 6379 --dir $dataRoot --appendonly yes
