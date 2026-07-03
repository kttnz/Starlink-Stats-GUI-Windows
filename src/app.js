// Global State Variables
let downloadHistory = [];
let uploadHistory = [];
let pingHistory = [];
let pingDropHistory = [];
const maxHistoryLength = 3600; // 1 hour of history (1 sample per second)

let dlPeak = 0;
let ulPeak = 0;

// Chart interval view window (seconds shown on chart)
let chartViewWindow = 60; // Default: last 60 seconds

// Data session tracking
let dataSampleBuffer = [];  // { time, rxBytes, txBytes } per second
let sessionRxTotal = 0;     // cumulative Rx bytes this session
let sessionTxTotal = 0;     // cumulative Tx bytes this session
let lastRxBytes = null;     // previous poll's raw rx total
let lastTxBytes = null;     // previous poll's raw tx total

// Canvas contexts
let speedChartCanvas = null;
let speedChartCtx = null;
let pingChartCanvas = null;
let pingChartCtx = null;
let radarCanvas = null;
let radarCtx = null;

// Radar sweep animation
let radarAngle = 0;

// Active Alert states (from API)
let currentAlerts = {};
let alertHistoryLog = [];
let totalObstructedSeconds = 0;

// Wait for DOM to load and pywebview to initialize
document.addEventListener("DOMContentLoaded", () => {
    // Setup Canvas References
    speedChartCanvas = document.getElementById("speed-chart");
    speedChartCtx = speedChartCanvas.getContext("2d");
    
    pingChartCanvas = document.getElementById("ping-chart");
    pingChartCtx = pingChartCanvas.getContext("2d");
    
    radarCanvas = document.getElementById("radar-map");
    radarCtx = radarCanvas.getContext("2d");
    
    // Resize canvases to actual layout sizes
    resizeCanvases();
    window.addEventListener("resize", () => {
        resizeCanvases();
    });

    // Wire up Buttons and Modals
    setupEventListeners();

    // Start Polling Loop (wait 500ms for pywebview bridge)
    setTimeout(() => {
        pollData();
        setInterval(pollData, 1000);
        
        // Start high-performance canvas rendering loop (e.g. radar sweep)
        requestAnimationFrame(renderLoop);
    }, 500);
});

function resizeCanvases() {
    if (speedChartCanvas) {
        const rect = speedChartCanvas.parentElement.getBoundingClientRect();
        speedChartCanvas.width = rect.width;
        speedChartCanvas.height = rect.height;
    }
    if (pingChartCanvas) {
        const rect = pingChartCanvas.parentElement.getBoundingClientRect();
        pingChartCanvas.width = rect.width;
        pingChartCanvas.height = rect.height;
    }
    if (radarCanvas) {
        const rect = radarCanvas.parentElement.getBoundingClientRect();
        radarCanvas.width = rect.width;
        radarCanvas.height = rect.height;
    }
}

