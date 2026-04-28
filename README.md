# Balloon Flight Dashboard

A React-based web dashboard for visualizing stratospheric balloon sensor data from an Excel file. 

## What It Shows

- **Altitude** over time (full ascent/descent arc)
- **Temperature** and **Pressure** over time
- **Pressure vs Altitude** scatter plot (validates barometric readings)
- **GPS Altitude vs Barometric Altitude** overlay
- **GPS Flight Path** trace (lat/lon)
- **Motion Sensor** (X, Y, Z axes)
- **Humidity** over time
- Stat cards for max altitude, latest readings, satellite count

## Prerequisites

You need Node.js installed before anything else. npm comes with it automatically.

### Installing Node.js on Mac
1. Go to [https://nodejs.org/](https://nodejs.org/)
2. Click the **LTS** button to download (says "Recommended for most users")
3. Open the downloaded `.pkg` file
4. Click through the installer — Next, Agree, Install
5. Open **Terminal** (search for it in Spotlight with `Cmd + Space`)
6. Type these to confirm it worked:
```bash
node -v
npm -v
```
Both should print a version number like `v20.x.x`. If they do, you're good.

### Installing Node.js on Windows
1. Go to [https://nodejs.org/](https://nodejs.org/)
2. Click the **LTS** button to download
3. Open the downloaded `.msi` file
4. Click through the installer — Next, Accept, Next, Install
5. Open **Command Prompt** (search for it in the Start menu)
6. Type these to confirm it worked:
```bash
node -v
npm -v
```
Both should print a version number like `v20.x.x`. If they do, you're good.

## Installation

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/sensor-dashboard.git
cd sensor-dashboard

# 2. Install dependencies
npm install
```

## Running the Dashboard

```bash
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

## Adding Your Flight Data

1. Export your sensor data as an Excel file (`.xlsx`)
2. Rename it to `balloon_flight_data.xlsx`
3. Drop it into the `public/` folder
4. Refresh the browser

The dashboard reads from `public/balloon_flight_data.xlsx` by default. If your file has a different name, update this line in `src/App.jsx`:

```js
const FILE_PATH = "/balloon_flight_data.xlsx";
```

## Column Headers

The dashboard **automatically detects** your column headers — you do not need to use specific names. It recognizes a wide range of naming styles including:

| Sensor | Examples it recognizes |
|---|---|
| Timestamp | `Timestamp`, `Time`, `DateTime`, `recordTime`, `date_time` |
| Temperature | `Temperature`, `Temp`, `Temp_C`, `tempCelsius`, `TEMP (degC)` |
| Pressure | `Pressure`, `Pres`, `Baro`, `Pressure_hPa`, `baroPress` |
| Humidity | `Humidity`, `Humid`, `RH`, `Rel_Humidity`, `humidityPct` |
| Altitude | `Altitude`, `Alt`, `Height`, `Baro_Alt_m`, `altMeters` |
| Accel X | `Accel_X`, `Gyro_X`, `IMU_X`, `Motion_X`, `AX`, `X` |
| Accel Y | `Accel_Y`, `Gyro_Y`, `IMU_Y`, `Motion_Y`, `AY`, `Y` |
| Accel Z | `Accel_Z`, `Gyro_Z`, `IMU_Z`, `Motion_Z`, `AZ`, `Z` |
| Latitude | `Latitude`, `Lat`, `GPS_Lat`, `gpsLatitude` |
| Longitude | `Longitude`, `Lon`, `Lng`, `GPS_Lon`, `gpsLongitude` |
| GPS Altitude | `GPS_Altitude`, `GPS_Alt`, `GPS_Alt_m`, `gpsAltitude` |
| Satellites | `Satellites`, `Sats`, `SVs`, `Num_Satellites`, `gpsSatellites` |
| GPS Valid | `GPS_Valid`, `Fix_Valid`, `GPSLock`, `GPS_Status`, `gpsValid` |

If a column isn't recognized, the dashboard will show a "Column not found" placeholder for that chart instead of crashing. You can expand the **"Show detected columns"** panel at the top of the dashboard to see exactly what was matched and what wasn't.

## GPS Flight Path

The GPS path chart only renders when:
- Latitude and Longitude columns are detected
- `GPS_Valid` (or equivalent) is `YES`
- Coordinates are non-zero

This is expected — GPS shows `NO` and `0.000000` until the module gets a satellite lock in the air.

## Tech Stack

- [React](https://react.dev/) — UI framework
- [Vite](https://vitejs.dev/) — dev server and bundler
- [Recharts](https://recharts.org/) — charting library
- [SheetJS (xlsx)](https://sheetjs.com/) — Excel file parsing

## Project Structure

```
sensor-dashboard/
├── public/
│   └── balloon_flight_data.xlsx   ← your data file goes here
├── src/
│   ├── App.jsx                    ← main dashboard component
│   ├── App.css                    ← styles
│   └── main.jsx                   ← React entry point
├── index.html
├── package.json
└── vite.config.js
```
