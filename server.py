import os
import random
import string
import time

from flask import Flask, render_template, redirect, request
from flask_socketio import SocketIO, emit, join_room as socket_join_room, leave_room as socket_leave_room

# -----------------------------
# App / SocketIO setup
# -----------------------------
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
# rooms[room_id] = {
#   "players": {sid: username},
#   "scores": {sid: int},
#   "current_word": str,
#   "current_line": str,
#   "round_active": bool,
#   "time_limit": int,
#   "round_token": str,  # unique id to avoid race conditions with timers
# }
rooms = {}

DEFAULT_TIME_LIMIT = 7  # seconds


def generate_room_code(n=5):
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


def ensure_room(room_id: str):
    if room_id not in rooms:
        rooms[room_id] = {
            "players": {},
            "scores": {},
            "current_word": "",
            "current_line": "",
            "round_active": False,
            "time_limit": DEFAULT_TIME_LIMIT,
            "round_token": "",
        }


def public_scoreboard(room_id: str):
    """Return scoreboard as a list of dicts for easy client rendering."""
    r = rooms[room_id]
    result = []
    for sid, name in r["players"].items():
        result.append({"name": name, "score": r["scores"].get(sid, 0)})
    # sort by score desc then name
    result.sort(key=lambda x: (-x["score"], x["name"].lower()))
    return result


def broadcast_scoreboard(room_id: str):
    emit("scoreboard", {"players": public_scoreboard(room_id)}, room=room_id)


# -----------------------------
# HTTP routes (pages)
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
def end_round_if_still_active(room_id: str, token: str):
    """Called after timer; ends round only if token matches current round."""
    if room_id not in rooms:
        return
    r = rooms[room_id]
    if r["round_active"] and r["round_token"] == token:
        r["round_active"] = False
        socketio.emit("round_timeout", {}, room=room_id)


def round_timer_task(room_id: str, token: str, seconds: int):
    socketio.sleep(seconds)
    end_round_if_still_active(room_id, token)


def start_new_round(room_id: str):
    r = rooms[room_id]
    if r["round_active"]:
        return

    r["current_word"] = random.choice(mots_cles)
    r["current_line"] = random.choice(lignes_code)
    r["round_active"] = True
    r["round_token"] = generate_room_code(10)  # token anti-race

    # Tout le monde voit la ligne
    socketio.emit("public_line", {"line": r["current_line"]}, room=room_id)

    # Chaque joueur reçoit le mot en privé (sid->room is implicit; emit without room targets sender)
    # On l’envoie à tous les membres, mais *chacun* le reçoit via son socket : c'est OK
    # car on va l’envoyer en "private_word" à chaque sid individuellement.
    for sid in list(r["players"].keys()):
        socketio.emit("private_word", {"word": r["current_word"]}, to=sid)

    # Start timer (server-authoritative)
    socketio.emit("timer_start", {"seconds": r["time_limit"]}, room=room_id)
    socketio.start_background_task(round_timer_task, room_id, r["round_token"], r["time_limit"])


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

    # Inform client they joined + send state
    emit("joined", {"room": room_id, "time_limit": r["time_limit"]})
    broadcast_scoreboard(room_id)

    # If no round running, start one
    if not r["round_active"]:
        start_new_round(room_id)
    else:
        # Send current line + timer restart info (client will just show the last "timer_start")
        emit("public_line", {"line": r["current_line"]})
        emit("private_word", {"word": r["current_word"]})


@socketio.on("set_time_limit")
def handle_set_time_limit(data):
    room_id = (data.get("room") or "").strip().upper()
    seconds = data.get("seconds")

    if room_id not in rooms:
        return

    try:
        seconds = int(seconds)
    except Exception:
        return

    # clamp
    seconds = max(3, min(30, seconds))
    rooms[room_id]["time_limit"] = seconds

    emit("time_limit_updated", {"seconds": seconds}, room=room_id)


@socketio.on("new_round")
def handle_new_round(data):
    room_id = (data.get("room") or "").strip().upper()
    if room_id not in rooms:
        return
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

    if text == r["current_word"]:
        # Winner
        r["round_active"] = False
        r["scores"][request.sid] = r["scores"].get(request.sid, 0) + 1
        winner_name = r["players"].get(request.sid, "Unknown")

        socketio.emit("winner", {"player": winner_name, "word": r["current_word"]}, room=room_id)
        broadcast_scoreboard(room_id)

        # Start next round shortly for better feel
        socketio.start_background_task(_delayed_next_round, room_id, 0.8)
    else:
        # Optional: feedback per player
        emit("wrong", {"got": text})


def _delayed_next_round(room_id: str, delay: float):
    socketio.sleep(delay)
    if room_id in rooms:
        start_new_round(room_id)


@socketio.on("disconnect")
def handle_disconnect():
    # Remove player from any rooms
    sid = request.sid
    empty_rooms = []
    for room_id, r in rooms.items():
        if sid in r["players"]:
            r["players"].pop(sid, None)
            r["scores"].pop(sid, None)
            try:
                socket_socket_leave = socket_leave_room
            except NameError:
                socket_socket_leave = socket_socket_room  # not used
            # broadcast updated scoreboard
            broadcast_scoreboard(room_id)

            # If room empty => mark for deletion
            if len(r["players"]) == 0:
                empty_rooms.append(room_id)

    for room_id in empty_rooms:
        rooms.pop(room_id, None)


# -----------------------------
# Run
# -----------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)