// Setup action event listeners
function setupEventListeners() {
    // IP input enter key
    const ipInput = document.getElementById("ip-input");
    ipInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            const ip = ipInput.value.trim();
            if (ip) {
                window.pywebview.api.set_ip(ip).then((res) => {
                    showNotification(`Target IP updated to: ${ip}`);
                });
            }
        }
    });

    // Toggle simulated / live mode
    const btnToggleSim = document.getElementById("btn-toggle-sim");
    btnToggleSim.addEventListener("click", () => {
        window.pywebview.api.toggle_simulation().then((res) => {
            showNotification(res.message);
            updateStatusDot(res.status);
        });
    });

    // Reboot modal triggers
    const btnReboot = document.getElementById("btn-reboot");
    const rebootModal = document.getElementById("reboot-modal");
    const btnCancelReboot = document.getElementById("btn-cancel-reboot");
    const btnConfirmReboot = document.getElementById("btn-confirm-reboot");

    btnReboot.addEventListener("click", () => {
        rebootModal.classList.add("active");
    });
    btnCancelReboot.addEventListener("click", () => {
        rebootModal.classList.remove("active");
    });
    btnConfirmReboot.addEventListener("click", () => {
        rebootModal.classList.remove("active");
        showNotification("Sending reboot command to Dishy...");
        window.pywebview.api.reboot_dish().then((res) => {
            if (res.success) {
                showNotification("Reboot command acknowledged by Dish.");
            } else {
                showNotification(`Reboot failed: ${res.message}`);
            }
        });
    });

    // Stow modal triggers
    const btnStow = document.getElementById("btn-stow");
    const stowModal = document.getElementById("stow-modal");
    const btnCancelStow = document.getElementById("btn-cancel-stow");
    const btnConfirmStow = document.getElementById("btn-confirm-stow");
    const stowTitle = document.getElementById("stow-modal-title");
    const stowDesc = document.getElementById("stow-modal-desc");
    
    let isStowingAction = true; // True for Stow, False for Unstow

    btnStow.addEventListener("click", () => {
        // Toggle action depending on button state
        if (btnStow.textContent === "STOW DISH") {
            isStowingAction = true;
            stowTitle.textContent = "Confirm Dish Stow";
            stowDesc.textContent = "Stowing the dish will fold the antenna flat for transport. This will interrupt your internet connection.";
        } else {
            isStowingAction = false;
            stowTitle.textContent = "Confirm Dish Unstow";
            stowDesc.textContent = "Unstowing the dish will command it to point towards the sky and search for satellites.";
        }
        stowModal.classList.add("active");
    });
    
    btnCancelStow.addEventListener("click", () => {
        stowModal.classList.remove("active");
    });
    
    btnConfirmStow.addEventListener("click", () => {
        stowModal.classList.remove("active");
        const actionText = isStowingAction ? "stowing" : "unstowing";
        showNotification(`Initiating dish ${actionText}...`);
        
        window.pywebview.api.stow_dish(isStowingAction).then((res) => {
            if (res.success) {
                showNotification(`Dish ${actionText} command sent successfully.`);
                btnStow.textContent = isStowingAction ? "UNSTOW DISH" : "STOW DISH";
                if (isStowingAction) {
                    btnStow.classList.remove("btn-secondary");
                    btnStow.classList.add("btn-primary");
                } else {
                    btnStow.classList.remove("btn-primary");
                    btnStow.classList.add("btn-secondary");
                }
            } else {
                showNotification(`Action failed: ${res.message}`);
            }
        });
    });

    // Simulated alerts toggles
    const setupAlertToggle = (checkboxId, alertName) => {
        const checkbox = document.getElementById(checkboxId);
        checkbox.addEventListener("change", () => {
            window.pywebview.api.set_sim_alert(alertName, checkbox.checked);
        });
    };

    setupAlertToggle("sim-alert-motors", "motors_stuck");
    setupAlertToggle("sim-alert-thermal", "thermal_throttle");
    setupAlertToggle("sim-alert-voltage", "low_voltage");

    // CSV export listener
    const btnExportCsv = document.getElementById("btn-export-csv");
    btnExportCsv.addEventListener("click", () => {
        if (downloadHistory.length === 0) {
            showNotification("No data collected yet to export.");
            return;
        }

        const data = {
            timestamp: new Date().toISOString(),
            mode: document.getElementById("status-mode").textContent,
            ip: document.getElementById("ip-input").value,
            uptime: document.getElementById("uptime-value").textContent,
            dl_speed: document.getElementById("dl-speed").textContent,
            ul_speed: document.getElementById("ul-speed").textContent,
            ping: document.getElementById("ping-value").textContent,
            snr: document.getElementById("snr-value").textContent,
            rx_mb: document.getElementById("rx-bytes").textContent,
            tx_mb: document.getElementById("tx-bytes").textContent
        };

        window.pywebview.api.save_session_csv(data).then((res) => {
            if (res.success) {
                showNotification(`Session log exported to starlink_session_log.csv`);
            } else {
                showNotification(`Export failed: ${res.error}`);
            }
        });
    });

    // Heating Mode Dropdown
    const selectHeating = document.getElementById("select-heating");
    selectHeating.addEventListener("change", () => {
        window.pywebview.api.set_heating_mode(selectHeating.value).then((res) => {
            showNotification(res.message);
        });
    });

    // Sleep Schedule Controllers
    const updateSleepSchedule = () => {
        const enabled = document.getElementById("sleep-schedule-enable").checked;
        const start = parseInt(document.getElementById("sleep-start-hour").value);
        const end = parseInt(document.getElementById("sleep-end-hour").value);
        window.pywebview.api.set_sleep_schedule(start, end, enabled).then((res) => {
            showNotification(res.message);
        });
    };

    document.getElementById("sleep-schedule-enable").addEventListener("change", updateSleepSchedule);
    document.getElementById("sleep-start-hour").addEventListener("change", updateSleepSchedule);
    document.getElementById("sleep-end-hour").addEventListener("change", updateSleepSchedule);

    // Chart interval selector buttons
    const intervalBtns = document.querySelectorAll(".interval-btn");
    intervalBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            intervalBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            chartViewWindow = parseInt(btn.dataset.seconds);
        });
    });

    // Diagnostics Troubleshooter
    const btnRunDiag = document.getElementById("btn-run-diagnostics");
    btnRunDiag.addEventListener("click", () => {
        btnRunDiag.disabled = true;
        btnRunDiag.textContent = "RUNNING...";
        
        const items = ["local", "grpc", "internet", "dns"];
        items.forEach(item => {
            const icon = document.getElementById(`diag-${item}-icon`);
            icon.textContent = "●";
            icon.style.color = "var(--color-yellow)";
            icon.style.borderColor = "var(--color-yellow)";
            icon.style.animation = "statusPulse 1s infinite alternate";
            document.getElementById(`diag-${item}`).style.borderColor = "rgba(245, 158, 11, 0.2)";
        });
        
        const log = document.getElementById("diagnostics-log");
        log.innerHTML = `[${new Date().toLocaleTimeString()}] Running real-time diagnostics troubleshooting...\n`;
        
        window.pywebview.api.run_diagnostics().then((results) => {
            btnRunDiag.disabled = false;
            btnRunDiag.textContent = "RUN DIAGNOSTICS";
            
            const updateDiagStatus = (key, result) => {
                const icon = document.getElementById(`diag-${key}-icon`);
                const desc = document.getElementById(`diag-${key}-desc`);
                const card = document.getElementById(`diag-${key}`);
                
                icon.style.animation = "none";
                if (result.ok) {
                    icon.textContent = "✓";
                    icon.style.color = "var(--color-green)";
                    icon.style.borderColor = "var(--color-green)";
                    card.style.borderColor = "rgba(16, 185, 129, 0.25)";
                    card.style.background = "rgba(16, 185, 129, 0.03)";
                    
                    const timeInfo = result.ms ? ` (${result.ms} ms)` : "";
                    desc.textContent = `${result.msg}${timeInfo}`;
                    desc.style.color = "var(--color-green)";
                } else {
                    icon.textContent = "✗";
                    icon.style.color = "var(--color-red)";
                    icon.style.borderColor = "var(--color-red)";
                    card.style.borderColor = "rgba(239, 68, 68, 0.25)";
                    card.style.background = "rgba(239, 68, 68, 0.03)";
                    
                    desc.textContent = result.msg;
                    desc.style.color = "var(--color-red)";
                }
            };
            
            updateDiagStatus("local", results.local_ping);
            updateDiagStatus("grpc", results.grpc_ok);
            updateDiagStatus("internet", results.internet_ping);
            updateDiagStatus("dns", results.dns_resolve);
            
            // Append log output
            log.innerHTML += `[Local Connection]: ${results.local_ping.ok ? 'PASS' : 'FAIL'} - ${results.local_ping.msg} (${results.local_ping.ms}ms)\n`;
            log.innerHTML += `[gRPC Reflection]: ${results.grpc_ok.ok ? 'PASS' : 'FAIL'} - ${results.grpc_ok.msg}\n`;
            log.innerHTML += `[Internet Access]: ${results.internet_ping.ok ? 'PASS' : 'FAIL'} - ${results.internet_ping.msg} (${results.internet_ping.ms}ms)\n`;
            log.innerHTML += `[DNS Resolution]: ${results.dns_resolve.ok ? 'PASS' : 'FAIL'} - ${results.dns_resolve.msg} (${results.dns_resolve.ms}ms)\n`;
            log.innerHTML += `[Diagnostics Complete] Starlink system checked.`;
            log.scrollTop = log.scrollHeight;
        });
    });
}

