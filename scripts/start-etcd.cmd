@echo off
setlocal
for %%I in ("%~dp0..") do set "PROJECT_ROOT=%%~fI"
set "ETCD_HOME=%PROJECT_ROOT%\.runtime\tools\etcd-v3.5.15-windows-amd64"
if not exist "%ETCD_HOME%\etcd.exe" (
  echo Official etcd 3.5.15 Windows binaries are not prepared.
  exit /b 1
)
"%ETCD_HOME%\etcd.exe" --name mianshiya --data-dir "%PROJECT_ROOT%\.runtime\etcd-host" --listen-client-urls http://127.0.0.1:2379 --advertise-client-urls http://127.0.0.1:2379 --listen-peer-urls http://127.0.0.1:2380 --initial-advertise-peer-urls http://127.0.0.1:2380 --initial-cluster mianshiya=http://127.0.0.1:2380
exit /b %ERRORLEVEL%
