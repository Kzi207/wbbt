const { useEffect, useMemo, useState } = React;

const API = `${window.location.origin}/api`;

const tabs = [
  { id: "home", label: "Trang Chủ" },
  { id: "cookie", label: "Cookie" },
  { id: "bot-control", label: "Điều Khiển Bot" },
  { id: "groups", label: "Nhóm Bot" },
  { id: "rent", label: "Thuê Bot" },
  { id: "commands", label: "Bật/Tắt Lệnh" },
  { id: "ban", label: "Ban / Unban" }
];

async function callApi(path, options = {}) {
  const requestOptions = { ...options };
  const hasBody = typeof requestOptions.body === "string";
  requestOptions.headers = {
    ...(requestOptions.headers || {}),
    ...(hasBody ? { "Content-Type": "application/json" } : {})
  };

  const response = await fetch(`${API}${path}`, requestOptions);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const err = new Error(data.error || "Yeu cau that bai");
    err.status = response.status;
    throw err;
  }
  return response.json();
}

function Section({ title, subtitle, children }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      {children}
    </section>
  );
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(
    window.sessionStorage.getItem("isLoggedIn") === "true"
  );
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [activeTab, setActiveTab] = useState("home");
  const [status, setStatus] = useState("");

  const [cookieText, setCookieText] = useState("");
  const [groups, setGroups] = useState([]);
  const [rentGroups, setRentGroups] = useState([]);
  const [rentKeys, setRentKeys] = useState({ used_keys: [], unUsed_keys: [] });
  const [disableMap, setDisableMap] = useState({});
  const [allCommands, setAllCommands] = useState([]);
  const [bannedCommands, setBannedCommands] = useState([]);
  const [banUsers, setBanUsers] = useState([]);
  const [banThreads, setBanThreads] = useState([]);
  const [adminUid, setAdminUid] = useState("");
  const [botRunning, setBotRunning] = useState(false);
  const [botPid, setBotPid] = useState(null);
  const [botLogs, setBotLogs] = useState([]);
  const [logCursor, setLogCursor] = useState(0);

  const [newRent, setNewRent] = useState({ t_id: "", uid_renter: "", days_rented: 30 });
  const [newKeyDays, setNewKeyDays] = useState(30);
  const [toggleState, setToggleState] = useState({ threadId: "", category: "", disabled: true });
  const [commandThreadId, setCommandThreadId] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [banUserState, setBanUserState] = useState({ userId: "", reason: "" });
  const [banThreadState, setBanThreadState] = useState({ threadId: "", reason: "" });

  const categories = useMemo(() => {
    const values = new Set();
    Object.values(disableMap).forEach((v) => Object.keys(v || {}).forEach((k) => values.add(k)));
    return Array.from(values);
  }, [disableMap]);

  async function refreshAll() {
    try {
      const [cookie, adminRes, botRes, groupRes, rentRes, keyRes, disableRes, commandsRes, usersRes, threadsRes] = await Promise.all([
        callApi("/cookie"),
        callApi("/config/admin"),
        callApi("/bot/status"),
        callApi("/groups"),
        callApi("/rental/groups"),
        callApi("/rental/keys"),
        callApi("/commands/disabled"),
        callApi("/commands/all"),
        callApi("/ban/users"),
        callApi("/ban/threads")
      ]);
      setCookieText(cookie.cookie || "");
      setAdminUid(adminRes.adminUid || "");
      setBotRunning(Boolean(botRes.running));
      setBotPid(botRes.pid || null);
      setGroups(groupRes.items || []);
      setRentGroups(rentRes.items || []);
      setRentKeys(keyRes || { used_keys: [], unUsed_keys: [] });
      setDisableMap(disableRes.items || {});
      setAllCommands(commandsRes.items || []);
      setBanUsers(usersRes.items || []);
      setBanThreads(threadsRes.items || []);
      setStatus("Tai du lieu thanh cong");
    } catch (error) {
      setStatus(error.message);
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      refreshAll();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const data = await callApi(`/bot/logs?after=${logCursor}`);
        if (data.items?.length) {
          setBotLogs((prev) => [...prev, ...data.items].slice(-1000));
          setLogCursor(data.lastId || logCursor);
        }
        setBotRunning(Boolean(data.running));
      } catch (_err) {}
    }, 1200);

    return () => clearInterval(timer);
  }, [logCursor]);

  async function saveCookie() {
    try {
      await callApi("/cookie", { method: "PUT", body: JSON.stringify({ cookie: cookieText }) });
      setStatus("Da cap nhat cookie");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function leaveGroup(threadId) {
    try {
      await callApi(`/groups/${threadId}/leave`, { method: "POST" });
      await refreshAll();
      const msg = `Đã xóa nhóm ${threadId} khỏi cơ sở dữ liệu.`;
      setStatus(msg);
      window.alert(msg);
    } catch (error) {
      setStatus(error.message);
      window.alert("Lỗi: " + error.message);
    }
  }

  async function saveAdminUid() {
    try {
      await callApi("/config/admin", { method: "PUT", body: JSON.stringify({ adminUid }) });
      setStatus("Da cap nhat UID admin");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function startBot() {
    try {
      const res = await callApi("/bot/start", {
        method: "POST",
        body: JSON.stringify({ adminUid, cookie: cookieText })
      });
      setBotRunning(Boolean(res.running));
      setBotPid(res.pid || null);
      setStatus("Da chay bot");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function stopBot() {
    try {
      await callApi("/bot/stop", { method: "POST" });
      setBotRunning(false);
      setStatus("Da dung bot");
    } catch (error) {
      setStatus(error.message);
    }
  }

  function clearLogs() {
    setBotLogs([]);
  }

  async function addRentGroup(e) {
    e.preventDefault();
    try {
      await callApi("/rental/groups", { method: "POST", body: JSON.stringify(newRent) });
      setNewRent({ t_id: "", uid_renter: "", days_rented: 30 });
      await refreshAll();
      setStatus("Da them nhom thue bot");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function deleteRentGroup(tid) {
    try {
      await callApi(`/rental/groups/${tid}`, { method: "DELETE" });
      await refreshAll();
      setStatus("Da xoa nhom thue bot");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function createRentKey() {
    try {
      const result = await callApi("/rental/keys", { method: "POST", body: JSON.stringify({ days: Number(newKeyDays) }) });
      await refreshAll();
      setStatus(`Da tao key thue bot: ${result.key || "(khong ro key)"}`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function deleteKey(key) {
    try {
      const res = await callApi("/rental/keys", {
        method: "POST",
        body: JSON.stringify({ action: "delete", key })
      });
      await refreshAll();
      const msg = res.removed ? `Da xoa key: ${key}` : `Khong tim thay key: ${key}`;
      setStatus(msg);
      window.alert(msg);
    } catch (error) {
      setStatus(error.message);
      window.alert(`Loi xoa key: ${error.message}`);
    }
  }

  async function updateDisable(e) {
    e.preventDefault();
    try {
      await callApi(`/commands/disabled/${toggleState.threadId}`, {
        method: "PUT",
        body: JSON.stringify({ category: toggleState.category, disabled: toggleState.disabled })
      });
      await refreshAll();
      setStatus("Da cap nhat trang thai lenh");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function loadBannedCommands(threadId) {
    const tid = String(threadId || "").trim();
    if (!tid) {
      setBannedCommands([]);
      return;
    }
    try {
      const res = await callApi(`/commands/banned/${tid}`);
      setBannedCommands(res.items || []);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function toggleCommand(commandName, nextBanned) {
    const tid = String(selectedThreadId || commandThreadId || "").trim();
    if (!tid) {
      setStatus("Chon nhom truoc");
      return;
    }
    try {
      await callApi(`/commands/banned/${tid}`, {
        method: "PUT",
        body: JSON.stringify({ command: commandName, banned: nextBanned })
      });
      await loadBannedCommands(tid);
      setStatus(nextBanned ? `Da tat lenh ${commandName}` : `Da bat lenh ${commandName}`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function banUser(e) {
    e.preventDefault();
    try {
      await callApi("/ban/users", { method: "POST", body: JSON.stringify(banUserState) });
      setBanUserState({ userId: "", reason: "" });
      await refreshAll();
      setStatus("Da ban user");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function unbanUser(userId) {
    try {
      await callApi(`/ban/users/${userId}`, { method: "DELETE" });
      await refreshAll();
      setStatus("Da unban user");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function banThread(e) {
    e.preventDefault();
    try {
      await callApi("/ban/threads", { method: "POST", body: JSON.stringify(banThreadState) });
      setBanThreadState({ threadId: "", reason: "" });
      await refreshAll();
      setStatus("Da ban nhom");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function unbanThread(threadId) {
    try {
      await callApi(`/ban/threads/${threadId}`, { method: "DELETE" });
      await refreshAll();
      setStatus("Da unban nhom");
    } catch (error) {
      setStatus(error.message);
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="layout" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <div className="panel" style={{ width: '100%', maxWidth: '400px', animation: 'fadeIn 0.5s ease' }}>
          <div className="panel-head" style={{ textAlign: 'center', marginBottom: '30px' }}>
            <h1 style={{ fontSize: '1.8rem', background: 'linear-gradient(135deg, #a5b4fc, #818cf8)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '10px' }}>
              Bot Manager
            </h1>
            <p>Vui lòng đăng nhập để tiếp tục</p>
          </div>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (password === "kzi207") {
              window.sessionStorage.setItem("isLoggedIn", "true");
              setIsAuthenticated(true);
            } else {
              setLoginError("Mật khẩu không chính xác!");
            }
          }}>
            <input 
              type="password" 
              placeholder="Nhập mật khẩu..." 
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setLoginError("");
              }}
              style={{ marginBottom: '20px' }}
            />
            {loginError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '-10px', marginBottom: '15px' }}>{loginError}</p>}
            <button type="submit" style={{ width: '100%' }}>Đăng Nhập</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Bot Control Deck</h1>
        <p>Quan tri bot tren mot giao dien web JSX.</p>
        <nav>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? "tab active" : "tab"}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <button className="ghost" onClick={refreshAll}>Lam moi</button>
      </aside>

      <main className="content">
        <p className="status">{status || "Sẵn sàng hoạt động"}</p>

        {activeTab === "home" && (
          <div>
            <div className="dashboard-grid">
              <div className="stat-card">
                <div className="stat-icon">🤖</div>
                <div className="stat-label">Trạng thái Bot</div>
                <div className={`stat-value ${botRunning ? 'ok' : 'error'}`}>{botRunning ? "Đang chạy" : "Đã dừng"}</div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">👥</div>
                <div className="stat-label">Tổng nhóm</div>
                <div className="stat-value">{groups.length}</div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">🔑</div>
                <div className="stat-label">Nhóm đang thuê</div>
                <div className="stat-value">{rentGroups.length}</div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">🚫</div>
                <div className="stat-label">Users bị Ban</div>
                <div className="stat-value">{banUsers.length}</div>
              </div>
            </div>
            
            <Section title="Tổng Quan" subtitle="Hệ thống Bot Web Manager. Chọn các tính năng từ thanh công cụ bên tay trái để quản lý Bot.">
              <div className="row">
                <button onClick={refreshAll}>🔄 Làm mới dữ liệu</button>
                {botRunning ? (
                   <button onClick={stopBot} style={{ background: 'var(--danger)' }}>⏹️ Dừng Bot</button>
                ) : (
                   <button onClick={startBot}>▶️ Chạy Bot</button>
                )}
              </div>
              <br/>
              <p>Phiên bản giao diện Premium v2.0 - Tối ưu hoá với hệ thống Glassmorphism</p>
            </Section>
          </div>
        )}

        {activeTab === "cookie" && (
          <Section title="Quản Lý Cookie" subtitle="Thay đổi cookie khi cookie cũ hết hạn hoặc bị lỗi.">
            <textarea rows={10} value={cookieText} onChange={(e) => setCookieText(e.target.value)} placeholder="Nhập Cookie mới vào đây..." />
            <button onClick={saveCookie}>Lưu Cookie</button>
          </Section>
        )}

        {activeTab === "bot-control" && (
          <>
            <Section title="Dieu Khien Bot" subtitle="Web chay truoc, bot chi chay khi bam nut.">
              <div className="grid-form grid-2">
                <input
                  placeholder="UID Admin"
                  value={adminUid}
                  onChange={(e) => setAdminUid(e.target.value)}
                />
                <button onClick={saveAdminUid}>Luu UID Admin</button>
              </div>

              <textarea
                rows={7}
                value={cookieText}
                onChange={(e) => setCookieText(e.target.value)}
                placeholder="Cookie"
              />

              <div className="row">
                <button onClick={saveCookie}>Luu Cookie</button>
                <button onClick={startBot}>Run Bot</button>
                <button onClick={stopBot}>Stop Bot</button>
                <button onClick={clearLogs}>Clear Console</button>
              </div>

              <p>Trang thai: {botRunning ? "Dang chay" : "Dang dung"} {botPid ? `| PID: ${botPid}` : ""}</p>
            </Section>

            <Section title="Console Bot" subtitle="Log realtime cua bot.">
              <div className="console-box">
                {botLogs.length === 0 ? "Chua co log" : botLogs.map((line) => line.text).join("\n")}
              </div>
            </Section>
          </>
        )}

        {activeTab === "groups" && (
          <Section title="Quan Ly Nhom Bot" subtitle="Danh sach nhom bot dang tham gia.">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Thread ID</th>
                    <th>Ten Nhom</th>
                    <th>So TV</th>
                    <th>Dang Thue</th>
                    <th>Thao tac</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.threadID}>
                      <td>{g.threadID}</td>
                      <td>{g.threadName || "(khong ro)"}</td>
                      <td>{g.memberCount ?? "-"}</td>
                      <td>{g.isRented ? "Co" : "Khong"}</td>
                      <td>
                        <button onClick={() => leaveGroup(g.threadID)}>Roi Nhom</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {activeTab === "rent" && (
          <>
            <Section title="Them Nhom Thue Bot" subtitle="Them theo UID nhom.">
              <form className="grid-form" onSubmit={addRentGroup}>
                <input
                  placeholder="UID nhom (t_id)"
                  value={newRent.t_id}
                  onChange={(e) => setNewRent((s) => ({ ...s, t_id: e.target.value }))}
                />
                <input
                  placeholder="UID nguoi thue"
                  value={newRent.uid_renter}
                  onChange={(e) => setNewRent((s) => ({ ...s, uid_renter: e.target.value }))}
                />
                <input
                  type="number"
                  min={1}
                  placeholder="So ngay"
                  value={newRent.days_rented}
                  onChange={(e) => setNewRent((s) => ({ ...s, days_rented: e.target.value }))}
                />
                <button type="submit">Them Nhom Thue</button>
              </form>
            </Section>

            <Section title="Danh Sach Nhom Dang Thue">
              <ul className="chip-list">
                {rentGroups.map((item) => (
                  <li key={item.t_id}>
                    <span>{item.t_id} | {item.uid_renter} | {item.time_end}</span>
                    <button onClick={() => deleteRentGroup(item.t_id)}>Xoa</button>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Tao Key Thue Bot">
              <div className="row">
                <input
                  type="number"
                  min={1}
                  value={newKeyDays}
                  onChange={(e) => setNewKeyDays(e.target.value)}
                />
                <button onClick={createRentKey}>Tao Key</button>
              </div>
              <p>Key chua dung: {rentKeys.unUsed_keys?.length || 0} | Key da dung: {rentKeys.used_keys?.length || 0}</p>

              <div className="key-grid">
                <div>
                  <h3>Danh sach key chua dung</h3>
                  <ul className="key-list">
                    {(rentKeys.unUsed_keys || []).length === 0 && <li>(khong co key)</li>}
                    {(rentKeys.unUsed_keys || []).map((key) => (
                      <li key={`u-${key}`}>
                        <span>{key}</span>
                        <button type="button" className="small-btn" onClick={(e) => { e.preventDefault(); deleteKey(key); }}>Xoa</button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3>Danh sach key da dung</h3>
                  <ul className="key-list key-list-used">
                    {(rentKeys.used_keys || []).length === 0 && <li>(khong co key)</li>}
                    {(rentKeys.used_keys || []).map((key) => (
                      <li key={`x-${key}`}>
                        <span>{key}</span>
                        <button type="button" className="small-btn" onClick={(e) => { e.preventDefault(); deleteKey(key); }}>Xoa</button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Section>
          </>
        )}

        {activeTab === "commands" && (
          <>
            <Section title="Tat/Bat Tung Lenh" subtitle="Hien all lenh va tat/bat theo tung thread.">
              <div className="row">
                <select
                  value={selectedThreadId}
                  onChange={(e) => {
                    const tid = e.target.value;
                    setSelectedThreadId(tid);
                    setCommandThreadId(tid);
                    setToggleState((s) => ({ ...s, threadId: tid }));
                    loadBannedCommands(tid);
                  }}
                >
                  <option value="">Chon nhom...</option>
                  {groups.map((g) => (
                    <option key={g.threadID} value={g.threadID}>
                      {(g.threadName || "(khong ro)") + " | " + g.threadID}
                    </option>
                  ))}
                </select>
                <button onClick={() => loadBannedCommands(selectedThreadId)}>Tai trang thai lenh</button>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Lenh</th>
                      <th>Nhom</th>
                      <th>Trang thai</th>
                      <th>Hanh dong</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allCommands.map((cmd) => {
                      const isBanned = bannedCommands.some((x) => x.cmd === cmd.name);
                      return (
                        <tr key={cmd.file}>
                          <td>{cmd.name}</td>
                          <td>{cmd.category}</td>
                          <td>{isBanned ? "Dang tat" : "Dang bat"}</td>
                          <td>
                            <button onClick={() => toggleCommand(cmd.name, !isBanned)}>
                              {isBanned ? "Unban (Bat)" : "Ban (Tat)"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Bat Tat Lenh">
              <form className="grid-form" onSubmit={updateDisable}>
                <select
                  value={selectedThreadId}
                  onChange={(e) => {
                    const tid = e.target.value;
                    setSelectedThreadId(tid);
                    setCommandThreadId(tid);
                    setToggleState((s) => ({ ...s, threadId: tid }));
                    loadBannedCommands(tid);
                  }}
                >
                  <option value="">Chon nhom...</option>
                  {groups.map((g) => (
                    <option key={g.threadID} value={g.threadID}>
                      {(g.threadName || "(khong ro)") + " | " + g.threadID}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="Category"
                  value={toggleState.category}
                  onChange={(e) => setToggleState((s) => ({ ...s, category: e.target.value }))}
                  list="known-categories"
                />
                <datalist id="known-categories">
                  {categories.map((c) => (
                    <option value={c} key={c} />
                  ))}
                </datalist>
                <select
                  value={String(toggleState.disabled)}
                  onChange={(e) => setToggleState((s) => ({ ...s, disabled: e.target.value === "true" }))}
                >
                  <option value="true">Tat</option>
                  <option value="false">Bat</option>
                </select>
                <button type="submit">Cap Nhat</button>
              </form>
            </Section>

            <Section title="Danh Sach Dang Tat">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Thread ID</th>
                      <th>Cac category dang tat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(disableMap).map(([tid, map]) => (
                      <tr key={tid}>
                        <td>{tid}</td>
                        <td>{Object.entries(map).filter(([, v]) => v === true).map(([k]) => k).join(", ") || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Danh Sach Lenh Da Tat (Unban)">
              <ul className="chip-list">
                {bannedCommands.map((x) => (
                  <li key={`${x.cmd}-${x.time || ""}`}>
                    <span>{x.cmd} | {x.time || ""}</span>
                    <button onClick={() => toggleCommand(x.cmd, false)}>Unban</button>
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}

        {activeTab === "ban" && (
          <>
            <Section title="Ban User" subtitle="Ban/Unban nguoi dung khoi bot.">
              <form className="grid-form" onSubmit={banUser}>
                <input
                  placeholder="User ID"
                  value={banUserState.userId}
                  onChange={(e) => setBanUserState((s) => ({ ...s, userId: e.target.value }))}
                />
                <input
                  placeholder="Ly do"
                  value={banUserState.reason}
                  onChange={(e) => setBanUserState((s) => ({ ...s, reason: e.target.value }))}
                />
                <button type="submit">Ban User</button>
              </form>
              <ul className="chip-list">
                {banUsers.map((u) => (
                  <li key={u.userID}>
                    <span>{u.userID} | {u.reason || "(khong ly do)"}</span>
                    <button onClick={() => unbanUser(u.userID)}>Unban</button>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Ban Nhom" subtitle="Ban/Unban thread nhom.">
              <form className="grid-form" onSubmit={banThread}>
                <input
                  placeholder="Thread ID"
                  value={banThreadState.threadId}
                  onChange={(e) => setBanThreadState((s) => ({ ...s, threadId: e.target.value }))}
                />
                <input
                  placeholder="Ly do"
                  value={banThreadState.reason}
                  onChange={(e) => setBanThreadState((s) => ({ ...s, reason: e.target.value }))}
                />
                <button type="submit">Ban Nhom</button>
              </form>
              <ul className="chip-list">
                {banThreads.map((t) => (
                  <li key={t.threadID}>
                    <span>{t.threadID} | {t.reason || "(khong ly do)"}</span>
                    <button onClick={() => unbanThread(t.threadID)}>Unban</button>
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
