"""
flask_server.py — Ground station dashboard backend

Reads the receiver ESP32's Serial output and serves it to the React dashboard.

The receiver emits three types of structured lines:
  SENSOR_JSON:{...}   → parsed and appended to sensor_history
  IMG_HEX:<hexstr>    → decoded to JPEG bytes, served as /api/image
  IR_JSON:[f1,f2,...] → parsed to float array, served as /api/ir

All other lines are treated as log output and forwarded to /api/log.

Usage:
  pip install flask pyserial flask-cors
  python flask_server.py --port /dev/tty.usbserial-XXXX

  On Mac:   ls /dev/tty.usb*   to find the port
  On Win:   Use COM3, COM4, etc.
  On Linux: /dev/ttyUSB0 or /dev/ttyACM0
"""

import argparse
import base64
import json
import threading
import time
import serial
from collections import deque
from flask import Flask, jsonify, Response
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Allow React dev server (localhost:5173) to talk to Flask (localhost:5000)

# ── Shared state (written by serial thread, read by Flask routes) ──────────
sensor_history = []          # list of dicts, one per completed capture cycle
latest_image_bytes = None    # raw JPEG bytes of the most recently received image
session_images = []          # ALL images received this session: [{timestamp, b64, size_bytes}]
latest_ir = []               # list of 768 floats (32x24 IR grid) — most recent frame
ir_gallery = []              # ALL IR frames this session: [{timestamp, frame, min, max}]
log_lines = deque(maxlen=200)

state_lock = threading.Lock()
serial_ref = {"port": None}   # holds the live Serial object so routes can write to it
# ──────────────────────────────────────────────────────────────────────────


def parse_serial(port: str, baud: int = 115200):
    """
    Background thread: opens the serial port and processes incoming lines.
    Each line is classified and stored in the shared state above.
    """
    global latest_image_bytes, latest_ir

    print(f"[serial] Opening {port} at {baud} baud...")
    try:
        ser = serial.Serial(port, baud, timeout=1)
    except serial.SerialException as e:
        print(f"[serial] ERROR: {e}")
        print("[serial] Running in DEMO mode — sending simulated data every 10s")
        _demo_mode()
        return

    print(f"[serial] Connected to {port}")
    serial_ref["port"] = ser   # expose to Flask routes for writing

    while True:
        try:
            raw = ser.readline()
            if not raw:
                continue
            line = raw.decode("utf-8", errors="replace").strip()
        except Exception as e:
            print(f"[serial] Read error: {e}")
            time.sleep(1)
            continue

        # ── Sensor JSON ──────────────────────────────────────────────────
        if line.startswith("SENSOR_JSON:"):
            json_str = line[len("SENSOR_JSON:"):]
            try:
                reading = json.loads(json_str)
                # Add wall-clock timestamp alongside the ESP32 millis() value
                reading["wall_time"] = time.time()
                with state_lock:
                    sensor_history.append(reading)
                print(f"[serial] 📊 Sensor reading #{len(sensor_history)}: "
                      f"T={reading.get('temp')}°C  Alt={reading.get('alt')}m  "
                      f"GPS={reading.get('lat')},{reading.get('lon')}")
            except json.JSONDecodeError as e:
                print(f"[serial] ⚠ Bad SENSOR_JSON: {e}")

        # ── Image hex ────────────────────────────────────────────────────
        elif line.startswith("IMG_HEX:"):
            hex_str = line[len("IMG_HEX:"):]
            try:
                img_bytes = bytes.fromhex(hex_str)
                b64 = base64.b64encode(img_bytes).decode("utf-8")
                entry = {
                    "timestamp": time.time(),
                    "image": f"data:image/jpeg;base64,{b64}",
                    "size_bytes": len(img_bytes),
                    "index": len(session_images),  # 0-based position in gallery
                }
                with state_lock:
                    latest_image_bytes = img_bytes
                    session_images.append(entry)
                print(f"[serial] 📸 Image #{len(session_images)} received: {len(img_bytes)} bytes")
            except ValueError as e:
                print(f"[serial] ⚠ Bad IMG_HEX: {e}")

        # ── IR JSON ──────────────────────────────────────────────────────
        elif line.startswith("IR_JSON:"):
            json_str = line[len("IR_JSON:"):]
            try:
                ir_data = json.loads(json_str)
                mn = min(ir_data)
                mx = max(ir_data)
                entry = {
                    "timestamp": time.time(),
                    "frame": ir_data,
                    "min": mn,
                    "max": mx,
                    "index": len(ir_gallery),
                }
                with state_lock:
                    latest_ir = ir_data
                    ir_gallery.append(entry)
                print(f"[serial] 🔥 IR frame #{len(ir_gallery)} received: {len(ir_data)} values, {mn:.1f}–{mx:.1f}°C")
            except json.JSONDecodeError as e:
                print(f"[serial] ⚠ Bad IR_JSON: {e}")

        # ── Everything else goes to the log ──────────────────────────────
        else:
            with state_lock:
                log_lines.append({"t": time.time(), "msg": line})
            # Also print to terminal for debugging
            print(f"[recv] {line}")


