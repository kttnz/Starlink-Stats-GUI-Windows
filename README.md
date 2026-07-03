# Starlink Windows Stats Dashboard

[![Release Version](https://img.shields.io/badge/version-v0.0.11-cyan.svg)](https://github.com/kttnz/Starlink-Stats-GUI-Windows)
[![Platform](https://img.shields.io/badge/platform-Windows_10_/_11-blue.svg)](#)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#)

A high-performance, real-time Windows GUI application packaged as an MSIX installer that connects to your Starlink User Terminal (Dishy) via gRPC. It displays live bandwidth telemetry, latency history graphs, active obstruction maps, heating status, and includes a comprehensive network troubleshooter.

---

## Key Features

*   📊 **Real-time Telemetry**: Live tracking of download speeds, upload speeds, peak throughput, and total data transferred (Rx and Tx listed separately).
*   📈 **Historical Charts**: Real-time canvas line graphs showing 60 seconds of historical throughput, ping latency, and packet drops.
*   📡 **Hemispherical Obstruction Map**: Polar radar view mapping sky obstruction sectors (each 5 degrees) in real-time, along with live tracking of **Total Time Obstructed**.
*   ⚙️ **Dish Control Panel**: Configure snow melt/heating modes (Auto, Always On, Always Off) and schedule custom sleep timers via gRPC.
*   🩺 **Connection Diagnostics**: Single-click Troubleshooter testing local dish gateway ping, gRPC connectivity, public WAN ping (Cloudflare `1.1.1.1`), and DNS resolution latency.
*   🔒 **Digital System Health**: Monitors active system alarms (Motors Stuck, Low Voltage, Roaming, Tilted Mast Alignment, and Thermal Overheating).
*   📦 **MSIX Windows Installer**: Seamless installation, updates, and Start Menu registration via signed MSIX packaging.

---

## Getting Started & Installation

To run this dashboard on your Windows machine, download the latest version from your releases and follow these installation steps:

### 1. Trust the Developer Certificate
Because the installer uses a self-signed developer certificate, you must add the certificate to your trusted certificate store:
1. Locate **`StarlinkStatsCert.pfx`** (or run `install_cert.ps1` as Administrator).
2. Alternatively, right-click **`install_cert.ps1`** and select **Run with PowerShell** (this elevates to administrator automatically and imports the developer certificate to your computer's `Trusted People` store).

### 2. Enable Windows Sideloading
1. Open Windows **Settings** (Win + I).
2. Go to **Update & Security** > **For Developers** (or search for "Developer settings").
3. Toggle on **Sideload apps** or **Developer Mode**.

### 3. Install the MSIX Package
1. Double-click the file: **`Starlink-Windows-Stats-v.0.0.11.msix`**.
2. Click **Install**.
3. Launch from your Start Menu!

---

## Development & Building

If you would like to compile or customize the application locally:

### Prerequisites
*   **Python 3.11**
*   **Windows SDK** (for `MakeAppx.exe` and `SignTool.exe`)
*   Install python requirements:
    ```bash
    pip install pyinstaller pywebview grpcio grpcio-tools
    ```

### Compilation Pipeline
To automatically compile the Python backend, bundle the web assets, build the Appx package structure, and sign the MSIX installer, run:
```powershell
powershell -ExecutionPolicy Bypass -File .\build_msix.ps1
```

---

## Project Structure
```text
├── src/
│   ├── main.py              # Pywebview controller and gRPC client logic
│   ├── index.html           # HTML5 Dashboard Layout
│   ├── style.css            # Custom CSS Glassmorphism Stylesheet
│   ├── app.js               # Canvas graphics rendering & GUI data update loop
│   └── Assets/              # MSIX Tile logos and app icons
├── AppxManifest.xml         # Windows AppX Packaging manifest configuration
├── build_msix.ps1           # Full build, package, and signing script
└── install_cert.ps1         # Administrator certificate trust helper
```

---

## License

This project is licensed under the MIT License - see the LICENSE file for details.
