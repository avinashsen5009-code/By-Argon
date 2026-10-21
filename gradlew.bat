@rem Gradle wrapper launcher for Windows
@echo off
set DIR=%~dp0

where gradle >nul 2>nul
if %ERRORLEVEL% equ 0 (
  gradle %*
  exit /b %ERRORLEVEL%
)

if exist "%DIR%gradle\wrapper\gradle-wrapper.jar" (
  java -jar "%DIR%gradle\wrapper\gradle-wrapper.jar" %*
  exit /b %ERRORLEVEL%
)

echo Error: 'gradle' command not found on PATH.
echo Please install Gradle (https://gradle.org/install/), add it to PATH, or open the 'android' folder in Android Studio.
exit /b 1
