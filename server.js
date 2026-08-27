const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

// Активные комнаты
const rooms = new Map();

// Код: XXX-XXX
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomPart() {
  let result = "";

  for (let i = 0; i < 3; i++) {
    result += ALPHABET[
      crypto.randomInt(0, ALPHABET.length)
    ];
  }

  return result;
}

function generateCode() {
  return `${randomPart()}-${randomPart()}`;
}

// Создание уникального кода
function createUniqueCode() {
  let code;

  do {
    code = generateCode();
  } while (rooms.has(code));

  return code;
}

// Удаление комнаты
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


// Обычный HTTP-сервер
const server = http.createServer((req, res) => {

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8"
  });

  res.end(JSON.stringify({
    app: "Duora",
    status: "online"
  }));
});


// WebSocket
const wss = new WebSocket.Server({
  server
});


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


    // =====================================
    // СОЗДАТЬ КОМНАТУ
    // =====================================

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


      // Автоматическое удаление через 5 минут
      setTimeout(() => {

        if (rooms.has(code)) {
          deleteRoom(code);
        }

      }, 5 * 60 * 1000);


      return;
    }


    // =====================================
    // ПРИСОЕДИНИТЬСЯ
    // =====================================

    if (data.type === "join_room") {

      const code =
        String(data.code || "")
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


      // Проверка времени
      if (Date.now() > room.expiresAt) {

        deleteRoom(code);

        ws.send(JSON.stringify({
          type: "join_error",
          message: "Срок действия кода истёк"
        }));

        return;
      }


      // Максимум 2 человека
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


      // Сообщаем вошедшему
      ws.send(JSON.stringify({
        type: "joined",
        code
      }));


      // Сообщаем первому участнику
      room.users.forEach(user => {

        if (user !== ws) {

          user.send(JSON.stringify({
            type: "partner_joined"
          }));

        }

      });


      console.log(
        `К комнате ${code} подключился второй человек`
      );


      // Комната теперь подключена
      room.users.forEach(user => {

        user.send(JSON.stringify({
          type: "connected"
        }));

      });


      return;
    }


    // =====================================
    // СООБЩЕНИЕ
    // =====================================

    if (data.type === "message") {

      const room =
        rooms.get(ws.roomCode);


      if (!room) {

        ws.send(JSON.stringify({
          type: "error",
          message: "Комната не существует"
        }));

        return;
      }


      const message = {
        type: "message",
        id: crypto.randomUUID(),
        text: String(data.text || "").slice(0, 2000),
        time: Date.now(),
        from: ws.role
      };


      // Отправляем обоим
      room.users.forEach(user => {

        if (user.readyState === WebSocket.OPEN) {

          user.send(JSON.stringify(message));

        }

      });


      return;
    }


    // =====================================
    // СТИКЕР
    // =====================================

    if (data.type === "sticker") {

      const room =
        rooms.get(ws.roomCode);


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


    // =====================================
    // PING
    // =====================================

    if (data.type === "ping") {

      ws.send(JSON.stringify({
        type: "pong",
        time: Date.now()
      }));

      return;
    }

  });


  // Отключение
  ws.on("close", () => {

    const code = ws.roomCode;

    if (!code) return;


    const room = rooms.get(code);

    if (!room) return;


    room.users.delete(ws);


    // Сообщаем оставшемуся участнику
    room.users.forEach(user => {

      if (user.readyState === WebSocket.OPEN) {

        user.send(JSON.stringify({
          type: "partner_left"
        }));

      }

    });


    console.log(
      `Пользователь вышел из комнаты ${code}`
    );


    // Если никого не осталось —
    // удаляем комнату
    if (room.users.size === 0) {

      rooms.delete(code);

      console.log(
        `Комната ${code} удалена`
      );

    }

  });

});


// Запуск
server.listen(PORT, () => {

  console.log(
    `Duora server запущен на порту ${PORT}`
  );

});