// Update UI Connection status colors
function updateStatusDot(status) {
    const dot = document.getElementById("status-dot");
    const text = document.getElementById("status-mode");
    
    dot.className = "pulse-dot";
    
    if (status === "live") {
        dot.classList.add("live");
        text.textContent = "LIVE DISH";
        text.style.color = "var(--color-green)";
    } else if (status === "simulated") {
        dot.classList.add("simulated");
        text.textContent = "SIMULATION";
        text.style.color = "var(--color-yellow)";
    } else {
        dot.classList.add("disconnected");
        text.textContent = "DISCONNECTED";
        text.style.color = "var(--color-red)";
    }
}

// Notification system
function showNotification(msg) {
    const toast = document.getElementById("notification");
    toast.textContent = msg;
    toast.classList.add("active");
    setTimeout(() => {
        toast.classList.remove("active");
    }, 3500);
}

// Polling loop to fetch stats from Python backend
function pollData() {
    if (!window.pywebview || !window.pywebview.api) return;

    window.pywebview.api.get_stats().then((stats) => {
        updateDashboard(stats);
    }).catch((err) => {
        console.error("Polling Error: ", err);
        updateStatusDot("disconnected");
    });
}

// Format bytes into readable format
function formatBytes(bytes) {
    if (bytes === 0) return '0.00 MB';
    const k = 1024;
    const dm = 2;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    // For our app, let's keep it in MB/GB for visual consistency
    const value = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
    return `${value} ${sizes[i]}`;
}

