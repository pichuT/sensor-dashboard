import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
  ScatterChart, Scatter, ZAxis
} from "recharts";
import "./App.css";

const FILE_PATH        = "/balloon_flight_data.xlsx";
const LIVE_URL         = "http://localhost:8000/data";
const LOG_URL          = "http://localhost:8000/log";
const LIVE_INTERVAL_MS = 3000;

// Toggle: false = static Excel mode, true = live serial mode
const LIVE_MODE = true;

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

const LOG_COLORS = {
  error:   "#e74c3c",
  warning: "#f39c12",
  success: "#2ecc71",
  packet:  "#378add",
  info:    "#aaaaaa",
};

const SENSOR_MATCHERS = [
  { id: "timestamp",    color: null,              patterns: ["timestamp"] },
  { id: "temperature",  color: COLORS.temperature, patterns: ["temperature"] },
  { id: "pressure",     color: COLORS.pressure,   patterns: ["pressure"] },
  { id: "humidity",     color: COLORS.humidity,   patterns: ["humidity"] },
  { id: "altitude",     color: COLORS.altitude,   patterns: ["altitude"] },
  { id: "accel_x",      color: COLORS.x,          patterns: ["accel_x"] },
  { id: "accel_y",      color: COLORS.y,          patterns: ["accel_y"] },
  { id: "accel_z",      color: COLORS.z,          patterns: ["accel_z"] },
  { id: "latitude",     color: "#378add",         patterns: ["latitude"] },
  { id: "longitude",    color: "#378add",         patterns: ["longitude"] },
  { id: "gps_altitude", color: COLORS.gpsAlt,    patterns: ["gps_altitude"] },
  { id: "satellites",   color: "#888",            patterns: ["satellites"] },
  { id: "gps_valid",    color: null,              patterns: ["gps_valid"] },
];

