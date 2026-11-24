@echo off
rem Builds AudioHelper.exe with the C# compiler of the .NET Framework that ships with Windows.
setlocal
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo [error] csc.exe of .NET Framework 4 not found.
  exit /b 1
)
set OUT=%~dp0..\dev.appmixer.volume.sdPlugin\bin
if not exist "%OUT%" mkdir "%OUT%"
"%CSC%" /nologo /target:exe /platform:anycpu /optimize+ /out:"%OUT%\AudioHelper.exe" /r:System.Drawing.dll "%~dp0AudioHelper.cs"
if errorlevel 1 exit /b 1
echo AudioHelper.exe built in %OUT%
