param(
    [switch]$Build,
    [switch]$Dev,
    [switch]$Production
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$frontendRoot = Join-Path $projectRoot 'mianshiya-next-frontend'
Push-Location $frontendRoot
try {
    if (!(Test-Path -LiteralPath 'node_modules\next\package.json')) {
        & npm.cmd ci --cache "$projectRoot/.runtime/npm-cache" --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    }
    if ($Dev -and $Production) { throw 'Choose either Dev or Production.' }
    if (!$Production) {
        & npm.cmd run dev -- --hostname 127.0.0.1
    } else {
        if ($Build -or !(Test-Path -LiteralPath '.next\standalone\server.js') -or !(Test-Path -LiteralPath '.next\BUILD_ID')) {
            & npm.cmd run build
            if ($LASTEXITCODE -ne 0) { throw 'Frontend production build failed.' }
        }
        # Next.js standalone output requires static assets to be copied separately.
        if (Test-Path -LiteralPath '.next\static') {
            Copy-Item -LiteralPath '.next\static' -Destination '.next\standalone\.next' -Recurse -Force
        }
        if (Test-Path -LiteralPath 'public') {
            Copy-Item -LiteralPath 'public' -Destination '.next\standalone' -Recurse -Force
        }
        $env:NODE_ENV = 'production'
        $env:HOSTNAME = '127.0.0.1'
        $env:PORT = '3000'
        & node.exe '.next\standalone\server.js'
    }
    if ($LASTEXITCODE -ne 0) { throw "Frontend exited with code $LASTEXITCODE" }
} finally { Pop-Location }
