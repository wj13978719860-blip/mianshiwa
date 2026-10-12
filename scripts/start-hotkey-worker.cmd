@echo off
setlocal
for %%I in ("%~dp0..") do set "PROJECT_ROOT=%%~fI"
if not defined JAVA_HOME set "JAVA_HOME=C:\Program Files\Java\jdk1.8.0_341"
set "WORKER_JAR=%PROJECT_ROOT%\.runtime\hotkey\worker-0.0.4-SNAPSHOT.jar"
if not exist "%WORKER_JAR%" (
  echo Official HotKey worker JAR is not prepared.
  exit /b 1
)
cd /d "%PROJECT_ROOT%\.runtime\hotkey"
"%JAVA_HOME%\bin\java.exe" -Dfile.encoding=UTF-8 -Xms128m -Xmx256m -jar "%WORKER_JAR%" --server.address=127.0.0.1 --server.port=8082 --netty.port=11113 --local.address=127.0.0.1 --etcd.server=http://127.0.0.1:2379 --etcd.workerPath=mianshiya
exit /b %ERRORLEVEL%
