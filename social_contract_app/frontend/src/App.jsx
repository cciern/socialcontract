import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

function errorMessage(err) {
  if (!err) return "Something went wrong";
  if (err.message) return err.message;
  return String(err);
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function computeStreak(entries, userId) {
  if (!entries?.length || !userId) return 0;
  const doneDays = new Set(
    entries.filter((e) => e.userId === userId && (e.done === 1 || e.done === true)).map((e) => e.dateKey)
  );
  let streak = 0;
  let cursor = new Date(getTodayKey());
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (doneDays.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

// Lightweight API helper
async function api(path, options = {}, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    headers,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Request failed");
  }
  return res.json();
}

export default function App() {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("sc_user");
    return raw ? JSON.parse(raw) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem("sc_token") || "");
  const [contracts, setContracts] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState({});
  const [checkins, setCheckins] = useState({});
  const [inviteNotice, setInviteNotice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [matchOverlay, setMatchOverlay] = useState(null);
  const [error, setError] = useState("");
  const [view, setView] = useState("discover"); // discover (browse), new (create), contracts, chat
  const [openContracts, setOpenContracts] = useState([]);
  const [exploreSearch, setExploreSearch] = useState("");
  const contractLimit = 3;
  const socketRef = useRef(null);

  // Init socket once per session.
  useEffect(() => {
    const socket = io(API_URL, { transports: ["websocket"] });
    socketRef.current = socket;
    return () => socket.close();
  }, []);

  // Persist user locally.
  useEffect(() => {
    if (user) localStorage.setItem("sc_user", JSON.stringify(user));
    else localStorage.removeItem("sc_user");
  }, [user]);

  useEffect(() => {
    if (token) localStorage.setItem("sc_token", token);
    else localStorage.removeItem("sc_token");
  }, [token]);

  // Load contracts for logged-in user.
  useEffect(() => {
    if (!user) return;
    loadContracts();
    loadOpenContracts();
  }, [user]);

  // Join room and load messages when active contract changes.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !activeId) return;
    socket.emit("join_contract", { contractId: activeId });
    socket.off("new_message");
    socket.on("new_message", (msg) => {
      setMessages((prev) => {
        const list = prev[msg.contractId] || [];
        if (msg.contractId !== activeId) return prev;
        return { ...prev, [msg.contractId]: [...list, msg] };
      });
    });
    loadMessages(activeId);
    loadCheckins(activeId);
  }, [activeId]);

  async function loadContracts() {
    if (!user) return;
    const data = await api(`/api/users/${user.id}/contracts`, {}, token);
    setContracts(data);
    if (data.length && !activeId) setActiveId(data[0].id);
  }

  async function loadOpenContracts() {
    const data = await api("/api/contracts", {}, token);
    setOpenContracts(data);
  }

async function loadMessages(contractId) {
  const data = await api(`/api/contracts/${contractId}/messages`, {}, token);
  setMessages((prev) => ({ ...prev, [contractId]: data }));
}

async function loadCheckins(contractId) {
  const data = await api(`/api/contracts/${contractId}/checkins`, {}, token);
  setCheckins((prev) => ({ ...prev, [contractId]: data }));
}

  async function handleRegister(form) {
    setError("");
    try {
      const res = await api("/api/auth/register", { method: "POST", body: form });
      setUser(res.user);
      setToken(res.token);
      await loadContracts();
      await loadOpenContracts();
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    }
  }

  async function handleLogin(form) {
    setError("");
    try {
      const res = await api("/api/auth/login", { method: "POST", body: form });
      setUser(res.user);
      setToken(res.token);
      await loadContracts();
      await loadOpenContracts();
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    }
  }

  async function handleCreateContract(form, matchType) {
    if (!user) return;
    setLoading(true);
    if (contracts.length >= contractLimit) {
      setError(`Free version limited to ${contractLimit} contracts. Please cancel one to create a new contract.`);
      return;
    }
    try {
      setError("");
      const res = await api("/api/contracts", {
        method: "POST",
        body: { ...form, ownerId: user.id, matchType },
      }, token);
      if (matchType === "friend" && res.inviteCode) {
        setInviteNotice(`${window.location.origin}/invite/${res.inviteCode}`);
      } else {
        setInviteNotice(null);
      }
      await loadContracts();
      await loadOpenContracts();
      setActiveId(res.contract.id);
      if (res.matchedWith?.user) {
        setMatchOverlay({
          partner: res.matchedWith.user,
          contractId: res.matchedWith.contractId,
        });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleAcceptInvite(code) {
    if (!user) return;
    try {
      setError("");
      await api(`/api/invites/${code}/accept`, { method: "POST", body: {} }, token);
      await loadContracts();
      await loadOpenContracts();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleSendMessage(contractId, text) {
    if (!user || !text.trim()) return;
    try {
      setError("");
      await api(`/api/contracts/${contractId}/messages`, {
        method: "POST",
        body: { text: text.trim() },
      }, token);
      // socket broadcast will update state; no manual append needed.
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleCheckIn(contractId) {
    if (!user) return;
    const today = getTodayKey();
    const list = checkins[contractId] || [];
    const existing = list.find((c) => c.dateKey === today && c.userId === user.id);
    const next = existing ? !existing.done : true;
    try {
      setError("");
      await api(`/api/contracts/${contractId}/checkins`, {
        method: "POST",
        body: { dateKey: today, done: next },
      }, token);
      await loadCheckins(contractId);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleJoinOpenContract(contractId) {
    if (!user) return;
    try {
      setError("");
      const res = await api(`/api/contracts/${contractId}/join`, {
        method: "POST",
        body: {},
      }, token);
      await loadContracts();
      await loadOpenContracts();
      setActiveId(res.id);
      setView("chat");
      setMatchOverlay({
        partner: { name: "Your partner" },
        contractId: res.id,
      });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleCancelContract(contractId) {
    if (!user) return;
    const ok = window.confirm("Cancel and delete this contract?");
    if (!ok) return;
    try {
      setError("");
      await api(`/api/contracts/${contractId}`, {
        method: "DELETE",
        body: {},
      }, token);
      await loadContracts();
      await loadOpenContracts();
      if (activeId === contractId) {
        setActiveId(null);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function logout() {
    setUser(null);
    setContracts([]);
    setActiveId(null);
    setMessages({});
    setToken("");
    localStorage.removeItem("sc_user");
    localStorage.removeItem("sc_token");
  }

  const activeContract = contracts.find((c) => c.id === activeId) || null;
  const activeMessages = (activeContract && messages[activeContract.id]) || [];
  const matchedContracts = contracts.filter((c) => c.status === "matched");
  const streakCount = activeContract ? computeStreak(checkins[activeContract.id], user?.id) : 0;
  const todayDone = (() => {
    if (!activeContract) return false;
    const list = checkins[activeContract.id] || [];
    const entry = list.find((c) => c.dateKey === getTodayKey() && c.userId === (user?.id || ""));
    return entry?.done === 1 || entry === true;
  })();

  return (
    <div className="app-root">
      <Header user={user} onLogout={logout} view={view} setView={setView} />
      {error && <ErrorBanner message={error} onClose={() => setError("")} />}

      {!user && (
        <main className="section">
          <div className="section-inner">
          <h1 className="section-title">Social Contract</h1>
          <p className="section-subtitle">
            Create a measurable goal, match with a partner, and keep each other accountable.
          </p>
          <AuthCard onRegister={handleRegister} onLogin={handleLogin} />
        </div>
      </main>
    )}

      {user && (
        <>
          {view === "discover" && (
            <main className="dashboard">
              <div className="dashboard-inner">
                <DiscoverHero />
                <section className="dashboard-header">
                  <h2 className="section-title">Discover contracts</h2>
                  <p className="section-subtitle">Search and join open contracts from others.</p>
                </section>
                <div className="dashboard-content single">
                  <div className="dashboard-left">
                    <ChallengeFeed onAdopt={(preset) => handleCreateContract(preset, "random")} />
                    <ExploreList
                      openContracts={openContracts}
                      search={exploreSearch}
                      onSearch={setExploreSearch}
                      onJoin={handleJoinOpenContract}
                    />
                  </div>
                </div>
              </div>
            </main>
          )}

          {view === "new" && (
            <main className="dashboard">
              <div className="dashboard-inner">
                <DashboardHeader user={user} />
                <div className="dashboard-content single">
                  <div className="dashboard-left">
                    <CreateContractCard
                      onCreate={handleCreateContract}
                      loading={loading}
                      inviteNotice={inviteNotice}
                      isCapped={contracts.length >= contractLimit}
                      limit={contractLimit}
                    />
                    <InviteAcceptCard onAccept={handleAcceptInvite} />
                  </div>
                </div>
              </div>
            </main>
          )}

          {view === "explore" && (
            <main className="dashboard">
              <div className="dashboard-inner">
                <section className="dashboard-header">
                  <h2 className="section-title">Explore contracts</h2>
                  <p className="section-subtitle">Search and join open contracts from others.</p>
                </section>
                <div className="dashboard-content single">
                  <div className="dashboard-left">
                    <ExploreList
                      openContracts={openContracts}
                      search={exploreSearch}
                      onSearch={setExploreSearch}
                      onJoin={handleJoinOpenContract}
                    />
                  </div>
                </div>
              </div>
            </main>
          )}

          {view === "contracts" && (
            <main className="dashboard">
              <div className="dashboard-inner">
                <section className="dashboard-header">
                  <h2 className="section-title">My Contracts</h2>
                  <p className="section-subtitle">Browse, select, and track progress.</p>
                </section>
                <div className="dashboard-content">
                  <div className="dashboard-left">
                    <ContractList contracts={contracts} activeId={activeId} onSelect={setActiveId} />
                  </div>
                  <div className="dashboard-right">
                    {activeContract ? (
                      <ContractDetail
                        contract={activeContract}
                        user={user}
                        messages={activeMessages}
                        onSendMessage={handleSendMessage}
                        onCheckIn={handleCheckIn}
                        todayDone={todayDone}
                        streak={streakCount}
                        onCancel={handleCancelContract}
                      />
                    ) : (
                      <EmptyState />
                    )}
                  </div>
                </div>
              </div>
            </main>
          )}

          {view === "chat" && (
            <main className="dashboard">
              <div className="dashboard-inner">
                <section className="dashboard-header">
                  <h2 className="section-title">Partner chat</h2>
                  <p className="section-subtitle">Pick a matched contract to chat with your partner.</p>
                </section>
                <div className="dashboard-content single">
                  <div className="dashboard-left">
                    <MatchedSelector
                      matchedContracts={matchedContracts}
                      activeId={activeId}
                      onSelect={(id) => setActiveId(id)}
                    />
                    {activeContract ? (
                      <ChatPanel messages={activeMessages} onSend={(t) => handleSendMessage(activeContract.id, t)} user={user} />
                    ) : (
                      <EmptyState />
                    )}
                  </div>
                </div>
              </div>
            </main>
          )}
        </>
      )}

      {matchOverlay && (
        <MatchOverlay
          partner={matchOverlay.partner}
          onClose={() => setMatchOverlay(null)}
          onOpenChat={() => {
            setActiveId(matchOverlay.contractId);
            setView("chat");
            setMatchOverlay(null);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Components ---------------- */

function Header({ user, onLogout, view, setView }) {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="brand">
          <span className="brand-mark">◎</span>
          <span className="brand-name">Social Contract</span>
        </div>
        {user && (
          <nav className="nav">
            <button className={"nav-pill" + (view === "discover" ? " active" : "")} onClick={() => setView("discover")}>
              Discover
            </button>
            <button className={"nav-pill" + (view === "new" ? " active" : "")} onClick={() => setView("new")}>
              New Contract
            </button>
            <button className={"nav-pill" + (view === "contracts" ? " active" : "")} onClick={() => setView("contracts")}>
              My Contracts
            </button>
            <button className={"nav-pill" + (view === "chat" ? " active" : "")} onClick={() => setView("chat")}>
              Chat
            </button>
          </nav>
        )}
        <div className="header-actions">
          {user ? (
            <>
              <span className="header-user">Hi, {user.name}</span>
              <button className="btn ghost" onClick={onLogout}>
                Log out
              </button>
            </>
          ) : (
            <span className="header-user">Accountability that actually sticks.</span>
          )}
        </div>
      </div>
    </header>
  );
}

function ErrorBanner({ message, onClose }) {
  return (
    <div className="error-banner">
      <span>{message}</span>
      <button className="error-close" onClick={onClose} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

function DiscoverHero() {
  return (
    <section className="hero">
      <div className="hero-overlay" />
      <div className="hero-inner">
        <div className="hero-text">
          <p className="eyebrow">Social Contract</p>
          <h1 className="hero-title">I&apos;ll do it if you do it.</h1>
          <p className="hero-subtitle">
            Partner up, keep your streak alive, and prove you both showed up. Find a live challenge or start your own.
          </p>
          <p className="hero-note">Stay accountable together — one check-in at a time.</p>
        </div>
      </div>
      <div className="hero-wave" />
    </section>
  );
}

function AuthCard({ onRegister, onLogin }) {
  const [mode, setMode] = useState("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    try {
      if (mode === "register") {
        await onRegister({ name: name.trim() || email.trim(), email: email.trim(), password });
      } else {
        await onLogin({ email: email.trim(), password });
      }
    } catch (err) {
      // Error banner handled at app level.
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h3 className="card-title">{mode === "register" ? "Create account" : "Log in"}</h3>
      <p className="card-subtitle">Email + password so we can keep your contracts and chats tied to you.</p>
      <form onSubmit={submit} className="contract-form">
        {mode === "register" && (
          <label className="field">
            <span className="field-label">Name</span>
            <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span className="field-label">Email</span>
          <input className="field-input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input className="field-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn primary" type="submit" disabled={!email.trim() || !password || loading}>
          {loading ? "Working…" : mode === "register" ? "Create account" : "Log in"}
        </button>
      </form>
      <div className="auth-switch">
        {mode === "register" ? (
          <button className="btn ghost" onClick={() => setMode("login")}>Have an account? Log in</button>
        ) : (
          <button className="btn ghost" onClick={() => setMode("register")}>New here? Create account</button>
        )}
      </div>
    </div>
  );
}

function DashboardHeader({ user }) {
  return (
    <section className="dashboard-header">
      <h2 className="section-title">
        Welcome back, <span className="highlight">{user.name}</span>
      </h2>
      <p className="section-subtitle">
        Draft a measurable habit, invite a friend or find a match, and start chatting when paired.
      </p>
    </section>
  );
}

function CreateContractCard({ onCreate, loading, inviteNotice, isCapped, limit }) {
  const [form, setForm] = useState({
    title: "",
    topicCategory: "fitness",
    description: "",
    frequencyPerWeek: 4,
    durationDays: 30,
    stakesLevel: "social",
  });

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(matchType) {
    if (!form.title.trim()) return;
    await onCreate(
      {
        ...form,
        frequencyPerWeek: Number(form.frequencyPerWeek),
        durationDays: Number(form.durationDays),
      },
      matchType
    );
    setForm((f) => ({ ...f, title: "", description: "" }));
  }

  return (
    <div className="card">
      <h3 className="card-title">Create a Contract</h3>
      <p className="card-subtitle">Define your goal, then invite a friend or find a random partner.</p>
      <div className="contract-form">
        <label className="field">
          <span className="field-label">Title</span>
          <input
            className="field-input"
            placeholder="Run 3x per week"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Topic</span>
          <select
            className="field-input"
            value={form.topicCategory}
            onChange={(e) => update("topicCategory", e.target.value)}
          >
            <option value="fitness">Fitness</option>
            <option value="sleep">Sleep</option>
            <option value="study">Study</option>
            <option value="food">Food</option>
            <option value="money">Money</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Description</span>
          <textarea
            className="field-input"
            rows={2}
            placeholder="Details that keep you honest"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Times per week</span>
            <input
              className="field-input"
              type="number"
              min={1}
              max={7}
              value={form.frequencyPerWeek}
              onChange={(e) => update("frequencyPerWeek", e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Duration (days)</span>
            <input
              className="field-input"
              type="number"
              min={7}
              max={180}
              value={form.durationDays}
              onChange={(e) => update("durationDays", e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Stakes</span>
          <select
            className="field-input"
            value={form.stakesLevel}
            onChange={(e) => update("stakesLevel", e.target.value)}
          >
            <option value="none">None</option>
            <option value="social">Social</option>
            <option value="reward">Reward</option>
            <option value="money">Money (later)</option>
          </select>
        </label>
        <div className="actions">
          <button className="btn primary" disabled={loading || !form.title.trim() || isCapped} onClick={() => submit("friend")}>
            Invite a friend
          </button>
          <button className="btn secondary" disabled={loading || !form.title.trim() || isCapped} onClick={() => submit("random")}>
            Find random partner
          </button>
        </div>
        {isCapped && (
          <div className="cap-banner">
            Free version allows up to {limit} contracts. Cancel one to create a new contract.
          </div>
        )}
        {inviteNotice && <InviteBanner link={inviteNotice} />}
      </div>
    </div>
  );
}

function InviteBanner({ link }) {
  function copy() {
    navigator.clipboard?.writeText(link);
  }
  return (
    <div className="invite-banner">
      <div>
        Share this link with your friend:<br />
        <code>{link}</code>
      </div>
      <button className="btn ghost" onClick={copy}>
        Copy
      </button>
    </div>
  );
}

function ChallengeFeed({ onAdopt }) {
  const presets = [
    {
      title: "Morning runs 3x/week",
      topicCategory: "fitness",
      description: "5km runs before 8am, Tues/Thu/Sat.",
      frequencyPerWeek: 3,
      durationDays: 30,
      stakesLevel: "social",
      postedBy: "Alex",
    },
    {
      title: "In bed by 23:00",
      topicCategory: "sleep",
      description: "No phone after 22:30, lights out by 23:00.",
      frequencyPerWeek: 6,
      durationDays: 21,
      stakesLevel: "reward",
      postedBy: "Jamie",
    },
    {
      title: "Study 45m daily",
      topicCategory: "study",
      description: "Deep work on weekdays before noon.",
      frequencyPerWeek: 5,
      durationDays: 28,
      stakesLevel: "none",
      postedBy: "Riley",
    },
  ];

  return (
    <div className="card">
      <h3 className="card-title">Discover live challenges</h3>
      <p className="card-subtitle">Jump into an open challenge and get matched instantly.</p>
      <div className="challenge-row">
        {presets.map((c) => (
          <div key={c.title} className="challenge-card">
            <div className="challenge-top">
              <span className="chip">{prettyCategory(c.topicCategory)}</span>
              <span className="chip ghost-chip">Posted by {c.postedBy}</span>
            </div>
            <h4>{c.title}</h4>
            <p>{c.description}</p>
            <div className="challenge-meta">
              <span>{c.frequencyPerWeek}x/week</span>
              <span>{c.durationDays} days</span>
            </div>
            <button className="btn primary full" onClick={() => onAdopt(c)}>
              Match with {c.postedBy}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function InviteAcceptCard({ onAccept }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    try {
      await onAccept(code.trim());
      setCode("");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="card">
      <h3 className="card-title">Have an invite code?</h3>
      <form className="contract-form" onSubmit={submit}>
        <input
          className="field-input"
          placeholder="Paste invite code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button className="btn secondary" type="submit" disabled={!code.trim() || loading}>
          Join contract
        </button>
      </form>
    </div>
  );
}

function ContractList({ contracts, activeId, onSelect }) {
  if (contracts.length === 0) {
    return (
      <ContractDocShell title="My Contracts">
        <p className="card-subtitle">No contracts yet. Create one to get matched.</p>
      </ContractDocShell>
    );
  }
  return (
    <ContractDocShell title="My Contracts">
      <ul className="contract-list contract-doc-list">
        {contracts.map((c) => (
          <li key={c.id} className={"contract-list-item" + (c.id === activeId ? " active" : "")}>
            <button className="contract-list-main" onClick={() => onSelect(c.id)}>
              <div className="contract-list-title">
                {c.title}
                {c.partnerName && <span className="partner-inline"> • {c.partnerName}</span>}
              </div>
              <div className="contract-list-meta">
                <span className="badge badge-soft">{prettyCategory(c.topicCategory)}</span>
                <span className="badge badge-soft">{c.status}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </ContractDocShell>
  );
}

function ContractDetail({ contract, user, messages, onSendMessage, onCheckIn, todayDone, streak, onCancel }) {
  const partnerName = contract.partnerName || (contract.partnerId ? "Your partner" : "Waiting for match");
  return (
    <div className="card card-detail">
      <h3 className="card-title">
        {contract.title}
        {contract.partnerId && (
          <span className="partner-tag"> • Partner: {partnerName}</span>
        )}
      </h3>
      <p className="card-subtitle">{contract.description || "No description yet."}</p>
      <div className="detail-grid">
        <DetailItem label="Topic" value={prettyCategory(contract.topicCategory)} />
        <DetailItem label="Frequency" value={`${contract.frequencyPerWeek}x/week`} />
        <DetailItem label="Duration" value={`${contract.durationDays} days`} />
        <DetailItem label="Stakes" value={prettyStakes(contract.stakesLevel)} />
        <DetailItem label="Status" value={contract.status} />
        <DetailItem label="Partner" value={partnerName} />
      </div>

      <div className="streak-card">
        <div className="streak-row">
          <span className="streak-emoji">🔥</span>
          <div>
            <div className="streak-label">Current streak</div>
            <div className="streak-count">{streak} day{streak === 1 ? "" : "s"}</div>
          </div>
        </div>
        <p className="streak-note">Check in daily to keep the streak alive.</p>
      </div>

      <div className="today-checkin">
        <h4>Today&apos;s check-in</h4>
        <p className="today-text">
          {todayDone ? "Marked done for today. You can toggle if needed." : "Mark today as done when you complete it."}
        </p>
        <button
          className={"btn full " + (todayDone ? "secondary-outline" : "primary")}
          onClick={() => onCheckIn(contract.id)}
        >
          {todayDone ? "Undo today's check-in" : "Mark today as done"}
        </button>
      </div>

      {contract.status === "matched" ? (
        <ChatPanel messages={messages} onSend={(text) => onSendMessage(contract.id, text)} user={user} />
      ) : (
        <p className="card-subtitle">Chat unlocks once you have a partner.</p>
      )}

      <div className="detail-footer">
        <button className="btn secondary-outline full" onClick={() => onCancel(contract.id)}>
          Cancel contract
        </button>
      </div>
    </div>
  );
}

function ChatPanel({ messages, onSend, user }) {
  const [text, setText] = useState("");
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text);
    setText("");
  }

  return (
    <div className="card chat-card">
      <h4>Chat</h4>
      <div className="chat-log">
        {messages.map((m) => (
          <div key={m.id} className={"chat-msg" + (m.senderId === user.id ? " mine" : "")}>
            <div className="chat-meta">
              <span>{m.senderName || (m.senderId === user.id ? "You" : "Partner")}</span>
              <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
            </div>
            <div className="chat-text">{m.text}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="chat-input-row" onSubmit={submit}>
        <input
          className="field-input"
          placeholder="Send a message"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

function DetailItem({ label, value }) {
  return (
    <div className="detail-item">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card card-empty">
      <h3 className="card-title">No contract selected</h3>
      <p className="card-subtitle">Choose a contract on the left to view details and chat.</p>
    </div>
  );
}

function MatchOverlay({ partner, onClose, onOpenChat }) {
  return (
    <div className="overlay">
      <div className="match-card">
        <div className="match-emoji">🎉</div>
        <h3>It&apos;s a match!</h3>
        <p>You&apos;ve been paired with {partner?.name || "a new partner"}. Start chatting now.</p>
        <div className="actions">
          <button className="btn primary" onClick={onOpenChat}>
            Open chat
          </button>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function MatchedSelector({ matchedContracts, activeId, onSelect }) {
  if (!matchedContracts.length) {
    return (
      <ContractDocShell title="Partner chat">
        <p className="card-subtitle">Match with someone first to start chatting.</p>
      </ContractDocShell>
    );
  }
  return (
    <ContractDocShell title="Select a matched contract">
      <ul className="contract-list contract-doc-list">
        {matchedContracts.map((c) => (
          <li key={c.id} className={"contract-list-item" + (c.id === activeId ? " active" : "")}>
            <button className="contract-list-main" onClick={() => onSelect(c.id)}>
              <div className="contract-list-title">
                {c.title}
                {c.partnerName && <span className="partner-inline"> • {c.partnerName}</span>}
              </div>
              <div className="contract-list-meta">
                <span className="badge badge-soft">Matched</span>
                <span className="badge badge-soft">{prettyCategory(c.topicCategory)}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </ContractDocShell>
  );
}

function ExploreList({ openContracts, search, onSearch, onJoin }) {
  const filtered = openContracts.filter((c) => {
    const term = search.toLowerCase();
    return (
      !term ||
      c.title.toLowerCase().includes(term) ||
      (c.description || "").toLowerCase().includes(term) ||
      (c.topicCategory || "").toLowerCase().includes(term)
    );
  });

  return (
    <div className="card">
      <h3 className="card-title">Browse open contracts</h3>
      <div className="field">
        <input
          className="field-input"
          placeholder="Search by goal, topic, or description"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <div className="explore-grid">
        {filtered.length === 0 && <p className="card-subtitle">No open contracts found.</p>}
        {filtered.map((c) => (
          <div key={c.id} className="challenge-card">
            <div className="challenge-top">
              <span className="chip">{prettyCategory(c.topicCategory)}</span>
              <span className="chip ghost-chip">By {c.ownerName || "Partner"}</span>
            </div>
            <h4>{c.title}</h4>
            <p>{c.description || "No description"}</p>
            <div className="challenge-meta">
              <span>{c.frequencyPerWeek}x/week</span>
              <span>{c.durationDays} days</span>
              <span>{prettyStakes(c.stakesLevel)}</span>
            </div>
            <button className="btn primary full" onClick={() => onJoin(c.id)}>
              Join this contract
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContractDocShell({ title, children }) {
  return (
    <div className="contract-doc">
      <div className="contract-doc-header">
        <div className="contract-doc-logo">SC</div>
        <div>
          <div className="contract-doc-title">{title}</div>
          <div className="contract-doc-sub">Accountability Agreement</div>
        </div>
      </div>
      <div className="contract-doc-body">{children}</div>
    </div>
  );
}

function prettyCategory(cat) {
  switch (cat) {
    case "fitness":
      return "Fitness";
    case "food":
      return "Food";
    case "sleep":
      return "Sleep";
    case "study":
      return "Study";
    case "money":
      return "Money";
    default:
      return "Other";
  }
}

function prettyStakes(level) {
  switch (level) {
    case "none":
      return "None";
    case "social":
      return "Social";
    case "reward":
      return "Reward";
    case "money":
      return "Money later";
    default:
      return "Custom";
  }
}
