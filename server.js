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

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/* =========================================================
   STORAGE
========================================================= */

const rooms = new Map();

const twoSpaces = new Map();


/* =========================================================
   TURN / ICE
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


function isTurnConfigured() {
  return Boolean(
    process.env.TURN_URL &&
    process.env.TURN_USERNAME &&
    process.env.TURN_CREDENTIAL
  );
}


/* =========================================================
   ICE ENDPOINT

   Used by normal NEXORA + TWO.
========================================================= */

app.get(
  "/api/ice",
  (req, res) => {
    res.set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      iceServers: getIceServers(),

      turnEnabled:
        isTurnConfigured()
    });
  }
);


/* =========================================================
   HEALTH / NETWORK DOCTOR
========================================================= */

app.get(
  "/health",
  (req, res) => {
    res.set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      ok: true,

      app: "NEXORA",

      version: "4.0.0",

      normalRooms:
        rooms.size,

      twoSpaces:
        twoSpaces.size,

      socketConnections:
        io.engine.clientsCount,

      turnConfigured:
        isTurnConfigured(),

      time:
        new Date().toISOString()
    });
  }
);


/* =========================================================
   COMMON HELPERS
========================================================= */

function cleanRoomId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(
      /[^a-z0-9-_]/g,
      ""
    )
    .slice(0, 64);
}


function cleanName(value) {
  return (
    String(value || "")
      .trim()
      .replace(/[<>]/g, "")
      .slice(0, 30) ||
    "Guest"
  );
}


/* =========================================================
   NORMAL NEXORA ROOMS
========================================================= */

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(
      roomId,
      {
        createdAt:
          Date.now(),

        users:
          new Map(),

        media:
          null,

        queue:
          []
      }
    );
  }

  return rooms.get(roomId);
}


function getRoomUsers(room) {
  return [
    ...room.users.entries()
  ].map(
    ([id, user]) => ({
      id,
      name:
        user.name
    })
  );
}


function leaveNormalRoom(socket) {
  const roomId =
    socket.data.roomId;

  if (!roomId) {
    return;
  }

  const room =
    rooms.get(roomId);

  if (room) {
    room.users.delete(
      socket.id
    );

    socket
      .to(roomId)
      .emit(
        "user-left",
        {
          id:
            socket.id
        }
      );

    io
      .to(roomId)
      .emit(
        "room-users",
        getRoomUsers(room)
      );

    if (
      room.users.size === 0
    ) {
      rooms.delete(
        roomId
      );

      console.log(
        `[ROOM CLOSED] ${roomId}`
      );
    }
  }

  try {
    socket.leave(
      roomId
    );
  } catch {}

  socket.data.roomId =
    null;
}


/* =========================================================
   NEXORA TWO
========================================================= */

function getTwoSocketRoom(
  spaceId
) {
  /*
    Prefix prevents collisions between:

    normal room "abc"

    and

    TWO space "abc"
  */

  return `two:${spaceId}`;
}


function createTwoSpace(
  spaceId
) {
  const space = {
    id:
      spaceId,

    createdAt:
      Date.now(),

    users:
      new Map(),

    /*
      Shared presence mode.
    */

    mode:
      "quiet",

    /*
      Shared study state.
    */

    study: {
      running:
        false,

      seconds:
        25 * 60,

      updatedAt:
        Date.now()
    },

    /*
      Current couple cinema item.
    */

    cinema:
      null
  };

  twoSpaces.set(
    spaceId,
    space
  );

  return space;
}


function getTwoSpace(
  spaceId
) {
  return (
    twoSpaces.get(
      spaceId
    ) ||
    createTwoSpace(
      spaceId
    )
  );
}


function getTwoPartner(
  space,
  socketId
) {
  for (
    const [id, user]
    of space.users.entries()
  ) {
    if (
      id !== socketId
    ) {
      return {
        id,
        name:
          user.name
      };
    }
  }

  return null;
}


/* =========================================================
   LEAVE TWO SPACE
========================================================= */