// Format seconds into uptime string (HH:MM:SS)
function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Format obstructed seconds into readable duration (e.g. 15s, 2m 14s, etc)
function formatObstructedTime(seconds) {
    if (seconds === 0) return "0s";
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) {
        return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    }
    const hrs = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins > 0 ? `${hrs}h ${remainingMins}m` : `${hrs}h`;
}

// Update all DOM elements
let obstructionWedges = []; // Globally saved to draw in canvas render loop

function updateDashboard(stats) {
    // Mode status
    if (stats.mode === "Simulated") {
        updateStatusDot("simulated");
        document.getElementById("dish-state").textContent = "SIMULATED";
        document.getElementById("dish-state").className = "meta-val highlight-blue";
    } else if (stats.connected) {
        updateStatusDot("live");
        document.getElementById("dish-state").textContent = "CONNECTED";
        document.getElementById("dish-state").className = "meta-val highlight-green";
    } else {
        updateStatusDot("disconnected");
        document.getElementById("dish-state").textContent = "OFFLINE";
        document.getElementById("dish-state").className = "meta-val highlight-red";
        
        // Clear speed metrics if disconnected
        document.getElementById("dl-speed").textContent = "0.0";
        document.getElementById("ul-speed").textContent = "0.0";
        return;
    }

    // Target IP display (in case loaded/changed)
    document.getElementById("ip-input").value = stats.ip;

    // Speeds & Peaks
    const dlMbps = parseFloat((stats.downlink_throughput_bps / 1000000).toFixed(1));
    const ulMbps = parseFloat((stats.uplink_throughput_bps / 1000000).toFixed(1));
    
    document.getElementById("dl-speed").textContent = dlMbps.toFixed(1);
    document.getElementById("ul-speed").textContent = ulMbps.toFixed(1);
    
    if (dlMbps > dlPeak) {
        dlPeak = dlMbps;
        document.getElementById("dl-peak").textContent = dlPeak.toFixed(1);
    }
    if (ulMbps > ulPeak) {
        ulPeak = ulMbps;
        document.getElementById("ul-peak").textContent = ulPeak.toFixed(1);
    }

    // Speed history list updating
    downloadHistory.push(dlMbps);
    uploadHistory.push(ulMbps);
    if (downloadHistory.length > maxHistoryLength) downloadHistory.shift();
    if (downloadHistory.length > maxHistoryLength) uploadHistory.shift();

    // Ping & Latency History updating
    const currentPing = stats.ping_ms;
    pingHistory.push(currentPing);
    if (pingHistory.length > maxHistoryLength) pingHistory.shift();

    // Calculate a simulated packet drop/loss rate based on obstructions
    const dropChance = 0.01 + (stats.obstruction_fraction * 0.5);
    const isDrop = Math.random() < dropChance ? 1 : 0;
    pingDropHistory.push(isDrop);
    if (pingDropHistory.length > maxHistoryLength) pingDropHistory.shift();

    // Latency & SNR
    document.getElementById("ping-value").textContent = stats.ping_ms.toFixed(0);
    document.getElementById("snr-value").textContent = stats.snr.toFixed(1);
    document.getElementById("obstruction-pct").textContent = (stats.obstruction_fraction * 100).toFixed(1);

    // Track total obstruction duration (runs once per second when polled)
    if (stats.obstruction_fraction > 0.01) {
        totalObstructedSeconds += 1;
    }
    document.getElementById("val-obstructed-time").textContent = formatObstructedTime(totalObstructedSeconds);

    // Data Used — session tracking
    const rawRx = stats.rx_bytes_total;
    const rawTx = stats.tx_bytes_total;

    // Calculate delta bytes since last poll and accumulate session totals
    if (lastRxBytes !== null && rawRx >= lastRxBytes) {
        sessionRxTotal += (rawRx - lastRxBytes);
    }
    if (lastTxBytes !== null && rawTx >= lastTxBytes) {
        sessionTxTotal += (rawTx - lastTxBytes);
    }
    lastRxBytes = rawRx;
    lastTxBytes = rawTx;

    // Push current sample to the data buffer (keep up to 3600 samples = 1 hour)
    const now = Date.now();
    dataSampleBuffer.push({ time: now, rxBytes: rawRx, txBytes: rawTx });
    if (dataSampleBuffer.length > maxHistoryLength) dataSampleBuffer.shift();

    // Helper: compute total bytes transferred over the last windowSecs seconds
    function computeTrafficAverage(windowSecs) {
        const cutoff = now - windowSecs * 1000;
        const relevant = dataSampleBuffer.filter(s => s.time >= cutoff);
        if (relevant.length < 2) return { rx: 0, tx: 0 };
        const oldest = relevant[0];
        const newest = relevant[relevant.length - 1];
        return {
            rx: Math.max(0, newest.rxBytes - oldest.rxBytes),
            tx: Math.max(0, newest.txBytes - oldest.txBytes)
        };
    }

    // Live current speed display (top of card)
    document.getElementById("rx-bytes").textContent = formatBytes(sessionRxTotal);
    document.getElementById("tx-bytes").textContent = formatBytes(sessionTxTotal);

    // Rolling traffic averages
    const avg1m  = computeTrafficAverage(60);
    const avg5m  = computeTrafficAverage(300);
    const avg15m = computeTrafficAverage(900);
    const avg1h  = computeTrafficAverage(3600);

    document.getElementById("rx-avg-1m").textContent  = formatBytes(avg1m.rx);
    document.getElementById("tx-avg-1m").textContent  = formatBytes(avg1m.tx);
    document.getElementById("rx-avg-5m").textContent  = formatBytes(avg5m.rx);
    document.getElementById("tx-avg-5m").textContent  = formatBytes(avg5m.tx);
    document.getElementById("rx-avg-15m").textContent = formatBytes(avg15m.rx);
    document.getElementById("tx-avg-15m").textContent = formatBytes(avg15m.tx);
    document.getElementById("rx-avg-1h").textContent  = formatBytes(avg1h.rx);
    document.getElementById("tx-avg-1h").textContent  = formatBytes(avg1h.tx);

    // Session cumulative totals (footer)
    document.getElementById("rx-bytes-total").textContent = formatBytes(sessionRxTotal);
    document.getElementById("tx-bytes-total").textContent = formatBytes(sessionTxTotal);

    // Uptime
    document.getElementById("uptime-value").textContent = formatUptime(stats.uptime_seconds);

    // System details
    document.getElementById("val-device-id").textContent = stats.device_id;
    document.getElementById("val-hw-rev").textContent = stats.hardware_version;
    document.getElementById("val-sw-ver").textContent = stats.software_version;
    
    const pitch = stats.elevation_deg.toFixed(1); // Starlink elevation maps to pitch
    const roll = stats.azimuth_deg.toFixed(1); // Azimuth maps to roll / yaw alignment
    document.getElementById("val-angles").textContent = `E:${pitch}° / A:${roll}°`;

    // GPS Status
    const gpsNode = document.getElementById("val-gps-status");
    gpsNode.textContent = stats.gps_valid ? "ACTIVE LOCK" : "SEARCHING LOCK...";
    gpsNode.className = stats.gps_valid ? "value highlight-green" : "value highlight-yellow";

    // Tracked Satellites
    document.getElementById("val-satellites").textContent = stats.gps_sats;

    // Heating element state
    const heatingNode = document.getElementById("val-heating-state");
    heatingNode.textContent = stats.is_heating ? "ACTIVELY HEATING" : "STANDBY (IDLE)";
    heatingNode.className = stats.is_heating ? "value highlight-magenta" : "value highlight-cyan";

    // Save obstruction wedges array
    obstructionWedges = stats.wedge_fraction_obstructed || [];

    // Process Alert state changes for logging
    const alertKeys = ["motors_stuck", "thermal_throttle", "low_voltage", "roaming", "mast_not_near_vertical", "thermal_shutdown"];
    const alertLabelMap = {
        "motors_stuck": "Motors Stuck Alarm",
        "thermal_throttle": "Thermal Throttle Active",
        "low_voltage": "Low Voltage Warn",
        "roaming": "Roaming State Change",
        "mast_not_near_vertical": "Mast Tilt Fault",
        "thermal_shutdown": "Thermal Shutdown Active"
    };
    
    alertKeys.forEach(key => {
        const previousState = currentAlerts[key] || false;
        const currentState = stats.alerts[key] || false;
        
        if (previousState !== currentState) {
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const action = currentState ? "Active" : "Cleared";
            alertHistoryLog.push({
                timestamp: timeStr,
                alertName: alertLabelMap[key],
                action: action,
                active: currentState
            });
            if (alertHistoryLog.length > 25) alertHistoryLog.shift();
        }
    });
    currentAlerts = { ...stats.alerts };

    // Update Advanced Config elements
    const selHeating = document.getElementById("select-heating");
    if (document.activeElement !== selHeating && selHeating.value !== stats.heating_mode) {
        selHeating.value = stats.heating_mode;
    }
    
    const slpEnable = document.getElementById("sleep-schedule-enable");
    if (document.activeElement !== slpEnable && slpEnable.checked !== stats.sleep_enabled) {
        slpEnable.checked = stats.sleep_enabled;
    }
    
    const startHr = Math.floor(stats.sleep_start / 60).toString();
    const selStart = document.getElementById("sleep-start-hour");
    if (document.activeElement !== selStart && selStart.value !== startHr) {
        selStart.value = startHr;
    }
    
    const endHr = Math.floor(stats.sleep_end / 60).toString();
    const selEnd = document.getElementById("sleep-end-hour");
    if (document.activeElement !== selEnd && selEnd.value !== endHr) {
        selEnd.value = endHr;
    }

    // System Alerts update
    updateAlertsList(stats.alerts);
}

