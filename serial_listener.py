"""
Reads the Heltec receiver ESP32's Serial output over USB and serves
structured data to the React dashboard over HTTP (localhost:5000).

The Heltec receiver reassembles LoRa packets from the XIAO ESP32S3 sender
into three file types, then dumps them over Serial as structured lines:

  SENSOR_JSON:{...}   → parsed and appended to sensor_history
  IMG_HEX:<hexstr>    → decoded to JPEG bytes, served as /api/image
  IR_JSON:[f1,f2...]  → parsed to float array, served as /api/ir

All other lines (log messages, packet status, ARQ events) are forwarded
to /api/log and also watched for FILE_SAVED / FILE_COMPLETE events that
trigger in-place gallery reloads after ARQ resend phases complete.

Usage:
  pip install flask pyserial flask-cors
  python serial_listener.py --port /dev/tty.usbserial-XXXX

  Mac:   ls /dev/tty.usb*    to find the port
  Win:   COM3, COM4, etc.
  Linux: /dev/ttyUSB0 or /dev/ttyACM0

  Omit --port to run in demo mode with simulated data.
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
# Allow React dev server (localhost:5173) to call Flask (localhost:5000)
CORS(app)

# ── Shared state ───────────────────────────────────────────────────────────
# Written by the serial reader thread, read by Flask route handlers.
# All access must be protected by state_lock to avoid race conditions.

sensor_history      = []          # list of dicts, one per completed sensor reading
latest_image_bytes  = None        # raw JPEG bytes of the most recently received image
session_images      = []          # all images this session: [{timestamp, image (b64 data URI), size_bytes, version}]
latest_ir           = []          # most recent IR frame: flat list of 768 floats (32×24 grid)
ir_gallery          = []          # all IR frames this session: [{timestamp, frame, min, max, version}]
log_lines           = deque(maxlen=200)  # rolling window of last 200 serial log lines

# Maps saved filename → gallery list index so we can update entries in-place
# after the ARQ resend phase patches a previously incomplete file.
_img_file_index = {}   # e.g. "/img_847666.jpg" → 0
_ir_file_index  = {}   # e.g. "/ir_946096.bin"  → 0

state_lock = threading.Lock()
serial_ref = {"port": None}  # holds the live Serial object so Flask routes can write to it


# ── Serial reader thread ───────────────────────────────────────────────────

def parse_serial(port: str, baud: int = 115200):
    """
    Background thread: opens the serial port and processes incoming lines forever.

    Line classification:
      SENSOR_JSON:  → parse JSON, append to sensor_history
      IMG_HEX:      → hex-decode to JPEG bytes, append to session_images
      IR_JSON:      → parse float array, append to ir_gallery
      FILE SAVED:   → record filename→gallery index mapping for later ARQ reload
      FILE COMPLETE → re-read completed file from disk and update gallery entry in-place
      anything else → append to log_lines, print to terminal
    """
    global latest_image_bytes, latest_ir

    print(f"[serial] Opening {port} at {baud} baud...")
    try:
        ser = serial.Serial(port, baud, timeout=1)
    except serial.SerialException as e:
        print(f"[serial] ERROR: {e}")
        print("[serial] Could not open serial port. Exiting.")
        return

    print(f"[serial] Connected to {port}")
    serial_ref["port"] = ser  # expose to Flask routes for sending commands

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
        # Format: SENSOR_JSON:{"temp":22.1,"pres":1013.2,...}
        if line.startswith("SENSOR_JSON:"):
            json_str = line[len("SENSOR_JSON:"):]
            try:
                reading = json.loads(json_str)
                reading["wall_time"] = time.time()  # add server-side timestamp
                with state_lock:
                    sensor_history.append(reading)
                print(f"[serial] 📊 Sensor #{len(sensor_history)}: "
                      f"T={reading.get('temp')}°C  Alt={reading.get('alt')}m  "
                      f"GPS={reading.get('lat')},{reading.get('lon')}")
            except json.JSONDecodeError as e:
                print(f"[serial] ⚠ Bad SENSOR_JSON: {e}")

        # ── Image hex ────────────────────────────────────────────────────
        # Format: IMG_HEX:<hex-encoded JPEG bytes>
        # The receiver sends the full JPEG as a single hex string after
        # reassembling all LoRa packets (including any ARQ resends).
        elif line.startswith("IMG_HEX:"):
            hex_str = line[len("IMG_HEX:"):]
            try:
                img_bytes = bytes.fromhex(hex_str)
                b64 = base64.b64encode(img_bytes).decode("utf-8")
                entry = {
                    "timestamp":  time.time(),
                    "image":      f"data:image/jpeg;base64,{b64}",
                    "size_bytes": len(img_bytes),
                    "index":      len(session_images),  # 0-based gallery position
                    "version":    1,  # incremented each time the file is reloaded after ARQ
                }
                with state_lock:
                    latest_image_bytes = img_bytes
                    session_images.append(entry)
                print(f"[serial] 📸 Image #{len(session_images)}: {len(img_bytes)} bytes")
            except ValueError as e:
                print(f"[serial] ⚠ Bad IMG_HEX: {e}")

        # ── IR JSON ──────────────────────────────────────────────────────
        # Format: IR_JSON:[22.1, 22.3, ..., 31.4]  (768 floats, 32×24 grid)
        elif line.startswith("IR_JSON:"):
            json_str = line[len("IR_JSON:"):]
            try:
                ir_data = json.loads(json_str)
                mn, mx = min(ir_data), max(ir_data)
                entry = {
                    "timestamp": time.time(),
                    "frame":     ir_data,
                    "min":       mn,
                    "max":       mx,
                    "index":     len(ir_gallery),
                    "version":   1,
                }
                with state_lock:
                    latest_ir = ir_data
                    ir_gallery.append(entry)
                print(f"[serial] 🔥 IR frame #{len(ir_gallery)}: {len(ir_data)} values, {mn:.1f}–{mx:.1f}°C")
            except json.JSONDecodeError as e:
                print(f"[serial] ⚠ Bad IR_JSON: {e}")

        # ── All other lines go to the log ─────────────────────────────────
        else:
            with state_lock:
                log_lines.append({"t": time.time(), "msg": line})
            print(f"[recv] {line}")

            # ── Track FILE SAVED lines to map filename → gallery index ────
            # The receiver logs: ✅ FILE SAVED: /img_847666.jpg
            # We record the mapping so we can find the right gallery entry
            # later when the ARQ resend phase completes and we need to reload.
            if "FILE SAVED:" in line:
                fname = line.split("FILE SAVED:")[-1].strip()
                with state_lock:
                    if fname.endswith(".jpg") or fname.endswith(".jpeg"):
                        idx = len(session_images) - 1
                        if idx >= 0:
                            _img_file_index[fname] = idx
                            print(f"[serial] 🗂 Tracked img: {fname} → gallery[{idx}]")
                    elif fname.endswith(".bin"):
                        idx = len(ir_gallery) - 1
                        if idx >= 0:
                            _ir_file_index[fname] = idx
                            print(f"[serial] 🗂 Tracked IR: {fname} → ir_gallery[{idx}]")

            # ── Reload image after ARQ resend phase completes ─────────────
            # The receiver logs: 🎉 IMAGE file is now COMPLETE!
            # At this point the .jpg on disk is fully patched with the resent
            # packets, so we re-read it and update the gallery entry in-place.
            # The React dashboard detects the version bump and re-renders.
            elif "IMAGE file is now COMPLETE" in line:
                with state_lock:
                    if _img_file_index:
                        # Use the most recently tracked image file
                        fname = max(_img_file_index, key=_img_file_index.get)
                        idx   = _img_file_index[fname]
                        try:
                            with open(fname, "rb") as f:
                                img_bytes = f.read()
                            b64 = base64.b64encode(img_bytes).decode("utf-8")
                            session_images[idx]["image"]      = f"data:image/jpeg;base64,{b64}"
                            session_images[idx]["size_bytes"] = len(img_bytes)
                            session_images[idx]["version"]    = session_images[idx].get("version", 1) + 1
                            latest_image_bytes = img_bytes
                            print(f"[serial] 🔄 Reloaded image after ARQ: {fname} "
                                  f"({len(img_bytes)} bytes, v{session_images[idx]['version']})")
                        except Exception as e:
                            print(f"[serial] ⚠ Could not reload image {fname}: {e}")

            # ── Reload IR after ARQ resend phase completes ────────────────
            # Same pattern as image reload above, but for .bin IR files.
            # The .bin stores 768 uint16 values (compressed floats).
            # Decompress: value / (65535 / 340) - 40 → temperature in °C
            elif "IR file is now COMPLETE" in line:
                with state_lock:
                    if _ir_file_index:
                        fname = max(_ir_file_index, key=_ir_file_index.get)
                        idx   = _ir_file_index[fname]
                        try:
                            with open(fname, "rb") as f:
                                raw = f.read()
                            # IR bin: 768 uint16 values, each compressed from float
                            # Encoding on sender: uint16 = (temp + 40) * (65535 / 340)
                            # Decoding here:      temp   = uint16 * (340 / 65535) - 40
                            import struct
                            count   = len(raw) // 2
                            packed  = struct.unpack(f"{count}H", raw[:count * 2])
                            ir_data = [v * (340.0 / 65535.0) - 40.0 for v in packed]
                            mn, mx  = min(ir_data), max(ir_data)
                            ir_gallery[idx]["frame"]   = ir_data
                            ir_gallery[idx]["min"]     = mn
                            ir_gallery[idx]["max"]     = mx
                            ir_gallery[idx]["version"] = ir_gallery[idx].get("version", 1) + 1
                            latest_ir[:] = ir_data
                            print(f"[serial] 🔄 Reloaded IR after ARQ: {fname} "
                                  f"({count} values, v{ir_gallery[idx]['version']})")
                        except Exception as e:
                            print(f"[serial] ⚠ Could not reload IR {fname}: {e}")


# ── Demo mode ──────────────────────────────────────────────────────────────

def _demo_mode():
    """
    Generates fake sensor readings, images, and IR frames every 15 seconds
    when no serial port is provided. Useful for UI development without hardware.

    The real capture cycle runs every 5 minutes; demo is compressed to 15s.
    A tiny 1×1 grey JPEG placeholder is used as the demo image.
    IR frames are synthesized as a warm-centre, cool-edge Gaussian blob.
    """
    import math, random

    # Minimal valid 1×1 grey JPEG — used as placeholder in demo mode
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
        placeholder     = bytes.fromhex(GREY_JPEG_HEX.replace("\n", ""))
        placeholder_b64 = base64.b64encode(placeholder).decode()
    except Exception:
        placeholder_b64 = ""

    t = 0
    while True:
        t += 1
        reading = {
            "t":        t * 15000,
            "wall_time": time.time(),
            "temp":     round(20 - t * 0.3 + random.uniform(-0.5, 0.5), 2),
            "pres":     round(1013 - t * 1.2 + random.uniform(-0.2, 0.2), 2),
            "hum":      round(50 + math.sin(t * 0.3) * 10 + random.uniform(-1, 1), 2),
            "alt":      round(t * 80 + random.uniform(-5, 5), 1),
            "yaw":      round(math.sin(t * 0.1) * 30, 2),
            "pitch":    round(math.cos(t * 0.15) * 15, 2),
            "roll":     round(math.sin(t * 0.2) * 10, 2),
            "lat":      round(34.0522 + t * 0.0001, 6),
            "lon":      round(-118.2437 + t * 0.0001, 6),
            "gpsAlt":   round(t * 80 + random.uniform(-3, 3), 1),
            "sats":     random.randint(6, 12),
            "gpsValid": True,
            "loraLat":  round(34.0522, 6),
            "loraLon":  round(-118.2437, 6),
        }

        img_entry = {
            "timestamp":  time.time(),
            "image":      f"data:image/jpeg;base64,{placeholder_b64}",
            "size_bytes": len(placeholder) if placeholder_b64 else 0,
            "index":      t - 1,
            "version":    1,
        }

        # Synthesize a warm-centre IR frame: temperatures radiate outward from centre
        fake_frame = []
        for row in range(24):
            for col in range(32):
                cx   = abs(col - 16) / 16.0
                cy   = abs(row - 12) / 12.0
                dist = (cx**2 + cy**2) ** 0.5
                temp = 30.0 - dist * 8.0 + random.uniform(-0.3, 0.3) + reading["temp"] - 20
                fake_frame.append(round(temp, 1))

        ir_entry = {
            "timestamp": time.time(),
            "frame":     fake_frame,
            "min":       min(fake_frame),
            "max":       max(fake_frame),
            "index":     t - 1,
            "version":   1,
        }

        with state_lock:
            sensor_history.append(reading)
            session_images.append(img_entry)
            latest_ir = fake_frame
            ir_gallery.append(ir_entry)
            log_lines.append({"t": time.time(), "msg": f"[DEMO] Cycle #{t} complete"})

        print(f"[demo] Cycle #{t}: T={reading['temp']}°C  Alt={reading['alt']}m")
        time.sleep(15)


# ── Flask routes ───────────────────────────────────────────────────────────

@app.route("/api/sensor-history")
def get_sensor_history():
    """
    Returns ALL sensor readings accumulated since server start, oldest first.
    The React dashboard plots these as time-series charts.

    Each reading contains:
      t, wall_time, temp, pres, hum, alt, yaw, pitch, roll,
      lat, lon, gpsAlt, sats, gpsValid, loraLat, loraLon
    """
    with state_lock:
        return jsonify(sensor_history)


@app.route("/api/sensor-latest")
def get_sensor_latest():
    """Returns only the most recent sensor reading (used for stat cards)."""
    with state_lock:
        return jsonify(sensor_history[-1] if sensor_history else None)


@app.route("/api/image")
def get_image():
    """Returns the most recently received JPEG as a base64 data URI."""
    with state_lock:
        if latest_image_bytes is None:
            return jsonify({"image": None, "timestamp": None})
        b64 = base64.b64encode(latest_image_bytes).decode("utf-8")
        return jsonify({
            "image":      f"data:image/jpeg;base64,{b64}",
            "timestamp":  time.time(),
            "size_bytes": len(latest_image_bytes),
        })


@app.route("/api/images-gallery")
def get_images_gallery():
    """
    Returns ALL images captured this session, newest first.
    Each entry: { index, timestamp, image (data URI), size_bytes, version }

    version starts at 1 and increments each time the image is reloaded
    after ARQ resends complete. The React dashboard uses this to detect
    stale renders and force a re-render of the gallery thumbnail.
    """
    with state_lock:
        return jsonify(list(reversed(session_images)))


@app.route("/api/ir")
def get_ir():
    """
    Returns the most recent IR frame.
    Response: { frame: [...768 floats...], min: float, max: float }
    """
    with state_lock:
        if not latest_ir:
            return jsonify({"frame": None})
        return jsonify({"frame": latest_ir, "min": min(latest_ir), "max": max(latest_ir)})


@app.route("/api/ir-gallery")
def get_ir_gallery():
    """
    Returns ALL IR frames captured this session, newest first.
    Each entry: { index, timestamp, frame, min, max, version }

    version increments after ARQ reload, same as images-gallery.
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
    """
    Returns a health summary used by the dashboard header.
    { ok, sensor_readings, has_image, image_count, has_ir, ir_count }
    """
    with state_lock:
        return jsonify({
            "ok":              True,
            "sensor_readings": len(sensor_history),
            "has_image":       latest_image_bytes is not None,
            "image_count":     len(session_images),
            "has_ir":          len(latest_ir) > 0,
            "ir_count":        len(ir_gallery),
        })


