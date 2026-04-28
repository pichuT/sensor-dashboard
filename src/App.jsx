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

/* ── Reusable line chart ── */
function SensorLine({ data, lines, title, height = 220, tickFormatter }) {
  return (
    <div className="chart-block">
      <p className="chart-title">{title}</p>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.12)" />
            <XAxis
              dataKey="Timestamp"
              tick={{ fontSize: 10, fill: "#888" }}
              tickFormatter={tickFormatter ?? ((v) => v?.slice(11, 16))}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fontSize: 10, fill: "#888" }} width={52} />
            <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(v) => `Time: ${v}`} />
            {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {lines.map((l) => (
              <Line
                key={l.key}
                type="monotone"
                dataKey={l.key}
                name={l.label ?? l.key}
                stroke={l.color}
                dot={false}
                strokeWidth={2}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ── Pressure vs Altitude scatter ── */
function PressureAltScatter({ data }) {
  const points = data.map((r) => ({
    alt: r["Altitude (m)"],
    pres: r["Pressure (hPa)"],
  }));
  return (
    <div className="chart-block">
      <p className="chart-title">Pressure vs Altitude (scatter)</p>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.12)" />
            <XAxis dataKey="alt"  name="Altitude"  unit=" m"   tick={{ fontSize: 10, fill: "#888" }} label={{ value: "Altitude (m)",  position: "insideBottom", offset: -2, fontSize: 11, fill: "#aaa" }} />
            <YAxis dataKey="pres" name="Pressure"  unit=" hPa" tick={{ fontSize: 10, fill: "#888" }} width={52} />
            <ZAxis range={[18, 18]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ fontSize: 12 }} formatter={(val, name) => [val, name]} />
            <Scatter data={points} fill={COLORS.pressure} fillOpacity={0.6} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ── GPS flight path trace ── */
function GPSPath({ data }) {
  const valid = data.filter(
    (r) => r["GPS_Valid"] === "YES" && r["Latitude"] !== 0 && r["Longitude"] !== 0
  );

  if (valid.length === 0) {
    return (
      <div className="chart-block chart-block--full">
        <p className="chart-title">GPS Flight Path</p>
        <div className="no-gps">No valid GPS readings in this file.<br /><small>GPS_Valid was NO or coordinates were 0,0 for all rows.</small></div>
      </div>
    );
  }

  const points = valid.map((r) => ({ lat: r["Latitude"], lon: r["Longitude"] }));
  return (
    <div className="chart-block chart-block--full">
      <p className="chart-title">GPS Flight Path (Lat / Lon trace)</p>
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 4, right: 16, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.12)" />
            <XAxis dataKey="lon" name="Longitude" type="number" domain={["auto","auto"]} tick={{ fontSize: 10, fill: "#888" }} label={{ value: "Longitude", position: "insideBottom", offset: -10, fontSize: 11, fill: "#aaa" }} />
            <YAxis dataKey="lat" name="Latitude"  type="number" domain={["auto","auto"]} tick={{ fontSize: 10, fill: "#888" }} width={72} label={{ value: "Latitude", angle: -90, position: "insideLeft", fontSize: 11, fill: "#aaa" }} />
            <ZAxis range={[24, 24]} />
            <Tooltip contentStyle={{ fontSize: 12 }} formatter={(val, name) => [val.toFixed(6), name]} />
            <Scatter data={points} fill="#378add" fillOpacity={0.75} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
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

/* ── App ── */
export default function App() {
  const [data, setData]       = useState([]);
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
        setData(rows);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const latest  = data[data.length - 1];
  const maxAlt  = data.length ? Math.max(...data.map((r) => r["Altitude (m)"] ?? 0)) : null;

  if (loading) return <div className="status-msg">Loading flight data...</div>;
  if (error)   return (
    <div className="status-msg error">
      ⚠️ {error}
      <br /><small>Make sure balloon_flight_data.xlsx is inside the public/ folder.</small>
    </div>
  );

  return (
    <div className="app">

      {/* Header */}
      <div className="header">
        <div>
          <h1>Balloon Flight Dashboard</h1>
          <p className="subtitle">{data.length} readings · {latest?.["Timestamp"]?.slice(0, 10)}</p>
        </div>
        <div className="badge">Static · From Excel</div>
      </div>

      {/* Stat cards */}
      <div className="cards">
        <StatCard label="Max Altitude"  value={maxAlt?.toFixed(1)}                   unit="m"   color={COLORS.altitude} />
        <StatCard label="Temperature"   value={latest?.["Temperature (C)"]}           unit="°C"  color={COLORS.temperature} />
        <StatCard label="Pressure"      value={latest?.["Pressure (hPa)"]}            unit="hPa" color={COLORS.pressure} />
        <StatCard label="Humidity"      value={latest?.["Humidity (%)"]}              unit="%"   color={COLORS.humidity} />
        <StatCard label="Satellites"    value={latest?.["Satellites"]}                unit="sats" color="#888" />
        <StatCard label="Total Readings" value={data.length}                          unit="rows" color="#888" />
      </div>

      {/* 1 — Altitude hero chart */}
      <SensorLine
        data={data}
        title="Altitude over Time"
        height={260}
        lines={[{ key: "Altitude (m)", color: COLORS.altitude }]}
      />

      {/* 2 — Temperature + Pressure side by side */}
      <div className="charts-grid">
        <SensorLine
          data={data}
          title="Temperature (°C)"
          lines={[{ key: "Temperature (C)", label: "Temp (°C)", color: COLORS.temperature }]}
        />
        <SensorLine
          data={data}
          title="Pressure (hPa)"
          lines={[{ key: "Pressure (hPa)", label: "Pressure", color: COLORS.pressure }]}
        />
      </div>

      {/* 3 — Pressure vs Altitude scatter + GPS Alt vs Baro Alt */}
      <div className="charts-grid">
        <PressureAltScatter data={data} />
        <SensorLine
          data={data}
          title="GPS Altitude vs Barometric Altitude"
          lines={[
            { key: "Altitude (m)",      label: "Barometric Alt", color: COLORS.altitude },
            { key: "GPS_Altitude (m)",  label: "GPS Alt",        color: COLORS.gpsAlt },
          ]}
        />
      </div>

      {/* 4 — GPS flight path */}
      <GPSPath data={data} />

      {/* 5 — Motion + Humidity side by side */}
      <div className="charts-grid">
        <SensorLine
          data={data}
          title="Motion Sensor (X / Y / Z)"
          lines={[
            { key: "Accel_X", label: "X", color: COLORS.x },
            { key: "Accel_Y", label: "Y", color: COLORS.y },
            { key: "Accel_Z", label: "Z", color: COLORS.z },
          ]}
        />
        <SensorLine
          data={data}
          title="Humidity (%)"
          lines={[{ key: "Humidity (%)", label: "Humidity", color: COLORS.humidity }]}
        />
      </div>

    </div>
  );
}