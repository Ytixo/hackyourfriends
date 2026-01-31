import os
import random
import string
import time

from flask import Flask, render_template, redirect, request, jsonify
from flask_socketio import SocketIO, emit, join_room as socket_join_room

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

mots_cles = [
    "for", "while", "if", "else", "print", "input",
    "list", "dict", "len", "range", "import", "def",
    "try", "except", "return", "class", "lambda", "with",
    "break", "continue", "yield", "global", "assert", "test"
]

lignes_code = [
    "for i in range(len(ip_addresses)):",
    "print(f\"Connecting to {target_ip}...\")",
    "socket.connect((target_ip, 22))",
    "data = socket.recv(1024)",
    "access_granted = True",
    "try:",
    "except ConnectionError:",
    "def scan_network(ip_range):",
    "return open_ports",
    "payload = encrypt(data)",
]

rooms = {}

DEFAULT_TIME_LIMIT = 7         # temps max par mot/round
DEFAULT_TIME_LIMIT_HARD = 3
ROUNDS_TOTAL = 30

MAX_HP = 100
DAMAGE_ON_WIN = 5              # dégâts à tous les autres quand quelqu’un gagne un round
DAMAGE_ON_WRONG = 2            # dégâts sur erreur (anti-bourrin)

RECENT_WORD_WINDOW = 2         # le mot ne peut pas réapparaitre dans les 2 prochains rounds


def generate_room_code(n=5):
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


def ensure_room(room_id: str):
    if room_id not in rooms:
        rooms[room_id] = {
            "players": {},      # sid -> username
            "scores": {},       # sid -> points
            "hp": {},           # sid -> hp
            "host_sid": None,

            "started": False,
            "time_limit_easy": DEFAULT_TIME_LIMIT,
            "time_limit_hard": DEFAULT_TIME_LIMIT_HARD,
            "round_total": ROUNDS_TOTAL,

            "mode": "easy",     # easy | hard
            "round_index": 0,
            "round_active": False,
            "current_word": "",
            "current_line": "",
            "round_token": "",
            "round_start_ts": 0.0,

            "match_start_ts": 0.0,
            "recent_words": [],  # anti-repeat
        }

def get_time_limit(r):
    return r["time_limit_easy"] if r["mode"] == "easy" else r["time_limit_hard"]

def public_state(room_id: str):
    r = rooms[room_id]
    players = []
    for sid, name in r["players"].items():
        players.append({
            "name": name,
            "score": r["scores"].get(sid, 0),
            "hp": r["hp"].get(sid, MAX_HP)
        })
    players.sort(key=lambda x: (-x["score"], -x["hp"], x["name"].lower()))
    return players


def lobby_payload(room_id: str):
    r = rooms[room_id]
    return {
        "started": r["started"],
        "round_index": r["round_index"],
        "round_total": r["round_total"],
        "players": [{"name": r["players"][sid]} for sid in r["players"]],
        "host_name": r["players"].get(r["host_sid"], "Host"),
        "mode": r["mode"],
        "time_limit": get_time_limit(r),
    }


def emit_state(room_id: str):
    socketio.emit("state", {"players": public_state(room_id)}, room=room_id)


def choose_word_no_recent(r):
    # Évite que le même mot revienne trop vite (fenêtre de 2)
    candidates = [w for w in mots_cles if w not in r["recent_words"]]
    if not candidates:
        candidates = mots_cles[:]  # fallback
    word = random.choice(candidates)

    r["recent_words"].append(word)
    if len(r["recent_words"]) > RECENT_WORD_WINDOW:
        r["recent_words"] = r["recent_words"][-RECENT_WORD_WINDOW:]
    return word


