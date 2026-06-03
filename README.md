# CubeSat SOAR26 — Balloon Flight Dashboard

A React-based web dashboard for visualizing stratospheric balloon sensor data. Supports two modes: post-flight analysis from an Excel file, and live streaming directly from the ground station receiver over Serial.

## What It Shows

- **Altitude** over time 
- **Temperature** and **Pressure** over time
- **Pressure vs Altitude** scatter plot 
- **GPS Altitude vs Barometric Altitude** overlay
- **GPS Flight Path** trace (lat/lon)
- **Motion Sensor** (X, Y, Z axes)
- **Humidity** over time
- Stat cards for max altitude, latest readings, satellite count
- **Live Serial Log** panel showing real-time packet status from the receiver (live mode only)

## Two Modes

### Static Mode (post-flight)
Reads from a local Excel file you drop into the `public/` folder. Good for reviewing data after a flight.

### Live Mode (during flight)
Streams data directly from the ground station receiver over USB Serial in real time. Charts update automatically every 3 seconds as packets arrive from the CubeSat.

To switch modes, change this line in `src/App.jsx`:
```js
const LIVE_MODE = false; // false = static Excel, true = live serial
```

## Prerequisites

You need Node.js and Python 3 installed.

### Installing Node.js on Mac
1. Go to [https://nodejs.org/](https://nodejs.org/)
2. Click the **LTS** button to download
3. Open the downloaded `.pkg` file and click through the installer
4. Confirm it worked:
```bash
node -v
npm -v
```

### Installing Node.js on Windows
1. Go to [https://nodejs.org/](https://nodejs.org/)
2. Click the **LTS** button to download
3. Open the `.msi` file and click through the installer
4. Confirm it worked:
```bash
node -v
npm -v
```

### Python dependencies
```bash
pip3 install openpyxl pyserial flask flask-cors
```

## Installation

```bash
# 1. Clone the repo
git clone https://github.com/pichuT/sensor-dashboard.git
cd sensor-dashboard

# 2. Install dependencies
npm install
```

## Running the Dashboard (Static Mode)

1. Add your sensor data to `public/balloon_flight_data.xlsx` (see below)
2. Make sure `LIVE_MODE = false` in `src/App.jsx`
3. Run:
```bash
npm run dev
```
4. Open [http://localhost:5173](http://localhost:5173)

## Finding Your Serial Port
 
The serial port name is unique to your computer and changes depending on which USB port you plug into and the order devices are connected. You need to check it every time before running in live mode.
 
**On Mac:**
```bash
ls /dev/cu.*
```
Look for something like `/dev/cu.usbmodem101` or `/dev/cu.usbmodem1101`.
 
**On Windows:**
Open Device Manager and look under "Ports (COM & LPT)" for something like `COM3` or `COM4`.
 
> The port name is specific to your machine — it will be different on every computer and can change between sessions on the same computer even if you're using the same board. Always run the command above to check before starting.


## Running the Dashboard (Live Mode)

You need three terminals running simultaneously.

**Terminal 1 — Start the serial listener:**
```bash
python3 serial_listener.py --port /dev/cu.usbmodem101 --baud 115200
```
Replace `/dev/cu.usbmodem101` with your actual port. On Windows use `COMx`.

**Terminal 2 — Start the dashboard:**
```bash
npm run dev
```
Make sure `LIVE_MODE = true` in `src/App.jsx`.

**Terminal 3 — Trigger the CubeSat to start transmitting:**
```bash
python3 -c "import serial; s = serial.Serial('/dev/cu.usbmodem101', 115200); s.write(b'START\n'); s.close()"
```

Then open [http://localhost:5173](http://localhost:5173) and watch the dashboard update live.

## Converting SD Card Data to Excel (Static Mode)

After a flight, copy the `sensor_*.txt` files off the SD card and run:

```bash
python3 convert_to_excel.py sensor_41817.txt
```

For multiple files (one row per reading):
```bash
python3 convert_to_excel.py sensor_41817.txt sensor_31352.txt sensor_4111.txt
```

This generates `balloon_flight_data.xlsx`. Drop it into the `public/` folder and refresh the dashboard.

## Project Structure

```
sensor-dashboard/
├── public/
│   └── balloon_flight_data.xlsx   ← data file goes here
├── src/
│   ├── App.jsx                    ← main dashboard component
│   ├── App.css                    ← styles
│   └── main.jsx                   ← React entry point
├── convert_to_excel.py            ← converts sensor .txt files to Excel
├── serial_listener.py             ← reads receiver Serial and serves live JSON
├── index.html
├── package.json
└── vite.config.js
```

## Column Headers

The dashboard matches these exact column names output by `convert_to_excel.py` and `serial_listener.py`:

| Sensor | Column Name |
|---|---|
| Timestamp | `Timestamp` |
| Temperature | `Temperature` |
| Pressure | `Pressure` |
| Humidity | `Humidity` |
| Altitude | `Altitude` |
| Accel X | `Accel_X` |
| Accel Y | `Accel_Y` |
| Accel Z | `Accel_Z` |
| Latitude | `Latitude` |
| Longitude | `Longitude` |
| GPS Altitude | `GPS_Altitude` |
| Satellites | `Satellites` |
| GPS Valid | `GPS_Valid` |

## GPS Flight Path

The GPS path chart only renders when:
- Latitude and Longitude columns are detected
- `GPS_Valid` is `YES`
- Coordinates are non-zero

GPS will show `NO` and `0.000000` until the module gets a satellite fix outdoors.

## Tech Stack

- [React](https://react.dev/) — UI framework
- [Vite](https://vitejs.dev/) — dev server and bundler
- [Recharts](https://recharts.org/) — charting library
- [SheetJS (xlsx)](https://sheetjs.com/) — Excel file parsing
- [Flask](https://flask.palletsprojects.com/) — live data server
- [pyserial](https://pyserial.readthedocs.io/) — Serial port reading