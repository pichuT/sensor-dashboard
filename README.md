# CubeSat SOAR26 — Ground Station Dashboard

A React + Flask dashboard for visualizing stratospheric balloon telemetry in real time. The XIAO ESP32S3 sender captures sensor data, JPEG images, and MLX90640 thermal IR frames, then transmits them over LoRa to the Heltec ground station receiver. This dashboard reads the receiver's Serial output and displays everything live.

## What It Shows

- **Temperature**, **Pressure**, and **Humidity** over time
- **Altitude** — barometric vs GPS overlay
- **Temperature vs Altitude** and **Pressure vs Altitude** scatter plots
- **GPS Flight Path** — Leaflet map with live polyline trace (street + satellite layers)
- **Camera Images** — JPEG gallery from the OV2640, with lightbox and newest-first ordering
- **Thermal IR** — MLX90640 32×24 heatmap gallery with colour-scaled canvas rendering
- **Live Serial Log** — real-time packet/ARQ status from the receiver
- **Stat cards** — latest temp, pressure, humidity, altitude, max altitude, GPS satellites

## Hardware

| Board | Role |
|---|---|
| XIAO ESP32S3 | Sender — captures sensors/camera/IR, transmits over LoRa |
| Heltec LoRa32 (sender-side) | LoRa radio relay |
| Heltec LoRa32 (ground station) | Receiver — reassembles packets, dumps over Serial |
| NEO-6M | GPS module on the XIAO |

## Prerequisites

You need Node.js and Python 3 installed.

### Node.js (Mac)
1. Go to [https://nodejs.org/](https://nodejs.org/) and download the **LTS** version
2. Open the `.pkg` installer and click through
3. Confirm it worked: `node -v` and `npm -v`

### Node.js (Windows)
1. Go to [https://nodejs.org/](https://nodejs.org/) and download the **LTS** version
2. Open the `.msi` installer and click through
3. Confirm it worked: `node -v` and `npm -v`

### Python dependencies
```bash
pip3 install flask flask-cors pyserial openpyxl
```

## Installation

```bash
git clone https://github.com/pichuT/sensor-dashboard.git
cd sensor-dashboard
npm install
```

## Running the Dashboard

You need two terminals running simultaneously.

**Terminal 1 — Start the Flask backend (serial listener):**
```bash
python3 serial_listener.py --port /dev/cu.usbmodem101 --baud 115200
```
Replace `/dev/cu.usbmodem101` with your actual serial port (see below).
Omit `--port` entirely to run in **demo mode** with simulated data — useful for UI development without hardware.

**Terminal 2 — Start the React dashboard:**
```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The dashboard polls the Flask backend every 5 seconds and updates all charts and galleries automatically.

To trigger a capture cycle, click the **▶ Start** button in the dashboard header, or run:
```bash
curl -X POST http://localhost:5000/api/start
```
To halt the auto-capture loop, click **■ Stop**, or run:
```bash
curl -X POST http://localhost:5000/api/stop
```

## Finding Your Serial Port

**Mac:**
```bash
ls /dev/cu.*
```
Look for something like `/dev/cu.usbmodem101` or `/dev/cu.usbserial-XXXX`.

**Windows:** Open Device Manager → Ports (COM & LPT) → look for `COM3`, `COM4`, etc.

> The port name changes depending on which USB port you plug into. Always check before starting.

## Post-Flight: Converting SD Card Data to Excel

After a flight, copy the `sensor_*.txt` files off the SD card and run:

```bash
python3 convert_to_excel.py sensor_41817.txt
```

For multiple files (one row per reading):
```bash
python3 convert_to_excel.py sensor_41817.txt sensor_31352.txt sensor_4111.txt
```

This generates `balloon_flight_data.xlsx`. The dashboard currently operates in live mode only — this file is for archival/offline analysis.

## Project Structure

```
sensor-dashboard/
├── public/
├── src/
│   ├── App.jsx               ← main dashboard (charts, gallery, GPS map, log)
│   ├── App.css               ← dark-theme styles
│   └── main.jsx              ← React entry point
├── convert_to_excel.py       ← converts SD card sensor_*.txt files to Excel
├── serial_listener.py        ← Flask backend: reads receiver Serial, serves JSON API,
│                                handles ARQ resend reloads for image/IR gallery
├── index.html
├── package.json
└── vite.config.js
```

## API Endpoints (Flask, localhost:5000)

| Endpoint | Method | Description |
|---|---|---|
| `/api/sensor-history` | GET | All sensor readings this session |
| `/api/sensor-latest` | GET | Most recent reading only |
| `/api/images-gallery` | GET | All JPEG images, newest first |
| `/api/ir-gallery` | GET | All IR frames, newest first |
| `/api/ir` | GET | Latest IR frame |
| `/api/log` | GET | Last 200 serial log lines |
| `/api/status` | GET | Connection health + counts |
| `/api/start` | POST | Send START to receiver over serial |
| `/api/stop` | POST | Send STOP to receiver over serial |

## Sensor Data Fields

Each reading from `/api/sensor-history` contains:

| Field | Description |
|---|---|
| `temp` | Temperature (°C) from TMP117 |
| `pres` | Pressure (hPa) from BMP390 |
| `hum` | Humidity (%) from BME280 |
| `alt` | Barometric altitude (m) from BMP390 |
| `yaw` / `pitch` / `roll` | Orientation from ICM20948 + Madgwick filter |
| `lat` / `lon` | GPS coordinates from NEO-6M |
| `gpsAlt` | GPS altitude (m) |
| `sats` | Satellite count |
| `loraLat` / `loraLon` | GPS coords stamped at the receiver when packet arrived |

## GPS Flight Path

The GPS track on the map uses `loraLat`/`loraLon` (receiver-stamped coordinates) and only plots points where both values are non-zero. GPS shows `0.000000` until the NEO-6M gets a satellite fix outdoors.

## Tech Stack

- [React](https://react.dev/) — UI framework
- [Vite](https://vitejs.dev/) — dev server and bundler
- [Recharts](https://recharts.org/) — time-series and scatter charts
- [react-leaflet](https://react-leaflet.js.org/) + [Leaflet](https://leafletjs.com/) — GPS flight path map
- [Flask](https://flask.palletsprojects.com/) + [flask-cors](https://flask-cors.readthedocs.io/) — live data API server
- [pyserial](https://pyserial.readthedocs.io/) — Serial port communication
- [openpyxl](https://openpyxl.readthedocs.io/) — Excel export for post-flight data