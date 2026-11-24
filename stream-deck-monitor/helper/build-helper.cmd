@echo off
rem Builds SensorHelper.exe with the C# compiler of the .NET Framework that ships with Windows,
rem and copies LibreHardwareMonitorLib + dependencies (helper\lib, see tools\fetch-lhm.mjs) next to it.
setlocal
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo [error] csc.exe of .NET Framework 4 not found.
  exit /b 1
)
set OUT=%~dp0..\dev.sdmonitor.sdPlugin\bin
if not exist "%OUT%" mkdir "%OUT%"
if not exist "%~dp0lib\LibreHardwareMonitorLib.dll" (
  echo Downloading LibreHardwareMonitorLib...
  node "%~dp0..\tools\fetch-lhm.mjs"
  if errorlevel 1 exit /b 1
)
copy /y "%~dp0lib\*.dll" "%OUT%\" >nul
"%CSC%" /nologo /target:exe /platform:x64 /optimize+ /out:"%OUT%\SensorHelper.exe" /r:"%~dp0lib\LibreHardwareMonitorLib.dll" "%~dp0SensorHelper.cs"
if errorlevel 1 exit /b 1
copy /y "%~dp0..\LICENSE-THIRD-PARTY.txt" "%OUT%\" >nul
echo SensorHelper.exe built in %OUT%
