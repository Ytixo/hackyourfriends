const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const roomInput = document.getElementById("roomInput");

createBtn.addEventListener("click", () => {
    window.location.href = "/create";
});

joinBtn.addEventListener("click", () => {
    const code = (roomInput.value || "").trim().toUpperCase();
    if (!code) return;
    window.location.href = `/room/${code}`;
});

roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinBtn.click();
});

const canvas = document.getElementById("matrix");
const ctx = canvas.getContext("2d");

// Ajuste la résolution du canvas (vraie taille, pas juste CSS)
function fit() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // on dessine en "pixels CSS"
}
fit();
window.addEventListener("resize", () => {
  fit();
  setupColumns();
});

// Paramètres
const chars = "01";
let fontSize = 16;         // taille des caractères
let speedMin = 0.6;        // vitesse min
let speedMax = 1.6;        // vitesse max
let trailAlpha = 0.08;     // plus petit => traînée plus longue (0.03 - 0.15)

let columns = [];          // y positions (en "lignes") par colonne
let speeds = [];           // vitesse par colonne

function setupColumns() {
  const w = window.innerWidth;
  const count = Math.ceil(w / fontSize);
  columns = new Array(count).fill(0).map(() => Math.random() * window.innerHeight / fontSize);
  speeds = new Array(count).fill(0).map(() => speedMin + Math.random() * (speedMax - speedMin));
  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = "top";
}

setupColumns();

let last = performance.now();

function draw(now) {
  const dt = (now - last) / 16.6667; // ~1 à 60fps
  last = now;

  // Fade (traînée)
  ctx.fillStyle = `rgba(0,0,0,${trailAlpha})`;
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = "top";

  for (let i = 0; i < columns.length; i++) {
    const x = i * fontSize;
    const y = columns[i] * fontSize;

    // Caractère aléatoire (0/1)
    const ch = chars[(Math.random() * chars.length) | 0];

    // Petit glow "matrix"
    ctx.shadowColor = "rgba(0,255,70,0.9)";
    ctx.shadowBlur = 8;

    // Couleur principale
    ctx.fillStyle = "rgba(0, 255, 70, 0.95)";
    ctx.fillText(ch, x, y);

    // Avance la colonne
    columns[i] += speeds[i] * dt;

    // Reset en haut de manière aléatoire après être sorti
    if (y > window.innerHeight && Math.random() > 0.975) {
      columns[i] = 0;
      speeds[i] = speedMin + Math.random() * (speedMax - speedMin);
    }
  }

  // Remettre l'ombre à 0 pour éviter effets involontaires ailleurs
  ctx.shadowBlur = 0;

  requestAnimationFrame(draw);
}

// Démarrage: fond noir immédiat
ctx.fillStyle = "#000";
ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
requestAnimationFrame(draw);

// Optionnel: touches pour ajuster vite (facultatif)
// + / - => taille, [ / ] => traînée
window.addEventListener("keydown", (e) => {
  if (e.key === "+" || e.key === "=") { fontSize = Math.min(32, fontSize + 1); setupColumns(); }
  if (e.key === "-" || e.key === "_") { fontSize = Math.max(10, fontSize - 1); setupColumns(); }
  if (e.key === "[") { trailAlpha = Math.max(0.02, trailAlpha - 0.01); }
  if (e.key === "]") { trailAlpha = Math.min(0.20, trailAlpha + 0.01); }
});

async function loadRooms() {
  const list = document.getElementById("roomsList");
  const empty = document.getElementById("roomsEmpty");

  try {
    const res = await fetch("/api/rooms", { cache: "no-store" });
    if (!res.ok) throw new Error("API error");
    const rooms = await res.json(); // ex: ["X9A4F","AB12C"]

    list.innerHTML = "";
    if (!rooms || rooms.length === 0) {
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";

    for (const r of rooms) {
        const code = r.room;

        const a = document.createElement("a");
        a.href = `/room/${encodeURIComponent(code)}`;
        a.textContent = `${code} (${r.players}) ${r.started ? "• en cours" : "• lobby"} • ${r.mode}`;
        a.style.cssText = `
            padding:10px 12px;
            border:1px solid #333;
            border-radius:10px;
            text-decoration:none;
            color:#eaeaea;
            background:#111;
            display:inline-block;
            `;
        list.appendChild(a);
    }

  } catch (e) {
    // si l'API n'existe pas encore, on n'affiche rien
    console.warn("Rooms list not available:", e);
  }
}

loadRooms();
// Optionnel: refresh auto toutes les 5s
setInterval(loadRooms, 5000);