// Update Alerts List in DOM
function updateAlertsList(alerts) {
    const container = document.getElementById("alerts-list");
    container.innerHTML = "";
    
    let activeAlertCount = 0;
    
    const addAlertItem = (message, active) => {
        const item = document.createElement("div");
        item.className = active ? "alert-item alert-danger" : "alert-item alert-ok";
        item.innerHTML = `<span class="alert-icon">${active ? '⚠' : '✓'}</span><span class="alert-msg">${message}</span>`;
        container.appendChild(item);
        if (active) activeAlertCount++;
    };

    if (alerts.motors_stuck) addAlertItem("MOTORS STUCK - MOTOR FAULT DETECTED", true);
    if (alerts.thermal_throttle) addAlertItem("THERMAL OVERHEATING - PERFORMANCE THROTTLED", true);
    if (alerts.low_voltage) addAlertItem("LOW VOLTAGE - CHECK POWER SUPPLY", true);
    if (alerts.roaming) addAlertItem("TERMINAL ROAMING - NOT AT REGISTERED LOCATION", true);
    if (alerts.mast_not_near_vertical) addAlertItem("MAST ALIGNMENT FAULT - TILT LIMIT EXCEEDED", true);
    if (alerts.thermal_shutdown) addAlertItem("CRITICAL THERMAL SHUTDOWN - TEMP LIMIT EXCEEDED", true);

    if (activeAlertCount === 0) {
        addAlertItem("ALL SYSTEMS OPERATIONAL", false);
    }

    // Historical alerts logging display
    if (alertHistoryLog.length > 0) {
        const divider = document.createElement("div");
        divider.style.borderTop = "1px solid rgba(255, 255, 255, 0.05)";
        divider.style.margin = "8px 0";
        container.appendChild(divider);
        
        for (let i = alertHistoryLog.length - 1; i >= 0; i--) {
            const log = alertHistoryLog[i];
            const logItem = document.createElement("div");
            logItem.style.fontSize = "10px";
            logItem.style.fontFamily = "var(--font-mono)";
            logItem.style.color = log.active ? "var(--color-magenta)" : "#64748b";
            logItem.style.padding = "2px 4px";
            logItem.style.display = "flex";
            logItem.style.justifyContent = "space-between";
            logItem.innerHTML = `<span>[${log.timestamp}] ${log.alertName}</span> <span>${log.action.toUpperCase()}</span>`;
            container.appendChild(logItem);
        }
    }
}

