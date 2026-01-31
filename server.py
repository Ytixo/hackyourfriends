from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room as socket_join_room
import random, threading, os

app = Flask(__name__)
socketio = SocketIO(app)

mots_cles = [
    "for", "while", "if", "else", "print", "input",
    "list", "dict", "len", "range", "import", "def"
]

lignes_code = [
    "for i in range(len(ip_addresses)):",
    "print(f\"Connecting to {target_ip}...\")",
    "socket.connect((target_ip, 22))",
    "data = socket.recv(1024)",
    "access_granted = True"
]

scores = {}
current_word = ""
round_active = False

@app.route("/")
def index():
    return render_template("index.html")

@socketio.on("join_room")
def handle_join_room(data):
    room = data["room"]
    username = data["username"]

    socket_join_room(room)

    rooms[room]["players"][request.sid] = username
    rooms[room]["score"][request.sid] = 0

rooms = {}

@app.route("/room/<room_id>")
def room(room_id):
    if room_id not in rooms:
        rooms[room_id] = {
            "players": {},
            "scores": {},
            "current_word": "",
            "round_active": False,
            "time_limit": 5
        }
    return render_template("index.html", room_id=room_id)

@socketio.on("join_room")
def handle_join(data):
    room = data["room"]
    username = data["username"]

    socket_join_room(room)

    rooms[room]["players"][request.sid] = username
    rooms[room]["scores"][request.sid] = 0

    emit("scoreboard", rooms[room]["scores"], room=room)


def end_round(room):
    rooms[room]["round_active"] = False
    socketio.emit("round_timeout", room=room)

def start_round(room):
    rooms[room]["round_active"] = True

    timer = rooms[room]["time_limit"]
    socketio.emit("timer_start", {"time": timer}, room=room)

    threading.Timer(timer, end_round, args=[room]).start()

@socketio.on("new_round")
def new_round(data):
    room = data["room"]

    if rooms[room]["round_active"]:
        return

    word = random.choice(mots_cles)
    line = random.choice(lignes_code)

    rooms[room]["current_word"] = word
    start_round(room)

    emit("public_line", {"line": line}, room=room)
    emit("private_word", {"word": word})


@socketio.on("player_input")
def check_input(data):
    room = data["room"]
    user_input = data["input"]

    if not rooms[room]["round_active"]:
        return

    if user_input == rooms[room]["current_word"]:
        rooms[room]["round_active"] = False
        rooms[room]["scores"][request.sid] += 1

        emit("winner", {
            "player": rooms[room]["players"][request.sid]
        }, room=room)

        emit("scoreboard", rooms[room]["scores"], room=room)


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)

