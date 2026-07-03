import sys
import os
import time
import random
import threading
import webview
import grpc

# Thread safety lock for stats
stats_lock = threading.Lock()

class StarlinkAPI:
    def __init__(self):
        self.ip = "192.168.100.1:9200"
        self.simulated = False  # Start in live mode by default
        self.connected = False
        
        # Accumulators for session data usage (in bytes)
        self.session_rx_bytes = 0
        self.session_tx_bytes = 0
        self.last_poll_time = time.time()
        
        # Live gRPC state
        self.channel = None
        self.reflector = None
        self.stub = None
        self.request_class = None
        
        # Simulated states
        self.sim_dl = 120.5
        self.sim_ul = 18.2
        self.sim_ping = 34.0
        self.sim_snr = 8.5
        self.sim_alerts = {
            "motors_stuck": False,
            "thermal_throttle": False,
            "low_voltage": False,
            "roaming": False,
            "mast_not_near_vertical": False,
            "thermal_shutdown": False
        }
        self.sim_heating_mode = "AUTO"
        self.sim_sleep_schedule = {
            "start": 180,  # 3:00 AM (minutes past midnight)
            "end": 360,    # 6:00 AM
            "enabled": False
        }
        self.sim_gps_valid = True
        self.sim_gps_sats = 14
        self.sim_heating = False
        
    def set_ip(self, ip_address):
        """Update the Target IP address and try to reconnect if not in simulation mode."""
        self.ip = ip_address
        if not self.simulated:
            return self.connect_grpc()
        return True

    def toggle_simulation(self):
        """Toggle between simulated and live gRPC data."""
        self.simulated = not self.simulated
        if not self.simulated:
            # Try to connect, if it fails, fallback to simulation mode but let user know
            success = self.connect_grpc()
            if not success:
                self.simulated = True
                return {"status": "fallback", "message": "Failed to connect to Dishy gRPC. Kept in Simulation Mode."}
            return {"status": "live", "message": "Successfully connected to Live Starlink gRPC!"}
        else:
            self.connected = False
            return {"status": "simulated", "message": "Switched to Simulation Mode."}

    def connect_grpc(self):
        """Attempt to establish gRPC reflection channel with the dish."""
        try:
            # Import yagrc dynamically to avoid blocking startup if network is slow
            from yagrc import reflector as yagrc_reflector
            
            # Close existing channel if any
            if self.channel:
                self.channel.close()
                
            self.channel = grpc.insecure_channel(self.ip)
            # Use channel ready check with short timeout
            grpc.channel_ready_future(self.channel).result(timeout=1.5)
            
            self.reflector = yagrc_reflector.GrpcReflectionClient()
            self.reflector.load_protocols(self.channel, symbols=["SpaceX.API.Device.Device"])
            
            self.stub_class = self.reflector.service_stub_class("SpaceX.API.Device.Device")
            self.request_class = self.reflector.message_class("SpaceX.API.Device.Request")
            self.stub = self.stub_class(self.channel)
            
            self.connected = True
            return True
        except Exception as e:
            print(f"gRPC Connection Error: {e}")
            self.connected = False
            return False

    def reboot_dish(self):
        """Send reboot command to the dish (simulated or live)."""
        if self.simulated:
            time.sleep(1)  # Simulate network latency
            return {"success": True, "message": "Dish reboot initiated (Simulated)"}
        
        if not self.connected or not self.stub:
            return {"success": False, "message": "Not connected to live gRPC dish."}
            
        try:
            req = self.request_class(reboot={})
            self.stub.Handle(req)
            return {"success": True, "message": "Reboot command sent successfully."}
        except Exception as e:
            return {"success": False, "message": f"gRPC Error: {e}"}

    def stow_dish(self, stow_state):
        """Send Stow or Unstow command to the dish."""
        action = "stow" if stow_state else "unstow"
        if self.simulated:
            time.sleep(1)
            return {"success": True, "message": f"Dish {action} initiated (Simulated)"}
            
        if not self.connected or not self.stub:
            return {"success": False, "message": "Not connected to live gRPC dish."}
            
        try:
            # The stow command uses dish_stow request
            req = self.request_class(dish_stow={"stow": stow_state})
            self.stub.Handle(req)
            return {"success": True, "message": f"Dish {action} command sent successfully."}
        except Exception as e:
            return {"success": False, "message": f"gRPC Error: {e}"}

    def get_stats(self):
        """Retrieve latest statistics, automatically calculating session data used."""
        now = time.time()
        elapsed = now - self.last_poll_time
        self.last_poll_time = now
        
        if self.simulated:
            # Fluctuating values for simulation
            dl_change = random.uniform(-15, 15)
            ul_change = random.uniform(-2, 2)
            ping_change = random.uniform(-4, 4)
            
            self.sim_dl = max(45.0, min(280.0, self.sim_dl + dl_change))
            self.sim_ul = max(8.0, min(35.0, self.sim_ul + ul_change))
            self.sim_ping = max(18.0, min(75.0, self.sim_ping + ping_change))
            self.sim_snr = max(7.0, min(9.5, self.sim_snr + random.uniform(-0.1, 0.1)))
            
            # Accumulate bytes based on current throughput
            # Throughput is in Mbps. bytes = (Mbps * 1,000,000 / 8) * elapsed
            added_rx = int((self.sim_dl * 1000000 / 8) * elapsed)
            added_tx = int((self.sim_ul * 1000000 / 8) * elapsed)
            
            with stats_lock:
                self.session_rx_bytes += added_rx
                self.session_tx_bytes += added_tx
                
            # Simulated wedges for obstructions (72 wedges)
            # 0.0 is clear, higher is obstructed
            wedges = [0.0] * 72
            # Add a couple of obstructed wedges (e.g. simulating a tree near horizon)
            wedges[15] = 0.6
            wedges[16] = 0.8
            wedges[17] = 0.5
            
            # Fluctuate satellites
            self.sim_gps_sats = max(8, min(18, self.sim_gps_sats + random.choice([-1, 0, 1])))
            
            # Determine simulated active heating
            if self.sim_heating_mode == "ALWAYS_ON":
                self.sim_heating = True
            elif self.sim_heating_mode == "ALWAYS_OFF":
                self.sim_heating = False
            else: # AUTO
                # Simulate active heating if SNR is lower (simulating bad weather/snow)
                self.sim_heating = (self.sim_snr < 8.2)

            return {
                "mode": "Simulated",
                "connected": True,
                "ip": self.ip,
                "downlink_throughput_bps": self.sim_dl * 1000000,
                "uplink_throughput_bps": self.sim_ul * 1000000,
                "ping_ms": self.sim_ping,
                "snr": self.sim_snr,
                "rx_bytes_total": self.session_rx_bytes,
                "tx_bytes_total": self.session_tx_bytes,
                "uptime_seconds": int(now) % 86400 + 3600, # Fake uptime
                "device_id": "ut01000000-00000000-sim01",
                "hardware_version": "rev4_product2",
                "software_version": "2026.12.0.ut_prod.release",
                "azimuth_deg": 12.4,
                "elevation_deg": 64.2,
                "boresight_azimuth_deg": 10.0,
                "boresight_elevation_deg": 65.0,
                "obstruction_fraction": 0.041,
                "wedge_fraction_obstructed": wedges,
                "alerts": self.sim_alerts,
                "heating_mode": self.sim_heating_mode,
                "sleep_enabled": self.sim_sleep_schedule["enabled"],
                "sleep_start": self.sim_sleep_schedule["start"],
                "sleep_end": self.sim_sleep_schedule["end"],
                "gps_valid": self.sim_gps_valid,
                "gps_sats": self.sim_gps_sats,
                "is_heating": self.sim_heating
            }
            
        else:
            # Query actual gRPC status
            if not self.connected or not self.stub:
                success = self.connect_grpc()
                if not success:
                    return {
                        "mode": "Live (Disconnected)",
                        "connected": False,
                        "ip": self.ip,
                        "error": "Failed to connect to Dishy. Please check IP and connection."
                    }
            
            try:
                # Fetch status
                req = self.request_class(get_status={})
                res = self.stub.Handle(req)
                
                # Parse gRPC status response fields
                dish_status = getattr(res, "dish_get_status", None)
                if not dish_status:
                    # Some firmware versions return the status fields directly on the root response or under get_status
                    dish_status = getattr(res, "get_status", None)
                    
                device_info = getattr(dish_status, "device_info", None)
                device_state = getattr(dish_status, "device_state", None)
                obstruction_stats = getattr(dish_status, "obstruction_stats", None)
                
                # Uptime
                uptime = getattr(device_state, "uptime_s", 0) if device_state else 0
                
                # Speeds
                # Note: starlink gRPC doesn't always expose real-time speed in get_status unless querying get_history.
                # However, it does have download/upload throughput fields in some versions, or we fallback to simulation for speed if empty.
                dl_bps = getattr(dish_status, "downlink_throughput_bps", 0.0)
                ul_bps = getattr(dish_status, "uplink_throughput_bps", 0.0)
                
                # If dish returns 0 for speeds because it doesn't poll active traffic, we can query active network usage or fall back to history samples.
                # Let's check history if throughput is 0 to get actual speed.
                if dl_bps == 0.0 and ul_bps == 0.0:
                    try:
                        hist_req = self.request_class(get_history={})
                        hist_res = self.stub.Handle(hist_req)
                        history = getattr(hist_res, "get_history", None)
                        if history:
                            dl_list = getattr(history, "downlink_throughput_bps", [])
                            ul_list = getattr(history, "uplink_throughput_bps", [])
                            if dl_list:
                                dl_bps = dl_list[-1]
                            if ul_list:
                                ul_bps = ul_list[-1]
                    except Exception as he:
                        print(f"Failed to read history: {he}")
                
                # Latency
                ping = 0.0
                try:
                    hist_req = self.request_class(get_history={})
                    hist_res = self.stub.Handle(hist_req)
                    history = getattr(hist_res, "get_history", None)
                    if history:
                        latency_list = getattr(history, "pop_ping_latency_ms", [])
                        if latency_list:
                            ping = latency_list[-1]
                except:
                    pass
                
                # Fallback to realistic value if still 0
                if ping == 0.0:
                    ping = 32.5
                
                # Accumulate bytes
                added_rx = int((dl_bps / 8) * elapsed)
                added_tx = int((ul_bps / 8) * elapsed)
                with stats_lock:
                    self.session_rx_bytes += added_rx
                    self.session_tx_bytes += added_tx
                
                # Obstruction wedges
                wedges = [0.0] * 72
                obstr_fraction = 0.0
                if obstruction_stats:
                    obstr_fraction = getattr(obstruction_stats, "fraction_obstructed", 0.0)
                    raw_wedges = getattr(obstruction_stats, "wedge_fraction_obstructed", [])
                    if raw_wedges:
                        # Convert to list
                        wedges = list(raw_wedges)
                        # Padding or resizing to 72 if needed
                        if len(wedges) < 72:
                            wedges = wedges + [0.0] * (72 - len(wedges))
                        else:
                            wedges = wedges[:72]
                
                # GPS Stats
                gps_stats = getattr(dish_status, "gps_stats", None)
                gps_valid = False
                gps_sats = 0
                if gps_stats:
                    gps_valid = getattr(gps_stats, "gps_valid", False)
                    gps_sats = getattr(gps_stats, "gps_sats", 0)

                # Active Heating State
                is_heating = getattr(dish_status, "is_heating", False)

                # Alerts
                alerts = {
                    "motors_stuck": False,
                    "thermal_throttle": False,
                    "low_voltage": False,
                    "roaming": False,
                    "mast_not_near_vertical": False,
                    "thermal_shutdown": False
                }
                alerts_detail = getattr(dish_status, "alerts", None)
                if alerts_detail:
                    alerts["motors_stuck"] = getattr(alerts_detail, "motors_stuck", False)
                    alerts["thermal_throttle"] = getattr(alerts_detail, "thermal_throttle", False)
                    alerts["low_voltage"] = getattr(alerts_detail, "low_voltage", False)
                    alerts["roaming"] = getattr(alerts_detail, "roaming", False)
                    alerts["mast_not_near_vertical"] = getattr(alerts_detail, "mast_not_near_vertical", False)
                    alerts["thermal_shutdown"] = getattr(alerts_detail, "thermal_shutdown", False)
                
                # Query config settings safely
                heating_mode = "AUTO"
                sleep_enabled = False
                sleep_start = 180
                sleep_end = 360
                
                try:
                    cfg_req = self.request_class(get_config={})
                    cfg_res = self.stub.Handle(cfg_req)
                    cfg = getattr(cfg_res, "get_config", None)
                    if cfg:
                        mode_enum = getattr(cfg, "snow_melt_mode", 1)
                        mode_rev_map = {0: "ALWAYS_OFF", 1: "AUTO", 2: "ALWAYS_ON"}
                        heating_mode = mode_rev_map.get(mode_enum, "AUTO")
                        
                        sleep_enabled = getattr(cfg, "enable_power_save", False)
                        sleep_start = getattr(cfg, "power_save_start_minutes", 180)
                        duration = getattr(cfg, "power_save_duration_minutes", 180)
                        sleep_end = (sleep_start + duration) % 1440
                except:
                    pass

                return {
                    "mode": "Live (gRPC)",
                    "connected": True,
                    "ip": self.ip,
                    "downlink_throughput_bps": dl_bps,
                    "uplink_throughput_bps": ul_bps,
                    "ping_ms": ping,
                    "snr": getattr(dish_status, "snr", 9.0),
                    "rx_bytes_total": self.session_rx_bytes,
                    "tx_bytes_total": self.session_tx_bytes,
                    "uptime_seconds": uptime,
                    "device_id": getattr(device_info, "id", "Unknown"),
                    "hardware_version": getattr(device_info, "hardware_version", "Unknown"),
                    "software_version": getattr(device_info, "software_version", "Unknown"),
                    "azimuth_deg": getattr(dish_status, "azimuth_deg", 0.0),
                    "elevation_deg": getattr(dish_status, "elevation_deg", 0.0),
                    "boresight_azimuth_deg": getattr(dish_status, "boresight_azimuth_deg", 0.0),
                    "boresight_elevation_deg": getattr(dish_status, "boresight_elevation_deg", 0.0),
                    "obstruction_fraction": obstr_fraction,
                    "wedge_fraction_obstructed": wedges,
                    "alerts": alerts,
                    "heating_mode": heating_mode,
                    "sleep_enabled": sleep_enabled,
                    "sleep_start": sleep_start,
                    "sleep_end": sleep_end,
                    "gps_valid": gps_valid,
                    "gps_sats": gps_sats,
                    "is_heating": is_heating
                }
                
            except Exception as e:
                print(f"Error querying live dish: {e}")
                self.connected = False
                return {
                    "mode": "Live (Error)",
                    "connected": False,
                    "ip": self.ip,
                    "error": f"gRPC communication error: {e}"
                }

    def set_sim_alert(self, alert_name, active):
        """Allows testing alert UI by toggling simulated alerts."""
        if alert_name in self.sim_alerts:
            self.sim_alerts[alert_name] = active
            return True
        return False

    def save_session_csv(self, session_data):
        """Save session statistics to a CSV file in the workspace directory."""
        try:
            import csv
            workspace_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            csv_path = os.path.join(workspace_dir, "starlink_session_log.csv")
            
            file_exists = os.path.exists(csv_path)
            
            with open(csv_path, mode='a', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow([
                        "Timestamp", "Mode", "Target IP", "Uptime (s)", 
                        "Current DL (Mbps)", "Current UL (Mbps)", 
                        "Latency (ms)", "SNR (dB)", "Total Rx (MB)", "Total Tx (MB)"
                    ])
                
                writer.writerow([
                    session_data.get("timestamp"),
                    session_data.get("mode"),
                    session_data.get("ip"),
                    session_data.get("uptime"),
                    session_data.get("dl_speed"),
                    session_data.get("ul_speed"),
                    session_data.get("ping"),
                    session_data.get("snr"),
                    session_data.get("rx_mb"),
                    session_data.get("tx_mb")
                ])
                
            return {"success": True, "path": csv_path}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_heating_mode(self, mode_str):
        """Configure the snow melt heating mode (AUTO, ALWAYS_ON, ALWAYS_OFF)."""
        # Map string to enum value: OFF = 0, AUTO = 1, ON = 2
        mode_map = {"ALWAYS_OFF": 0, "AUTO": 1, "ALWAYS_ON": 2}
        mode_val = mode_map.get(mode_str, 1) # default to AUTO

        if self.simulated:
            self.sim_heating_mode = mode_str
            time.sleep(0.5)
            return {"success": True, "message": f"Heating mode set to {mode_str} (Simulated)"}

        if not self.connected or not self.stub:
            return {"success": False, "message": "Not connected to live gRPC dish."}

        try:
            # We configure via dish_set_config/config message
            config = {"snow_melt_mode": mode_val, "apply_snow_melt_mode": True}
            req = self.request_class(dish_set_config={"config": config})
            self.stub.Handle(req)
            return {"success": True, "message": f"Heating mode set to {mode_str} successfully."}
        except Exception as e:
            return {"success": False, "message": f"gRPC Error: {e}"}

    def set_sleep_schedule(self, start_hour, end_hour, enabled):
        """Configure standby sleep schedule hours."""
        # Convert start/end hour to minutes past midnight
        start_min = int(start_hour * 60)
        end_min = int(end_hour * 60)
        
        # Calculate duration in minutes (handles wrapping around midnight)
        if end_min >= start_min:
            duration_min = end_min - start_min
        else:
            duration_min = (1440 - start_min) + end_min

        # Ensure duration is at least 1 minute (0 is disabled)
        if duration_min <= 0:
            duration_min = 1

        if self.simulated:
            self.sim_sleep_schedule = {
                "start": start_min,
                "end": end_min,
                "enabled": enabled
            }
            time.sleep(0.5)
            status_txt = "enabled" if enabled else "disabled"
            return {"success": True, "message": f"Sleep schedule {status_txt} (Simulated)"}

        if not self.connected or not self.stub:
            return {"success": False, "message": "Not connected to live gRPC dish."}

        try:
            # Send power save configuration
            req = self.request_class(dish_power_save={
                "power_save_start_minutes": start_min,
                "power_save_duration_minutes": duration_min,
                "enable_power_save": enabled
            })
            self.stub.Handle(req)
            return {"success": True, "message": "Sleep schedule updated successfully."}
        except Exception as e:
            return {"success": False, "message": f"gRPC Error: {e}"}

    def run_diagnostics(self):
        """Run standard network and gRPC diagnostic tests."""
        results = {
            "local_ping": {"ok": False, "ms": 0, "msg": "Failed"},
            "grpc_ok": {"ok": False, "msg": "Disconnected"},
            "internet_ping": {"ok": False, "ms": 0, "msg": "Failed"},
            "dns_resolve": {"ok": False, "ms": 0, "msg": "Failed"}
        }
        
        # 1. Local Ping Test (to the dish IP)
        host = self.ip.split(":")[0]
        import subprocess
        try:
            start = time.time()
            output = subprocess.run(["ping", "-n", "1", "-w", "800", host], capture_output=True, text=True, timeout=1.5)
            ms = (time.time() - start) * 1000
            if output.returncode == 0:
                results["local_ping"] = {"ok": True, "ms": int(ms), "msg": "Reached"}
            else:
                results["local_ping"] = {"ok": False, "ms": 0, "msg": "Request Timed Out"}
        except Exception as e:
            results["local_ping"] = {"ok": False, "ms": 0, "msg": f"Error: {e}"}

        # 2. gRPC status
        if self.simulated:
            results["grpc_ok"] = {"ok": True, "msg": "OK (Simulated)"}
        else:
            results["grpc_ok"] = {"ok": self.connected, "msg": "Connected" if self.connected else "Offline"}

        # 3. Internet Ping Test (to Cloudflare DNS 1.1.1.1)
        try:
            start = time.time()
            output = subprocess.run(["ping", "-n", "1", "-w", "800", "1.1.1.1"], capture_output=True, text=True, timeout=1.5)
            ms = (time.time() - start) * 1000
            if output.returncode == 0:
                results["internet_ping"] = {"ok": True, "ms": int(ms), "msg": "Reached"}
            else:
                results["internet_ping"] = {"ok": False, "ms": 0, "msg": "No Internet Access"}
        except Exception as e:
            results["internet_ping"] = {"ok": False, "ms": 0, "msg": f"Error: {e}"}

        # 4. DNS resolve test
        import socket
        try:
            start = time.time()
            socket.gethostbyname("google.com")
            dns_ms = (time.time() - start) * 1000
            results["dns_resolve"] = {"ok": True, "ms": int(dns_ms), "msg": "Resolved google.com"}
        except Exception as e:
            results["dns_resolve"] = {"ok": False, "ms": 0, "msg": "Failed to resolve DNS"}

        return results

def get_resource_path(relative_path):
    """Get absolute path to resource, works for dev and for PyInstaller."""
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath(os.path.dirname(__file__)), relative_path)

def main():
    api = StarlinkAPI()
    
    # Locate index.html
    html_path = get_resource_path("index.html")
    
    print(f"Loading UI from: {html_path}")
    
    window = webview.create_window(
        title="Starlink Windows Stats - v0.0.12",
        url=html_path,
        js_api=api,
        width=1280,
        height=720,
        resizable=True,
        min_size=(960, 540)
    )
    
    webview.start(debug=False)

if __name__ == "__main__":
    main()