def _demo_mode():
    """
    Generates fake sensor readings every 15 seconds when no serial port is
    available. Also adds a placeholder image entry so the gallery works.
    In real use the cycle is every 5 minutes; demo is compressed for testing.
    """
    import math, random
    # tiny 1x1 grey JPEG as placeholder image in demo mode
    GREY_JPEG_HEX = (
        "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707"
        "070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c"
        "1c2837292c30313434341f27393d38323c2e333432ffffc000110800010001011100"
        "ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc4"
        "00b5100002010303020403050504040000017d01020300041105122131410613516107"
        "2232811491a1082342b1c11552d1f02433627282090a161718191a25262728292a3435"
        "363738393a434445464748494a535455565758595a636465666768696a737475767778"
        "797a838485868788898a929394959697989990a0a0b0c0d0e0f1a1b1c1d1e1f2a2b2c"
        "2d2e2f3a3b3c3d3e3f4a4b4c4d4e4f5a5b5c5d5e5f6a6b6c6d6e6f7a7b7c7d7e7f"
        "8a8b8c8d8e8f9a9b9c9d9e9fa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4"
        "c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8"
        "f9faffda000c03010002110311003f00f8c28a2803fffd9"
    )
    try:
        placeholder = bytes.fromhex(GREY_JPEG_HEX.replace("\n",""))
        placeholder_b64 = base64.b64encode(placeholder).decode()
    except Exception:
        placeholder_b64 = ""

    t = 0
    while True:
        t += 1
        reading = {
            "t": t * 15000,
            "wall_time": time.time(),
            "temp": round(20 - t * 0.3 + random.uniform(-0.5, 0.5), 2),
            "pres": round(1013 - t * 1.2 + random.uniform(-0.2, 0.2), 2),
            "hum": round(50 + math.sin(t * 0.3) * 10 + random.uniform(-1, 1), 2),
            "alt": round(t * 80 + random.uniform(-5, 5), 1),
            "yaw": round(math.sin(t * 0.1) * 30, 2),
            "pitch": round(math.cos(t * 0.15) * 15, 2),
            "roll": round(math.sin(t * 0.2) * 10, 2),
            "lat": round(34.0522 + t * 0.0001, 6),
            "lon": round(-118.2437 + t * 0.0001, 6),
            "gpsAlt": round(t * 80 + random.uniform(-3, 3), 1),
            "sats": random.randint(6, 12),
            "gpsValid": True,
            "loraLat": round(34.0522, 6),
            "loraLon": round(-118.2437, 6),
        }
        img_entry = {
            "timestamp": time.time(),
            "image": f"data:image/jpeg;base64,{placeholder_b64}",
            "size_bytes": len(placeholder) if placeholder_b64 else 0,
            "index": t - 1,
        }
        import random as _r
        # fake 32x24 IR frame — warm blob in center, cooler edges
        fake_frame = []
        for row in range(24):
            for col in range(32):
                cx = abs(col - 16) / 16.0
                cy = abs(row - 12) / 12.0
                dist = (cx**2 + cy**2) ** 0.5
                temp = 30.0 - dist * 8.0 + _r.uniform(-0.3, 0.3) + reading["temp"] - 20
                fake_frame.append(round(temp, 1))
        ir_entry = {
            "timestamp": time.time(),
            "frame": fake_frame,
            "min": min(fake_frame),
            "max": max(fake_frame),
            "index": t - 1,
        }
        with state_lock:
            sensor_history.append(reading)
            session_images.append(img_entry)
            latest_ir = fake_frame
            ir_gallery.append(ir_entry)
            log_lines.append({"t": time.time(), "msg": f"[DEMO] Cycle #{t} complete"})
        print(f"[demo] Cycle #{t}: T={reading['temp']}°C  Alt={reading['alt']}m  Images so far: {t}")
        time.sleep(15)


