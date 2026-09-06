const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

/* =========================================================
   SOCKET.IO
========================================================= */

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },

  // Allows signaling + reasonably sized messages.
  maxHttpBufferSize: 10 * 1024 * 1024,

  pingTimeout: 20000,
  pingInterval: 25000
});


/* =========================================================
   EXPRESS
========================================================= */

app.disable("x-powered-by");

app.use(express.json({
  limit: "1mb"
}));

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    name: "NEXORA",
    status: "online",
    time: new Date().toISOString()
  });
});


/* =========================================================
   ROOM STORAGE

   This is intentionally in-memory for now.

   Later we can move persistent room information to Redis
   when scaling across multiple Render instances.
========================================================= */

const rooms = new Map();


function cleanRoomId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 64);
}


function cleanName(value) {
  const name = String(value || "")
    .trim()
    .replace(/[<>]/g, "")
    .slice(0, 30);

  return name || "Guest";
}


function getRoom(roomId) {

  if (!rooms.has(roomId)) {

    rooms.set(roomId, {

      createdAt: Date.now(),

      users: new Map(),

      media: {
        url: "",
        playing: false,
        currentTime: 0,
        updatedAt: Date.now()
      }

    });

  }

  return rooms.get(roomId);
}


function getRoomUsers(room) {

  return [...room.users.entries()]
    .map(([id, user]) => ({
      id,
      name: user.name,
      joinedAt: user.joinedAt
    }));

}


/* =========================================================
   REMOVE USER
========================================================= */

function leaveCurrentRoom(socket) {

  const roomId =
    socket.data.roomId;

  if (!roomId) return;

  const room =
    rooms.get(roomId);

  if (room) {

    room.users.delete(
      socket.id
    );


    /* Tell remaining clients */

    socket
      .to(roomId)
      .emit(
        "user-left",
        {
          id: socket.id
        }
      );


    /* Send fresh participant list */

    io
      .to(roomId)
      .emit(
        "room-users",
        getRoomUsers(room)
      );


    /*
      Delete completely empty rooms so memory
      doesn't keep growing forever.
    */

    if (
      room.users.size === 0
    ) {

      rooms.delete(roomId);

      console.log(
        `[ROOM REMOVED] ${roomId}`
      );

    }

  }


  try {

    socket.leave(roomId);

  } catch (error) {

    console.warn(
      "Unable to leave room:",
      error.message
    );

  }


  socket.data.roomId = null;
  socket.data.name = null;
}


/* =========================================================
   SOCKET CONNECTION
========================================================= */

