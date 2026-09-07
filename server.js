const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 10 * 1024 * 1024,
  pingInterval: 15000,
  pingTimeout: 20000
});

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

/* =========================================================
   TURN / ICE CONFIGURATION
========================================================= */

function getIceServers() {
  const iceServers = [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302"
      ]
    }
  ];

  /*
    Configure these as Render Environment Variables:

    TURN_URL
    TURN_USERNAME
    TURN_CREDENTIAL

    Example TURN_URL:
    turn:turn.example.com:3478

    Never put real TURN credentials in GitHub.
  */

  if (
    process.env.TURN_URL &&
    process.env.TURN_USERNAME &&
    process.env.TURN_CREDENTIAL
  ) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }

  return iceServers;
}

app.get("/api/ice", (req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    iceServers: getIceServers(),
    turnEnabled: Boolean(
      process.env.TURN_URL &&
      process.env.TURN_USERNAME &&
      process.env.TURN_CREDENTIAL
    )
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    app: "NEXORA",
    version: "3.0.0",
    socketConnections: io.engine.clientsCount,
    rooms: rooms.size,
    turnConfigured: Boolean(
      process.env.TURN_URL &&
      process.env.TURN_USERNAME &&
      process.env.TURN_CREDENTIAL
    ),
    time: new Date().toISOString()
  });
});

/* =========================================================
   HELPERS
========================================================= */

function cleanRoomId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 64);
}

function cleanName(value) {
  return (
    String(value || "")
      .trim()
      .replace(/[<>]/g, "")
      .slice(0, 30) || "Guest"
  );
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      users: new Map(),
      media: null,
      queue: []
    });
  }

  return rooms.get(roomId);
}

function getUsers(room) {
  return [...room.users.entries()].map(([id, user]) => ({
    id,
    name: user.name
  }));
}

function leaveRoom(socket) {
  const roomId = socket.data.roomId;

  if (!roomId) return;

  const room = rooms.get(roomId);

  if (room) {
    room.users.delete(socket.id);

    socket.to(roomId).emit("user-left", {
      id: socket.id
    });

    io.to(roomId).emit(
      "room-users",
      getUsers(room)
    );

    if (room.users.size === 0) {
      rooms.delete(roomId);
    }
  }

  try {
    socket.leave(roomId);
  } catch {}

  socket.data.roomId = null;
  socket.data.name = null;
}

/* =========================================================
   SOCKET.IO
========================================================= */

