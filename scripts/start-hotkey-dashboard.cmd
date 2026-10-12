@echo off
setlocal
for %%I in ("%~dp0..") do set "PROJECT_ROOT=%%~fI"
if not defined JAVA_HOME set "JAVA_HOME=C:\Program Files\Java\jdk1.8.0_341"
set "DASHBOARD_JAR=%PROJECT_ROOT%\.runtime\hotkey\dashboard-0.0.2-SNAPSHOT.jar"
set "DASHBOARD_CONFIG=%PROJECT_ROOT%\.runtime\hotkey\dashboard-local.yml"
if not exist "%DASHBOARD_JAR%" (
  echo Official HotKey dashboard JAR is not prepared.
  exit /b 1
)
if not exist "%DASHBOARD_CONFIG%" (
  echo HotKey dashboard local database configuration is missing.
  exit /b 1
)
cd /d "%PROJECT_ROOT%\.runtime\hotkey"
"%JAVA_HOME%\bin\java.exe" -Dfile.encoding=UTF-8 -Xms128m -Xmx256m -jar "%DASHBOARD_JAR%" "--spring.config.additional-location=file:%DASHBOARD_CONFIG%" --server.address=127.0.0.1 --server.port=8081 --etcd.server=http://127.0.0.1:2379
exit /b %ERRORLEVEL%
