const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomPart() {
  let result = "";

  for (let i = 0; i < 3; i++) {
    result += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }

  return result;
}

function generateCode() {
  return `${randomPart()}-${randomPart()}`;
}

function createUniqueCode() {
  let code;

  do {
    code = generateCode();
  } while (rooms.has(code));

  return code;
}

function deleteRoom(code) {
  const room = rooms.get(code);

  if (!room) return;

  room.users.forEach(ws => {
    try {
      ws.send(JSON.stringify({
        type: "room_expired"
      }));
      ws.close();
    } catch {}
  });

  rooms.delete(code);
  console.log(`Комната ${code} удалена`);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8"
  });

  res.end(JSON.stringify({
    app: "Duora",
    status: "online"
  }));
});

const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {

  console.log("Новое подключение");

  ws.on("message", raw => {

    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({
        type: "error",
        message: "Неверный формат данных"
      }));
      return;
    }

    // Создание комнаты
    if (data.type === "create_room") {

      const code = createUniqueCode();

      const room = {
        code,
        users: new Set(),
        createdAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000
      };

      rooms.set(code, room);
      room.users.add(ws);

      ws.roomCode = code;
      ws.role = "owner";

      ws.send(JSON.stringify({
        type: "room_created",
        code,
        expiresAt: room.expiresAt
      }));

      console.log(`Создана комната: ${code}`);

      setTimeout(() => {
        if (rooms.has(code)) {
          deleteRoom(code);
        }
      }, 5 * 60 * 1000);

      return;
    }

    // Подключение по коду
    if (data.type === "join_room") {

      const code = String(data.code || "")
        .toUpperCase()
        .trim();

      const room = rooms.get(code);

      if (!room) {
        ws.send(JSON.stringify({
          type: "join_error",
          message: "Комната не найдена или код уже истёк"
        }));
        return;
      }

      if (Date.now() > room.expiresAt) {
        deleteRoom(code);

        ws.send(JSON.stringify({
          type: "join_error",
          message: "Срок действия кода истёк"
        }));

        return;
      }

      if (room.users.size >= 2) {
        ws.send(JSON.stringify({
          type: "join_error",
          message: "В комнате уже находятся 2 человека"
        }));

        return;
      }

      room.users.add(ws);

      ws.roomCode = code;
      ws.role = "guest";

      ws.send(JSON.stringify({
        type: "joined",
        code
      }));

      room.users.forEach(user => {
        if (user !== ws &&
            user.readyState === WebSocket.OPEN) {

          user.send(JSON.stringify({
            type: "partner_joined"
          }));
        }
      });

      room.users.forEach(user => {
        if (user.readyState === WebSocket.OPEN) {
          user.send(JSON.stringify({
            type: "connected",
            code
          }));
        }
      });

      console.log(`В комнату ${code} вошёл второй человек`);

      return;
    }

    // Сообщения
    if (data.type === "message") {

      const room = rooms.get(ws.roomCode);

      if (!room) return;

      const message = {
        type: "message",
        id: crypto.randomUUID(),
        text: String(data.text || "").slice(0, 2000),
        time: Date.now(),
        from: ws.role
      };

      room.users.forEach(user => {
        if (user.readyState === WebSocket.OPEN) {
          user.send(JSON.stringify(message));
        }
      });

      return;
    }

    // Стикеры
    if (data.type === "sticker") {

      const room = rooms.get(ws.roomCode);

      if (!room) return;

      const sticker = {
        type: "sticker",
        id: crypto.randomUUID(),
        sticker: data.sticker,
        time: Date.now(),
        from: ws.role
      };

      room.users.forEach(user => {
        if (user.readyState === WebSocket.OPEN) {
          user.send(JSON.stringify(sticker));
        }
      });

      return;
    }
  });

  ws.on("close", () => {

    const code = ws.roomCode;

    if (!code) return;

    const room = rooms.get(code);

    if (!room) return;

    room.users.delete(ws);

    room.users.forEach(user => {
      if (user.readyState === WebSocket.OPEN) {
        user.send(JSON.stringify({
          type: "partner_left"
        }));
      }
    });

    if (room.users.size === 0) {
      rooms.delete(code);
      console.log(`Комната ${code} удалена`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Duora server запущен на порту ${PORT}`);
});