# ── Flask routes ───────────────────────────────────────────────────────────

@app.route("/api/sensor-history")
def get_sensor_history():
    """
    Returns ALL sensor readings accumulated since server start.
    The React dashboard accumulates these into scatter plots.
    Each reading has: t, wall_time, temp, pres, hum, alt, yaw, pitch, roll,
                      lat, lon, gpsAlt, sats, gpsValid, loraLat, loraLon
    """
    with state_lock:
        return jsonify(sensor_history)


@app.route("/api/sensor-latest")
def get_sensor_latest():
    """Returns only the most recent sensor reading (for stat cards)."""
    with state_lock:
        if sensor_history:
            return jsonify(sensor_history[-1])
        return jsonify(None)


@app.route("/api/image")
def get_image():
    """Returns the most recently received JPEG image."""
    with state_lock:
        if latest_image_bytes is None:
            return jsonify({"image": None, "timestamp": None})
        b64 = base64.b64encode(latest_image_bytes).decode("utf-8")
        return jsonify({
            "image": f"data:image/jpeg;base64,{b64}",
            "timestamp": time.time(),
            "size_bytes": len(latest_image_bytes),
        })


@app.route("/api/images-gallery")
def get_images_gallery():
    """
    Returns ALL images captured this session as an array, newest first.
    Each entry: { index, timestamp, image (data URI), size_bytes }
    The dashboard uses this to show a browsable photo gallery.
    """
    with state_lock:
        return jsonify(list(reversed(session_images)))


@app.route("/api/ir")
def get_ir():
    """
    Returns the most recent IR frame as a flat array of 768 floats (32x24).
    Response: { "frame": [...768 floats...], "min": f, "max": f }
    """
    with state_lock:
        if not latest_ir:
            return jsonify({"frame": None})
        mn = min(latest_ir)
        mx = max(latest_ir)
        return jsonify({"frame": latest_ir, "min": mn, "max": mx})


@app.route("/api/ir-gallery")
def get_ir_gallery():
    """
    Returns ALL IR frames captured this session, newest first.
    Each entry: { index, timestamp, frame, min, max }
    The dashboard uses this to browse past thermal frames.
    """
    with state_lock:
        return jsonify(list(reversed(ir_gallery)))


@app.route("/api/log")
def get_log():
    """Returns the last 200 lines of raw serial output for the log panel."""
    with state_lock:
        return jsonify(list(log_lines))


@app.route("/api/status")
def get_status():
    with state_lock:
        return jsonify({
            "ok": True,
            "sensor_readings": len(sensor_history),
            "has_image": latest_image_bytes is not None,
            "image_count": len(session_images),
            "has_ir": len(latest_ir) > 0,
            "ir_count": len(ir_gallery),
        })


@app.route("/api/start", methods=["POST"])
def post_start():
    """Send START command to the receiver ESP32 over serial."""
    ser = serial_ref.get("port")
    if ser is None:
        return jsonify({"ok": False, "error": "Serial port not connected (demo mode)"}), 400
    try:
        ser.write(b"START\n")
        print("[flask] 📤 Sent START to receiver")
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/stop", methods=["POST"])
def post_stop():
    """Send STOP command to the receiver ESP32 over serial."""
    ser = serial_ref.get("port")
    if ser is None:
        return jsonify({"ok": False, "error": "Serial port not connected (demo mode)"}), 400
    try:
        ser.write(b"STOP\n")
        print("[flask] 🛑 Sent STOP to receiver")
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ── Entry point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CubeSat ground station dashboard server")
    parser.add_argument("--port", default=None,
                        help="Serial port (e.g. /dev/tty.usbserial-XXXX or COM3). "
                             "Omit to run in demo mode with simulated data.")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--flask-port", type=int, default=5000)
    args = parser.parse_args()

    # Start serial reader in background thread
    serial_thread = threading.Thread(
        target=parse_serial,
        args=(args.port or "DEMO", args.baud),
        daemon=True,
    )
    serial_thread.start()

    print(f"[flask] Starting on http://{args.host}:{args.flask_port}")
    app.run(host=args.host, port=args.flask_port, debug=False)