// Canvas Render Loop (High Framerate for charts and radar scan)
function renderLoop() {
    drawSpeedChart();
    drawPingChart();
    drawRadarMap();
    
    // Increment radar sweep angle
    radarAngle += 0.015;
    if (radarAngle > Math.PI * 2) radarAngle = 0;
    
    requestAnimationFrame(renderLoop);
}

// Draw the Speed Chart on Canvas
function drawSpeedChart() {
    if (!speedChartCtx || !speedChartCanvas) return;
    
    const ctx = speedChartCtx;
    const w = speedChartCanvas.width;
    const h = speedChartCanvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, w, h);
    
    // Define margins
    const marginL = 40;
    const marginR = 10;
    const marginT = 15;
    const marginB = 25;
    const graphW = w - marginL - marginR;
    const graphH = h - marginT - marginB;
    
    // Draw background grid lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = 1;
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
        const y = marginT + (graphH / gridLines) * i;
        ctx.beginPath();
        ctx.moveTo(marginL, y);
        ctx.lineTo(w - marginR, y);
        ctx.stroke();
    }
    
    // Slice history to the current view window
    const viewDl = downloadHistory.slice(-chartViewWindow);
    const viewUl = uploadHistory.slice(-chartViewWindow);
    if (viewDl.length < 2) return;
    
    // Calculate max scale based on sliced history
    let maxVal = 100;
    for (let val of viewDl) { if (val > maxVal) maxVal = val; }
    for (let val of viewUl) { if (val > maxVal) maxVal = val; }
    maxVal = Math.ceil(maxVal / 50) * 50;
    
    // Draw Y axis labels
    ctx.fillStyle = "#64748b";
    ctx.font = "10px 'Share Tech Mono'";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= gridLines; i++) {
        const val = maxVal - (maxVal / gridLines) * i;
        const y = marginT + (graphH / gridLines) * i;
        ctx.fillText(Math.round(val), marginL - 8, y);
    }
    
    // Draw X axis time labels
    const xLabel = chartViewWindow >= 3600 ? "1h ago" :
                   chartViewWindow >= 900  ? "15m ago" :
                   chartViewWindow >= 300  ? "5m ago"  : "60s ago";
    ctx.textAlign = "center";
    ctx.fillText(xLabel, marginL, h - marginB + 14);
    ctx.fillText("Now", w - marginR, h - marginB + 14);

    // Function to draw a path for a sliced history array
    const drawLinePath = (history, strokeColor, glowColor, fillColor) => {
        ctx.beginPath();
        const stepX = graphW / Math.max(history.length - 1, 1);
        ctx.moveTo(marginL, marginT + graphH - (history[0] / maxVal) * graphH);
        for (let i = 1; i < history.length; i++) {
            const x = marginL + i * stepX;
            const y = marginT + graphH - (history[i] / maxVal) * graphH;
            ctx.lineTo(x, y);
        }
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
        const lastX = marginL + (history.length - 1) * stepX;
        ctx.lineTo(lastX, marginT + graphH);
        ctx.lineTo(marginL, marginT + graphH);
        ctx.closePath();
        const fillGrad = ctx.createLinearGradient(0, marginT, 0, marginT + graphH);
        fillGrad.addColorStop(0, fillColor);
        fillGrad.addColorStop(1, "rgba(7, 9, 19, 0)");
        ctx.fillStyle = fillGrad;
        ctx.fill();
    };

    drawLinePath(viewUl, "#ff007f", "rgba(255, 0, 127, 0.4)", "rgba(255, 0, 127, 0.08)");
    drawLinePath(viewDl, "#00f2fe", "rgba(0, 242, 254, 0.4)", "rgba(0, 242, 254, 0.12)");
}

