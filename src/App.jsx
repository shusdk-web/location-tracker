import { useState, useEffect, useRef } from "react";

// ============================================================
// Firebase Config
// ============================================================
const DB_URL = "https://location-tracker-d1c63-default-rtdb.asia-southeast1.firebasedatabase.app";

async function fbRead() {
  const res = await fetch(`${DB_URL}/records.json`);
  const data = await res.json();
  if (!data) return [];
  return Object.entries(data).map(([id, val]) => ({ id, ...val }));
}

async function fbWrite(record) {
  await fetch(`${DB_URL}/records.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
}

// ============================================================
// Constants
// ============================================================
const STATUS_OPTIONS = ["出張", "外出", "テレワーク", "帰社", "休暇"];
const STATUS_COLORS = {
  出張: "#f59e0b",
  外出: "#3b82f6",
  テレワーク: "#8b5cf6",
  帰社: "#10b981",
  休暇: "#ef4444",
};

const AUTO_INTERVAL_MS = 30 * 60 * 1000;
const NAME_KEY = "lt_saved_name";

const nowISO = () => new Date().toISOString();
const fmt = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ja`
    );
    const data = await res.json();
    const a = data.address || {};
    const parts = [a.prefecture, a.city || a.town || a.village, a.neighbourhood || a.suburb, a.road].filter(Boolean);
    return parts.join(" ") || data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("位置情報未対応のブラウザです")); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
  });
}