def start_new_round(room_id: str):
    r = rooms[room_id]
    if not r["started"]:
        return
    if r["round_active"]:
        return

    # fin si 30 mots
    if r["round_index"] >= r["round_total"]:
        end_game(room_id)
        return

    # fin si un seul survivant (optionnel)
    alive = [sid for sid in r["players"] if r["hp"].get(sid, MAX_HP) > 0]
    if len(alive) <= 1 and len(r["players"]) > 0:
        end_game(room_id)
        return

    r["round_index"] += 1
    r["current_word"] = choose_word_no_recent(r)
    r["current_line"] = random.choice(lignes_code)
    r["round_active"] = True
    r["round_token"] = generate_room_code(10)
    r["round_start_ts"] = time.time()

    seconds = get_time_limit(r)

    socketio.emit("round_start", {
        "line": r["current_line"],
        "word": r["current_word"],
        "round_index": r["round_index"],
        "round_total": r["round_total"],
        "seconds": seconds,
        "mode": r["mode"],
        "word_reveal_ms": 500 if r["mode"] == "hard" else 999999,
        "match_start_ts": r["match_start_ts"],
    }, room=room_id)

    socketio.start_background_task(round_timer_task, room_id, r["round_token"], seconds)



def round_timer_task(room_id: str, token: str, seconds: int):
    socketio.sleep(seconds)
    if room_id not in rooms:
        return
    r = rooms[room_id]
    if r["round_active"] and r["round_token"] == token:
        r["round_active"] = False
        socketio.emit("round_timeout", {}, room=room_id)
        socketio.start_background_task(_delayed_next_round, room_id, 0.7)


def _delayed_next_round(room_id: str, delay: float):
    socketio.sleep(delay)
    if room_id in rooms:
        start_new_round(room_id)


def end_game(room_id: str):
    r = rooms[room_id]
    r["round_active"] = False
    r["started"] = False

    total_ms = 0
    if r["match_start_ts"] > 0:
        total_ms = int((time.time() - r["match_start_ts"]) * 1000)

    socketio.emit("game_over", {
        "players": public_state(room_id),
        "total_ms": total_ms
    }, room=room_id)


@app.route("/")
def home():
    return render_template("home.html")

@app.route("/room/<room_id>")
def room(room_id):
    ensure_room(room_id)
    return render_template("game.html", room_id=room_id)


@socketio.on("join_room")
def handle_join(data):
    room_id = (data.get("room") or "").strip().upper()
    username = (data.get("username") or "Player").strip()

    if not room_id:
        return

    ensure_room(room_id)
    socket_join_room(room_id)

    r = rooms[room_id]
    r["players"][request.sid] = username
    r["scores"].setdefault(request.sid, 0)
    r["hp"].setdefault(request.sid, MAX_HP)

    if r["host_sid"] is None:
        r["host_sid"] = request.sid

    emit("joined", {
        "room": room_id,
        "is_host": request.sid == r["host_sid"],
        "started": r["started"],
        "time_limit": get_time_limit(r),
        "round_total": r["round_total"],
        "mode": r["mode"],
        "max_hp": MAX_HP,
    })


    socketio.emit("lobby_state", lobby_payload(room_id), room=room_id)
    emit_state(room_id)


@socketio.on("set_time_limit")
def handle_set_time_limit(data):
    room_id = (data.get("room") or "").strip().upper()
    if room_id not in rooms:
        return

    r = rooms[room_id]
    if request.sid != r["host_sid"]:
        return

    try:
        seconds = int(data.get("seconds"))
    except Exception:
        return

    seconds = max(3, min(30, seconds))

    # change le time limit du mode actuel
    if r["mode"] == "easy":
        r["time_limit_easy"] = seconds
    else:
        r["time_limit_hard"] = seconds

    socketio.emit("time_limit_updated", {"seconds": seconds, "mode": r["mode"]}, room=room_id)
    socketio.emit("lobby_state", lobby_payload(room_id), room=room_id)