// Draw the Ping and Packet Loss Chart on Canvas
function drawPingChart() {
    if (!pingChartCtx || !pingChartCanvas) return;
    
    const ctx = pingChartCtx;
    const w = pingChartCanvas.width;
    const h = pingChartCanvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    const marginL = 40;
    const marginR = 10;
    const marginT = 15;
    const marginB = 25;
    const graphW = w - marginL - marginR;
    const graphH = h - marginT - marginB;
    
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = 1;
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
        const y = marginT + (graphH / gridLines) * i;
        ctx.beginPath();
        ctx.moveTo(marginL, y);
        ctx.lineTo(w - marginR, y);
        ctx.stroke();
    }
    
    // Slice history to current view window
    const viewPing = pingHistory.slice(-chartViewWindow);
    const viewDrop = pingDropHistory.slice(-chartViewWindow);
    if (viewPing.length < 2) return;
    
    let maxVal = 60;
    for (let val of viewPing) { if (val > maxVal) maxVal = val; }
    maxVal = Math.ceil(maxVal / 20) * 20;
    
    ctx.fillStyle = "#64748b";
    ctx.font = "10px 'Share Tech Mono'";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= gridLines; i++) {
        const val = maxVal - (maxVal / gridLines) * i;
        const y = marginT + (graphH / gridLines) * i;
        ctx.fillText(Math.round(val), marginL - 8, y);
    }
    
    const xLabel = chartViewWindow >= 3600 ? "1h ago" :
                   chartViewWindow >= 900  ? "15m ago" :
                   chartViewWindow >= 300  ? "5m ago"  : "60s ago";
    ctx.textAlign = "center";
    ctx.fillText(xLabel, marginL, h - marginB + 14);
    ctx.fillText("Now", w - marginR, h - marginB + 14);

    const stepX = graphW / Math.max(viewPing.length - 1, 1);

    // Draw packet drops
    ctx.shadowBlur = 0;
    for (let i = 0; i < viewDrop.length; i++) {
        if (viewDrop[i] === 1) {
            const x = marginL + i * stepX;
            ctx.beginPath();
            ctx.moveTo(x, marginT + graphH);
            ctx.lineTo(x, marginT + graphH * 0.6);
            ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    }

    // Draw Ping line
    ctx.beginPath();
    ctx.moveTo(marginL, marginT + graphH - (viewPing[0] / maxVal) * graphH);
    for (let i = 1; i < viewPing.length; i++) {
        const x = marginL + i * stepX;
        const y = marginT + graphH - (viewPing[i] / maxVal) * graphH;
        ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(59, 130, 246, 0.5)";
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    
    const lastX = marginL + (viewPing.length - 1) * stepX;
    ctx.lineTo(lastX, marginT + graphH);
    ctx.lineTo(marginL, marginT + graphH);
    ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0, marginT, 0, marginT + graphH);
    fillGrad.addColorStop(0, "rgba(59, 130, 246, 0.1)");
    fillGrad.addColorStop(1, "rgba(7, 9, 19, 0)");
    ctx.fillStyle = fillGrad;
    ctx.fill();
}

