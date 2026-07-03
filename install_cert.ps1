# PowerShell script to install the developer certificate for Starlink Windows Stats
# Requires Administrator privileges to import into the machine's Trusted People store.

$ErrorActionPreference = "Stop"
$PfxName = "StarlinkStatsCert.pfx"
$PfxPassword = "StarlinkPassword123"

# Get current script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $ScriptDir) { $ScriptDir = Get-Location }
$PfxPath = Join-Path $ScriptDir $PfxName

# 1. Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "This script needs to run as Administrator to trust the certificate." -ForegroundColor Yellow
    Write-Host "Elevating privileges..." -ForegroundColor Gray
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    Exit
}

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "Installing Starlink Developer Certificate" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

if (-not (Test-Path $PfxPath)) {
    Write-Host "Error: Certificate file '$PfxPath' not found!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    Exit
}

try {
    Write-Host "Importing certificate into Trusted People (Local Machine)..." -ForegroundColor Gray
    
    # Construct secure string password
    $SecurePassword = ConvertTo-SecureString -String $PfxPassword -Force -AsPlainText
    
    # Import into LocalMachine Trusted People
    Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password $SecurePassword | Out-Null
    
    # Also import into Trusted Root Certification Authorities to be absolutely sure
    Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation Cert:\LocalMachine\Root -Password $SecurePassword | Out-Null
    
    Write-Host "`nSUCCESS: The certificate was successfully trusted!" -ForegroundColor Green
    Write-Host "You can now install the MSIX app package." -ForegroundColor Green
} catch {
    Write-Host "`nFailed to import certificate: $_" -ForegroundColor Red
}

Write-Host "=====================================================" -ForegroundColor Cyan
Read-Host "Press Enter to exit"
