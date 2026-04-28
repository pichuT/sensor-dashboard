import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
  ScatterChart, Scatter, ZAxis
} from "recharts";
import "./App.css";

const FILE_PATH = "/balloon_flight_data.xlsx";

const COLORS = {
  altitude:    "#9b59b6",
  temperature: "#d85a30",
  pressure:    "#1d9e75",
  humidity:    "#378add",
  gpsAlt:      "#e67e22",
  x: "#e74c3c",
  y: "#f39c12",
  z: "#2ecc71",
};

// Each sensor has a list of possible header name variations (all lowercase for matching)
const SENSOR_MATCHERS = [
  { id: "timestamp",    color: null,              patterns: ["timestamp", "time", "datetime", "date"] },
  { id: "temperature",  color: COLORS.temperature, patterns: ["temperature", "temp", "t c", "tc"] },
  { id: "pressure",     color: COLORS.pressure,   patterns: ["pressure", "preassure", "presure", "pres", "baro", "p hpa", "phpa"] },
  { id: "humidity",     color: COLORS.humidity,   patterns: ["humidity", "humid", "humpct", "hum pct", "rel hum", "relhum", "rh"] },
  { id: "altitude",     color: COLORS.altitude,   patterns: ["altitude", "alt", "height"] },
  { id: "accel_x",      color: COLORS.x,          patterns: ["accel x", "accelx", "acc x", "accx", "gyro x", "gyrox", "motion x", "accelerometer x", "imu x", "imux", "ax", "^x"] },
  { id: "accel_y",      color: COLORS.y,          patterns: ["accel y", "accely", "acc y", "accy", "gyro y", "gyroy", "motion y", "accelerometer y", "imu y", "imuy", "ay", "^y"] },
  { id: "accel_z",      color: COLORS.z,          patterns: ["accel z", "accelz", "acc z", "accz", "gyro z", "gyroz", "motion z", "accelerometer z", "imu z", "imuz", "az", "^z"] },
  { id: "latitude",     color: "#378add",         patterns: ["latitude", "gps_lat", "gpslat", "lat"] },
  { id: "longitude",    color: "#378add",         patterns: ["longitude", "gps_lon", "gpslon", "lon", "lng", "long"] },
  { id: "gps_altitude", color: COLORS.gpsAlt,    patterns: ["gps alt", "gpsalt", "gps altitude", "gps altitude m", "gpsaltitude", "gps height", "gpsheight"] },
  { id: "satellites",   color: "#888",            patterns: ["satellites", "num sat", "sats", "sat", "svs", "^sv"] },
  { id: "gps_valid",    color: null,              patterns: ["gps valid", "gpsvalid", "fix valid", "gps fix", "gpsfix", "gpsok", "gps ok", "gps status", "gpsstatus", "gpslock", "gps lock", "valid"] },
];