@app.route("/api/start", methods=["POST"])
def post_start():
    """
    Sends START over serial to the Heltec receiver, which forwards it to
    the XIAO sender via ESP-NOW to trigger a capture-and-transmit cycle.
    """
    ser = serial_ref.get("port")
    if ser is None:
        return jsonify({"ok": False, "error": "Serial port not connected (demo mode)"}), 400
    try:
        ser.write(b"START\n")
        print("[flask] 📤 Sent START")
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/stop", methods=["POST"])
def post_stop():
    """
    Sends STOP over serial to the Heltec receiver to halt the capture loop.
    """
    ser = serial_ref.get("port")
    if ser is None:
        return jsonify({"ok": False, "error": "Serial port not connected (demo mode)"}), 400
    try:
        ser.write(b"STOP\n")
        print("[flask] 🛑 Sent STOP")
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ── Entry point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CubeSat SOAR26 ground station server")
    parser.add_argument("--port", default=None,
                        help="Serial port (e.g. /dev/tty.usbserial-XXXX or COM3). "
                             "Omit to run in demo mode.")
    parser.add_argument("--baud",       type=int, default=115200)
    parser.add_argument("--host",       default="0.0.0.0")
    parser.add_argument("--flask-port", type=int, default=5000)
    args = parser.parse_args()

    # Start the serial reader (or demo generator) in a background daemon thread
    target = parse_serial if args.port else _demo_mode
    t_args = (args.port, args.baud) if args.port else ()
    threading.Thread(target=target, args=t_args, daemon=True).start()

    print(f"[flask] Starting on http://{args.host}:{args.flask_port}")
    app.run(host=args.host, port=args.flask_port, debug=False)