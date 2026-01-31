import os
import random
import string
import time

from flask import Flask, render_template, redirect, request
from flask_socketio import SocketIO, emit, join_room as socket_join_room

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# -----------------------------
# Game data
# -----------------------------
mots_cles = [
    "for", "while", "if", "else", "print", "input",
    "list", "dict", "len", "range", "import", "def",
    "try", "except", "return", "class"
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
]

# -----------------------------
# Rooms state
# -----------------------------
rooms = {}
DEFAULT_TIME_LIMIT = 7
ROUNDS_TOTAL = 30


def generate_room_code(n=5):
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


def ensure_room(room_id: str):
    if room_id not in rooms:
        rooms[room_id] = {
            "players": {},        # sid -> username
            "scores": {},         # sid -> int
            "host_sid": None,
            "started": False,
            "time_limit": DEFAULT_TIME_LIMIT,

            "round_index": 0,
            "round_total": ROUNDS_TOTAL,
            "round_active": False,
            "current_word": "",
            "current_line": "",
            "round_token": "",
            "round_start_ts": 0.0,
        }


def public_scoreboard(room_id: str):
    r = rooms[room_id]
    players = [{"name": r["players"][sid], "score": r["scores"].get(sid, 0)} for sid in r["players"]]
    players.sort(key=lambda x: (-x["score"], x["name"].lower()))
    return players


def lobby_payload(room_id: str):
    r = rooms[room_id]
    return {
        "started": r["started"],
        "round_index": r["round_index"],
        "round_total": r["round_total"],
        "players": [{"name": r["players"][sid]} for sid in r["players"]],
        "host_name": r["players"].get(r["host_sid"], "Host"),
    }


def emit_scoreboard(room_id: str):
    socketio.emit("scoreboard", {"players": public_scoreboard(room_id)}, room=room_id)


# -----------------------------
# HTTP routes
# -----------------------------
@app.route("/")
def home():
    return render_template("home.html")


@app.route("/create")
def create():
    room_id = generate_room_code()
    return redirect(f"/room/{room_id}")


@app.route("/room/<room_id>")
def room(room_id):
    ensure_room(room_id)
    return render_template("game.html", room_id=room_id)


# -----------------------------
# Round logic
# -----------------------------
def start_new_round(room_id: str):
    r = rooms[room_id]
    if not r["started"]:
        return
    if r["round_active"]:
        return

    if r["round_index"] >= r["round_total"]:
        end_game(room_id)
        return

    r["round_index"] += 1
    r["current_word"] = random.choice(mots_cles)
    r["current_line"] = random.choice(lignes_code)
    r["round_active"] = True
    r["round_token"] = generate_room_code(10)
    r["round_start_ts"] = time.time()

    socketio.emit("round_start", {
        "line": r["current_line"],
        "word": r["current_word"],
        "round_index": r["round_index"],
        "round_total": r["round_total"],
        "seconds": r["time_limit"],
    }, room=room_id)

    socketio.start_background_task(round_timer_task, room_id, r["round_token"], r["time_limit"])


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
    socketio.emit("game_over", {"players": public_scoreboard(room_id)}, room=room_id)


# -----------------------------
# Socket.IO events
# -----------------------------
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

    if r["host_sid"] is None:
        r["host_sid"] = request.sid

    emit("joined", {
        "room": room_id,
        "is_host": request.sid == r["host_sid"],
        "started": r["started"],
        "time_limit": r["time_limit"],
        "round_total": r["round_total"],
    })

    socketio.emit("lobby_state", lobby_payload(room_id), room=room_id)
    emit_scoreboard(room_id)


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

    r["started"] = True
    r["round_index"] = 0
    socketio.emit("game_started", {"round_total": r["round_total"]}, room=room_id)
    start_new_round(room_id)


@socketio.on("set_time_limit")
def handle_set_time_limit(data):
    room_id = (data.get("room") or "").strip().upper()
    if room_id not in rooms:
        return

    try:
        seconds = int(data.get("seconds"))
    except Exception:
        return

    seconds = max(3, min(30, seconds))
    rooms[room_id]["time_limit"] = seconds
    socketio.emit("time_limit_updated", {"seconds": seconds}, room=room_id)


@socketio.on("player_input")
def handle_input(data):
    room_id = (data.get("room") or "").strip().upper()
    text = (data.get("input") or "").strip()

    if room_id not in rooms:
        return

    r = rooms[room_id]
    if not r["round_active"]:
        return

    if text == r["current_word"]:
        r["round_active"] = False
        r["scores"][request.sid] = r["scores"].get(request.sid, 0) + 1

        winner_name = r["players"].get(request.sid, "Unknown")
        elapsed_ms = int((time.time() - r["round_start_ts"]) * 1000)

        socketio.emit("round_winner", {
            "player": winner_name,
            "ms": elapsed_ms,
            "word": r["current_word"],
        }, room=room_id)

        emit_scoreboard(room_id)
        socketio.start_background_task(_delayed_next_round, room_id, 0.7)
    else:
        emit("wrong", {})


@socketio.on("disconnect")
def handle_disconnect():
    sid = request.sid
    empty = []

    for room_id, r in rooms.items():
        if sid in r["players"]:
            r["players"].pop(sid, None)
            r["scores"].pop(sid, None)

            # si l'host part, on passe l'host au premier joueur restant
            if r["host_sid"] == sid:
                r["host_sid"] = next(iter(r["players"].keys()), None)

            socketio.emit("lobby_state", lobby_payload(room_id), room=room_id)
            emit_scoreboard(room_id)

            if len(r["players"]) == 0:
                empty.append(room_id)

    for room_id in empty:
        rooms.pop(room_id, None)


# -----------------------------
# Run
# -----------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)