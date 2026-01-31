from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit
import random
import threading

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

@socketio.on("join")
def join(data):
    username = data["username"]
    scores[request.sid] = {"name": username, "score": 0}
    emit("scoreboard", scores, broadcast=True)

rooms = {
    "X9A4F": {
        "players": {},
        "score": {},
        "current_word": "",
        "round_active": False,
        "time_limit": 5
    }
}

@socketio.on("join_room")
def join_room(data):
    room = data["room"]
    username = data["username"]
    join_room(room)

    rooms[room]["players"][request.sid] = username
    rooms[room]["score"][request.sid] = 0


def end_round(room):
    rooms[room]["round_active"] = False
    socketio.emit("round_timeout", room=room)

def start_round(room):
    rooms[room]["round_active"] = True
    threading.Timer(
        rooms[room]["time_limit"],
        end_round,
        args=[room]
    ).start()

@socketio.on("new_round")
def new_round():
    global current_word, round_active
    if round_active:
        return

    current_word = random.choice(mots_cles)
    line = random.choice(lignes_code)
    round_active = True

    # visible par tous
    emit("public_line", {"line": line}, broadcast=True)

    # mot envoyé en privé
    emit("private_word", {"word": current_word})

@socketio.on("player_input")
def check_input(data):
    global round_active
    if not round_active:
        return

    if data["input"] == current_word:
        round_active = False
        scores[request.sid]["score"] += 1

        emit("winner", {
            "player": scores[request.sid]["name"]
        }, broadcast=True)

        emit("scoreboard", scores, broadcast=True)

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)

