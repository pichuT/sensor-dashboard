# Balloon Flight Dashboard

A React-based web dashboard for visualizing stratospheric balloon sensor data from an Excel file. Built for the LMU CubeSat/Balloon Research Project.

## What It Shows

- **Altitude** over time (full ascent/descent arc)
- **Temperature** and **Pressure** over time
- **Pressure vs Altitude** scatter plot (validates barometric readings)
- **GPS Altitude vs Barometric Altitude** overlay
- **GPS Flight Path** trace (lat/lon)
- **Motion Sensor** (X, Y, Z axes)
- **Humidity** over time
- Stat cards for max altitude, latest readings, satellite count

## Requirements

- [Node.js](https://nodejs.org/) v18 or higher
- npm (comes with Node)

## Installation

```bash
# 1. Clone the repo
git clone https://github.com/pichuT/sensor-dashboard.git
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

## Expected Excel Column Headers

Your Excel file should have the following columns (row 1 as headers):

| Column | Example Value |
|---|---|
| Timestamp | 2025-04-10 10:01:00 |
| Temperature (C) | 23.41 |
| Pressure (hPa) | 955.51 |
| Humidity (%) | 61.38 |
| Altitude (m) | 37.08 |
| Accel_X | 0.02 |
| Accel_Y | 0.23 |
| Accel_Z | 179.99 |
| Latitude | 33.969400 |
| Longitude | -118.416400 |
| GPS_Altitude (m) | 37.08 |
| Satellites | 7 |
| GPS_Valid | YES |

> The GPS flight path chart only renders when `GPS_Valid` is `YES` and coordinates are non-zero. This is expected behavior — GPS shows `NO` and `0.000000` until the module gets a satellite lock.

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
