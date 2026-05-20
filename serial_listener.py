"""
serial_listener.py - CubeSat Balloon Flight
Reads the ground station receiver's Serial output, parses incoming
sensor data, and serves it as live JSON at localhost:8000.
Stops listening on Serial when all transfers are complete but keeps
the Flask server running so the dashboard can still fetch data.

Endpoints:
  GET /data   - all parsed sensor readings
  GET /log    - all raw Serial lines with timestamps and color tags
  GET /status - health check
  POST /clear - clear all data

USAGE:
  python3 serial_listener.py --port /dev/cu.usbmodem101 --baud 115200

REQUIREMENTS:
  pip3 install pyserial flask flask-cors
"""

import argparse
import re
import threading
from datetime import datetime
from flask import Flask, jsonify
from flask_cors import CORS
import serial

app = Flask(__name__)
CORS(app)

# Shared state
readings      = []
log_lines     = []
readings_lock = threading.Lock()
log_lock      = threading.Lock()

MAX_LOG_LINES = 500

# ── Color tag classifier ───────────────────────────────────────────────────
def classify_line(line):
    if any(x in line for x in ["FAIL", "ERROR", "failed", "FAILED"]):
        return "error"
    if any(x in line for x in ["TIMEOUT", "DROP", "missing", "MISSING"]):
        return "warning"
    if any(x in line for x in ["COMPLETE", "SAVED", "READY", "SENT", "OK", "START"]):
        return "success"
    if any(x in line for x in ["Packet", "Type:", "Sent", "Queued", "RESEND", "Receiving"]):
        return "packet"
    return "info"

# ── Sensor block parser ────────────────────────────────────────────────────
def parse_sensor_block(block):
    data = {
        "Timestamp":    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "Temperature":  None,
        "Pressure":     None,
        "Humidity":     None,
        "Altitude":     None,
        "Accel_X":      None,
        "Accel_Y":      None,
        "Accel_Z":      None,
        "Latitude":     None,
        "Longitude":    None,
        "GPS_Altitude": None,
        "Satellites":   None,
        "GPS_Valid":    None,
    }

    def extract(pattern, text, cast=float):
        m = re.search(pattern, text)
        if m:
            try:
                return cast(m.group(1))
            except:
                return m.group(1)
        return None

    data["Temperature"]  = extract(r"Temperature:([\d.\-]+)", block)
    data["Pressure"]     = extract(r"Pressure:([\d.\-]+)", block)
    data["Humidity"]     = extract(r"Humidity:([\d.\-]+)", block)
    data["Altitude"]     = extract(r"Altitude:([\d.\-]+)", block)
    data["Accel_X"]      = extract(r"X:([\d.\-]+)", block)
    data["Accel_Y"]      = extract(r"Y:([\d.\-]+)", block)
    data["Accel_Z"]      = extract(r"Z:([\d.\-]+)", block)
    data["Latitude"]     = extract(r"Latitude:([\d.\-]+)", block)
    data["Longitude"]    = extract(r"Longitude:([\d.\-]+)", block)
    data["GPS_Altitude"] = extract(r"GPS_Altitude:([\d.\-]+)", block)
    data["Satellites"]   = extract(r"Satellites:(\d+)", block, cast=int)
    data["GPS_Valid"]    = extract(r"GPS_Valid:(\w+)", block, cast=str)

    if any(v is not None for k, v in data.items() if k != "Timestamp"):
        return data
    return None

# ── Serial reader thread ───────────────────────────────────────────────────
def read_serial(port, baud):
    print(f"Connecting to {port} at {baud} baud...")
    try:
        ser = serial.Serial(port, baud, timeout=1)
        print(f"Connected. Listening for sensor data...")
    except serial.SerialException as e:
        print(f"ERROR: Could not open port {port}: {e}")
        return

    in_block      = False
    block_lines   = []
    transfer_done = False

    while not transfer_done:
        try:
            raw = ser.readline()
            if not raw:
                continue
            line = raw.decode("utf-8", errors="ignore").strip()
            if not line:
                continue

            print(f"[Serial] {line}")

            # Append to log with timestamp and color tag
            with log_lock:
                log_lines.append({
                    "time":  datetime.now().strftime("%H:%M:%S"),
                    "text":  line,
                    "color": classify_line(line)
                })
                if len(log_lines) > MAX_LOG_LINES:
                    del log_lines[0]

            # Stop listening once all transfers are complete
            if "All transfers complete with no missing packets!" in line:
                print("All transfers complete. Stopping serial listener. Flask server still running.")
                transfer_done = True
                continue

            # Also stop after resend phase if it ran
            if "ALL FILES COMPLETE" in line:
                print("All files complete. Stopping serial listener. Flask server still running.")
                transfer_done = True
                continue

            # Detect sensor data block boundaries
            if "LIVE SENSOR DATA" in line and "======" in line and not in_block:
                in_block    = True
                block_lines = []
                continue

            if in_block and "======" in line:
                in_block   = False
                block_text = "\n".join(block_lines)
                reading    = parse_sensor_block(block_text)
                if reading:
                    with readings_lock:
                        readings.append(reading)
                    print(f"[Parsed] New reading added. Total: {len(readings)}")
                block_lines = []
                continue

            if in_block:
                block_lines.append(line)

        except Exception as e:
            print(f"[Serial Error] {e}")
            continue

    ser.close()
    print("Serial port closed. Dashboard still available at http://localhost:8000")

# ── Flask routes ───────────────────────────────────────────────────────────
@app.route("/data")
def get_data():
    with readings_lock:
        return jsonify(readings)

@app.route("/log")
def get_log():
    with log_lock:
        return jsonify(log_lines)

@app.route("/status")
def get_status():
    with readings_lock:
        with log_lock:
            return jsonify({
                "status":    "running",
                "readings":  len(readings),
                "log_lines": len(log_lines),
                "latest":    readings[-1] if readings else None
            })

@app.route("/clear", methods=["POST"])
def clear_data():
    with readings_lock:
        readings.clear()
    with log_lock:
        log_lines.clear()
    return jsonify({"status": "cleared"})

# ── Main ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CubeSat Serial Listener")
    parser.add_argument("--port",        required=True,  help="Serial port (e.g. /dev/cu.usbmodem101)")
    parser.add_argument("--baud",        default=115200, type=int)
    parser.add_argument("--host",        default="localhost")
    parser.add_argument("--server-port", default=8000,   type=int)
    args = parser.parse_args()

    serial_thread = threading.Thread(
        target=read_serial,
        args=(args.port, args.baud),
        daemon=True
    )
    serial_thread.start()

    print(f"Starting live server at http://{args.host}:{args.server_port}")
    app.run(host=args.host, port=args.server_port, debug=False)