// Normalize: lowercase, replace underscores/special chars with space, collapse spaces
function normalize(str) {
  return str.toLowerCase().replace(/_/g, " ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// Takes the actual headers from the file, returns a map of { sensorId -> actualHeaderName }
function detectColumns(headers) {
  const map = {};
  for (const sensor of SENSOR_MATCHERS) {
    const match = headers.find((h) => {
      const n = normalize(h);
      return sensor.patterns.some((p) => {
        const np = p.replace(/_/g, " ");
        // exact-only patterns are marked with ^ prefix
        if (np.startsWith("^")) return n === np.slice(1);
        return n.includes(np);
      });
    });
    if (match) map[sensor.id] = match;
  }
  return map;
}

/* ── Reusable line chart ── */
function SensorLine({ data, lines, title, height = 220, xKey }) {
  return (
    <div className="chart-block">
      <p className="chart-title">{title}</p>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.12)" />
            <XAxis
              dataKey={xKey}
              tick={{ fontSize: 10, fill: "#888" }}
              tickFormatter={(v) => typeof v === "string" ? v.slice(11, 16) : v}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fontSize: 10, fill: "#888" }} width={52} />
            <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(v) => `Time: ${v}`} />
            {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {lines.map((l) => (
              <Line key={l.key} type="monotone" dataKey={l.key} name={l.label ?? l.key}
                stroke={l.color} dot={false} strokeWidth={2} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ── Pressure vs Altitude scatter ── */
function PressureAltScatter({ data, colMap }) {
  const altKey  = colMap["altitude"];
  const presKey = colMap["pressure"];
  if (!altKey || !presKey) return <MissingChart title="Pressure vs Altitude (scatter)" />;

  const points = data.map((r) => ({ alt: r[altKey], pres: r[presKey] }));
  return (
    <div className="chart-block">
      <p className="chart-title">Pressure vs Altitude (scatter)</p>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.12)" />
            <XAxis dataKey="alt"  name="Altitude" unit=" m"   tick={{ fontSize: 10, fill: "#888" }}
              label={{ value: "Altitude (m)", position: "insideBottom", offset: -2, fontSize: 11, fill: "#aaa" }} />
            <YAxis dataKey="pres" name="Pressure" unit=" hPa" tick={{ fontSize: 10, fill: "#888" }} width={52} />
            <ZAxis range={[18, 18]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ fontSize: 12 }}
              formatter={(val, name) => [val, name]} />
            <Scatter data={points} fill={COLORS.pressure} fillOpacity={0.6} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ── GPS flight path ── */
function GPSPath({ data, colMap }) {
  const latKey   = colMap["latitude"];
  const lonKey   = colMap["longitude"];
  const validKey = colMap["gps_valid"];

  const valid = data.filter((r) => {
    if (validKey && r[validKey] !== "YES") return false;
    if (!latKey || !lonKey) return false;
    if (r[latKey] === 0 && r[lonKey] === 0) return false;
    return true;
  });

  if (!latKey || !lonKey || valid.length === 0) {
    return (
      <div className="chart-block chart-block--full">
        <p className="chart-title">GPS Flight Path</p>
        <div className="no-gps">
          No valid GPS readings found.<br />
          <small>GPS_Valid was NO or coordinates were 0,0 for all rows.</small>
        </div>
      </div>
    );
  }

  const points = valid.map((r) => ({ lat: r[latKey], lon: r[lonKey] }));
  return (
    <div className="chart-block chart-block--full">
      <p className="chart-title">GPS Flight Path (Lat / Lon trace)</p>
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 4, right: 16, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.12)" />
            <XAxis dataKey="lon" name="Longitude" type="number" domain={["auto","auto"]}
              tick={{ fontSize: 10, fill: "#888" }}
              label={{ value: "Longitude", position: "insideBottom", offset: -10, fontSize: 11, fill: "#aaa" }} />
            <YAxis dataKey="lat" name="Latitude" type="number" domain={["auto","auto"]}
              tick={{ fontSize: 10, fill: "#888" }} width={72}
              label={{ value: "Latitude", angle: -90, position: "insideLeft", fontSize: 11, fill: "#aaa" }} />
            <ZAxis range={[24, 24]} />
            <Tooltip contentStyle={{ fontSize: 12 }} formatter={(val, name) => [val.toFixed(6), name]} />
            <Scatter data={points} fill="#378add" fillOpacity={0.75} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ── Missing column fallback ── */
function MissingChart({ title }) {
  return (
    <div className="chart-block">
      <p className="chart-title">{title}</p>
      <div className="no-gps">Column not found in file.<br /><small>Header name didn't match any known variation.</small></div>
    </div>
  );
}

/* ── Stat card ── */
function StatCard({ label, value, unit, color }) {
  return (
    <div className="card">
      <p className="card-label">{label}</p>
      <p className="card-value" style={{ color }}>{value ?? "—"}</p>
      <p className="card-unit">{unit}</p>
    </div>
  );
}

/* ── Column map debug panel ── */
function ColMapPanel({ colMap, headers }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="debug-panel">
      <button className="debug-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▲ Hide" : "▼ Show"} detected columns
      </button>
      {open && (
        <div className="debug-body">
          <p className="debug-section">Headers found in file:</p>
          <p className="debug-mono">{headers.join(", ")}</p>
          <p className="debug-section" style={{ marginTop: 10 }}>Matched sensors:</p>
          {Object.entries(colMap).map(([id, col]) => (
            <p key={id} className="debug-mono"><strong>{id}</strong> → "{col}"</p>
          ))}
          {SENSOR_MATCHERS.filter((s) => !colMap[s.id]).map((s) => (
            <p key={s.id} className="debug-mono debug-miss"><strong>{s.id}</strong> → ⚠️ not found</p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── App ── */
export default function App() {
  const [data, setData]       = useState([]);
  const [headers, setHeaders] = useState([]);
  const [colMap, setColMap]   = useState({});
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(FILE_PATH)
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load file: ${FILE_PATH}`);
        return res.arrayBuffer();
      })
      .then((buf) => {
        const wb   = XLSX.read(buf, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws);
        if (rows.length === 0) throw new Error("Excel file is empty or has no data rows.");
        const hdrs = Object.keys(rows[0]);
        setHeaders(hdrs);
        setColMap(detectColumns(hdrs));
        setData(rows);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const latest = data[data.length - 1];
  const xKey   = colMap["timestamp"];
  const maxAlt = colMap["altitude"] && data.length
    ? Math.max(...data.map((r) => r[colMap["altitude"]] ?? 0)).toFixed(1)
    : null;

  if (loading) return <div className="status-msg">Loading flight data...</div>;
  if (error)   return (
    <div className="status-msg error">
      ⚠️ {error}<br />
      <small>Make sure balloon_flight_data.xlsx is inside the public/ folder.</small>
    </div>
  );

  return (
    <div className="app">
      <div className="header">
        <div>
          <h1>Balloon Flight Dashboard</h1>
          <p className="subtitle">{data.length} readings · {latest?.[xKey]?.toString().slice(0, 10)}</p>
        </div>
        <div className="badge">Static · From Excel</div>
      </div>

      <ColMapPanel colMap={colMap} headers={headers} />

      <div className="cards">
        <StatCard label="Max Altitude"    value={maxAlt}                                      unit="m"    color={COLORS.altitude} />
        <StatCard label="Temperature"     value={colMap["temperature"] ? latest?.[colMap["temperature"]] : null} unit="°C"   color={COLORS.temperature} />
        <StatCard label="Pressure"        value={colMap["pressure"]    ? latest?.[colMap["pressure"]]    : null} unit="hPa"  color={COLORS.pressure} />
        <StatCard label="Humidity"        value={colMap["humidity"]    ? latest?.[colMap["humidity"]]    : null} unit="%"    color={COLORS.humidity} />
        <StatCard label="Satellites"      value={colMap["satellites"]  ? latest?.[colMap["satellites"]]  : null} unit="sats" color="#888" />
        <StatCard label="Total Readings"  value={data.length}                                 unit="rows" color="#888" />
      </div>

      {/* Altitude hero */}
      {colMap["altitude"]
        ? <SensorLine data={data} xKey={xKey} title="Altitude over Time" height={260}
            lines={[{ key: colMap["altitude"], label: "Altitude (m)", color: COLORS.altitude }]} />
        : <MissingChart title="Altitude over Time" />}

      {/* Temp + Pressure */}
      <div className="charts-grid">
        {colMap["temperature"]
          ? <SensorLine data={data} xKey={xKey} title="Temperature (°C)"
              lines={[{ key: colMap["temperature"], label: "Temp (°C)", color: COLORS.temperature }]} />
          : <MissingChart title="Temperature" />}
        {colMap["pressure"]
          ? <SensorLine data={data} xKey={xKey} title="Pressure (hPa)"
              lines={[{ key: colMap["pressure"], label: "Pressure", color: COLORS.pressure }]} />
          : <MissingChart title="Pressure" />}
      </div>

      {/* Scatter + GPS Alt vs Baro Alt */}
      <div className="charts-grid">
        <PressureAltScatter data={data} colMap={colMap} />
        {colMap["altitude"] && colMap["gps_altitude"]
          ? <SensorLine data={data} xKey={xKey} title="GPS Altitude vs Barometric Altitude"
              lines={[
                { key: colMap["altitude"],     label: "Barometric Alt", color: COLORS.altitude },
                { key: colMap["gps_altitude"], label: "GPS Alt",        color: COLORS.gpsAlt },
              ]} />
          : <MissingChart title="GPS Altitude vs Barometric Altitude" />}
      </div>

      {/* GPS path */}
      <GPSPath data={data} colMap={colMap} />

      {/* Motion + Humidity */}
      <div className="charts-grid">
        {colMap["accel_x"] && colMap["accel_y"] && colMap["accel_z"]
          ? <SensorLine data={data} xKey={xKey} title="Motion Sensor (X / Y / Z)"
              lines={[
                { key: colMap["accel_x"], label: "X", color: COLORS.x },
                { key: colMap["accel_y"], label: "Y", color: COLORS.y },
                { key: colMap["accel_z"], label: "Z", color: COLORS.z },
              ]} />
          : <MissingChart title="Motion Sensor" />}
        {colMap["humidity"]
          ? <SensorLine data={data} xKey={xKey} title="Humidity (%)"
              lines={[{ key: colMap["humidity"], label: "Humidity", color: COLORS.humidity }]} />
          : <MissingChart title="Humidity" />}
      </div>
    </div>
  );
}