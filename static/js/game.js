(() => {
  const socket = io();
  const room = (window.GAME_ROOM || "").trim().toUpperCase();
  const username = (prompt("Pseudo ?") || "Player").trim() || "Player";

  const typedEl = document.getElementById("typed");
  const wordEl = document.getElementById("word");
  const inputEl = document.getElementById("input");
  const timerEl = document.getElementById("timer");
  const matchTimerEl = document.getElementById("matchTimer");

  const scoresEl = document.getElementById("scores");
  const hpListEl = document.getElementById("hpList");

  const statusEl = document.getElementById("status");
  const roundInfoEl = document.getElementById("roundInfo");
  const logEl = document.getElementById("log");

  const roomLinkEl = document.getElementById("roomLink");
  const copyBtn = document.getElementById("copyBtn");
  const startBtn = document.getElementById("startBtn");

  const timeLimitInput = document.getElementById("timeLimitInput");
  const setTimeBtn = document.getElementById("setTimeBtn");

  const modeSelect = document.getElementById("modeSelect");
  const setModeBtn = document.getElementById("setModeBtn");

  let gameStarted = false;
  let isHost = false;
  let currentMode = "easy";
  let matchStartTs = 0;

  // --- link
  const link = `${window.location.origin}/room/${room}`;
  roomLinkEl.textContent = link;

  copyBtn?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link); flashStatus("Lien copié 📋", 1200); }
    catch { flashStatus("Copie impossible 😅", 1500); }
  });

  function flashStatus(msg, ms = 1200) {
    statusEl.textContent = msg;
    if (ms > 0) setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ""; }, ms);
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

  // --- typewriter
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

  // --- round timer
  let roundInterval = null;
  function startRoundTimer(seconds) {
    clearInterval(roundInterval);
    let t = Number(seconds) || 0;
    timerEl.textContent = String(t);
    roundInterval = setInterval(() => {
      t -= 1;
      if (t < 0) { clearInterval(roundInterval); return; }
      timerEl.textContent = String(t);
    }, 1000);
  }

  // --- match timer (global)
  let matchInterval = null;
  function startMatchTimer(startTs) {
    matchStartTs = startTs || 0;
    clearInterval(matchInterval);
    const tick = () => {
      if (!matchStartTs) return;
      const s = (Date.now()/1000 - matchStartTs).toFixed(1);
      if (matchTimerEl) matchTimerEl.textContent = s;
    };
    tick();
    matchInterval = setInterval(tick, 100);
  }
  function stopMatchTimer() {
    clearInterval(matchInterval);
  }

  // --- scoreboard + hp
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
      name.textContent = `${p.name} — ${p.hp} HP`;

      const bar = document.createElement("div");
      bar.className = "hpBar";

      const fill = document.createElement("div");
      fill.className = "hpFill";
      const pct = Math.max(0, Math.min(100, p.hp));
      fill.style.width = pct + "%";

      bar.appendChild(fill);
      row.appendChild(name);
      row.appendChild(bar);
      hpListEl.appendChild(row);
    });
  }

  function hackBurst(winner, ms) {
    const word = data?.word ?? "";
    logPush(`⚡ ${winner} > BYPASS FIREWALL (${ms}ms)`);
    logPush(`🔓 ACCESS GRANTED`);
    logPush(`⬇️  EXFILTRATING DATA...`);
    setTimeout(() => logPush(`✅ DONE "${word}"`), 400);
  }

  // --- hard mode: mask input & hide word after reveal
  let hideWordTimer = null;
  function applyMode(mode, revealMs) {
    currentMode = mode || "easy";
    if (modeSelect) modeSelect.value = currentMode;

    clearTimeout(hideWordTimer);

    if (currentMode === "hard") {
      inputEl.type = "password"; // masque ce qu’on écrit
      if (revealMs && revealMs > 0) {
        hideWordTimer = setTimeout(() => {
          wordEl.textContent = "••••";
        }, revealMs);
      } else {
        wordEl.textContent = "••••";
      }
    } else {
      inputEl.type = "text";
    }
  }

  // --- join
  if (!room) { window.location.href = "/"; return; }
  socket.emit("join_room", { room, username });

  socket.on("joined", (data) => {
    isHost = !!data?.is_host;
    gameStarted = !!data?.started;
    currentMode = data?.mode || "easy";

    if (startBtn) {
      startBtn.style.display = (isHost && !gameStarted) ? "inline-block" : "none";
      startBtn.onclick = () => socket.emit("start_game", { room });
    }

    if (setTimeBtn) {
      setTimeBtn.disabled = !isHost;
      setTimeBtn.title = isHost ? "" : "Seul l'hôte peut changer";
    }
    if (timeLimitInput && data?.time_limit) timeLimitInput.value = data.time_limit;

    if (setModeBtn) {
      setModeBtn.disabled = !isHost;
      setModeBtn.title = isHost ? "" : "Seul l'hôte peut changer";
    }
    if (modeSelect) modeSelect.value = currentMode;

    setLobbyMode(!gameStarted);

    flashStatus(`Connecté ✅ (${username})`, 1000);
    logPush(`Connecté au salon ${room}`);
    inputEl.focus();
  });

  // --- set time limit
  setTimeBtn?.addEventListener("click", () => {
    const val = Number(timeLimitInput?.value);
    if (!Number.isFinite(val)) return;
    socket.emit("set_time_limit", { room, seconds: val });
  });
  socket.on("time_limit_updated", (data) => {
    const s = data?.seconds;
    if (s && timeLimitInput) timeLimitInput.value = s;
    flashStatus(`⏱️ Temps par round: ${s}s`, 1200);
    logPush(`Temps par round réglé à ${s}s`);
  });

  // --- mode select
  setModeBtn?.addEventListener("click", () => {
    const mode = (modeSelect?.value || "easy").toLowerCase();
    socket.emit("set_mode", { room, mode });
  });
  socket.on("mode_updated", (data) => {
    currentMode = data?.mode || "easy";
    flashStatus(`Mode: ${currentMode.toUpperCase()}`, 1200);
    logPush(`Mode réglé: ${currentMode}`);
    applyMode(currentMode, 0);
  });

  // lobby
  socket.on("lobby_state", (data) => {
    if (!data?.started) {
      gameStarted = false;
      setLobbyMode(true);
      stopMatchTimer();
      if (matchTimerEl) matchTimerEl.textContent = "0.0";

      currentMode = data?.mode || currentMode;
      if (modeSelect) modeSelect.value = currentMode;

      roundInfoEl.textContent =
        `Lobby 👥 (${data.players?.length || 0} joueurs) — Host: ${data.host_name || "?"}`;

      wordEl.textContent = "---";
      if (typedEl) typedEl.textContent = "";
      timerEl.textContent = "0";

      const hostName = data.host_name || "";
      if (hostName && hostName === username) isHost = true;

      if (startBtn) startBtn.style.display = (isHost && !gameStarted) ? "inline-block" : "none";
      if (setTimeBtn) setTimeBtn.disabled = !isHost;
      if (setModeBtn) setModeBtn.disabled = !isHost;

      applyMode("easy", 0); // en lobby on remet visible
    }
  });

  socket.on("game_started", (data) => {
    gameStarted = true;
    setLobbyMode(false);

    currentMode = data?.mode || currentMode;
    applyMode(currentMode, 0);

    // match timer démarre ici (client)
    startMatchTimer(Date.now()/1000);

    flashStatus("▶ Partie lancée !", 1200);
    logPush(`Partie lancée (${data?.round_total || 30} mots) en ${currentMode.toUpperCase()}`);
    if (startBtn) startBtn.style.display = "none";
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

    typewrite(line, 90);

    wordEl.textContent = word;
    applyMode(mode, revealMs);

    roundInfoEl.textContent = `Mot ${idx}/${total} ⚡`;
    inputEl.value = "";
    inputEl.focus();
    startRoundTimer(seconds);

  });

  socket.on("round_timeout", () => {
    flashStatus("⏱️ Trop tard !", 900);
    logPush("⏱️ Timeout");
  });

  socket.on("round_winner", (data) => {
    const winner = data?.player || "Quelqu’un";
    const ms = data?.ms ?? 0;
    const dmg = data?.damage ?? 0;
    flashStatus(`🏆 ${winner} hack (${ms}ms) -${dmg}HP`, 1700);
    hackBurst(winner, ms);
  });

  socket.on("wrong", (data) => {
    const dmg = data?.damage ?? 0;
    const hp = data?.hp;
    flashStatus(`❌ Erreur ! -${dmg}HP`, 700);
    if (typeof hp === "number") logPush(`Erreur: -${dmg}HP (reste ${hp}HP)`);
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

    flashStatus(`✅ Partie terminée en ${totalS}s`, 2500);
    logPush(`🏁 Fin de partie (${totalS}s)`);

    const top = (data?.players ?? [])[0];
    if (top) {
      alert(`🏁 Fin de partie !\nTemps: ${totalS}s\nGagnant: ${top.name} (${top.score} pts, ${top.hp}HP)`);
    } else {
      alert(`🏁 Fin de partie !\nTemps: ${totalS}s`);
    }

    if (startBtn) startBtn.style.display = isHost ? "inline-block" : "none";
    applyMode("easy", 0);
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
