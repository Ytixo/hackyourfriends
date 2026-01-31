from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit
import random

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
    socketio.run(app, debug=True)