// ============================================================
// Main App
// ============================================================
export default function App() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("register");
  const [form, setForm] = useState({
    name: localStorage.getItem(NAME_KEY) || "",
    status: "外出",
    location: "",
    note: ""
  });
  const [filter, setFilter] = useState({ name: "", status: "" });
  const [toast, setToast] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [nextAutoIn, setNextAutoIn] = useState(null);
  const [showSleepWarning, setShowSleepWarning] = useState(false);
  const autoTimerRef = useRef(null);
  const countdownRef = useRef(null);
  const formRef = useRef(form);

  useEffect(() => { formRef.current = form; }, [form]);

  // 氏名が変わったらlocalStorageに保存
  const handleNameChange = (name) => {
    setForm(f => ({ ...f, name }));
    if (name.trim()) localStorage.setItem(NAME_KEY, name);
  };

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadRecords = async () => {
    setLoading(true);
    try {
      const data = await fbRead();
      setRecords(data.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
    } catch (e) {
      showToast("読み込み失敗: " + e.message, "err");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRecords(); }, []);

  const handleGetLocation = async () => {
    setGeoLoading(true);
    try {
      const pos = await getCurrentPosition();
      const address = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      setForm(f => ({ ...f, location: address }));
      showToast("現在地を取得しました ✓");
    } catch (e) {
      showToast("位置情報の取得に失敗: " + e.message, "err");
    } finally {
      setGeoLoading(false);
    }
  };

  const doRegister = async (f) => {
    if (!f.name.trim()) { showToast("氏名を入力してください", "err"); return false; }
    try {
      let location = f.location;
      try {
        const pos = await getCurrentPosition();
        location = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      } catch { /* 位置情報取得失敗時は既存の場所を使う */ }
      const record = { ...f, location, timestamp: nowISO() };
      await fbWrite(record);
      await loadRecords();
      return true;
    } catch (e) {
      showToast("保存失敗: " + e.message, "err");
      return false;
    }
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { showToast("氏名を入力してください", "err"); return; }
    setLoading(true);
    const ok = await doRegister(form);
    if (ok) {
      setForm(f => ({ ...f, location: "", note: "" }));
      showToast("登録しました ✓");
      setTab("history");
    }
    setLoading(false);
  };

  const startAutoMode = () => {
    if (!formRef.current.name.trim()) {
      showToast("氏名を入力してから開始してください", "err");
      return;
    }
    setAutoMode(true);
    setShowSleepWarning(true);
    showToast("自動登録を開始しました（30分ごと）");
    doRegister(formRef.current);

    let remaining = AUTO_INTERVAL_MS / 1000;
    setNextAutoIn(remaining);
    countdownRef.current = setInterval(() => {
      setNextAutoIn(r => r - 1);
    }, 1000);

    autoTimerRef.current = setInterval(async () => {
      await doRegister(formRef.current);
      showToast("自動登録しました ✓");
      setNextAutoIn(AUTO_INTERVAL_MS / 1000);
    }, AUTO_INTERVAL_MS);
  };

  const stopAutoMode = () => {
    setAutoMode(false);
    setNextAutoIn(null);
    setShowSleepWarning(false);
    clearInterval(autoTimerRef.current);
    clearInterval(countdownRef.current);
    showToast("自動登録を停止しました");
  };

  useEffect(() => () => {
    clearInterval(autoTimerRef.current);
    clearInterval(countdownRef.current);
  }, []);

  const formatCountdown = (sec) => {
    if (sec === null || sec < 0) return "";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `次の自動登録まで ${m}分${String(s).padStart(2,"0")}秒`;
  };

  const filtered = records.filter(r =>
    (!filter.name || r.name.includes(filter.name)) &&
    (!filter.status || r.status === filter.status)
  );

  return (
    <div style={styles.page}>
      {toast && (
        <div style={{ ...styles.toast, background: toast.type === "err" ? "#ef4444" : "#10b981" }}>
          {toast.msg}
        </div>
      )}
      {loading && <div style={styles.loadingBar} />}

      {/* スマホスリープ警告 */}
      {showSleepWarning && (
        <div style={styles.sleepWarning}>
          ⚠️ スマホの画面をオフにすると自動登録が止まります。画面をつけたままにしてください。
          <button style={styles.sleepClose} onClick={() => setShowSleepWarning(false)}>✕</button>
        </div>
      )}

      <header style={styles.header}>
        <span style={styles.logoText}>📍</span>
        <span style={styles.headerTitle}>Location Tracker</span>
        {autoMode && <span style={styles.autoIndicator}>🔄 自動登録中</span>}
        <button style={styles.refreshBtn} onClick={loadRecords} title="更新">↻</button>
      </header>

      <div style={styles.tabs}>
        {["register", "history"].map(t => (
          <button
            key={t}
            style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}
            onClick={() => setTab(t)}
          >
            {t === "register" ? "📝 登録" : "📋 履歴"}
          </button>
        ))}
      </div>

      <div style={styles.content}>
        {tab === "register" && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>居場所を登録</h2>

            <Field label="氏名 *">
              <div style={{ position: "relative" }}>
                <input
                  style={styles.input}
                  value={form.name}
                  onChange={e => handleNameChange(e.target.value)}
                  placeholder="山田 太郎"
                />
                {localStorage.getItem(NAME_KEY) && (
                  <span style={styles.savedBadge}>💾 保存済み</span>
                )}
              </div>
              <p style={styles.hint}>入力した氏名は次回から自動で表示されます</p>
            </Field>

            <Field label="ステータス">
              <div style={styles.statusGrid}>
                {STATUS_OPTIONS.map(s => (
                  <button
                    key={s}
                    style={{
                      ...styles.statusBtn,
                      background: form.status === s ? STATUS_COLORS[s] : "#1e293b",
                      color: form.status === s ? "#fff" : "#94a3b8",
                      border: `2px solid ${form.status === s ? STATUS_COLORS[s] : "#334155"}`,
                    }}
                    onClick={() => setForm({...form, status: s})}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="場所・目的地">
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={{ ...styles.input, flex: 1 }}
                  value={form.location}
                  onChange={e => setForm({...form, location: e.target.value})}
                  placeholder="東京都千代田区 / 〇〇社"
                />
                <button style={styles.geoBtn} onClick={handleGetLocation} disabled={geoLoading} title="現在地を取得">
                  {geoLoading ? "⏳" : "📍"}
                </button>
              </div>
              <p style={styles.hint}>📍ボタンで現在地を自動入力できます</p>
            </Field>

            <Field label="備考">
              <textarea
                style={{...styles.input, height: 72, resize: "vertical"}}
                value={form.note}
                onChange={e => setForm({...form, note: e.target.value})}
                placeholder="帰社予定: 17:00"
              />
            </Field>

            <button style={styles.primaryBtn} onClick={handleSubmit} disabled={loading}>
              {loading ? "保存中…" : "登録する"}
            </button>

            <div style={styles.autoBox}>
              <div style={styles.autoTitle}>🔄 自動登録モード（30分ごと）</div>
              <p style={styles.autoDesc}>ブラウザを開いている間、30分ごとに現在地を自動で登録します。</p>
              {autoMode ? (
                <>
                  <div style={styles.countdown}>{formatCountdown(nextAutoIn)}</div>
                  <button style={styles.stopBtn} onClick={stopAutoMode}>自動登録を停止</button>
                </>
              ) : (
                <button style={styles.autoBtn} onClick={startAutoMode}>自動登録を開始</button>
              )}
            </div>
          </div>
        )}

        {tab === "history" && (
          <div>
            <div style={styles.filterRow}>
              <input
                style={{...styles.input, flex: 1}}
                placeholder="氏名で絞り込み"
                value={filter.name}
                onChange={e => setFilter({...filter, name: e.target.value})}
              />
              <select
                style={{...styles.input, width: 130}}
                value={filter.status}
                onChange={e => setFilter({...filter, status: e.target.value})}
              >
                <option value="">すべて</option>
                {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>

            {filtered.length === 0 && <div style={styles.empty}>履歴がありません</div>}

            {filtered.map(r => (
              <div key={r.id} style={styles.recCard}>
                <div style={styles.recTop}>
                  <span style={styles.recName}>{r.name}</span>
                  <span style={{
                    ...styles.badge,
                    background: STATUS_COLORS[r.status] + "22",
                    color: STATUS_COLORS[r.status],
                    border: `1px solid ${STATUS_COLORS[r.status]}44`,
                  }}>{r.status}</span>
                </div>
                {r.location && <div style={styles.recLocation}>📌 {r.location}</div>}
                {r.note && <div style={styles.recNote}>{r.note}</div>}
                <div style={styles.recTime}>{fmt(r.timestamp)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <div style={{ marginBottom: 16 }}><label style={styles.label}>{label}</label>{children}</div>;
}

const styles = {
  page: { minHeight: "100vh", background: "#0f172a", color: "#e2e8f0", fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif", paddingBottom: 40 },
  logoText: { fontSize: 28 },
  header: { display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", background: "#1e293b", borderBottom: "1px solid #334155", position: "sticky", top: 0, zIndex: 10 },
  headerTitle: { flex: 1, fontWeight: 700, fontSize: 18, color: "#f1f5f9" },
  autoIndicator: { fontSize: 12, color: "#10b981", background: "#10b98122", border: "1px solid #10b98144", borderRadius: 20, padding: "3px 10px" },
  refreshBtn: { background: "none", border: "1px solid #334155", color: "#94a3b8", borderRadius: 8, width: 34, height: 34, cursor: "pointer", fontSize: 18 },
  tabs: { display: "flex", borderBottom: "1px solid #1e293b", background: "#0f172a" },
  tab: { flex: 1, padding: "14px 0", background: "none", border: "none", color: "#64748b", fontSize: 15, cursor: "pointer", fontWeight: 600, borderBottom: "3px solid transparent" },
  tabActive: { color: "#38bdf8", borderBottom: "3px solid #38bdf8" },
  content: { maxWidth: 600, margin: "0 auto", padding: "20px 16px" },
  card: { background: "#1e293b", borderRadius: 14, padding: "24px 20px", boxShadow: "0 4px 24px #0006" },
  cardTitle: { fontSize: 18, fontWeight: 700, margin: "0 0 20px", color: "#f1f5f9" },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 6 },
  input: { width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", fontSize: 15, padding: "10px 12px", boxSizing: "border-box", outline: "none" },
  hint: { fontSize: 12, color: "#475569", marginTop: 6, lineHeight: 1.6 },
  savedBadge: { position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#10b981" },
  geoBtn: { background: "#1e3a5f", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", fontSize: 20, width: 44, cursor: "pointer", flexShrink: 0 },
  statusGrid: { display: "flex", flexWrap: "wrap", gap: 8 },
  statusBtn: { padding: "7px 14px", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" },
  primaryBtn: { width: "100%", background: "#38bdf8", color: "#0f172a", border: "none", borderRadius: 10, padding: "13px 0", fontSize: 16, fontWeight: 700, cursor: "pointer", marginTop: 8 },
  autoBox: { marginTop: 20, background: "#0f172a", borderRadius: 10, padding: "16px", border: "1px solid #334155" },
  autoTitle: { fontWeight: 700, fontSize: 14, color: "#f1f5f9", marginBottom: 6 },
  autoDesc: { fontSize: 12, color: "#64748b", marginBottom: 12 },
  countdown: { fontSize: 13, color: "#38bdf8", marginBottom: 10, textAlign: "center" },
  autoBtn: { width: "100%", background: "#1e3a5f", color: "#38bdf8", border: "1px solid #38bdf8", borderRadius: 8, padding: "10px 0", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  stopBtn: { width: "100%", background: "#3f1515", color: "#ef4444", border: "1px solid #ef4444", borderRadius: 8, padding: "10px 0", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  sleepWarning: { background: "#78350f", color: "#fcd34d", padding: "12px 16px", fontSize: 13, display: "flex", alignItems: "center", gap: 8, lineHeight: 1.5 },
  sleepClose: { marginLeft: "auto", background: "none", border: "none", color: "#fcd34d", fontSize: 16, cursor: "pointer", flexShrink: 0 },
  filterRow: { display: "flex", gap: 10, marginBottom: 16 },
  recCard: { background: "#1e293b", borderRadius: 12, padding: "14px 16px", marginBottom: 10, borderLeft: "3px solid #38bdf8" },
  recTop: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 },
  recName: { fontWeight: 700, fontSize: 16, color: "#f1f5f9", flex: 1 },
  badge: { padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600 },
  recLocation: { fontSize: 14, color: "#94a3b8", marginBottom: 4 },
  recNote: { fontSize: 13, color: "#64748b", marginBottom: 4 },
  recTime: { fontSize: 12, color: "#475569", textAlign: "right" },
  empty: { textAlign: "center", color: "#475569", padding: "60px 0" },
  toast: { position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", padding: "10px 20px", borderRadius: 10, color: "#fff", fontWeight: 600, fontSize: 14, zIndex: 100, boxShadow: "0 4px 20px #0008" },
  loadingBar: { position: "fixed", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #38bdf8, #818cf8)", zIndex: 200 },
};