io.on("connection", (socket) => {
  console.log("[CONNECTED]", socket.id);

  socket.on("join-room", (payload = {}, callback) => {
    const respond =
      typeof callback === "function"
        ? callback
        : () => {};

    const roomId = cleanRoomId(payload.roomId);
    const name = cleanName(payload.name);

    if (!roomId) {
      respond({
        ok: false,
        error: "Invalid room ID."
      });

      return;
    }

    if (socket.data.roomId) {
      leaveRoom(socket);
    }

    const room = getRoom(roomId);

    socket.join(roomId);

    socket.data.roomId = roomId;
    socket.data.name = name;

    room.users.set(socket.id, {
      name,
      joinedAt: Date.now()
    });

    respond({
      ok: true,
      selfId: socket.id,
      roomId,
      users: getUsers(room),
      media: room.media,
      queue: room.queue,
      turnEnabled: getIceServers().length > 1
    });

    socket.to(roomId).emit("user-joined", {
      id: socket.id,
      name
    });

    io.to(roomId).emit(
      "room-users",
      getUsers(room)
    );
  });

  /* WebRTC signaling */

  socket.on("signal", (payload = {}) => {
    if (!payload.target || !payload.data) return;
    if (payload.target === socket.id) return;

    io.to(payload.target).emit("signal", {
      from: socket.id,
      name: socket.data.name || "Guest",
      data: payload.data
    });
  });

  /* Chat */

  socket.on("chat-message", (payload = {}) => {
    const roomId = socket.data.roomId;

    if (!roomId) return;

    const text = String(payload.text || "")
      .trim()
      .slice(0, 2000);

    if (!text) return;

    io.to(roomId).emit("chat-message", {
      id: crypto.randomUUID(),
      senderId: socket.id,
      name: socket.data.name || "Guest",
      text,
      timestamp: Date.now()
    });
  });

  /* Reactions */

  socket.on("reaction", (payload = {}) => {
    const roomId = socket.data.roomId;

    if (!roomId) return;

    const allowed = [
      "❤️",
      "🔥",
      "👏",
      "😂",
      "🎉",
      "👍"
    ];

    if (!allowed.includes(payload.emoji)) return;

    io.to(roomId).emit("reaction", {
      senderId: socket.id,
      name: socket.data.name || "Guest",
      emoji: payload.emoji
    });
  });

  /* =======================================================
     MEDIA HUB
  ======================================================= */

  socket.on("media-load", (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    const allowedTypes = [
      "youtube",
      "direct",
      "local"
    ];

    if (!allowedTypes.includes(payload.type)) return;

    const media = {
      id: String(
        payload.id || crypto.randomUUID()
      ).slice(0, 100),

      type: payload.type,

      title: String(
        payload.title || "Shared Media"
      ).slice(0, 300),

      playing: false,
      currentTime: 0,
      updatedAt: Date.now()
    };

    if (payload.type === "youtube") {
      media.url = String(payload.url || "").slice(0, 2000);
      media.videoId = String(payload.videoId || "").slice(0, 100);
    }

    if (payload.type === "direct") {
      media.url = String(payload.url || "").slice(0, 4000);
    }

    if (payload.type === "local") {
      media.fileName = String(payload.fileName || "").slice(0, 300);
      media.fileSize = Math.max(0, Number(payload.fileSize) || 0);
      media.fingerprint = String(payload.fingerprint || "").slice(0, 128);
    }

    room.media = media;

    room.queue.push({
      id: media.id,
      type: media.type,
      title: media.title
    });

    if (room.queue.length > 20) {
      room.queue = room.queue.slice(-20);
    }

    socket.to(roomId).emit(
      "media-load",
      media
    );

    io.to(roomId).emit(
      "media-queue",
      room.queue
    );
  });

  socket.on("media-state", (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);

    if (!room?.media) return;

    if (
      payload.mediaId &&
      room.media.id &&
      payload.mediaId !== room.media.id
    ) {
      return;
    }

    const currentTime =
      Number(payload.currentTime);

    room.media.playing =
      Boolean(payload.playing);

    room.media.currentTime =
      Number.isFinite(currentTime)
        ? Math.max(0, currentTime)
        : 0;

    room.media.updatedAt =
      Date.now();

    socket.to(roomId).emit(
      "media-state",
      {
        mediaId: room.media.id,
        type: room.media.type,
        playing: room.media.playing,
        currentTime: room.media.currentTime,
        sentAt: Date.now()
      }
    );
  });

  socket.on("leave-room", () => {
    leaveRoom(socket);
  });

  socket.on("disconnect", (reason) => {
    console.log(
      "[DISCONNECTED]",
      socket.id,
      reason
    );

    leaveRoom(socket);
  });
});

/* =========================================================
   SPA FALLBACK
========================================================= */

app.use((req, res, next) => {
  if (req.path.startsWith("/socket.io/")) {
    return next();
  }

  if (path.extname(req.path)) {
    return res.status(404).send("Not found");
  }

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================================================
   START
========================================================= */

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("======================================");
  console.log("       NEXORA CONNECTION ENGINE");
  console.log("======================================");
  console.log(`Local:  http://localhost:${PORT}`);
  console.log("Socket: READY");
  console.log("WebRTC: READY");
  console.log(
    `TURN:   ${
      getIceServers().length > 1
        ? "CONFIGURED"
        : "NOT CONFIGURED"
    }`
  );
  console.log("======================================");
});