(() => {
  const socket = io();
  const room = (window.GAME_ROOM || "").trim().toUpperCase();
  const username = (prompt("Pseudo ?") || "Player").trim() || "Player";

  const lineEl = document.getElementById("line");
  const wordEl = document.getElementById("word");
  const inputEl = document.getElementById("input");
  const timerEl = document.getElementById("timer");
  const scoresEl = document.getElementById("scores");
  const statusEl = document.getElementById("status");
  const roundInfoEl = document.getElementById("roundInfo");

  const roomLinkEl = document.getElementById("roomLink");
  const copyBtn = document.getElementById("copyBtn");
  const startBtn = document.getElementById("startBtn");

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

  // ----- helper UI
  function flashStatus(msg, ms = 1200) {
    statusEl.textContent = msg;
    if (ms > 0) {
      setTimeout(() => {
        if (statusEl.textContent === msg) statusEl.textContent = "";
      }, ms);
    }
  }

  // ----- typewriter animation (terminal line)
  let typeTimer = null;
  function typewrite(el, text, cps = 55) { // chars per second
    clearInterval(typeTimer);
    el.textContent = "";
    let i = 0;
    const interval = Math.max(5, Math.floor(1000 / cps));
    typeTimer = setInterval(() => {
      i++;
      el.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(typeTimer);
    }, interval);
  }

  // ----- timer display (server-authoritative)
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

  // ----- join
  if (!room) {
    window.location.href = "/";
    return;
  }

  socket.emit("join_room", { room, username });

  socket.on("joined", (data) => {
    const isHost = !!data?.is_host;
    const started = !!data?.started;

    if (startBtn) {
      startBtn.style.display = (isHost && !started) ? "inline-block" : "none";
      startBtn.onclick = () => socket.emit("start_game", { room });
    }

    flashStatus(`Connecté ✅ (${username})`, 1000);
    inputEl.focus();
  });

  // lobby state updates
  socket.on("lobby_state", (data) => {
    if (!data?.started) {
      roundInfoEl.textContent = `Lobby 👥 (${data.players?.length || 0} joueurs) — Host: ${data.host_name || "?"}`;
      wordEl.textContent = "---";
      lineEl.textContent = "En attente du lancement...";
      timerEl.textContent = "0";
    }
  });

  socket.on("game_started", (data) => {
    flashStatus("▶ Partie lancée !", 1200);
  });

  // ----- rounds
  socket.on("round_start", (data) => {
    const line = data?.line ?? "";
    const word = data?.word ?? "";
    const idx = data?.round_index ?? 0;
    const total = data?.round_total ?? 0;
    const seconds = data?.seconds ?? 0;

    typewrite(lineEl, line, 70);        // animation terminal
    wordEl.textContent = word;          // tout le monde voit le mot
    roundInfoEl.textContent = `Round ${idx}/${total} ⚡`;
    inputEl.value = "";
    inputEl.focus();
    startTimer(seconds);
  });

  socket.on("round_timeout", () => {
    flashStatus("⏱️ Trop tard !", 900);
  });

  socket.on("round_winner", (data) => {
    flashStatus(`🏆 ${data.player} a hack en ${data.ms}ms !`, 1600);
  });

  socket.on("wrong", () => {
    flashStatus("❌ Mauvais mot", 500);
  });

  socket.on("scoreboard", (data) => {
    renderScores(data?.players ?? []);
  });

  socket.on("game_over", (data) => {
    flashStatus("✅ Partie terminée !", 2000);
    const top = (data?.players ?? [])[0];
    if (top) {
      alert(`🏁 Fin de partie !\nGagnant: ${top.name} (${top.score} pts)`);
    } else {
      alert("🏁 Fin de partie !");
    }
  });

  // ----- input
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      socket.emit("player_input", { room, input: inputEl.value });
      inputEl.value = "";
    }
  });
})();
