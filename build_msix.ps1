# PowerShell Build and Package Script for Starlink Windows Stats GUI
# Version: Starlink-Windows-Stats-v.0.0.1

$ErrorActionPreference = "Stop"

# Constants
$AppName = "starlink_stats"
$Version = "0.0.14"
$MsixName = "Starlink-Windows-Stats-v.${Version}.msix"
$PackageRootDir = "package_root"
$PfxPath = "StarlinkStatsCert.pfx"
$PfxPassword = "StarlinkPassword123"
$Publisher = "CN=StarlinkWindowsStatsPublisher"

# Windows SDK Tools Paths
$SdkBinPath = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64"
$MakeAppx = Join-Path $SdkBinPath "makeappx.exe"
$SignTool = Join-Path $SdkBinPath "signtool.exe"

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "Building Starlink Windows Stats GUI v${Version}" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# Step 1: Run PyInstaller to compile Python application
Write-Host "`n[Step 1/6] Compiling Python application with PyInstaller..." -ForegroundColor Green
$PythonExe = "C:\Users\Winter\AppData\Local\Programs\Python\Python311\python.exe"

if (-not (Test-Path $PythonExe)) {
    Write-Error "Python executable not found at $PythonExe"
}

# Clean old build/dist folders to avoid compilation conflicts and locked directories
if (Test-Path "build") { Remove-Item -Recurse -Force "build" -ErrorAction SilentlyContinue }
if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" -ErrorAction SilentlyContinue }

# Run PyInstaller
# We copy index.html, style.css, and app.js into the root directory of the build folder.
& $PythonExe -m PyInstaller --noconfirm --noconsole --name $AppName --clean `
    --add-data "src/index.html;." `
    --add-data "src/style.css;." `
    --add-data "src/app.js;." `
    src/main.py

if (-not (Test-Path "dist/$AppName")) {
    Write-Error "PyInstaller build failed. Output directory dist/$AppName not found."
}
Write-Host "Compilation complete." -ForegroundColor Gray

# Step 2: Prep package root directory
Write-Host "`n[Step 2/6] Preparing package root directory..." -ForegroundColor Green
if (Test-Path $PackageRootDir) {
    Remove-Item -Recurse -Force $PackageRootDir
}
New-Item -ItemType Directory -Path $PackageRootDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $PackageRootDir "Assets") | Out-Null

# Copy build files from dist/starlink_stats/*
Copy-Item -Path "dist/$AppName/*" -Destination $PackageRootDir -Recurse -Force

# Copy manifest
Copy-Item -Path "AppxManifest.xml" -Destination $PackageRootDir -Force

# Copy Assets (StoreLogo, SquareLogo, WideLogo etc.)
Copy-Item -Path "src/Assets/*" -Destination (Join-Path $PackageRootDir "Assets") -Force

Write-Host "Package root folder prepped successfully." -ForegroundColor Gray

# Step 3: Run makeappx.exe to package MSIX
Write-Host "`n[Step 3/6] Packaging folder into MSIX file..." -ForegroundColor Green
if (-not (Test-Path $MakeAppx)) {
    Write-Error "makeappx.exe not found at $MakeAppx. Make sure Windows 10/11 SDK is installed."
}

if (Test-Path $MsixName) {
    Remove-Item $MsixName -Force
}

# Call makeappx
& $MakeAppx pack /d $PackageRootDir /p $MsixName /o

if (-not (Test-Path $MsixName)) {
    Write-Error "MSIX packaging failed. File $MsixName not created."
}
Write-Host "MSIX file packaged: $MsixName" -ForegroundColor Gray

# Step 4: Create developer certificate if needed
Write-Host "`n[Step 4/6] Creating developer self-signed certificate..." -ForegroundColor Green

# Check if certificate already exists in current user personal store
$ExistingCerts = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $Publisher }

if ($ExistingCerts) {
    Write-Host "Using existing certificate for $Publisher" -ForegroundColor Gray
    $Cert = $ExistingCerts[0]
} else {
    Write-Host "Creating new self-signed certificate for $Publisher..." -ForegroundColor Gray
    $Cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher -KeyUsage DigitalSignature -FriendlyName "StarlinkStatsCert" -CertStoreLocation "Cert:\CurrentUser\My" -NotAfter (Get-Date).AddYears(5)
}

# Export certificate to PFX file
Write-Host "Exporting certificate to PFX format..." -ForegroundColor Gray
$SecurePassword = ConvertTo-SecureString -String $PfxPassword -Force -AsPlainText
Export-PfxCertificate -Cert $Cert -FilePath $PfxPath -Password $SecurePassword -Force | Out-Null

if (-not (Test-Path $PfxPath)) {
    Write-Error "PFX certificate export failed."
}
Write-Host "PFX certificate exported: $PfxPath" -ForegroundColor Gray

# Step 5: Sign the MSIX package
Write-Host "`n[Step 5/6] Digitally signing the MSIX package..." -ForegroundColor Green
if (-not (Test-Path $SignTool)) {
    Write-Error "signtool.exe not found at $SignTool."
}

# Call SignTool
& $SignTool sign /fd SHA256 /f $PfxPath /p $PfxPassword $MsixName

Write-Host "Package signed successfully." -ForegroundColor Gray

# Step 6: Cleanup temporary build directories
Write-Host "`n[Step 6/7] Cleaning up build directories..." -ForegroundColor Green
if (Test-Path $PackageRootDir) {
    Remove-Item -Recurse -Force $PackageRootDir
}
Write-Host "Cleanup complete." -ForegroundColor Gray

# Step 7: Compress portable standalone ZIP package
$ZipName = "Starlink-Windows-Stats-v.${Version}.zip"
Write-Host "`n[Step 7/7] Compressing portable standalone ZIP archive..." -ForegroundColor Green
if (Test-Path $ZipName) {
    Remove-Item -Force $ZipName -ErrorAction SilentlyContinue
}
Compress-Archive -Path "dist/$AppName" -DestinationPath $ZipName -Force
Write-Host "Portable ZIP created: $ZipName" -ForegroundColor Gray

Write-Host "`n=======================================================" -ForegroundColor Cyan
Write-Host "SUCCESS: Starlink Windows Stats v${Version} has been built!" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "1. MSIX Package (Requires Developer Cert): $MsixName"
Write-Host "2. Portable Standalone ZIP (No Installer Needed): $ZipName"
Write-Host "=======================================================" -ForegroundColor Cyan
