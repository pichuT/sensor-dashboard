import { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "./App.css";

// Fix leaflet default marker icons (broken in Vite/webpack by default)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const API     = "http://localhost:5000/api";
const POLL_MS = 5000;

const C = {
  temp:   "#ff6b6b",
  pres:   "#4ecdc4",
  hum:    "#a29bfe",
  alt:    "#ffd93d",
  gpsAlt: "#55efc4",
  border: "#1e293b",
  muted:  "#64748b",
};

// Re-centers the map when the latest GPS point changes
function MapUpdater({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

function StatCard({ label, value, unit, color }) {
  return (
    <div className="stat-card" style={{ borderTopColor: color }}>
      <p className="stat-label">{label}</p>
      <p className="stat-value" style={{ color }}>{value ?? "—"}</p>
      <p className="stat-unit">{unit}</p>
    </div>
  );
}

function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: <strong>{typeof p.value === "number" ? p.value.toFixed(2) : p.value}</strong>
        </p>
      ))}
    </div>
  );
}

function IRHeatmap({ frame, min, max }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!frame || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const W = 32, H = 24;
    const cw = canvas.width / W;
    const ch = canvas.height / H;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const val  = frame[y * W + x];
        const norm = Math.max(0, Math.min(1, (val - min) / (max - min || 1)));
        const r = Math.round(255 * Math.min(1, norm * 2));
        const g = Math.round(255 * Math.min(1, norm < 0.5 ? norm * 2 : (1 - norm) * 2));
        const b = Math.round(255 * Math.max(0, 1 - norm * 2));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x * cw, y * ch, cw, ch);
      }
    }
  }, [frame, min, max]);

  if (!frame) {
    return (
      <div className="img-placeholder">
        <span>🔥 Waiting for IR data…</span>
        <p>Thermal frame will appear after the first complete IR transfer</p>
      </div>
    );
  }
  return (
    <div className="ir-wrap">
      <canvas ref={canvasRef} width={320} height={240} className="ir-canvas" />
      <div className="ir-legend">
        <span style={{ color: "#4fc3f7" }}>{min?.toFixed(1)}°C</span>
        <div className="ir-gradient" />
        <span style={{ color: "#ff6b6b" }}>{max?.toFixed(1)}°C</span>
      </div>
    </div>
  );
}

function IRThumbnail({ frame, min, max }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!frame || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const W = 32, H = 24;
    const cw = canvas.width / W;
    const ch = canvas.height / H;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const val  = frame[y * W + x];
        const norm = Math.max(0, Math.min(1, (val - min) / (max - min || 1)));
        const r = Math.round(255 * Math.min(1, norm * 2));
        const g = Math.round(255 * Math.min(1, norm < 0.5 ? norm * 2 : (1 - norm) * 2));
        const b = Math.round(255 * Math.max(0, 1 - norm * 2));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x * cw, y * ch, cw, ch);
      }
    }
  }, [frame, min, max]);
  return <canvas ref={canvasRef} width={128} height={96}
    style={{ width: "100%", height: "100%", display: "block", imageRendering: "pixelated" }} />;
}

