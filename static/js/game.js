(() => {
  const socket = io();
  const room = (window.GAME_ROOM || "").trim().toUpperCase();
  const username = (prompt("Pseudo ?") || "Player").trim() || "Player";

  const typedEl = document.getElementById("typed");     // <-- IMPORTANT
  const wordEl = document.getElementById("word");
  const inputEl = document.getElementById("input");
  const timerEl = document.getElementById("timer");
  const scoresEl = document.getElementById("scores");
  const statusEl = document.getElementById("status");
  const roundInfoEl = document.getElementById("roundInfo");
  const logEl = document.getElementById("log");

  const roomLinkEl = document.getElementById("roomLink");
  const copyBtn = document.getElementById("copyBtn");
  const startBtn = document.getElementById("startBtn");

  const timeLimitInput = document.getElementById("timeLimitInput");
  const setTimeBtn = document.getElementById("setTimeBtn");

  let gameStarted = false;
  let isHost = false;

  // ----- link
  const link = `${window.location.origin}/room/${room}`;
  roomLinkEl.textContent = link;

  copyBtn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      flashStatus("Lien copié 📋", 1200);
    } catch {
      flashStatus("Copie impossible 😅", 1500);
    }
  });

  // ----- UI helpers
  function flashStatus(msg, ms = 1200) {
    statusEl.textContent = msg;
    if (ms > 0) {
      setTimeout(() => {
        if (statusEl.textContent === msg) statusEl.textContent = "";
      }, ms);
    }
  }

  function logPush(text) {
    if (!logEl) return;
    const now = new Date().toLocaleTimeString();
    logEl.textContent = `[${now}] ${text}\n` + logEl.textContent;
  }

  function setLobbyMode(on) {
    inputEl.disabled = on;
    inputEl.placeholder = on ? "En attente du lancement..." : "Écris puis Entrée";
    if (on) inputEl.value = "";
  }

  // ----- typewriter animation
  let typeTimer = null;
  function typewrite(text, cps = 80) {
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

  // ----- timer
  let timerInterval = null;
  function startTimer(seconds) {
    clearInterval(timerInterval);
    let t = Number(seconds) || 0;
    timerEl.textContent = String(t);
    timerInterval = setInterval(() => {
      t -= 1;
      if (t < 0) {
        clearInterval(timerInterval);
        return;
      }
      timerEl.textContent = String(t);
    }, 1000);
  }

  // ----- scoreboard
  function renderScores(players) {
    scoresEl.innerHTML = "";
    players.forEach(p => {
      const li = document.createElement("li");
      li.textContent = `${p.name} : ${p.score}`;
      scoresEl.appendChild(li);
    });
  }

  // ----- fun hack burst
  function hackBurst(winner, ms) {
    logPush(`⚡ ${winner} > BYPASS FIREWALL (${ms}ms)`);
    logPush(`🔓 ACCESS GRANTED`);
    logPush(`⬇️  DOWNLOADING PAYLOAD...`);
    setTimeout(() => logPush(`✅ DONE`), 400);
  }

  // ----- join
  if (!room) {
    window.location.href = "/";
    return;
  }

  socket.emit("join_room", { room, username });

  socket.on("joined", (data) => {
    isHost = !!data?.is_host;
    gameStarted = !!data?.started;

    // bouton start visible uniquement si host + pas commencé
    if (startBtn) {
      startBtn.style.display = (isHost && !gameStarted) ? "inline-block" : "none";
      startBtn.onclick = () => socket.emit("start_game", { room });
    }

    // paramètres: seuls les hosts devraient changer le timer (optionnel)
    if (setTimeBtn) {
      setTimeBtn.disabled = !isHost;
      setTimeBtn.title = isHost ? "" : "Seul l'hôte peut changer le temps";
    }
    if (timeLimitInput && data?.time_limit) timeLimitInput.value = data.time_limit;

    setLobbyMode(!gameStarted);

    flashStatus(`Connecté ✅ (${username})`, 1000);
    logPush(`Connecté au salon ${room}`);
    inputEl.focus();
  });

  // ----- set time limit
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

  // ----- lobby updates
  socket.on("lobby_state", (data) => {
    if (!data?.started) {
      gameStarted = false;
      setLobbyMode(true);

      roundInfoEl.textContent =
        `Lobby 👥 (${data.players?.length || 0} joueurs) — Host: ${data.host_name || "?"}`;

      wordEl.textContent = "---";
      if (typedEl) typedEl.textContent = "";
      timerEl.textContent = "0";

      // si l'host a changé (host a quitté), on peut ré-activer le bouton
      const hostName = data.host_name || "";
      if (hostName && hostName === username) isHost = true;

      if (startBtn) startBtn.style.display = (isHost && !gameStarted) ? "inline-block" : "none";
      if (setTimeBtn) setTimeBtn.disabled = !isHost;
    }
  });

  socket.on("game_started", (data) => {
    gameStarted = true;
    setLobbyMode(false);
    flashStatus("▶ Partie lancée !", 1200);
    logPush(`Partie lancée (${data?.round_total || 30} rounds)`);
    if (startBtn) startBtn.style.display = "none";
  });

  // ----- rounds
  socket.on("round_start", (data) => {
    gameStarted = true;
    setLobbyMode(false);

    const line = data?.line ?? "";
    const word = data?.word ?? "";
    const idx = data?.round_index ?? 0;
    const total = data?.round_total ?? 0;
    const seconds = data?.seconds ?? 0;

    typewrite(line, 85);
    wordEl.textContent = word;

    roundInfoEl.textContent = `Round ${idx}/${total} ⚡`;
    inputEl.value = "";
    inputEl.focus();
    startTimer(seconds);

    logPush(`Nouveau round: tape "${word}"`);
  });

  socket.on("round_timeout", () => {
    flashStatus("⏱️ Trop tard !", 900);
    logPush("⏱️ Timeout (personne n'a hack à temps)");
  });

  socket.on("round_winner", (data) => {
    const winner = data?.player || "Quelqu’un";
    const ms = data?.ms ?? 0;
    flashStatus(`🏆 ${winner} a hack en ${ms}ms !`, 1600);
    hackBurst(winner, ms);
  });

  socket.on("wrong", () => {
    flashStatus("❌ Mauvais mot", 500);
  });

  socket.on("scoreboard", (data) => {
    renderScores(data?.players ?? []);
  });

  socket.on("game_over", (data) => {
    gameStarted = false;
    setLobbyMode(true);

    flashStatus("✅ Partie terminée !", 2000);
    logPush("🏁 Fin de partie");

    const top = (data?.players ?? [])[0];
    if (top) {
      alert(`🏁 Fin de partie !\nGagnant: ${top.name} (${top.score} pts)`);
    } else {
      alert("🏁 Fin de partie !");
    }

    // retour lobby
    if (startBtn) startBtn.style.display = isHost ? "inline-block" : "none";
  });

  // ----- input
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (!gameStarted) return;
      socket.emit("player_input", { room, input: inputEl.value });
      inputEl.value = "";
    }
  });
})();
