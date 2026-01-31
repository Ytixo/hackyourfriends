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
  const roomLinkEl = document.getElementById("roomLink");
  const copyBtn = document.getElementById("copyBtn");
  const timeLimitInput = document.getElementById("timeLimitInput");
  const setTimeBtn = document.getElementById("setTimeBtn");

  // ---- room link
  const link = `${window.location.origin}/room/${room}`;
  roomLinkEl.textContent = link;

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      flashStatus("Lien copié 📋", 1200);
    } catch {
      flashStatus("Copie impossible (permissions navigateur) 😅", 1800);
    }
  });

  // ---- timer (client-side display only; server decides timeout)
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

  // ---- scoreboard
  function renderScores(players) {
    scoresEl.innerHTML = "";
    players.forEach(p => {
      const li = document.createElement("li");
      li.textContent = `${p.name} : ${p.score}`;
      scoresEl.appendChild(li);
    });
  }

  function flashStatus(msg, ms=1500) {
    statusEl.textContent = msg;
    if (ms > 0) {
      setTimeout(() => {
        if (statusEl.textContent === msg) statusEl.textContent = "";
      }, ms);
    }
  }

  // ---- join
  if (!room) {
    alert("Room invalide. Reviens à l'accueil.");
    window.location.href = "/";
    return;
  }

  socket.emit("join_room", { room, username });

  socket.on("joined", (data) => {
    flashStatus(`Connecté en tant que ${username} ✅`, 1200);
    if (data && data.time_limit) {
      timeLimitInput.value = data.time_limit;
    }
  });

  // ---- receive public line / private word
  socket.on("public_line", (data) => {
    lineEl.textContent = data?.line ?? "";
    inputEl.value = "";
    inputEl.focus();
  });

  socket.on("private_word", (data) => {
    wordEl.textContent = data?.word ?? "---";
  });

  // ---- timer start
  socket.on("timer_start", (data) => {
    startTimer(data?.seconds ?? 0);
  });

  socket.on("round_timeout", () => {
    flashStatus("⏱️ Temps écoulé ! Nouveau round...", 1200);
    // server may auto-start, but we can request to be safe
    socket.emit("new_round", { room });
  });

  // ---- winner
  socket.on("winner", (data) => {
    const name = data?.player ?? "Quelqu'un";
    const word = data?.word ?? "";
    flashStatus(`🏆 ${name} a gagné ! (${word})`, 1600);
  });

  // ---- wrong feedback (private)
  socket.on("wrong", () => {
    flashStatus("❌ Mauvais mot", 700);
  });

  // ---- scoreboard updates
  socket.on("scoreboard", (data) => {
    renderScores(data?.players ?? []);
  });

  // ---- set time limit
  setTimeBtn.addEventListener("click", () => {
    const val = Number(timeLimitInput.value);
    if (!Number.isFinite(val)) return;
    socket.emit("set_time_limit", { room, seconds: val });
  });

  socket.on("time_limit_updated", (data) => {
    const s = data?.seconds;
    if (s) {
      timeLimitInput.value = s;
      flashStatus(`⏱️ Temps par round: ${s}s`, 1200);
    }
  });

  // ---- input send
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const text = inputEl.value || "";
      socket.emit("player_input", { room, input: text });
      inputEl.value = "";
    }
  });
})();
