(() => {
  const socket = io();
  const room = (window.GAME_ROOM || "").trim().toUpperCase();
  const storedName = (localStorage.getItem("hyf_username") || "").trim();
  const username = storedName || `player${Math.floor(10000 + Math.random() * 90000)}`;
  if (!storedName) localStorage.setItem("hyf_username", username);

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
  const spectatorBadge = document.getElementById("spectatorBadge");
  const firewallWrap = document.getElementById("firewallWrap");
  const firewallFill = document.getElementById("firewallFill");
  const firewallText = document.getElementById("firewallText");
  const damageFlash = document.getElementById("damageFlash");

  const roomLinkEl = document.getElementById("roomLink");
  const startBtn = document.getElementById("startBtn");

  const timeLimitInput = document.getElementById("timeLimitInput");
  const setTimeBtn = document.getElementById("setTimeBtn");
  const modeSelect = document.getElementById("modeSelect");
  const setModeBtn = document.getElementById("setModeBtn");
  const gameTypeSelect = document.getElementById("gameTypeSelect");
  const setGameTypeBtn = document.getElementById("setGameTypeBtn");
  const coopDifficultySelect = document.getElementById("coopDifficultySelect");
  const setCoopDifficultyBtn = document.getElementById("setCoopDifficultyBtn");

  const timerBar = document.getElementById("timerBar");
  const timerFill = document.getElementById("timerFill");

  const soundBtn = document.getElementById("soundBtn");

  let gameStarted = false;
  let isHost = false;
  let currentMode = "easy";
  let gameType = "pvp";
  let coopDifficulty = "easy";
  let matchStartTs = 0; // unix seconds (server)

  // ---------- small helpers ----------
  const link = `${window.location.origin}/room/${room}`;
  roomLinkEl.textContent = link;
  if (roomLinkEl) roomLinkEl.href = link;

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
    inputEl.disabled = on;
    inputEl.placeholder = on ? "En attente du lancement..." : "Écris puis Entrée";
    inputEl.value = "";
  }

  function formatRoundTotal(total) {
    const t = Number(total);
    return Number.isFinite(t) && t > 0 ? String(t) : "∞";
  }

  function setCoopUI(on) {
    if (firewallWrap) firewallWrap.style.display = on ? "flex" : "none";
    if (modeSelect) modeSelect.disabled = on;
    if (setModeBtn) setModeBtn.disabled = on || !isHost;
    if (timeLimitInput) timeLimitInput.disabled = on || !isHost;
    if (setTimeBtn) setTimeBtn.disabled = on || !isHost;
    if (coopDifficultySelect) coopDifficultySelect.disabled = !on || !isHost;
    if (setCoopDifficultyBtn) setCoopDifficultyBtn.disabled = !on || !isHost;
  }

  function renderFirewall(hp, max) {
    if (!firewallFill || !firewallText) return;
    const m = Math.max(1, Number(max) || 0);
    const h = Math.max(0, Math.min(m, Number(hp) || 0));
    firewallFill.style.width = `${(h / m) * 100}%`;
    firewallText.textContent = `PARE-FEU — ${h} / ${m}`;
  }

  function flashDamage() {
    if (!damageFlash) return;
    damageFlash.classList.remove("flash");
    void damageFlash.offsetWidth;
    damageFlash.classList.add("flash");
  }

  function shake() {
    if (!appWrap) return;
    appWrap.classList.remove("shake");
    // force reflow
    void appWrap.offsetWidth;
    appWrap.classList.add("shake");
  }

  // ---------- typewriter ----------
  let typeTimer = null;
  function typewrite(text, cps = 85) {
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
  let roundEndsAt = 0;      // ms
  let roundDuration = 0;    // ms

  function setTimerDanger(on) {
    if (!timerBar) return;
    timerBar.classList.toggle("timerDanger", !!on);
  }

  function startRoundTimer(seconds) {
    clearInterval(roundInterval);

    const s = Number(seconds) || 0;
    timerEl.textContent = String(s);

    roundDuration = s * 1000;
    roundEndsAt = Date.now() + roundDuration;

    setTimerDanger(false);
    setBar(1);

    roundInterval = setInterval(() => {
      const leftMs = Math.max(0, roundEndsAt - Date.now());
      const leftS = Math.ceil(leftMs / 1000);
      timerEl.textContent = String(leftS);

      const ratio = roundDuration ? (leftMs / roundDuration) : 0;
      setBar(ratio);

      if (ratio <= 0.22) setTimerDanger(true);
      if (leftMs <= 0) {
        clearInterval(roundInterval);
        setBar(0);
      }
    }, 80);
  }

  function setBar(ratio) {
    if (!timerFill) return;
    const r = Math.max(0, Math.min(1, ratio));
    timerFill.style.transform = `scaleX(${r})`;
  }

  // ---------- match timer (use server ts) ----------
  let matchInterval = null;
  function startMatchTimer(serverStartTs) {
    matchStartTs = Number(serverStartTs) || 0;
    clearInterval(matchInterval);

    const tick = () => {
      if (!matchStartTs) return;
      const s = (Date.now()/1000 - matchStartTs).toFixed(1);
      matchTimerEl.textContent = s;
    };
    tick();
    matchInterval = setInterval(tick, 100);
  }
  function stopMatchTimer() {
    clearInterval(matchInterval);
  }

  // ---------- scoreboard + hp ----------
  function renderScores(players) {
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

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, m => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[m]));
  }

  // ---------- cyber log burst ----------
  function hackBurst(winner, ms) {
    logPush(`⚡ ${winner} > BYPASS FIREWALL (${ms}ms)`);
    logPush(`🔓 ACCESS GRANTED`);
    logPush(`⬇️  EXFILTRATING DATA...`);
    setTimeout(() => logPush(`✅ DONE`), 380);
  }

  // ---------- mode (hard masking & hide word) ----------
  let hideWordTimer = null;
  function applyMode(mode, revealMs) {
    currentMode = mode || "easy";
    if (modeSelect) modeSelect.value = currentMode;

    clearTimeout(hideWordTimer);

    if (currentMode === "hard") {
      inputEl.type = "password";
      if (revealMs && revealMs > 0) {
        hideWordTimer = setTimeout(() => { wordEl.textContent = "••••"; }, revealMs);
      } else {
        wordEl.textContent = "••••";
      }
    } else {
      inputEl.type = "text";
    }
  }

  // ---------- SFX (WebAudio, no files) ----------
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
    if (type === "riposte") { f1 = 520; f2 = 110; dur = 0.16; }
    if (type === "win")   { f1 = 740; f2 = 1480; dur = 0.14; }
    if (type === "timeout"){ f1 = 220; f2 = 180; dur = 0.18; }

    o.type = (type === "wrong" || type === "riposte") ? "sawtooth" : "triangle";
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

  // unlock audio on first interaction
  window.addEventListener("pointerdown", () => { if (soundOn) ensureAudio(); }, { once: true });

  // ---------- join ----------
  if (!room) { window.location.href = "/"; return; }
  socket.emit("join_room", { room, username });

  socket.on("joined", (data) => {
    isHost = !!data?.is_host;
    gameStarted = !!data?.started;
    currentMode = data?.mode || "easy";
    gameType = data?.game_type || "pvp";
    coopDifficulty = data?.coop_difficulty || "easy";

    if (startBtn) {
      startBtn.style.display = (isHost && !gameStarted) ? "inline-block" : "none";
      startBtn.onclick = () => socket.emit("start_game", { room });
    }

    if (setTimeBtn) setTimeBtn.disabled = !isHost;
    if (timeLimitInput && data?.time_limit) timeLimitInput.value = data.time_limit;

    if (setModeBtn) setModeBtn.disabled = !isHost;
    if (modeSelect) modeSelect.value = currentMode;
    if (gameTypeSelect) gameTypeSelect.value = gameType;
    if (coopDifficultySelect) coopDifficultySelect.value = coopDifficulty;

    setLobbyMode(!gameStarted);
    setCoopUI(gameType === "coop");

    flashStatus(`Connecté ✅ (${username})`, 1000);
    logPush(`Connecté au salon ${room}`);
    inputEl.focus();
  });

  // set time limit
  setTimeBtn?.addEventListener("click", () => {
    const val = Number(timeLimitInput?.value);
    if (!Number.isFinite(val)) return;
    socket.emit("set_time_limit", { room, seconds: val });
  });
  socket.on("time_limit_updated", (data) => {
    const s = data?.seconds;
    if (s && timeLimitInput) timeLimitInput.value = s;
    flashStatus(`⏱️ Temps: ${s}s`, 1200);
    logPush(`Temps par round: ${s}s`);
    beep("ok");
  });

  // mode select
  setModeBtn?.addEventListener("click", () => {
    const mode = (modeSelect?.value || "easy").toLowerCase();
    socket.emit("set_mode", { room, mode });
  });
  socket.on("mode_updated", (data) => {
    currentMode = data?.mode || "easy";
    flashStatus(`Mode: ${currentMode.toUpperCase()}`, 1200);
    logPush(`Mode: ${currentMode}`);
    applyMode(currentMode, 0);
    beep("ok");
  });

  setGameTypeBtn?.addEventListener("click", () => {
    const gt = (gameTypeSelect?.value || "pvp").toLowerCase();
    socket.emit("set_game_type", { room, game_type: gt });
  });

  socket.on("game_type_updated", (data) => {
    gameType = data?.game_type || "pvp";
    if (gameTypeSelect) gameTypeSelect.value = gameType;
    setCoopUI(gameType === "coop");
    flashStatus(`Mode jeu: ${gameType.toUpperCase()}`, 1200);
    logPush(`Mode jeu: ${gameType}`);
  });

  setCoopDifficultyBtn?.addEventListener("click", () => {
    const diff = (coopDifficultySelect?.value || "easy").toLowerCase();
    socket.emit("set_coop_difficulty", { room, difficulty: diff });
  });

  socket.on("coop_difficulty_updated", (data) => {
    coopDifficulty = data?.difficulty || "easy";
    if (coopDifficultySelect) coopDifficultySelect.value = coopDifficulty;
    flashStatus(`Difficulté: ${coopDifficulty.toUpperCase()}`, 1200);
    logPush(`Difficulté: ${coopDifficulty}`);
  });

  // lobby
  socket.on("lobby_state", (data) => {
    if (!data?.started) {
      gameStarted = false;
      setLobbyMode(true);
      stopMatchTimer();
      matchTimerEl.textContent = "0.0";
      setBar(1);
      setTimerDanger(false);

      currentMode = data?.mode || currentMode;
      if (modeSelect) modeSelect.value = currentMode;
      gameType = data?.game_type || gameType;
      coopDifficulty = data?.coop_difficulty || coopDifficulty;
      if (gameTypeSelect) gameTypeSelect.value = gameType;
      if (coopDifficultySelect) coopDifficultySelect.value = coopDifficulty;
      setCoopUI(gameType === "coop");
      renderFirewall(data?.firewall_hp, data?.firewall_max);

      roundInfoEl.textContent =
        `Lobby 👥 (${data.players?.length || 0} joueurs) — Host: ${data.host_name || "?"}`;

      wordEl.textContent = "---";
      if (typedEl) typedEl.textContent = "";
      timerEl.textContent = "0";

      if (startBtn) startBtn.style.display = (isHost && !gameStarted) ? "inline-block" : "none";
      if (setTimeBtn) setTimeBtn.disabled = !isHost;
      if (setModeBtn) setModeBtn.disabled = !isHost;

      applyMode("easy", 0);
    }
  });

  socket.on("game_started", (data) => {
    gameStarted = true;
    setLobbyMode(false);

    currentMode = data?.mode || currentMode;
    applyMode(currentMode, 0);

    // NOTE: on attend surtout round_start pour avoir match_start_ts serveur
    flashStatus("▶ Partie lancée !", 1200);
    const totalLabel = formatRoundTotal(data?.round_total);
    logPush(`Partie lancée (${totalLabel} mots) en ${currentMode.toUpperCase()}`);
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
    const gt = data?.game_type ?? "pvp";
    const revealMs = data?.word_reveal_ms ?? 0;
    const msTs = data?.match_start_ts ?? 0;

    typewrite(line, 92);

    wordEl.textContent = word;
    applyMode(mode, revealMs);
    gameType = gt;
    if (gameTypeSelect) gameTypeSelect.value = gameType;
    setCoopUI(gameType === "coop");

    roundInfoEl.textContent = `Mot ${idx}/${formatRoundTotal(total)} ⚡`;
    inputEl.value = "";
    inputEl.focus();

    startRoundTimer(seconds);

    // ✅ match timer correct (depuis serveur)
    if (msTs) startMatchTimer(msTs);

    logPush(`Nouveau mot: "${word}"`);
    beep("ok");
  });

  socket.on("round_timeout", (data) => {
    const dmg = Number(data?.damage) || 0;
    if (gameType === "coop" && dmg > 0) {
      flashStatus(`⏱️ Trop tard ! Riposte -${dmg}HP`, 900);
      logPush(`⏱️ Timeout — riposte -${dmg}HP`);
      flashDamage();
    } else {
      flashStatus("⏱️ Trop tard !", 900);
      logPush("⏱️ Timeout");
    }
    beep(gameType === "coop" && dmg > 0 ? "riposte" : "timeout");
    shake();
  });

  socket.on("round_winner", (data) => {
    const winner = data?.player || "Quelqu’un";
    const ms = data?.ms ?? 0;
    const dmg = data?.damage ?? 0;

    if (gameType === "coop") {
      flashStatus(`🏆 ${winner} (${ms}ms) pare-feu -${dmg}`, 1700);
    } else {
      flashStatus(`🏆 ${winner} (${ms}ms) -${dmg}HP`, 1700);
    }
    hackBurst(winner, ms);
    beep("win");
    shake();
  });

  socket.on("wrong", (data) => {
    const dmg = data?.damage ?? 0;
    const hp = data?.hp;
    flashStatus(`❌ Erreur ! -${dmg}HP`, 700);
    if (typeof hp === "number") logPush(`Erreur: -${dmg}HP (reste ${hp}HP)`);
    if (gameType === "coop") {
      flashDamage();
      beep("riposte");
    } else {
      beep("wrong");
    }
    shake();
  });

  socket.on("state", (data) => {
    const players = data?.players ?? [];
    renderScores(players);
    renderHP(players);
    if (data?.game_type) {
      gameType = data.game_type;
      if (gameTypeSelect) gameTypeSelect.value = gameType;
      setCoopUI(gameType === "coop");
    }
    if (gameType === "coop") {
      renderFirewall(data?.firewall_hp, data?.firewall_max);
    }

    const me = players.find(p => p.name === username);
    const isSpectator = !!me && Number(me.hp) <= 0;
    if (spectatorBadge) spectatorBadge.style.display = isSpectator ? "inline-block" : "none";
    if (isSpectator) {
      inputEl.disabled = true;
      inputEl.placeholder = "Spectateur";
    } else if (gameStarted) {
      inputEl.disabled = false;
      inputEl.placeholder = "Écris puis Entrée";
    }
  });

  socket.on("game_over", (data) => {
    gameStarted = false;
    setLobbyMode(true);
    stopMatchTimer();

    const totalMs = data?.total_ms ?? 0;
    const totalS = (totalMs / 1000).toFixed(2);

    flashStatus(`✅ Terminé en ${totalS}s`, 2500);
    logPush(`🏁 Fin de partie (${totalS}s)`);

    const top = (data?.players ?? [])[0];
    if (top) {
        flashStatus(`🏆 ${top.name} gagne la partie !`, 2500);
        logPush(`🏁 Fin — Gagnant: ${top.name} (${top.score} pts, ${top.hp}HP)`);
    } else {
        flashStatus(`🏁 Partie terminée`, 2000);
    }

    if (startBtn) startBtn.style.display = isHost ? "inline-block" : "none";
    applyMode("easy", 0);
    beep("timeout");
  });

  // input
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (!gameStarted) return;
      socket.emit("player_input", { room, input: inputEl.value });
      inputEl.value = "";
    }
  });
})();
