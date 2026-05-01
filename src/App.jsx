import { useState, useEffect, useCallback } from "react";

// ============================================================
// Google Drive API helpers
// ============================================================
const CLIENT_ID_KEY = "lt_gd_client_id";
const FILE_NAME = "location-tracker-log.json";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";

function useGoogleDrive() {
  const [status, setStatus] = useState("idle"); // idle | init | ready | error
  const [error, setError] = useState(null);
  const [fileId, setFileId] = useState(null);
  const [clientId, setClientId] = useState(() => localStorage.getItem(CLIENT_ID_KEY) || "");
  const [tokenClient, setTokenClient] = useState(null);
  const [accessToken, setAccessToken] = useState(null);

  const saveClientId = (id) => {
    setClientId(id);
    localStorage.setItem(CLIENT_ID_KEY, id);
  };

  const initGIS = useCallback((cid) => {
    if (!window.google?.accounts?.oauth2) {
      setError("Google Identity Services が読み込まれていません");
      setStatus("error");
      return;
    }
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) { setError(resp.error); setStatus("error"); return; }
        setAccessToken(resp.access_token);
        setStatus("ready");
      },
    });
    setTokenClient(tc);
  }, []);

  const signIn = useCallback(() => {
    if (!tokenClient) { setError("先にクライアントIDを設定してください"); return; }
    setStatus("init");
    tokenClient.requestAccessToken({ prompt: "consent" });
  }, [tokenClient]);

  // Find or create the JSON file in appDataFolder
  const ensureFile = useCallback(async (token) => {
    const listRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${FILE_NAME}'&fields=files(id)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const listData = await listRes.json();
    if (listData.files?.length) {
      setFileId(listData.files[0].id);
      return listData.files[0].id;
    }
    const meta = { name: FILE_NAME, parents: ["appDataFolder"] };
    const createRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/related; boundary=bound" },
        body: `--bound\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--bound\r\nContent-Type: application/json\r\n\r\n[]\r\n--bound--`,
      }
    );
    const createData = await createRes.json();
    setFileId(createData.id);
    return createData.id;
  }, []);

  const readRecords = useCallback(async () => {
    const fid = fileId || await ensureFile(accessToken);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fid}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const text = await res.text();
    try { return JSON.parse(text); } catch { return []; }
  }, [accessToken, fileId, ensureFile]);

  const writeRecords = useCallback(async (records) => {
    const fid = fileId || await ensureFile(accessToken);
    await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fid}?uploadType=media`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(records),
      }
    );
  }, [accessToken, fileId, ensureFile]);

  return { status, error, clientId, saveClientId, initGIS, signIn, readRecords, writeRecords, accessToken };
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

const now = () => new Date().toISOString();
const fmt = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

// ============================================================
// Main App
// ============================================================
export default function App() {
  const drive = useGoogleDrive();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("register"); // register | history
  const [form, setForm] = useState({ name: "", status: "外出", location: "", note: "" });
  const [filter, setFilter] = useState({ name: "", status: "" });
  const [cidInput, setCidInput] = useState(() => localStorage.getItem(CLIENT_ID_KEY) || "");
  const [toast, setToast] = useState(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load records when ready
  useEffect(() => {
    if (drive.status === "ready" && !loadedOnce) {
      setLoadedOnce(true);
      loadRecords();
    }
  }, [drive.status]);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const data = await drive.readRecords();
      setRecords(data.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
    } catch (e) { showToast("読み込み失敗: " + e.message, "err"); }
    finally { setLoading(false); }
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { showToast("氏名を入力してください", "err"); return; }
    setLoading(true);
    try {
      const newRec = { id: crypto.randomUUID(), ...form, timestamp: now() };
      const updated = [newRec, ...records];
      await drive.writeRecords(updated);
      setRecords(updated);
      setForm({ name: "", status: "外出", location: "", note: "" });
      showToast("登録しました ✓");
      setTab("history");
    } catch (e) { showToast("保存失敗: " + e.message, "err"); }
    finally { setLoading(false); }
  };

  const filtered = records.filter(r =>
    (!filter.name || r.name.includes(filter.name)) &&
    (!filter.status || r.status === filter.status)
  );

  // ── Setup screen ──
  if (drive.status === "idle" || !drive.accessToken) {
    return (
      <div style={styles.page}>
        <div style={styles.setupCard}>
          <div style={styles.logo}>📍</div>
          <h1 style={styles.title}>Location Tracker</h1>
          <p style={styles.subtitle}>出張・外出者の居場所をチームで共有</p>

          <div style={styles.section}>
            <label style={styles.label}>Google Client ID</label>
            <input
              style={styles.input}
              value={cidInput}
              onChange={e => setCidInput(e.target.value)}
              placeholder="xxx.apps.googleusercontent.com"
            />
            <p style={styles.hint}>
              <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" style={styles.link}>
                Google Cloud Console
              </a> でプロジェクトを作成し、OAuthクライアントIDを取得してください。<br/>
              スコープ: <code style={styles.code}>drive.appdata</code>
            </p>
          </div>

          {drive.error && <div style={styles.errorBox}>{drive.error}</div>}

          <button
            style={styles.primaryBtn}
            onClick={() => {
              drive.saveClientId(cidInput);
              drive.initGIS(cidInput);
              setTimeout(() => drive.signIn(), 300);
            }}
            disabled={!cidInput.trim()}
          >
            Googleドライブで認証
          </button>
        </div>
        <Script src="https://accounts.google.com/gsi/client" />
      </div>
    );
  }

  // ── Main screen ──
  return (
    <div style={styles.page}>
      <Script src="https://accounts.google.com/gsi/client" />

      {toast && (
        <div style={{ ...styles.toast, background: toast.type === "err" ? "#ef4444" : "#10b981" }}>
          {toast.msg}
        </div>
      )}

      {loading && <div style={styles.loadingBar} />}

      <header style={styles.header}>
        <span style={styles.logo}>📍</span>
        <span style={styles.headerTitle}>Location Tracker</span>
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
              <input style={styles.input} value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="山田 太郎" />
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
              <input style={styles.input} value={form.location} onChange={e => setForm({...form, location: e.target.value})} placeholder="東京都千代田区 / 〇〇社" />
            </Field>

            <Field label="備考">
              <textarea style={{...styles.input, height: 72, resize: "vertical"}} value={form.note} onChange={e => setForm({...form, note: e.target.value})} placeholder="帰社予定: 17:00" />
            </Field>

            <button style={styles.primaryBtn} onClick={handleSubmit} disabled={loading}>
              {loading ? "保存中…" : "登録する"}
            </button>
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

            {filtered.length === 0 && (
              <div style={styles.empty}>履歴がありません</div>
            )}

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
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}

function Script({ src }) {
  useEffect(() => {
    if (document.querySelector(`script[src="${src}"]`)) return;
    const s = document.createElement("script");
    s.src = src; s.async = true;
    document.head.appendChild(s);
  }, [src]);
  return null;
}

// ============================================================
// Styles
// ============================================================
const styles = {
  page: {
    minHeight: "100vh",
    background: "#0f172a",
    color: "#e2e8f0",
    fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
    paddingBottom: 40,
  },
  setupCard: {
    maxWidth: 480,
    margin: "80px auto",
    background: "#1e293b",
    borderRadius: 16,
    padding: "40px 36px",
    boxShadow: "0 20px 60px #0008",
  },
  logo: { fontSize: 40, display: "block", textAlign: "center", marginBottom: 12 },
  title: { textAlign: "center", fontSize: 24, fontWeight: 700, margin: "0 0 6px", color: "#f1f5f9" },
  subtitle: { textAlign: "center", color: "#64748b", fontSize: 14, margin: "0 0 32px" },
  header: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "16px 20px",
    background: "#1e293b",
    borderBottom: "1px solid #334155",
    position: "sticky", top: 0, zIndex: 10,
  },
  headerTitle: { flex: 1, fontWeight: 700, fontSize: 18, color: "#f1f5f9" },
  refreshBtn: {
    background: "none", border: "1px solid #334155", color: "#94a3b8",
    borderRadius: 8, width: 34, height: 34, cursor: "pointer", fontSize: 18,
  },
  tabs: { display: "flex", borderBottom: "1px solid #1e293b", background: "#0f172a" },
  tab: {
    flex: 1, padding: "14px 0", background: "none", border: "none",
    color: "#64748b", fontSize: 15, cursor: "pointer", fontWeight: 600,
    borderBottom: "3px solid transparent",
  },
  tabActive: { color: "#38bdf8", borderBottom: "3px solid #38bdf8" },
  content: { maxWidth: 600, margin: "0 auto", padding: "20px 16px" },
  card: {
    background: "#1e293b", borderRadius: 14, padding: "24px 20px",
    boxShadow: "0 4px 24px #0006",
  },
  cardTitle: { fontSize: 18, fontWeight: 700, margin: "0 0 20px", color: "#f1f5f9" },
  section: { marginBottom: 24 },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 6 },
  input: {
    width: "100%", background: "#0f172a", border: "1px solid #334155",
    borderRadius: 8, color: "#e2e8f0", fontSize: 15, padding: "10px 12px",
    boxSizing: "border-box", outline: "none",
  },
  hint: { fontSize: 12, color: "#475569", marginTop: 8, lineHeight: 1.6 },
  link: { color: "#38bdf8" },
  code: { background: "#0f172a", padding: "1px 5px", borderRadius: 4, fontSize: 11 },
  statusGrid: { display: "flex", flexWrap: "wrap", gap: 8 },
  statusBtn: {
    padding: "7px 14px", borderRadius: 8, fontSize: 14, fontWeight: 600,
    cursor: "pointer", transition: "all 0.15s",
  },
  primaryBtn: {
    width: "100%", background: "#38bdf8", color: "#0f172a",
    border: "none", borderRadius: 10, padding: "13px 0",
    fontSize: 16, fontWeight: 700, cursor: "pointer", marginTop: 8,
  },
  filterRow: { display: "flex", gap: 10, marginBottom: 16 },
  recCard: {
    background: "#1e293b", borderRadius: 12, padding: "14px 16px",
    marginBottom: 10, borderLeft: "3px solid #38bdf8",
  },
  recTop: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 },
  recName: { fontWeight: 700, fontSize: 16, color: "#f1f5f9", flex: 1 },
  badge: { padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600 },
  recLocation: { fontSize: 14, color: "#94a3b8", marginBottom: 4 },
  recNote: { fontSize: 13, color: "#64748b", marginBottom: 4 },
  recTime: { fontSize: 12, color: "#475569", textAlign: "right" },
  empty: { textAlign: "center", color: "#475569", padding: "60px 0" },
  errorBox: { background: "#7f1d1d", borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 14, marginBottom: 16 },
  toast: {
    position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
    padding: "10px 20px", borderRadius: 10, color: "#fff", fontWeight: 600,
    fontSize: 14, zIndex: 100, boxShadow: "0 4px 20px #0008",
  },
  loadingBar: {
    position: "fixed", top: 0, left: 0, right: 0, height: 3,
    background: "linear-gradient(90deg, #38bdf8, #818cf8)",
    zIndex: 200, animation: "none",
  },
};