function normalize(str) {
  return str.toLowerCase().replace(/_/g, " ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function detectColumns(headers) {
  const map = {};
  for (const sensor of SENSOR_MATCHERS) {
    const match = headers.find((h) => {
      const n = normalize(h);
      return sensor.patterns.some((p) => {
        const np = p.replace(/_/g, " ");
        if (np.startsWith("^")) return n === np.slice(1);
        return n.includes(np);
      });
    });
    if (match) map[sensor.id] = match;
  }
  return map;
}

// ── Packet Log Panel ──────────────────────────────────────────────────────────
// Side panel showing live Serial output from the receiver, color-coded by type.
// Auto-scrolls to the bottom as new lines arrive.
function PacketLog({ logLines }) {
  
  return (
    <div className="packet-log">
      <div className="packet-log-header">
        <span>Serial Log</span>
        <span className="packet-log-count">{logLines.length} lines</span>
      </div>
      <div className="packet-log-body">
        {logLines.length === 0 && (
          <p className="packet-log-empty">Waiting for packets...</p>
        )}
        {logLines.map((entry, i) => (
          <div key={i} className="packet-log-line">
            <span className="packet-log-time">{entry.time}</span>
            <span className="packet-log-text" style={{ color: LOG_COLORS[entry.color] ?? "#aaa" }}>
              {entry.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Chart components ───────────────────────────────────────────────────────────
function SensorLine({ data, lines, title, height = 220, xKey }) {
  return (
    <div className="chart-block">
      <p className="chart-title">{title}</p>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.12)" />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: "#888" }}
              tickFormatter={(v) => typeof v === "string" ? v.slice(11, 16) : v}
              interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "#888" }} width={52} />
            <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(v) => `Time: ${v}`} />
            {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {lines.map((l) => (
              <Line key={l.key} type="monotone" dataKey={l.key} name={l.label ?? l.key}
                stroke={l.color} dot={false} strokeWidth={2} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

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
            <XAxis dataKey="alt" name="Altitude" unit=" m" tick={{ fontSize: 10, fill: "#888" }}
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

function MissingChart({ title }) {
  return (
    <div className="chart-block">
      <p className="chart-title">{title}</p>
      <div className="no-gps">Column not found in file.<br /><small>Header name didn't match any known variation.</small></div>
    </div>
  );
}

function StatCard({ label, value, unit, color }) {
  return (
    <div className="card">
      <p className="card-label">{label}</p>
      <p className="card-value" style={{ color }}>{value ?? "—"}</p>
      <p className="card-unit">{unit}</p>
    </div>
  );
}

function ColMapPanel({ colMap, headers }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="debug-panel">
      <button className="debug-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide" : "Show"} detected columns
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
            <p key={s.id} className="debug-mono debug-miss"><strong>{s.id}</strong> → not found</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────────
export default function App() {
  const [data, setData]           = useState([]);
  const [headers, setHeaders]     = useState([]);
  const [colMap, setColMap]       = useState({});
  const [error, setError]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [logLines, setLogLines]   = useState([]);
  const intervalRef               = useRef(null);

  function loadExcel() {
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
  }

  function fetchLive() {
    // Fetch sensor data and log lines in parallel
    Promise.all([
      fetch(LIVE_URL).then((r) => r.json()),
      fetch(LOG_URL).then((r) => r.json()),
    ])
      .then(([rows, log]) => {
        if (rows.length > 0) {
          const hdrs = Object.keys(rows[0]);
          setHeaders(hdrs);
          setColMap(detectColumns(hdrs));
          setData(rows);
        }
        setLogLines(log);
        setLastUpdate(new Date().toLocaleTimeString());
        setLoading(false);
        setError(null);
      })
      .catch((err) => {
        setError(err.message + " — is serial_listener.py running?");
        setLoading(false);
      });
  }

  useEffect(() => {
    if (LIVE_MODE) {
      fetchLive();
      intervalRef.current = setInterval(fetchLive, LIVE_INTERVAL_MS);
    } else {
      loadExcel();
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const latest = data[data.length - 1];
  const xKey   = colMap["timestamp"];
  const maxAlt = colMap["altitude"] && data.length
    ? Math.max(...data.map((r) => r[colMap["altitude"]] ?? 0)).toFixed(1)
    : null;

  if (loading) return (
    <div className="status-msg">
      {LIVE_MODE ? "Waiting for live data from serial_listener.py..." : "Loading flight data..."}
    </div>
  );

  if (error) return (
    <div className="status-msg error">
      {error}<br />
      {LIVE_MODE
        ? <small>Run: python3 serial_listener.py --port /dev/cu.usbmodem101</small>
        : <small>Make sure balloon_flight_data.xlsx is inside the public/ folder.</small>}
    </div>
  );

  // Charts content — same as before, extracted for layout clarity
  const charts = (
    <>
      <ColMapPanel colMap={colMap} headers={headers} />

      <div className="cards">
        <StatCard label="Max Altitude"   value={maxAlt}                                                           unit="m"    color={COLORS.altitude} />
        <StatCard label="Temperature"    value={colMap["temperature"] ? latest?.[colMap["temperature"]] : null}   unit="°C"   color={COLORS.temperature} />
        <StatCard label="Pressure"       value={colMap["pressure"]    ? latest?.[colMap["pressure"]]    : null}   unit="hPa"  color={COLORS.pressure} />
        <StatCard label="Humidity"       value={colMap["humidity"]    ? latest?.[colMap["humidity"]]    : null}   unit="%"    color={COLORS.humidity} />
        <StatCard label="Satellites"     value={colMap["satellites"]  ? latest?.[colMap["satellites"]]  : null}   unit="sats" color="#888" />
        <StatCard label="Total Readings" value={data.length}                                                      unit="rows" color="#888" />
      </div>

      {colMap["altitude"]
        ? <SensorLine data={data} xKey={xKey} title="Altitude over Time" height={260}
            lines={[{ key: colMap["altitude"], label: "Altitude (m)", color: COLORS.altitude }]} />
        : <MissingChart title="Altitude over Time" />}

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

      <GPSPath data={data} colMap={colMap} />

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
    </>
  );

  return (
    <div className="app">
      <div className="header">
        <div>
          <h1>Balloon Flight Dashboard</h1>
          <p className="subtitle">
            {data.length} readings
            {latest?.[xKey] ? ` · ${latest[xKey].toString().slice(0, 10)}` : ""}
          </p>
        </div>
        <div className="badge" style={{ background: LIVE_MODE ? "#1d9e75" : "#555" }}>
          {LIVE_MODE ? `Live · Updated ${lastUpdate ?? "..."}` : "Static · From Excel"}
        </div>
      </div>

      {/* Side-by-side layout in live mode, full-width in static mode */}
      {LIVE_MODE ? (
        <div className="live-layout">
          <div className="live-charts">{charts}</div>
          <PacketLog logLines={logLines} />
        </div>
      ) : (
        charts
      )}
    </div>
  );
}