io.on(
  "connection",
  (socket) => {

    console.log(
      `[CONNECTED] ${socket.id}`
    );


    /* =====================================================
       JOIN ROOM
    ===================================================== */

    socket.on(
      "join-room",
      (payload = {}, callback) => {

        const respond =
          typeof callback === "function"
            ? callback
            : () => {};


        const roomId =
          cleanRoomId(
            payload.roomId
          );

        const name =
          cleanName(
            payload.name
          );


        if (!roomId) {

          respond({
            ok: false,
            error: "Invalid room ID."
          });

          return;
        }


        /*
          If this socket was previously inside another
          room, remove it first.
        */

        if (
          socket.data.roomId
        ) {

          leaveCurrentRoom(
            socket
          );

        }


        const room =
          getRoom(roomId);


        socket.join(roomId);


        socket.data.roomId =
          roomId;

        socket.data.name =
          name;


        room.users.set(
          socket.id,
          {
            name,
            joinedAt: Date.now()
          }
        );


        console.log(
          `[JOIN] ${name} -> ${roomId}`
        );


        /*
          Return room state directly to the joining user.
        */

        respond({

          ok: true,

          selfId: socket.id,

          roomId,

          users:
            getRoomUsers(room),

          media:
            room.media

        });


        /*
          Tell existing users that somebody joined.

          Existing users will create WebRTC offers toward
          this new participant.
        */

        socket
          .to(roomId)
          .emit(
            "user-joined",
            {
              id: socket.id,
              name
            }
          );


        /*
          Synchronize participant sidebar.
        */

        io
          .to(roomId)
          .emit(
            "room-users",
            getRoomUsers(room)
          );

      }
    );


    /* =====================================================
       WEBRTC SIGNALING

       Offers
       Answers
       ICE candidates
    ===================================================== */

    socket.on(
      "signal",
      (payload = {}) => {

        const target =
          payload.target;

        const data =
          payload.data;


        if (
          !target ||
          !data
        ) {
          return;
        }


        /*
          Don't allow clients to signal themselves.
        */

        if (
          target === socket.id
        ) {
          return;
        }


        io
          .to(target)
          .emit(
            "signal",
            {
              from: socket.id,

              name:
                socket.data.name ||
                "Guest",

              data
            }
          );

      }
    );


    /* =====================================================
       CHAT
    ===================================================== */

    socket.on(
      "chat-message",
      (payload = {}) => {

        const roomId =
          socket.data.roomId;


        if (!roomId) return;


        const text =
          String(
            payload.text || ""
          )
            .trim()
            .slice(0, 2000);


        if (!text) return;


        io
          .to(roomId)
          .emit(
            "chat-message",
            {

              id:
                crypto.randomUUID(),

              senderId:
                socket.id,

              name:
                socket.data.name ||
                "Guest",

              text,

              timestamp:
                Date.now()

            }
          );

      }
    );


    /* =====================================================
       REACTIONS
    ===================================================== */

    socket.on(
      "reaction",
      (payload = {}) => {

        const roomId =
          socket.data.roomId;


        if (!roomId) return;


        const allowedReactions = [
          "❤️",
          "🔥",
          "👏",
          "😂",
          "🎉",
          "👍"
        ];


        if (
          !allowedReactions.includes(
            payload.emoji
          )
        ) {
          return;
        }


        io
          .to(roomId)
          .emit(
            "reaction",
            {

              senderId:
                socket.id,

              name:
                socket.data.name ||
                "Guest",

              emoji:
                payload.emoji

            }
          );

      }
    );


    /* =====================================================
       WATCH TOGETHER — LOAD MEDIA
    ===================================================== */

    socket.on(
      "media-load",
      (payload = {}) => {

        const roomId =
          socket.data.roomId;


        if (!roomId) return;


        const room =
          rooms.get(roomId);


        if (!room) return;


        const url =
          String(
            payload.url || ""
          )
            .trim()
            .slice(0, 2000);


        if (!url) return;


        room.media = {

          url,

          playing: false,

          currentTime: 0,

          updatedAt:
            Date.now()

        };


        /*
          Sender already loads it locally, so send to
          everybody else.
        */

        socket
          .to(roomId)
          .emit(
            "media-load",
            room.media
          );

      }
    );


    /* =====================================================
       WATCH TOGETHER — PLAYBACK STATE

       The current starter frontend doesn't yet use all
       of this, but the backend is prepared for synchronized
       playback.
    ===================================================== */

    socket.on(
      "media-state",
      (payload = {}) => {

        const roomId =
          socket.data.roomId;


        if (!roomId) return;


        const room =
          rooms.get(roomId);


        if (!room) return;


        const currentTime =
          Number(
            payload.currentTime
          );


        room.media.playing =
          Boolean(
            payload.playing
          );


        room.media.currentTime =
          Number.isFinite(
            currentTime
          )
            ? Math.max(
                0,
                currentTime
              )
            : 0;


        room.media.updatedAt =
          Date.now();


        socket
          .to(roomId)
          .emit(
            "media-state",
            room.media
          );

      }
    );


    /* =====================================================
       MANUAL LEAVE
    ===================================================== */

    socket.on(
      "leave-room",
      () => {

        leaveCurrentRoom(
          socket
        );

      }
    );


    /* =====================================================
       DISCONNECT
    ===================================================== */

    socket.on(
      "disconnect",
      (reason) => {

        console.log(
          `[DISCONNECTED] ${socket.id} (${reason})`
        );

        leaveCurrentRoom(
          socket
        );

      }
    );


    socket.on(
      "error",
      (error) => {

        console.error(
          `[SOCKET ERROR] ${socket.id}`,
          error
        );

      }
    );

  }
);


/* =========================================================
   FALLBACK

   Allows normal browser navigation back to the SPA.
========================================================= */

app.use((req, res, next) => {

  /*
    Never intercept Socket.IO's own endpoint.
  */

  if (
    req.path.startsWith(
      "/socket.io/"
    )
  ) {

    return next();

  }


  /*
    If the browser requests a file that doesn't exist,
    don't incorrectly return index.html for it.
  */

  if (
    path.extname(req.path)
  ) {

    return res.status(404).send(
      "Not found"
    );

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
   PROCESS ERROR LOGGING
========================================================= */

process.on(
  "unhandledRejection",
  (reason) => {

    console.error(
      "Unhandled rejection:",
      reason
    );

  }
);


process.on(
  "uncaughtException",
  (error) => {

    console.error(
      "Uncaught exception:",
      error
    );

  }
);


/* =========================================================
   START NEXORA
========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log("");
    console.log(
      "================================"
    );

    console.log(
      "       NEXORA IS ONLINE"
    );

    console.log(
      "================================"
    );

    console.log(
      `Server: http://localhost:${PORT}`
    );

    console.log(
      `Health: http://localhost:${PORT}/health`
    );

    console.log(
      "Socket.IO: ready"
    );

    console.log(
      "WebRTC signaling: ready"
    );

    console.log(
      "================================"
    );

    console.log("");

  }
);