@socketio.on("set_mode")
def handle_set_mode(data):
    room_id = (data.get("room") or "").strip().upper()
    mode = (data.get("mode") or "").strip().lower()

    if room_id not in rooms:
        return
    r = rooms[room_id]
    if request.sid != r["host_sid"]:
        return
    if mode not in ("easy", "hard"):
        return
    if r["started"]:
        return  # pas de changement en plein match

    r["mode"] = mode
    socketio.emit("mode_updated", {"mode": mode}, room=room_id)
    socketio.emit("lobby_state", lobby_payload(room_id), room=room_id)


@socketio.on("start_game")
def start_game(data):
    room_id = (data.get("room") or "").strip().upper()
    if room_id not in rooms:
        return
    r = rooms[room_id]

    if request.sid != r["host_sid"]:
        return
    if r["started"]:
        return

    # reset match state
    r["started"] = True
    r["round_index"] = 0
    r["round_active"] = False
    r["recent_words"] = []
    r["match_start_ts"] = time.time()

    # reset scores + hp
    for sid in list(r["players"].keys()):
        r["scores"][sid] = 0
        r["hp"][sid] = MAX_HP

    socketio.emit("game_started", {"round_total": r["round_total"], "mode": r["mode"]}, room=room_id)
    emit_state(room_id)
    start_new_round(room_id)


@socketio.on("player_input")
def handle_input(data):
    room_id = (data.get("room") or "").strip().upper()
    text = (data.get("input") or "").strip()

    if room_id not in rooms:
        return
    r = rooms[room_id]
    if not r["round_active"]:
        return

    # si joueur déjà KO, ignore
    if r["hp"].get(request.sid, MAX_HP) <= 0:
        return

    if text == r["current_word"]:
        r["round_active"] = False

        # point au winner
        r["scores"][request.sid] = r["scores"].get(request.sid, 0) + 1

        # dégâts aux autres
        for sid in r["players"].keys():
            if sid != request.sid:
                r["hp"][sid] = max(0, r["hp"].get(sid, MAX_HP) - DAMAGE_ON_WIN)

        winner_name = r["players"].get(request.sid, "Unknown")
        elapsed_ms = int((time.time() - r["round_start_ts"]) * 1000)

        socketio.emit("round_winner", {
            "player": winner_name,
            "ms": elapsed_ms,
            "word": r["current_word"],
            "damage": DAMAGE_ON_WIN
        }, room=room_id)

        emit_state(room_id)
        socketio.start_background_task(_delayed_next_round, room_id, 0.7)

    else:
        # erreur -> auto dégâts anti-bourrin
        r["hp"][request.sid] = max(0, r["hp"].get(request.sid, MAX_HP) - DAMAGE_ON_WRONG)
        emit("wrong", {"damage": DAMAGE_ON_WRONG, "hp": r["hp"][request.sid]})
        emit_state(room_id)


@socketio.on("disconnect")
def handle_disconnect():
    sid = request.sid
    empty = []

    for room_id, r in rooms.items():
        if sid in r["players"]:
            r["players"].pop(sid, None)
            r["scores"].pop(sid, None)
            r["hp"].pop(sid, None)

            if r["host_sid"] == sid:
                r["host_sid"] = next(iter(r["players"].keys()), None)

            socketio.emit("lobby_state", lobby_payload(room_id), room=room_id)
            emit_state(room_id)

            if len(r["players"]) == 0:
                empty.append(room_id)

    for room_id in empty:
        rooms.pop(room_id, None)


@app.get("/api/rooms")
def api_rooms():
    # Exemple: renvoie uniquement les rooms qui ont au moins 1 joueur
    active = []
    for room_id, r in rooms.items():
        if len(r["players"]) > 0:
            active.append({
                "room": room_id,
                "players": len(r["players"]),
                "started": r["started"],
                "mode": r["mode"],
            })

    # tri : rooms non démarrées d'abord, puis plus de joueurs
    active.sort(key=lambda x: (x["started"], -x["players"], x["room"]))
    return jsonify(active)

@app.route("/create")
def create():
    room_id = generate_room_code()
    ensure_room(room_id)
    return redirect(f"/room/{room_id}")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)