// Draw the Polar Obstruction Radar Map
function drawRadarMap() {
    if (!radarCtx || !radarCanvas) return;
    
    const ctx = radarCtx;
    const w = radarCanvas.width;
    const h = radarCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 5;
    
    // Clear canvas
    ctx.clearRect(0, 0, w, h);
    
    // Draw space background grid circles
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    
    // 30 degrees, 60 degrees elevation circles
    const elevations = [radius * 0.33, radius * 0.66, radius];
    for (let r of elevations) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
    }
    
    // Draw crosshair axes lines
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.stroke();

    // Draw Obstruction Wedges (72 sectors, each 5 degrees)
    const wedgeCount = obstructionWedges.length;
    if (wedgeCount > 0) {
        const sliceAngle = (Math.PI * 2) / wedgeCount;
        
        for (let i = 0; i < wedgeCount; i++) {
            const fraction = obstructionWedges[i];
            if (fraction > 0.05) {
                // Determine slice start/end angles (0 degree starts east in standard Math, Starlink points North)
                // Offset by -PI/2 to align 0 degree with North (straight up)
                const startAngle = i * sliceAngle - Math.PI / 2;
                const endAngle = (i + 1) * sliceAngle - Math.PI / 2;
                
                // Draw obstructed slice
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                
                // Outer arc representing the wedge
                ctx.arc(cx, cy, radius, startAngle, endAngle);
                ctx.closePath();
                
                // Red/crimson neon gradient representing trees/obstructions
                const wedgeGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, radius);
                
                // Deeper red for higher obstruction fraction
                const alpha = Math.min(0.85, fraction * 0.8);
                wedgeGrad.addColorStop(0, `rgba(239, 68, 68, ${alpha * 0.3})`);
                wedgeGrad.addColorStop(1, `rgba(239, 68, 68, ${alpha})`);
                
                ctx.fillStyle = wedgeGrad;
                ctx.fill();
                
                // Slight stroke for wedges to look segmented
                ctx.strokeStyle = "rgba(239, 68, 68, 0.3)";
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }
        }
    }

    // Draw sweeping radar line
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    // Offset scan starting at North (angle - PI/2)
    const scanX = cx + radius * Math.cos(radarAngle - Math.PI / 2);
    const scanY = cy + radius * Math.sin(radarAngle - Math.PI / 2);
    ctx.lineTo(scanX, scanY);
    ctx.strokeStyle = "rgba(0, 242, 254, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Sweep trail fade (cyan/blue gradient trail behind the scan line)
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, radarAngle - 0.2 - Math.PI/2, radarAngle - Math.PI/2);
    ctx.closePath();
    const trailGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    trailGrad.addColorStop(0, "rgba(0, 242, 254, 0.05)");
    trailGrad.addColorStop(1, "rgba(0, 242, 254, 0.15)");
    ctx.fillStyle = trailGrad;
    ctx.fill();
    
    // Draw outer glow border ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 242, 254, 0.2)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
}
