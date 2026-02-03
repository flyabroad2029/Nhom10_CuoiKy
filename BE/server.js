const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const PORT = 8080;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "database.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ rooms: {} }, null, 2));
}

function loadDatabase() {
    try {
        const content = fs.readFileSync(DATA_FILE, "utf8");
        const db = JSON.parse(content);
        const roomsFromFile = db.rooms || {};
        const loadedRooms = {};

        for (let id in roomsFromFile) {
            loadedRooms[id] = {
                password: roomsFromFile[id].password,
                messages: Array.isArray(roomsFromFile[id].messages)
                    ? roomsFromFile[id].messages
                    : [],
                clients: [],
            };
        }
        return loadedRooms;
    } catch (err) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ rooms: {} }, null, 2));
        return {};
    }
}

let rooms = loadDatabase();

let saveTimer = null;
function saveDatabaseDebounced() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDatabase, 1000);
}

function saveDatabase() {
    try {
        const data = { rooms: {} };
        for (let id in rooms) {
            if (rooms.hasOwnProperty(id)) {
                data.rooms[id] = {
                    password: rooms[id].password,
                    messages: rooms[id].messages,
                };
            }
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (err) {}
}

const wss = new WebSocket.Server({ port: PORT });

wss.on("connection", (ws) => {
    let currentUser = null;
    let currentRoomId = null;

    ws.on("message", (rawMessage) => {
        let data;
        try {
            data = JSON.parse(rawMessage.toString());
        } catch {
            return;
        }

        switch (data.type) {
            case "join": {
                const { roomId, password, user, avatar } = data;
                if (!roomId || !user) return;

                if (!rooms[roomId]) {
                    rooms[roomId] = {
                        password,
                        messages: [],
                        clients: [],
                    };
                    saveDatabaseDebounced();
                } else if (rooms[roomId].password !== password) {
                    ws.send(JSON.stringify({ type: "error", message: "Sai mật khẩu phòng!" }));
                    return;
                }

                currentUser = { user, avatar, ws };
                currentRoomId = roomId;

                rooms[roomId].clients.push(currentUser);

                ws.send(JSON.stringify({ type: "join_success", roomId }));

                rooms[roomId].messages.forEach((msg) => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
                });

                broadcastToRoom(roomId, {
                    type: "system",
                    message: `${user} đã tham gia`,
                });

                broadcastUsers(roomId);
                break;
            }

            case "chat": {
                if (!currentUser || !currentRoomId || !rooms[currentRoomId]) return;
                if (!data.message) return;

                const now = new Date();
                const chatMsg = {
                    type: "chat",
                    msgId: data.msgId || Date.now(),
                    user: currentUser.user,
                    avatar: currentUser.avatar,
                    message: data.message,
                    replyTo: data.replyTo,
                    time: now.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                    }),
                    date: now.toLocaleDateString("vi-VN"),
                };

                rooms[currentRoomId].messages.push(chatMsg);
                saveDatabaseDebounced();

                broadcastToRoom(currentRoomId, chatMsg);
                break;
            }

            case "recall": {
                if (!currentRoomId || !rooms[currentRoomId]) return;

                const msgs = rooms[currentRoomId].messages;
                const idx = msgs.findIndex((m) => m.msgId === data.msgId);

                if (idx !== -1 && msgs[idx].user === currentUser.user) {
                    msgs[idx].message = "📩 Tin nhắn đã được thu hồi";
                    saveDatabaseDebounced();

                    broadcastToRoom(currentRoomId, {
                        type: "recall",
                        msgId: data.msgId,
                    });
                }
                break;
            }

            case "reaction":
            case "call_signal": {
                if (!currentRoomId || !rooms[currentRoomId]) return;

                data.user = currentUser.user;
                const payload = JSON.stringify(data);

                rooms[currentRoomId].clients.forEach((c) => {
                    if (c.ws.readyState === WebSocket.OPEN && c !== currentUser) {
                        c.ws.send(payload);
                    }
                });
                break;
            }
        }
    });

    ws.on("close", () => {
        if (!currentRoomId || !currentUser || !rooms[currentRoomId]) return;

        rooms[currentRoomId].clients = rooms[currentRoomId].clients.filter(
            (c) => c !== currentUser
        );

        broadcastUsers(currentRoomId);
        broadcastToRoom(currentRoomId, {
            type: "system",
            message: `${currentUser.user} đã rời phòng`,
        });
    });
});

function broadcastToRoom(roomId, data) {
    if (!rooms[roomId]) return;
    const msg = JSON.stringify(data);
    rooms[roomId].clients.forEach((c) => {
        if (c.ws.readyState === WebSocket.OPEN) {
            c.ws.send(msg);
        }
    });
}

function broadcastUsers(roomId) {
    if (!rooms[roomId]) return;
    const users = rooms[roomId].clients.map((c) => ({
        user: c.user,
        avatar: c.avatar,
    }));
    broadcastToRoom(roomId, { type: "users", users });
}

console.log(`🚀 Server chạy tại ws://localhost:${PORT}`);
