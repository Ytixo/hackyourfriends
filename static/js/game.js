(() => {
  const socket = io();
  const room = (window.GAME_ROOM || "").trim().toUpperCase();

  // ✅ pas de popup bloquante : pseudo stable via localStorage
  const saved = localStorage.getItem("hyf_username");
  let username = (saved || "").trim();
  if (!username) {
    username = "Player" + Math.floor(Math.random() * 9000 + 1000);
    localStorage.setItem("hyf_username", username);
  }

  // DOM
  const appWrap = document.getElementById("appWrap");
  const typedEl = document.getElementById("typed");
  const wordEl = document.getElementById("word");
  const inputEl = document.getElementById("input");
  const timerEl = document.getElementById("timer");
  const matchTimerEl = document.getElementById("matchTimer");

  const scoresEl = document.getElementById("scores");
  const hpListEl = document.getElementById("hpList");
  const roundInfoEl = document.getElementById("roundInfo");
  const statusEl = document.getElementById("status");
  const logEl = document.getElementById("log");

  const roomLinkEl = document.getElementById("roomLink");
  const copyBtn = document.getElementById("copyBtn");
  const startBtn = document.getElementById("startBtn");

  const timerBar = document.getElementById("timerBar");
  const timerFill = document.getElementById("timerFill");

  const soundBtn = document.getElementById("soundBtn");

  // Settings (new)
  const modeSelect = document.getElementById("modeSelect");
  const setModeBtn = document.getElementById("setModeBtn");

  const timeEasySelect = document.getElementById("timeEasySelect");
  const timeHardSelect = document.getElementById("timeHardSelect");
  const setEasyBtn = document.getElementById("setEasyBtn");
  const setHardBtn = document.getElementById("setHardBtn");
  const activeTimeLabel = document.getElementById("activeTimeLabel");

  // State
  let gameStarted = false;
  let isHost = false;
  let currentMode = "easy";
  let matchStartTs = 0; // unix seconds (server)

  // ---------- helpers ----------
  const link = `${window.location.origin}/room/${room}`;
  if (roomLinkEl) roomLinkEl.textContent = link;

  copyBtn?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link); flashStatus("Lien copié 📋", 1200); }
    catch { flashStatus("Copie impossible 😅", 1500); }
  });

  function flashStatus(msg, ms = 1200) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    if (ms > 0) setTimeout(() => {
      if (statusEl.textContent === msg) statusEl.textContent = "";
    }, ms);
  }

  function logPush(text) {
    if (!logEl) return;
    const now = new Date().toLocaleTimeString();
    logEl.textContent = `[${now}] ${text}\n` + logEl.textContent;
  }

  function setLobbyMode(on) {
    if (!inputEl) return;
    inputEl.disabled = on;
    inputEl.placeholder = on ? "En attente du lancement..." : "Écris puis Entrée";
    inputEl.value = "";
  }

  function shake() {
    if (!appWrap) return;
    appWrap.classList.remove("shake");
    void appWrap.offsetWidth;
    appWrap.classList.add("shake");
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, m => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[m]));
  }

  // ---------- typewriter ----------
  let typeTimer = null;
  function typewrite(text, cps = 90) {
    clearInterval(typeTimer);
    if (typedEl) typedEl.textContent = "";
    let i = 0;
    const interval = Math.max(5, Math.floor(1000 / cps));
    typeTimer = setInterval(() => {
      i++;
      if (typedEl) typedEl.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(typeTimer);
    }, interval);
  }

  // ---------- timer (number + bar) ----------
  let roundInterval = null;
  let roundEndsAt = 0;
  let roundDuration = 0;

  function setTimerDanger(on) {
    timerBar?.classList.toggle("timerDanger", !!on);
  }

  function setBar(ratio) {
    if (!timerFill) return;
    const r = Math.max(0, Math.min(1, ratio));
    timerFill.style.transform = `scaleX(${r})`;
  }

  function startRoundTimer(seconds) {
    clearInterval(roundInterval);

    const s = Number(seconds) || 0;
    if (timerEl) timerEl.textContent = String(s);

    roundDuration = s * 1000;
    roundEndsAt = Date.now() + roundDuration;

    setTimerDanger(false);
    setBar(1);

    roundInterval = setInterval(() => {
      const leftMs = Math.max(0, roundEndsAt - Date.now());
      const leftS = Math.ceil(leftMs / 1000);
      if (timerEl) timerEl.textContent = String(leftS);

      const ratio = roundDuration ? (leftMs / roundDuration) : 0;
      setBar(ratio);

      if (ratio <= 0.22) setTimerDanger(true);
      if (leftMs <= 0) {
        clearInterval(roundInterval);
        setBar(0);
      }
    }, 80);
  }

  // ---------- match timer ----------
  let matchInterval = null;
  function startMatchTimer(serverStartTs) {
    matchStartTs = Number(serverStartTs) || 0;
    clearInterval(matchInterval);

    const tick = () => {
      if (!matchStartTs) return;
      const s = (Date.now()/1000 - matchStartTs).toFixed(1);
      if (matchTimerEl) matchTimerEl.textContent = s;
    };
    tick();
    matchInterval = setInterval(tick, 100);
  }
  function stopMatchTimer() { clearInterval(matchInterval); }

  // ---------- scoreboard + hp ----------
  function renderScores(players) {
    if (!scoresEl) return;
    scoresEl.innerHTML = "";
    players.forEach(p => {
      const li = document.createElement("li");
      li.textContent = `${p.name} : ${p.score}`;
      scoresEl.appendChild(li);
    });
  }

  function renderHP(players) {
    if (!hpListEl) return;
    hpListEl.innerHTML = "";
    players.forEach(p => {
      const row = document.createElement("div");
      row.className = "hpRow";

      const name = document.createElement("div");
      name.className = "hpName";
      name.innerHTML = `<span>${escapeHtml(p.name)}</span><span>${p.hp} HP</span>`;

      const bar = document.createElement("div");
      bar.className = "hpBar";

      const fill = document.createElement("div");
      fill.className = "hpFill";
      const pct = Math.max(0, Math.min(100, Number(p.hp) || 0));
      fill.style.width = pct + "%";

      bar.appendChild(fill);
      row.appendChild(name);
      row.appendChild(bar);
      hpListEl.appendChild(row);
    });
  }

  // ---------- mode ----------
  let hideWordTimer = null;
  function applyMode(mode, revealMs) {
    currentMode = mode || "easy";
    if (modeSelect) modeSelect.value = currentMode;

    clearTimeout(hideWordTimer);

    if (currentMode === "hard") {
      inputEl.type = "password";
      if (revealMs && revealMs > 0) {
        hideWordTimer = setTimeout(() => { if (wordEl) wordEl.textContent = "••••"; }, revealMs);
      } else {
        if (wordEl) wordEl.textContent = "••••";
      }
    } else {
      inputEl.type = "text";
    }
  }

  // ---------- SFX ----------
  let soundOn = true;
  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(()=>{});
    return audioCtx;
  }

  function beep(type = "ok") {
    if (!soundOn) return;
    const ctx = ensureAudio();

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);

    const now = ctx.currentTime;
    let f1 = 880, f2 = 1320, dur = 0.08;
    if (type === "wrong") { f1 = 140; f2 = 90; dur = 0.12; }
    if (type === "win")   { f1 = 740; f2 = 1480; dur = 0.14; }
    if (type === "timeout"){ f1 = 220; f2 = 180; dur = 0.18; }

    o.type = (type === "wrong") ? "sawtooth" : "triangle";
    o.frequency.setValueAtTime(f1, now);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, f2), now + dur);

    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    o.start(now);
    o.stop(now + dur + 0.02);
  }

  soundBtn?.addEventListener("click", () => {
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? "ON" : "OFF";
    if (soundOn) beep("ok");
  });
  window.addEventListener("pointerdown", () => { if (soundOn) ensureAudio(); }, { once: true });

  // ---------- SETTINGS SYNC ----------
  function setActiveTimeLabel(timeLimit) {
    if (!activeTimeLabel) return;
    activeTimeLabel.textContent = `${timeLimit ?? "—"}s (${currentMode.toUpperCase()})`;
  }

  function syncSettingsFromServer(data) {
    // mode + time limits
    if (data?.mode) currentMode = data.mode;
    if (modeSelect) modeSelect.value = currentMode;

    if (typeof data?.time_limit_easy === "number" && timeEasySelect) {
      timeEasySelect.value = String(data.time_limit_easy);
    }
    if (typeof data?.time_limit_hard === "number" && timeHardSelect) {
      timeHardSelect.value = String(data.time_limit_hard);
    }
    if (typeof data?.time_limit === "number") {
      setActiveTimeLabel(data.time_limit);
    }
  }

  function setHostUI(host) {
    const dis = !host;
    if (setModeBtn) setModeBtn.disabled = dis;
    if (setEasyBtn) setEasyBtn.disabled = dis;
    if (setHardBtn) setHardBtn.disabled = dis;
    if (modeSelect) modeSelect.disabled = dis;
    if (timeEasySelect) timeEasySelect.disabled = dis;
    if (timeHardSelect) timeHardSelect.disabled = dis;
  }

  // ---------- ONE-TIME button listeners ----------
  setModeBtn?.addEventListener("click", () => {
    const mode = (modeSelect?.value || "easy").toLowerCase();
    socket.emit("set_mode", { room, mode });
  });

  setEasyBtn?.addEventListener("click", () => {
    const val = Number(timeEasySelect?.value);
    if (!Number.isFinite(val)) return;
    socket.emit("set_time_limit", { room, target: "easy", seconds: val });
  });

  setHardBtn?.addEventListener("click", () => {
    const val = Number(timeHardSelect?.value);
    if (!Number.isFinite(val)) return;
    socket.emit("set_time_limit", { room, target: "hard", seconds: val });
  });

  // ---------- join ----------
  if (!room) { window.location.href = "/"; return; }
  socket.emit("join_room", { room, username });

  socket.on("joined", (data) => {
    isHost = !!data?.is_host;
    gameStarted = !!data?.started;

    setHostUI(isHost);
    syncSettingsFromServer(data);

    if (startBtn) {
      startBtn.style.display = (isHost && !gameStarted) ? "inline-block" : "none";
      startBtn.onclick = () => socket.emit("start_game", { room });
    }

    setLobbyMode(!gameStarted);
    flashStatus(`Connecté ✅ (${username})`, 1000);
    logPush(`Connecté au salon ${room}`);
    inputEl?.focus();
  });

  // lobby state
  socket.on("lobby_state", (data) => {
    // settings always sync (even if started=false)
    syncSettingsFromServer(data);

    if (!data?.started) {
      gameStarted = false;
      setLobbyMode(true);
      stopMatchTimer();
      if (matchTimerEl) matchTimerEl.textContent = "0.0";
      setBar(1);
      setTimerDanger(false);

      roundInfoEl.textContent =
        `Lobby 👥 (${data.players?.length || 0} joueurs) — Host: ${data.host_name || "?"}`;

      if (wordEl) wordEl.textContent = "---";
      if (typedEl) typedEl.textContent = "";
      if (timerEl) timerEl.textContent = "0";

      if (startBtn) startBtn.style.display = (isHost && !gameStarted) ? "inline-block" : "none";
      applyMode("easy", 0);
    }
  });

  // settings events
  socket.on("mode_updated", (data) => {
    syncSettingsFromServer(data);
    flashStatus(`Mode: ${currentMode.toUpperCase()}`, 1100);
    logPush(`Mode: ${currentMode} (temps actif ${data?.time_limit ?? "?"}s)`);
    beep("ok");
  });

  socket.on("time_limits_updated", (data) => {
    syncSettingsFromServer(data);
    flashStatus(`⏱️ Easy ${data.time_limit_easy}s • Hard ${data.time_limit_hard}s`, 1400);
    logPush(`Temps maj: easy=${data.time_limit_easy}s hard=${data.time_limit_hard}s`);
    beep("ok");
  });

  // game started
  socket.on("game_started", (data) => {
    gameStarted = true;
    setLobbyMode(false);

    // mode from server
    if (data?.mode) currentMode = data.mode;
    applyMode(currentMode, 0);

    flashStatus("▶ Partie lancée !", 1200);
    logPush(`Partie lancée (${data?.round_total || 30} mots) en ${currentMode.toUpperCase()}`);
    if (startBtn) startBtn.style.display = "none";
    beep("win");
  });

  // round start
  socket.on("round_start", (data) => {
    gameStarted = true;
    setLobbyMode(false);

    const line = data?.line ?? "";
    const word = data?.word ?? "";
    const idx = data?.round_index ?? 0;
    const total = data?.round_total ?? 0;
    const seconds = data?.seconds ?? 0;
    const mode = data?.mode ?? "easy";
    const revealMs = data?.word_reveal_ms ?? 0;
    const msTs = data?.match_start_ts ?? 0;

    typewrite(line, 92);

    if (wordEl) wordEl.textContent = word;
    applyMode(mode, revealMs);

    roundInfoEl.textContent = `Mot ${idx}/${total} ⚡`;
    inputEl.value = "";
    inputEl.focus();

    startRoundTimer(seconds);

    // match timer correct (depuis serveur)
    if (msTs) startMatchTimer(msTs);

    setActiveTimeLabel(seconds);
    logPush(`Nouveau mot: "${word}"`);
    beep("ok");
  });

  socket.on("round_timeout", () => {
    flashStatus("⏱️ Trop tard !", 900);
    logPush("⏱️ Timeout");
    beep("timeout");
    shake();
  });

  socket.on("round_winner", (data) => {
    const winner = data?.player || "Quelqu’un";
    const ms = data?.ms ?? 0;
    const dmg = data?.damage ?? 0;

    flashStatus(`🏆 ${winner} (${ms}ms) -${dmg}HP`, 1400);
    logPush(`⚡ ${winner} gagne le round (${ms}ms)`);
    beep("win");
    shake();
  });

  socket.on("wrong", (data) => {
    const dmg = data?.damage ?? 0;
    const hp = data?.hp;
    flashStatus(`❌ Erreur ! -${dmg}HP`, 700);
    if (typeof hp === "number") logPush(`Erreur: -${dmg}HP (reste ${hp}HP)`);
    beep("wrong");
    shake();
  });

  socket.on("state", (data) => {
    const players = data?.players ?? [];
    renderScores(players);
    renderHP(players);
  });

  socket.on("game_over", (data) => {
    gameStarted = false;
    setLobbyMode(true);
    stopMatchTimer();

    const totalMs = data?.total_ms ?? 0;
    const totalS = (totalMs / 1000).toFixed(2);

    flashStatus(`✅ Terminé en ${totalS}s`, 2200);
    logPush(`🏁 Fin de partie (${totalS}s)`);

    const top = (data?.players ?? [])[0];
    if (top) {
      flashStatus(`🏆 ${top.name} gagne la partie !`, 2200);
      logPush(`Gagnant: ${top.name} (${top.score} pts, ${top.hp}HP)`);
    } else {
      flashStatus(`🏁 Partie terminée`, 1800);
    }

    if (startBtn) startBtn.style.display = isHost ? "inline-block" : "none";
    applyMode("easy", 0);
    beep("timeout");
  });

  // input
  inputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (!gameStarted) return;
      socket.emit("player_input", { room, input: inputEl.value });
      inputEl.value = "";
    }
  });
})();
