const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

/* ================== CONFIG ================== */
const PORT = 8080;
// TẠO THƯ MỤC DATA RIÊNG BIỆT ĐỂ TRANH LIVE SERVER RELOAD
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "database.json");

/* ================== KIỂM TRA & TẠO THƯ MỤC ================== */
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ rooms: {} }, null, 2));
}
/* ================== LOAD DATABASE ================== */
function loadDatabase() {
  try {
    const content = fs.readFileSync(DATA_FILE, "utf8");
    const db = JSON.parse(content);
    const roomsFromFile = db.rooms || {};
    const loadedRooms = {};

    for (let id in roomsFromFile) {
      loadedRooms[id] = {
        password: roomsFromFile[id].password,
        // Đảm bảo messages luôn là mảng
        messages: Array.isArray(roomsFromFile[id].messages)
          ? roomsFromFile[id].messages
          : [],
        clients: [], // Reset danh sách người kết nối khi server chạy lại
      };
    }
    return loadedRooms;
  } catch (err) {
    console.error("❌ Database lỗi, tạo mới:", err);
    fs.writeFileSync(DATA_FILE, JSON.stringify({ rooms: {} }, null, 2));
    return {};
  }
}

/* ================== BIẾN TOÀN CỤC ================== */
let rooms = loadDatabase();

/* ================== SAVE DATABASE (DEBOUNCE) ================== */
// Cơ chế này giúp server không phải ghi file liên tục mỗi mili-giây
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
          messages: rooms[id].messages, // Chỉ lưu tin nhắn và pass, không lưu clients
        };
      }
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    // console.log("💾 Đã lưu dữ liệu chat.");
  } catch (err) {
    console.error("❌ Lỗi ghi database:", err);
  }
}

/* ================== WEBSOCKET SERVER ================== */
const wss = new WebSocket.Server({ port: PORT });

wss.on("connection", (ws) => {
  // [QUAN TRỌNG] Khai báo biến User Ở ĐÂY để riêng biệt cho từng người
  // Nếu để bên ngoài, người B vào sẽ đổi tên người A thành B.
  let currentUser = null;
  let currentRoomId = null;

  ws.on("message", (rawMessage) => {
    let data;
    try {
      data = JSON.parse(rawMessage.toString());
    } catch (err) {
      console.error("❌ JSON không hợp lệ:", err);
      return;
    }

    switch (data.type) {
      /* ===== JOIN ROOM ===== */
      case "join": {
        const { roomId, password, user, avatar } = data;
        if (!roomId || !user) return;

        // Tạo phòng mới nếu chưa có
        if (!rooms[roomId]) {
          rooms[roomId] = {
            password,
            messages: [],
            clients: [],
          };
          saveDatabaseDebounced();
        } else if (rooms[roomId].password !== password) {
          ws.send(
            JSON.stringify({ type: "error", message: "Sai mật khẩu phòng!" })
          );
          return;
        }

        // Cập nhật thông tin người dùng hiện tại
        currentUser = { user, avatar, ws };
        currentRoomId = roomId;

        // Thêm vào danh sách client của phòng
        rooms[roomId].clients.push(currentUser);

        ws.send(JSON.stringify({ type: "join_success", roomId }));

        // Gửi lịch sử chat
        rooms[roomId].messages.forEach((msg) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
        });

        // Thông báo người mới vào
        /* ===== ĐOẠN MỚI (Chỉ báo cho người khác biết) ===== */
        broadcastToRoom(roomId, {
              type: "system",
             message: `${user} đã tham gia`
           });

        // Duyệt qua danh sách người trong phòng
        rooms[roomId].clients.forEach((c) => {
          // Chỉ gửi nếu kết nối đang mở VÀ KHÔNG PHẢI là chính người vừa vào (currentUser)
          if (c.ws.readyState === WebSocket.OPEN && c !== currentUser) {
            c.ws.send(joinMsg);
          }
        });

        broadcastUsers(roomId);
        break;
      }

      /* ===== CHAT ===== */
      case "chat": {
        if (!currentUser || !currentRoomId || !rooms[currentRoomId]) return;
        if (!data.message) return;

        const now = new Date();
        const chatMsg = {
          type: "chat",
          msgId: data.msgId || Date.now(),
          user: currentUser.user, // Lấy user từ biến cục bộ
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
        saveDatabaseDebounced(); // Lưu file (Nodemon sẽ bỏ qua nhờ file nodemon.json)

        broadcastToRoom(currentRoomId, chatMsg);
        break;
      }

      /* ===== THU HỒI ===== */
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

      /* ===== REACTION / CALL ===== */
      case "reaction":
      case "call_signal": {
        if (!currentRoomId || !rooms[currentRoomId]) return;

        data.user = currentUser.user; // Gắn tên người gửi

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

  /* ===== DISCONNECT ===== */
  ws.on("close", () => {
    if (!currentRoomId || !currentUser || !rooms[currentRoomId]) return;

    // Xóa user khỏi phòng
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

/* ================== UTILS ================== */
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