export default function App() {
  const historyRef   = useRef([]);
  const [chartData,  setChartData]  = useState([]);
  const [gallery,    setGallery]    = useState([]);
  const [selected,   setSelected]   = useState(null);
  const [ir,         setIR]         = useState(null);
  const [irGallery,  setIRGallery]  = useState([]);
  const [selectedIR, setSelectedIR] = useState(null);
  const [log,        setLog]        = useState([]);
  const [status,     setStatus]     = useState(null);
  const [activeTab,  setActiveTab]  = useState("sensors");
  const [paused,     setPaused]     = useState(false);
  const [cmdStatus,  setCmdStatus]  = useState(null);
  const [mapLayer,   setMapLayer]   = useState("street"); // "street" | "satellite"

  const sendCommand = useCallback(async (cmd) => {
    setCmdStatus("sending");
    try {
      const r    = await fetch(`${API}/${cmd}`, { method: "POST" });
      const data = await r.json();
      setCmdStatus(data.ok ? "ok" : "error");
    } catch {
      setCmdStatus("error");
    }
    setTimeout(() => setCmdStatus(null), 2500);
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch(`${API}/sensor-history`);
      const incoming = await r.json();
      if (!Array.isArray(incoming)) return;
      const prev = historyRef.current;
      if (incoming.length > prev.length) {
        const merged = incoming.map((r, i) => ({ ...r, idx: i + 1 }));
        historyRef.current = merged;
        setChartData([...merged]);
      }
    } catch { }
  }, []);

  const fetchGallery = useCallback(async () => {
    try {
      const r    = await fetch(`${API}/images-gallery`);
      const data = await r.json();
      if (Array.isArray(data)) setGallery(data);
    } catch { }
  }, []);

  const fetchIR = useCallback(async () => {
    try {
      const r    = await fetch(`${API}/ir`);
      const data = await r.json();
      if (data.frame) setIR(data);
    } catch { }
  }, []);

  const fetchIRGallery = useCallback(async () => {
    try {
      const r    = await fetch(`${API}/ir-gallery`);
      const data = await r.json();
      if (Array.isArray(data)) setIRGallery(data);
    } catch { }
  }, []);

  const fetchLog = useCallback(async () => {
    try {
      const r    = await fetch(`${API}/log`);
      const data = await r.json();
      setLog(data.slice(-80));
    } catch { }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const r    = await fetch(`${API}/status`);
      const data = await r.json();
      setStatus(data);
    } catch { }
  }, []);

  useEffect(() => {
    if (paused) return;
    const poll = () => { fetchHistory(); fetchGallery(); fetchIR(); fetchIRGallery(); fetchLog(); fetchStatus(); };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [paused, fetchHistory, fetchGallery, fetchIR, fetchIRGallery, fetchLog, fetchStatus]);

  const latest = chartData[chartData.length - 1] ?? {};
  const maxAlt = chartData.length
    ? Math.max(...chartData.map((r) => r.alt ?? 0)).toFixed(1)
    : null;

  // GPS track points using LoRa-stamped coordinates
  const gpsPoints = chartData
    .filter(r => r.loraLat && r.loraLon && (r.loraLat !== 0 || r.loraLon !== 0))
    .map(r => [r.loraLat, r.loraLon]);
  const lastGPS = gpsPoints[gpsPoints.length - 1] ?? null;

  const margin = { top: 8, right: 16, left: 0, bottom: 4 };
  const XAx = () => (
    <XAxis dataKey="idx" tick={{ fill: C.muted, fontSize: 11 }}
      label={{ value: "Reading #", position: "insideBottomRight", offset: -4, fill: C.muted, fontSize: 11 }} />
  );
  const YAx = ({ unit, width = 52 }) => (
    <YAxis tick={{ fill: C.muted, fontSize: 11 }}
      tickFormatter={(v) => `${v}${unit}`} width={width} />
  );

  return (
    <div className="app">

      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="header-title">🛸 CubeSat Ground Station</span>
          <span className={`status-dot ${status?.ok ? "online" : "offline"}`} />
          <span className="status-text">
            {status?.ok
              ? `${chartData.length} reading${chartData.length !== 1 ? "s" : ""} · ${status.image_count ?? 0} image${status.image_count !== 1 ? "s" : ""}`
              : "Connecting…"}
          </span>
        </div>
        <div className="header-right">
          {cmdStatus && (
            <span className={`cmd-feedback ${cmdStatus}`}>
              {cmdStatus === "sending" ? "Sending…" : cmdStatus === "ok" ? "✓ Sent" : "✗ Failed"}
            </span>
          )}
          <button className="cmd-btn start" onClick={() => sendCommand("start")}
            disabled={cmdStatus === "sending"}>
            ▶ Start
          </button>
          <button className="cmd-btn stop" onClick={() => sendCommand("stop")}
            disabled={cmdStatus === "sending"}>
            ■ Stop
          </button>
          <button className={`pill-btn ${paused ? "active" : ""}`} onClick={() => setPaused(p => !p)}>
            {paused ? "⏸ Paused" : "⏸ Pause"}
          </button>
        </div>
      </header>

      {/* Stat cards */}
      <div className="stat-row">
        <StatCard label="Temperature"  value={latest.temp?.toFixed(1)}  unit="°C"   color={C.temp} />
        <StatCard label="Pressure"     value={latest.pres?.toFixed(1)}  unit="hPa"  color={C.pres} />
        <StatCard label="Humidity"     value={latest.hum?.toFixed(1)}   unit="%"    color={C.hum} />
        <StatCard label="Altitude"     value={latest.alt?.toFixed(0)}   unit="m"    color={C.alt} />
        <StatCard label="Max Altitude" value={maxAlt}                    unit="m"    color="#f9ca24" />
        <StatCard label="GPS Sats"     value={latest.sats}              unit="sats" color={C.gpsAlt} />
      </div>

      {/* Tabs */}
      <div className="tab-bar">
        {[
          ["sensors", "📊 Sensors"],
          ["images",  `📸 Images${gallery.length ? ` (${gallery.length})` : ""}`],
          ["gps",     "🗺 GPS Track"],
          ["log",     "📋 Log"],
        ].map(([id, label]) => (
          <button key={id}
            className={`tab-btn ${activeTab === id ? "active" : ""}`}
            onClick={() => setActiveTab(id)}>
            {label}
            {id === "images" && gallery.length > 0 && activeTab !== "images" && (
              <span className="tab-badge" />
            )}
          </button>
        ))}
      </div>

      {/* ── Sensors tab ── */}
      {activeTab === "sensors" && (
        <div className="tab-content">
          {chartData.length === 0 ? (
            <div className="empty-state">Waiting for sensor data…</div>
          ) : (<>
            <div className="chart-block">
              <h3 className="chart-title">Temperature <span>(°C)</span></h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={margin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAx /><YAx unit="°" />
                  <Tooltip content={<ChartTip />} />
                  <Line dataKey="temp" name="Temp °C" stroke={C.temp} dot={{ r: 3 }} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-block">
              <h3 className="chart-title">Pressure <span>(hPa)</span> &amp; Humidity <span>(%)</span></h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={margin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAx /><YAx unit="" />
                  <Tooltip content={<ChartTip />} />
                  <Legend wrapperStyle={{ color: C.muted, fontSize: 12 }} />
                  <Line dataKey="pres" name="Pressure hPa" stroke={C.pres} dot={{ r: 3 }} strokeWidth={2} isAnimationActive={false} />
                  <Line dataKey="hum"  name="Humidity %"   stroke={C.hum}  dot={{ r: 3 }} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-block">
              <h3 className="chart-title">Altitude <span>Barometric vs GPS (m)</span></h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={margin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAx /><YAx unit="m" />
                  <Tooltip content={<ChartTip />} />
                  <Legend wrapperStyle={{ color: C.muted, fontSize: 12 }} />
                  <Line dataKey="alt"    name="Baro Alt m" stroke={C.alt}    dot={{ r: 3 }} strokeWidth={2} isAnimationActive={false} />
                  <Line dataKey="gpsAlt" name="GPS Alt m"  stroke={C.gpsAlt} dot={{ r: 3 }} strokeWidth={2} strokeDasharray="5 3" isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-block">
              <h3 className="chart-title">Temperature vs Altitude <span>(scatter)</span></h3>
              <ResponsiveContainer width="100%" height={220}>
                <ScatterChart margin={margin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="alt"  name="Altitude" unit="m"  tick={{ fill: C.muted, fontSize: 11 }} label={{ value: "Altitude (m)", position: "insideBottom", offset: -2, fill: C.muted, fontSize: 11 }} />
                  <YAxis dataKey="temp" name="Temp"     unit="°C" tick={{ fill: C.muted, fontSize: 11 }} width={52} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<ChartTip />} />
                  <Scatter data={chartData} fill={C.temp} opacity={0.8} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-block">
              <h3 className="chart-title">Pressure vs Altitude <span>(scatter)</span></h3>
              <ResponsiveContainer width="100%" height={220}>
                <ScatterChart margin={margin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="alt"  name="Altitude" unit="m"   tick={{ fill: C.muted, fontSize: 11 }} label={{ value: "Altitude (m)", position: "insideBottom", offset: -2, fill: C.muted, fontSize: 11 }} />
                  <YAxis dataKey="pres" name="Pressure" unit="hPa" tick={{ fill: C.muted, fontSize: 11 }} width={56} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<ChartTip />} />
                  <Scatter data={chartData} fill={C.pres} opacity={0.8} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </>)}
        </div>
      )}

      {/* ── Images tab ── */}
      {activeTab === "images" && (
        <div className="tab-content">

          {/* Lightbox overlay */}
          {selected !== null && gallery[selected] && (
            <div className="lightbox" onClick={() => setSelected(null)}>
              <div className="lightbox-inner" onClick={e => e.stopPropagation()}>
                <div className="lightbox-header">
                  <span>
                    📸 Image {gallery.length - selected} of {gallery.length}
                    &nbsp;·&nbsp;
                    {new Date(gallery[selected].timestamp * 1000).toLocaleTimeString()}
                    &nbsp;·&nbsp;
                    {(gallery[selected].size_bytes / 1024).toFixed(1)} KB
                  </span>
                  <button className="lightbox-close" onClick={() => setSelected(null)}>✕</button>
                </div>
                <img src={gallery[selected].image} alt="CubeSat capture" className="lightbox-img" />
                <div className="lightbox-nav">
                  <button
                    className="nav-btn"
                    disabled={selected >= gallery.length - 1}
                    onClick={() => setSelected(s => s + 1)}>
                    ← Older
                  </button>
                  <span className="nav-label">
                    {new Date(gallery[selected].timestamp * 1000).toLocaleString()}
                  </span>
                  <button
                    className="nav-btn"
                    disabled={selected <= 0}
                    onClick={() => setSelected(s => s - 1)}>
                    Newer →
                  </button>
                </div>
              </div>
            </div>
          )}

          {gallery.length === 0 ? (
            <div className="empty-state">
              <p>📡 Waiting for first image…</p>
              <p className="empty-sub">Images appear here as the receiver assembles packets each cycle</p>
            </div>
          ) : (
            <>
              <div className="gallery-header">
                <span>{gallery.length} image{gallery.length !== 1 ? "s" : ""} this session</span>
                <span className="gallery-sub">Click any image to enlarge · newest first</span>
              </div>
              <div className="gallery-grid">
                {gallery.map((img, i) => (
                  <div key={`${i}-v${img.version ?? 1}`} className={`gallery-thumb ${i === 0 ? "latest" : ""}`}
                    onClick={() => setSelected(i)}>
                    <img src={img.image} alt={`Capture ${gallery.length - i}`} />
                    <div className="thumb-overlay">
                      <span className="thumb-num">#{gallery.length - i}</span>
                      <span className="thumb-time">
                        {new Date(img.timestamp * 1000).toLocaleTimeString()}
                      </span>
                    </div>
                    {i === 0 && <span className="latest-badge">LATEST</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── IR gallery ── */}
          <div style={{ marginBottom: 16 }}>
            <div className="gallery-header">
              <span>🔥 Thermal IR — {irGallery.length} frame{irGallery.length !== 1 ? "s" : ""} this session</span>
              <span className="gallery-sub">Click any frame to enlarge · newest first</span>
            </div>

            {/* IR lightbox */}
            {selectedIR !== null && irGallery[selectedIR] && (
              <div className="lightbox" onClick={() => setSelectedIR(null)}>
                <div className="lightbox-inner" onClick={e => e.stopPropagation()}>
                  <div className="lightbox-header">
                    <span>
                      🔥 Frame {irGallery.length - selectedIR} of {irGallery.length}
                      &nbsp;·&nbsp;
                      {new Date(irGallery[selectedIR].timestamp * 1000).toLocaleTimeString()}
                      &nbsp;·&nbsp;
                      {irGallery[selectedIR].min?.toFixed(1)}°C – {irGallery[selectedIR].max?.toFixed(1)}°C
                    </span>
                    <button className="lightbox-close" onClick={() => setSelectedIR(null)}>✕</button>
                  </div>
                  <div style={{ background: "#060a14", padding: 20, display: "flex", justifyContent: "center" }}>
                    <IRHeatmap
                      frame={irGallery[selectedIR].frame}
                      min={irGallery[selectedIR].min}
                      max={irGallery[selectedIR].max}
                    />
                  </div>
                  <div className="lightbox-nav">
                    <button className="nav-btn"
                      disabled={selectedIR >= irGallery.length - 1}
                      onClick={() => setSelectedIR(s => s + 1)}>← Older</button>
                    <span className="nav-label">
                      {new Date(irGallery[selectedIR].timestamp * 1000).toLocaleString()}
                    </span>
                    <button className="nav-btn"
                      disabled={selectedIR <= 0}
                      onClick={() => setSelectedIR(s => s - 1)}>Newer →</button>
                  </div>
                </div>
              </div>
            )}

            {irGallery.length === 0 ? (
              <div className="image-panel">
                <div className="image-frame">
                  <div className="img-placeholder">
                    <span>🔥 Waiting for IR data…</span>
                    <p>Thermal frames appear here after each cycle</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="gallery-grid">
                {irGallery.map((frame, i) => (
                  <div key={`${i}-v${frame.version ?? 1}`}
                    className={`gallery-thumb ir-thumb ${i === 0 ? "latest" : ""}`}
                    onClick={() => setSelectedIR(i)}>
                    <IRThumbnail frame={frame.frame} min={frame.min} max={frame.max} />
                    <div className="thumb-overlay">
                      <span className="thumb-num">#{irGallery.length - i}</span>
                      <span className="thumb-time">
                        {new Date(frame.timestamp * 1000).toLocaleTimeString()}
                      </span>
                    </div>
                    {i === 0 && <span className="latest-badge">LATEST</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── GPS Track tab ── */}
      {activeTab === "gps" && (
        <div className="tab-content">
          {gpsPoints.length === 0 ? (
            <div className="empty-state">
              <p>🛰 Waiting for GPS data…</p>
              <p className="empty-sub">The flight track will appear here once the sender board gets a GPS fix outdoors</p>
            </div>
          ) : (
            <>
              {/* Map layer toggle */}
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button
                  onClick={() => setMapLayer("street")}
                  style={{
                    padding: "6px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                    background: mapLayer === "street" ? "#ffd93d" : "#1e293b",
                    color: mapLayer === "street" ? "#0f172a" : "#94a3b8",
                    border: "1px solid #334155", fontWeight: 600,
                  }}>
                  🗺 Street
                </button>
                <button
                  onClick={() => setMapLayer("satellite")}
                  style={{
                    padding: "6px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                    background: mapLayer === "satellite" ? "#ffd93d" : "#1e293b",
                    color: mapLayer === "satellite" ? "#0f172a" : "#94a3b8",
                    border: "1px solid #334155", fontWeight: 600,
                  }}>
                  🛰 Satellite
                </button>
              </div>

              {/* Leaflet map */}
              <div style={{ height: 460, borderRadius: 12, overflow: "hidden", border: "1px solid #1e293b", marginBottom: 24 }}>
                <MapContainer
                  center={lastGPS ?? [34.05, -118.24]}
                  zoom={17}
                  style={{ height: "100%", width: "100%" }}
                >
                  {mapLayer === "street" ? (
                    <TileLayer
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    />
                  ) : (
                    <TileLayer
                      url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                      attribution='Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA'
                    />
                  )}
                  <MapUpdater center={lastGPS} />
                  {gpsPoints.length > 1 && (
                    <Polyline positions={gpsPoints} color="#ffd93d" weight={3} opacity={0.9} />
                  )}
                  {lastGPS && (
                    <Marker position={lastGPS}>
                      <Popup>
                        <strong>Latest CubeSat Position</strong><br />
                        Lat: {lastGPS[0].toFixed(6)}<br />
                        Lon: {lastGPS[1].toFixed(6)}<br />
                        Baro Alt: {latest.alt?.toFixed(1)} m<br />
                        Temp: {latest.temp?.toFixed(1)}°C
                      </Popup>
                    </Marker>
                  )}
                </MapContainer>
              </div>

              {/* GPS history table */}
              <div className="chart-block">
                <h3 className="chart-title">GPS History <span>({gpsPoints.length} points)</span></h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: "#cbd5e1" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #1e293b", color: C.muted, textAlign: "left" }}>
                        <th style={{ padding: "8px 12px" }}>#</th>
                        <th style={{ padding: "8px 12px" }}>Latitude</th>
                        <th style={{ padding: "8px 12px" }}>Longitude</th>
                        <th style={{ padding: "8px 12px" }}>Baro Alt (m)</th>
                        <th style={{ padding: "8px 12px" }}>Temp (°C)</th>
                        <th style={{ padding: "8px 12px" }}>Pressure (hPa)</th>
                        <th style={{ padding: "8px 12px" }}>Humidity (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...chartData].reverse().map((row, i) => {
                        const lat = row.loraLat ?? row.lat;
                        const lon = row.loraLon ?? row.lon;
                        if (!lat || !lon || (lat === 0 && lon === 0)) return null;
                        return (
                          <tr key={i} style={{ borderBottom: "1px solid #0f172a" }}>
                            <td style={{ padding: "7px 12px", color: C.muted }}>#{chartData.length - i}</td>
                            <td style={{ padding: "7px 12px", color: "#ffd93d" }}>{lat.toFixed(6)}</td>
                            <td style={{ padding: "7px 12px", color: "#ffd93d" }}>{lon.toFixed(6)}</td>
                            <td style={{ padding: "7px 12px" }}>{row.alt?.toFixed(1)}</td>
                            <td style={{ padding: "7px 12px", color: C.temp }}>{row.temp?.toFixed(1)}</td>
                            <td style={{ padding: "7px 12px", color: C.pres }}>{row.pres?.toFixed(1)}</td>
                            <td style={{ padding: "7px 12px", color: C.hum }}>{row.hum?.toFixed(1)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Log tab ── */}
      {activeTab === "log" && (
        <div className="tab-content">
          <div className="log-panel">
            {log.length === 0 ? (
              <div className="log-empty">No serial output yet…</div>
            ) : (
              [...log].reverse().map((entry, i) => (
                <div key={i} className={`log-line ${classifyLog(entry.msg)}`}>
                  <span className="log-time">{new Date(entry.t * 1000).toLocaleTimeString()}</span>
                  <span className="log-msg">{entry.msg}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function classifyLog(msg) {
  if (msg.startsWith("✅") || msg.startsWith("🎉")) return "log-ok";
  if (msg.startsWith("❌") || msg.startsWith("⚠"))  return "log-err";
  if (msg.startsWith("📥") || msg.startsWith("📡")) return "log-data";
  if (msg.startsWith("🔄"))                          return "log-resend";
  return "";
}