function leaveTwoSpace(
  socket
) {
  const spaceId =
    socket.data.twoSpaceId;

  if (!spaceId) {
    return;
  }

  const space =
    twoSpaces.get(
      spaceId
    );

  const socketRoom =
    getTwoSocketRoom(
      spaceId
    );

  if (space) {
    space.users.delete(
      socket.id
    );

    /*
      Tell the remaining partner.
    */

    socket
      .to(socketRoom)
      .emit(
        "two-partner-left",
        {
          id:
            socket.id,

          name:
            socket.data.twoName ||
            "Partner"
        }
      );

    /*
      Keep an empty space only while somebody
      is still connected.

      Persistent couple spaces should later move
      to a database.
    */

    if (
      space.users.size === 0
    ) {
      twoSpaces.delete(
        spaceId
      );

      console.log(
        `[TWO CLOSED] ${spaceId}`
      );
    }
  }

  try {
    socket.leave(
      socketRoom
    );
  } catch {}

  socket.data.twoSpaceId =
    null;

  socket.data.twoName =
    null;
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
       NORMAL ROOM — JOIN
    ===================================================== */

    socket.on(
      "join-room",
      (
        payload = {},
        callback
      ) => {
        const respond =
          typeof callback ===
          "function"
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
            error:
              "Invalid room ID."
          });

          return;
        }

        /*
          A socket shouldn't simultaneously belong
          to a normal room and TWO.
        */

        leaveTwoSpace(
          socket
        );

        if (
          socket.data.roomId
        ) {
          leaveNormalRoom(
            socket
          );
        }

        const room =
          getRoom(
            roomId
          );

        socket.join(
          roomId
        );

        socket.data.roomId =
          roomId;

        socket.data.name =
          name;

        room.users.set(
          socket.id,
          {
            name,

            joinedAt:
              Date.now()
          }
        );

        respond({
          ok: true,

          selfId:
            socket.id,

          roomId,

          users:
            getRoomUsers(
              room
            ),

          media:
            room.media,

          queue:
            room.queue,

          turnEnabled:
            isTurnConfigured()
        });

        socket
          .to(roomId)
          .emit(
            "user-joined",
            {
              id:
                socket.id,

              name
            }
          );

        io
          .to(roomId)
          .emit(
            "room-users",
            getRoomUsers(
              room
            )
          );

        console.log(
          `[ROOM JOIN] ${name} -> ${roomId}`
        );
      }
    );


    /* =====================================================
       NORMAL WEBRTC SIGNALING
    ===================================================== */

    socket.on(
      "signal",
      (
        payload = {}
      ) => {
        const target =
          String(
            payload.target ||
            ""
          );

        if (
          !target ||
          !payload.data ||
          target ===
            socket.id
        ) {
          return;
        }

        io
          .to(target)
          .emit(
            "signal",
            {
              from:
                socket.id,

              name:
                socket.data.name ||
                "Guest",

              data:
                payload.data
            }
          );
      }
    );


    /* =====================================================
       CHAT
    ===================================================== */

    socket.on(
      "chat-message",
      (
        payload = {}
      ) => {
        const roomId =
          socket.data.roomId;

        if (!roomId) {
          return;
        }

        const text =
          String(
            payload.text ||
            ""
          )
            .trim()
            .slice(
              0,
              2000
            );

        if (!text) {
          return;
        }

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
      (
        payload = {}
      ) => {
        const roomId =
          socket.data.roomId;

        if (!roomId) {
          return;
        }

        const allowed = [
          "❤️",
          "🔥",
          "👏",
          "😂",
          "🎉",
          "👍"
        ];

        if (
          !allowed.includes(
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
       NORMAL MEDIA HUB
    ===================================================== */

    socket.on(
      "media-load",
      (
        payload = {}
      ) => {
        const roomId =
          socket.data.roomId;

        if (!roomId) {
          return;
        }

        const room =
          rooms.get(
            roomId
          );

        if (!room) {
          return;
        }

        const allowedTypes = [
          "youtube",
          "direct",
          "local"
        ];

        if (
          !allowedTypes.includes(
            payload.type
          )
        ) {
          return;
        }

        const media = {
          id:
            String(
              payload.id ||
              crypto.randomUUID()
            ).slice(
              0,
              100
            ),

          type:
            payload.type,

          title:
            String(
              payload.title ||
              "Shared Media"
            ).slice(
              0,
              300
            ),

          playing:
            false,

          currentTime:
            0,

          updatedAt:
            Date.now()
        };


        if (
          payload.type ===
          "youtube"
        ) {
          media.url =
            String(
              payload.url ||
              ""
            ).slice(
              0,
              2000
            );

          media.videoId =
            String(
              payload.videoId ||
              ""
            ).slice(
              0,
              100
            );
        }


        if (
          payload.type ===
          "direct"
        ) {
          media.url =
            String(
              payload.url ||
              ""
            ).slice(
              0,
              4000
            );
        }


        if (
          payload.type ===
          "local"
        ) {
          media.fileName =
            String(
              payload.fileName ||
              ""
            ).slice(
              0,
              300
            );

          media.fileSize =
            Math.max(
              0,
              Number(
                payload.fileSize
              ) ||
              0
            );

          media.fingerprint =
            String(
              payload.fingerprint ||
              ""
            ).slice(
              0,
              128
            );
        }


        room.media =
          media;


        room.queue.push({
          id:
            media.id,

          type:
            media.type,

          title:
            media.title
        });


        if (
          room.queue.length >
          20
        ) {
          room.queue =
            room.queue.slice(
              -20
            );
        }


        socket
          .to(roomId)
          .emit(
            "media-load",
            media
          );


        io
          .to(roomId)
          .emit(
            "media-queue",
            room.queue
          );
      }
    );


    /* =====================================================
       NORMAL MEDIA STATE
    ===================================================== */

    socket.on(
      "media-state",
      (
        payload = {}
      ) => {
        const roomId =
          socket.data.roomId;

        if (!roomId) {
          return;
        }

        const room =
          rooms.get(
            roomId
          );

        if (
          !room ||
          !room.media
        ) {
          return;
        }

        if (
          payload.mediaId &&
          room.media.id &&
          payload.mediaId !==
            room.media.id
        ) {
          return;
        }

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
            {
              mediaId:
                room.media.id,

              type:
                room.media.type,

              playing:
                room.media.playing,

              currentTime:
                room.media.currentTime,

              sentAt:
                Date.now()
            }
          );
      }
    );


    /* =====================================================
       NORMAL LEAVE
    ===================================================== */

    socket.on(
      "leave-room",
      () => {
        leaveNormalRoom(
          socket
        );
      }
    );


    /* =====================================================
       ♡ NEXORA TWO — JOIN
    ===================================================== */

    socket.on(
      "two-join",
      (
        payload = {},
        callback
      ) => {
        const respond =
          typeof callback ===
          "function"
            ? callback
            : () => {};

        const spaceId =
          cleanRoomId(
            payload.spaceId
          );

        const name =
          cleanName(
            payload.name
          );

        if (!spaceId) {
          respond({
            ok: false,

            error:
              "Invalid TWO space."
          });

          return;
        }


        /*
          TWO and normal rooms are intentionally
          separate experiences.
        */

        leaveNormalRoom(
          socket
        );

        if (
          socket.data.twoSpaceId
        ) {
          leaveTwoSpace(
            socket
          );
        }


        const space =
          getTwoSpace(
            spaceId
          );


        /*
          TWO means TWO.

          Reject a third connected participant.
        */

        if (
          space.users.size >= 2
        ) {
          respond({
            ok: false,

            error:
              "This private space already has two people."
          });

          return;
        }


        const existingPartner =
          getTwoPartner(
            space,
            socket.id
          );


        const socketRoom =
          getTwoSocketRoom(
            spaceId
          );


        socket.join(
          socketRoom
        );


        socket.data.twoSpaceId =
          spaceId;

        socket.data.twoName =
          name;


        space.users.set(
          socket.id,
          {
            name,

            joinedAt:
              Date.now()
          }
        );


        respond({
          ok: true,

          selfId:
            socket.id,

          spaceId,

          partner:
            existingPartner,

          mode:
            space.mode,

          study:
            space.study,

          cinema:
            space.cinema,

          turnEnabled:
            isTurnConfigured()
        });


        /*
          Tell existing partner.
        */

        socket
          .to(socketRoom)
          .emit(
            "two-partner-joined",
            {
              id:
                socket.id,

              name
            }
          );


        console.log(
          `[TWO JOIN] ${name} -> ${spaceId} (${space.users.size}/2)`
        );
      }
    );


    /* =====================================================
       ♡ TWO WEBRTC SIGNALING
    ===================================================== */

    socket.on(
      "two-signal",
      (
        payload = {}
      ) => {
        const spaceId =
          socket.data.twoSpaceId;

        if (!spaceId) {
          return;
        }

        const space =
          twoSpaces.get(
            spaceId
          );

        if (!space) {
          return;
        }

        const target =
          String(
            payload.target ||
            ""
          );

        if (
          !target ||
          !payload.data ||
          target ===
            socket.id
        ) {
          return;
        }


        /*
          Security boundary:

          target must actually be the other participant
          in THIS TWO space.
        */

        if (
          !space.users.has(
            target
          )
        ) {
          return;
        }


        io
          .to(target)
          .emit(
            "two-signal",
            {
              from:
                socket.id,

              name:
                socket.data.twoName ||
                "Partner",

              data:
                payload.data
            }
          );
      }
    );


    /* =====================================================
       ♡ TWO TOUCH / PULSE
    ===================================================== */

    socket.on(
      "two-touch",
      (
        payload = {}
      ) => {
        const spaceId =
          socket.data.twoSpaceId;

        if (!spaceId) {
          return;
        }

        const socketRoom =
          getTwoSocketRoom(
            spaceId
          );


        const allowedPatterns = [
          "touch",
          "hold",
          "pulse",
          "shake"
        ];


        const pattern =
          allowedPatterns.includes(
            payload.pattern
          )
            ? payload.pattern
            : "touch";


        socket
          .to(socketRoom)
          .emit(
            "two-touch",
            {
              from:
                socket.id,

              name:
                socket.data.twoName ||
                "Partner",

              pattern,

              timestamp:
                Date.now()
            }
          );
      }
    );


    /* =====================================================
       ♡ TWO PRESENCE MODE
    ===================================================== */

    socket.on(
      "two-mode",
      (
        payload = {}
      ) => {
        const spaceId =
          socket.data.twoSpaceId;

        if (!spaceId) {
          return;
        }

        const space =
          twoSpaces.get(
            spaceId
          );

        if (!space) {
          return;
        }


        const allowedModes = [
          "conversation",
          "quiet",
          "study",
          "cinema",
          "sleep"
        ];


        if (
          !allowedModes.includes(
            payload.mode
          )
        ) {
          return;
        }


        space.mode =
          payload.mode;


        const socketRoom =
          getTwoSocketRoom(
            spaceId
          );


        socket
          .to(socketRoom)
          .emit(
            "two-mode",
            {
              mode:
                space.mode,

              name:
                socket.data.twoName ||
                "Partner",

              timestamp:
                Date.now()
            }
          );
      }
    );


    /* =====================================================
       ♡ TWO STUDY TIMER
    ===================================================== */

    socket.on(
      "two-study",
      (
        payload = {}
      ) => {
        const spaceId =
          socket.data.twoSpaceId;

        if (!spaceId) {
          return;
        }

        const space =
          twoSpaces.get(
            spaceId
          );

        if (!space) {
          return;
        }


        const allowedActions = [
          "start",
          "pause",
          "reset"
        ];


        if (
          !allowedActions.includes(
            payload.action
          )
        ) {
          return;
        }


        let seconds =
          Number(
            payload.seconds
          );


        if (
          !Number.isFinite(
            seconds
          )
        ) {
          seconds =
            25 * 60;
        }


        seconds =
          Math.max(
            0,
            Math.min(
              seconds,
              4 * 60 * 60
            )
          );


        if (
          payload.action ===
          "reset"
        ) {
          seconds =
            25 * 60;

          space.study.running =
            false;
        }


        else if (
          payload.action ===
          "start"
        ) {
          space.study.running =
            true;
        }


        else if (
          payload.action ===
          "pause"
        ) {
          space.study.running =
            false;
        }


        space.study.seconds =
          seconds;

        space.study.updatedAt =
          Date.now();


        const socketRoom =
          getTwoSocketRoom(
            spaceId
          );


        socket
          .to(socketRoom)
          .emit(
            "two-study",
            {
              action:
                payload.action,

              seconds,

              updatedAt:
                space.study.updatedAt
            }
          );
      }
    );


    /* =====================================================
       ♡ TWO CINEMA
    ===================================================== */

    socket.on(
      "two-cinema",
      (
        payload = {}
      ) => {
        const spaceId =
          socket.data.twoSpaceId;

        if (!spaceId) {
          return;
        }

        const space =
          twoSpaces.get(
            spaceId
          );

        if (!space) {
          return;
        }


        const videoId =
          String(
            payload.videoId ||
            ""
          )
            .trim()
            .replace(
              /[^a-zA-Z0-9_-]/g,
              ""
            )
            .slice(
              0,
              32
            );


        if (!videoId) {
          return;
        }


        space.mode =
          "cinema";


        space.cinema = {
          type:
            "youtube",

          videoId,

          playing:
            false,

          currentTime:
            0,

          updatedAt:
            Date.now()
        };


        const socketRoom =
          getTwoSocketRoom(
            spaceId
          );


        socket
          .to(socketRoom)
          .emit(
            "two-cinema",
            {
              videoId,

              timestamp:
                Date.now()
            }
          );


        socket
          .to(socketRoom)
          .emit(
            "two-mode",
            {
              mode:
                "cinema",

              name:
                socket.data.twoName ||
                "Partner",

              timestamp:
                Date.now()
            }
          );
      }
    );


    /* =====================================================
       ♡ TWO CINEMA PLAYBACK SYNC

       This prepares TWO for synchronized
       play/pause/seek.
    ===================================================== */

    socket.on(
      "two-cinema-state",
      (
        payload = {}
      ) => {
        const spaceId =
          socket.data.twoSpaceId;

        if (!spaceId) {
          return;
        }

        const space =
          twoSpaces.get(
            spaceId
          );

        if (
          !space ||
          !space.cinema
        ) {
          return;
        }


        const currentTime =
          Number(
            payload.currentTime
          );


        space.cinema.playing =
          Boolean(
            payload.playing
          );


        space.cinema.currentTime =
          Number.isFinite(
            currentTime
          )
            ? Math.max(
                0,
                currentTime
              )
            : 0;


        space.cinema.updatedAt =
          Date.now();


        socket
          .to(
            getTwoSocketRoom(
              spaceId
            )
          )
          .emit(
            "two-cinema-state",
            {
              playing:
                space.cinema.playing,

              currentTime:
                space.cinema.currentTime,

              sentAt:
                Date.now()
            }
          );
      }
    );


    /* =====================================================
       ♡ TWO LEAVE
    ===================================================== */

    socket.on(
      "two-leave",
      () => {
        leaveTwoSpace(
          socket
        );
      }
    );


    /* =====================================================
       DISCONNECT

       Clean up BOTH possible systems safely.
    ===================================================== */

    socket.on(
      "disconnect",
      (
        reason
      ) => {
        console.log(
          `[DISCONNECTED] ${socket.id} (${reason})`
        );

        leaveNormalRoom(
          socket
        );

        leaveTwoSpace(
          socket
        );
      }
    );
  }
);


/* =========================================================
   SPA FALLBACK
========================================================= */

app.use(
  (
    req,
    res,
    next
  ) => {
    if (
      req.path.startsWith(
        "/socket.io/"
      )
    ) {
      return next();
    }


    /*
      Missing files should remain 404.
    */

    if (
      path.extname(
        req.path
      )
    ) {
      return res
        .status(404)
        .send(
          "Not found"
        );
    }


    /*
      /two and /two/* should resolve to TWO.
    */

    if (
      req.path === "/two" ||
      req.path.startsWith(
        "/two/"
      )
    ) {
      return res.sendFile(
        path.join(
          __dirname,
          "public",
          "two",
          "index.html"
        )
      );
    }


    /*
      Everything else = normal NEXORA.
    */

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);


/* =========================================================
   ERROR LOGGING
========================================================= */

process.on(
  "unhandledRejection",
  (
    reason
  ) => {
    console.error(
      "Unhandled rejection:",
      reason
    );
  }
);


process.on(
  "uncaughtException",
  (
    error
  ) => {
    console.error(
      "Uncaught exception:",
      error
    );
  }
);


/* =========================================================
   START
========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      "              NEXORA 4"
    );

    console.log(
      "=========================================="
    );

    console.log(
      `Normal: http://localhost:${PORT}/`
    );

    console.log(
      `TWO:    http://localhost:${PORT}/two/`
    );

    console.log(
      `Health: http://localhost:${PORT}/health`
    );

    console.log(
      ""
    );

    console.log(
      "Socket.IO:       READY"
    );

    console.log(
      "Normal WebRTC:   READY"
    );

    console.log(
      "NEXORA TWO:      READY"
    );

    console.log(
      "Media Hub:       READY"
    );

    console.log(
      "Network Doctor:  READY"
    );

    console.log(
      `TURN:            ${
        isTurnConfigured()
          ? "CONFIGURED"
          : "NOT CONFIGURED"
      }`
    );

    console.log(
      "=========================================="
    );

    console.log("");
  }
);