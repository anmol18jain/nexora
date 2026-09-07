const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
  timeout: 10000
});

const $ = (id) => document.getElementById(id);

/* =========================================================
   BASIC ELEMENTS
========================================================= */

const joinScreen = $("joinScreen");
const app = $("app");

const nameInput = $("nameInput");
const roomInput = $("roomInput");
const randomRoomButton = $("randomRoomButton");
const joinButton = $("joinButton");

const roomLabel = $("roomLabel");
const peopleCount = $("peopleCount");
const peopleList = $("peopleList");

const emptyStage = $("emptyStage");
const videoGrid = $("videoGrid");

const micButton = $("micButton");
const cameraButton = $("cameraButton");
const screenButton = $("screenButton");
const watchButton = $("watchButton");
const leaveButton = $("leaveButton");

const copyButton = $("copyButton");
const sidebarButton = $("sidebarButton");
const sidePanel = $("sidePanel");

const messageForm = $("messageForm");
const messageInput = $("messageInput");
const messages = $("messages");

const fileInput = $("fileInput");
const filesList = $("filesList");

const reactionButton = $("reactionButton");
const reactionMenu = $("reactionMenu");
const reactionLayer = $("reactionLayer");

const connectionDot = $("connectionDot");
const connectionText = $("connectionText");
const toastElement = $("toast");

/* MEDIA */

const watchDialog = $("watchDialog");
const closeMediaHubButton = $("closeMediaHubButton");

const mediaUrlInput = $("mediaUrlInput");
const loadMediaButton = $("loadMediaButton");

const directVideoUrl = $("directVideoUrl");
const loadDirectVideoButton = $("loadDirectVideoButton");

const localCinemaInput = $("localCinemaInput");
const selectedLocalFile = $("selectedLocalFile");
const startLocalCinemaButton = $("startLocalCinemaButton");

const watchStage = $("watchStage");
const youtubeContainer = $("youtubeContainer");
const sharedVideoPlayer = $("sharedVideoPlayer");

const localCinemaWaiting = $("localCinemaWaiting");
const localWaitingText = $("localWaitingText");
const localJoinInput = $("localJoinInput");

const watchTypeBadge = $("watchTypeBadge");
const watchTitle = $("watchTitle");
const watchStatus = $("watchStatus");

const syncMediaButton = $("syncMediaButton");
const fullscreenMediaButton = $("fullscreenMediaButton");
const openMediaHubButton = $("openMediaHubButton");
const closeWatchButton = $("closeWatchButton");

const cinemaSyncText = $("cinemaSyncText");
const cinemaTime = $("cinemaTime");

const mediaQueue = $("mediaQueue");

/* =========================================================
   STATE
========================================================= */

let roomId = "";
let displayName = "";

let localStream = null;
let screenStream = null;

let micEnabled = true;
let cameraEnabled = true;
let sharingScreen = false;

let rtcConfiguration = {
  iceServers: []
};

let turnEnabled = false;

let currentQuality = "HD";

let selectedCinemaFile = null;
let localCinemaUrl = null;

let currentMedia = null;

let youtubePlayer = null;
let youtubeReady = false;

let applyingRemoteState = false;

const peers = new Map();
const peerNames = new Map();
const incomingFiles = new Map();

/* =========================================================
   HELPERS
========================================================= */

function toast(text) {
  toastElement.textContent = text;
  toastElement.classList.add("show");

  clearTimeout(toastElement._timer);

  toastElement._timer = setTimeout(() => {
    toastElement.classList.remove("show");
  }, 2200);
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function randomRoomCode() {
  const a = Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase();

  const b = Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase();

  return `${a}-${b}`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB"];

  const i = Math.min(
    units.length - 1,
    Math.floor(
      Math.log(bytes) /
      Math.log(1024)
    )
  );

  return (
    (bytes / Math.pow(1024, i)).toFixed(1) +
    " " +
    units[i]
  );
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return "00:00";
  }

  seconds = Math.max(
    0,
    Math.floor(seconds)
  );

  const h = Math.floor(seconds / 3600);

  const m = Math.floor(
    (seconds % 3600) / 60
  );

  const s = seconds % 60;

  if (h) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* =========================================================
   ICE CONFIG
========================================================= */

async function loadIceConfiguration() {
  try {
    const response = await fetch(
      "/api/ice",
      {
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(
        "ICE configuration unavailable"
      );
    }

    const data = await response.json();

    rtcConfiguration = {
      iceServers:
        Array.isArray(data.iceServers)
          ? data.iceServers
          : []
    };

    turnEnabled =
      Boolean(data.turnEnabled);

    console.log(
      "NEXORA ICE:",
      turnEnabled
        ? "STUN + TURN"
        : "STUN only"
    );
  }

  catch (error) {
    console.warn(error);

    rtcConfiguration = {
      iceServers: [
        {
          urls:
            "stun:stun.l.google.com:19302"
        }
      ]
    };

    turnEnabled = false;
  }
}

/* =========================================================
   INITIAL URL
========================================================= */

const params =
  new URLSearchParams(
    location.search
  );

if (params.get("room")) {
  roomInput.value =
    params.get("room");
}

const savedName =
  localStorage.getItem(
    "nexora-name"
  );

if (savedName) {
  nameInput.value =
    savedName;
}

randomRoomButton.addEventListener(
  "click",
  () => {
    roomInput.value =
      randomRoomCode();
  }
);

/* =========================================================
   JOIN
========================================================= */

joinButton.addEventListener(
  "click",
  joinRoom
);

async function joinRoom() {
  displayName =
    nameInput.value.trim() ||
    "Guest";

  roomId =
    roomInput.value
      .trim()
      .toLowerCase()
      .replace(
        /[^a-z0-9-_]/g,
        ""
      );

  if (!roomId) {
    roomId =
      randomRoomCode()
        .toLowerCase();
  }

  joinButton.disabled = true;
  joinButton.textContent =
    "Preparing connection...";

  await loadIceConfiguration();

  try {
    localStream =
      await navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },

          video: {
            width: {
              ideal: 1280,
              max: 1920
            },

            height: {
              ideal: 720,
              max: 1080
            },

            frameRate: {
              ideal: 30,
              max: 30
            }
          }
        });
  }

  catch (error) {
    console.warn(
      "Video unavailable:",
      error
    );

    try {
      localStream =
        await navigator.mediaDevices
          .getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true
            },

            video: false
          });

      cameraEnabled = false;

      cameraButton.classList.add(
        "off"
      );
    }

    catch {
      toast(
        "Please allow microphone access."
      );

      joinButton.disabled = false;

      joinButton.textContent =
        "Enter Room";

      return;
    }
  }

  localStorage.setItem(
    "nexora-name",
    displayName
  );

  history.replaceState(
    {},
    "",
    `/?room=${encodeURIComponent(roomId)}`
  );

  socket.emit(
    "join-room",
    {
      roomId,
      name: displayName
    },

    (response) => {
      if (!response?.ok) {
        toast(
          response?.error ||
          "Unable to join."
        );

        joinButton.disabled = false;

        joinButton.textContent =
          "Enter Room";

        return;
      }

      joinScreen.classList.add(
        "hidden"
      );

      app.classList.remove(
        "hidden"
      );

      roomLabel.textContent =
        `Room • ${roomId}`;

      addVideoCard(
        socket.id,
        `${displayName} (You)`,
        localStream,
        true
      );

      updateUsers(
        response.users || []
      );

      renderQueue(
        response.queue || []
      );

      if (response.media?.type) {
        openRemoteMedia(
          response.media
        );
      }

      setConnectionStatus(
        turnEnabled
          ? "Protected"
          : "Connected",
        true
      );

      joinButton.disabled = false;

      joinButton.textContent =
        "Enter Room";

      toast(
        turnEnabled
          ? "Connected • TURN ready"
          : "Connected • STUN"
      );
    }
  );
}

/* =========================================================
   WEBRTC CONNECTION ENGINE
========================================================= */

function createPeer(
  peerId,
  name = "Guest"
) {
  if (peers.has(peerId)) {
    return peers.get(peerId);
  }

  peerNames.set(peerId, name);

  const pc =
    new RTCPeerConnection(
      rtcConfiguration
    );

  const peer = {
    pc,
    channel: null,

    stats: {
      previousBytes: 0,
      previousTimestamp: 0,

      rtt: null,
      jitter: null,
      packetLoss: null,
      bitrate: null,
      candidateType: "unknown"
    },

    reconnectTimer: null
  };

  peers.set(peerId, peer);

  if (localStream) {
    localStream
      .getTracks()
      .forEach((track) => {
        pc.addTrack(
          track,
          localStream
        );
      });
  }

  pc.onicecandidate =
    (event) => {
      if (!event.candidate) return;

      socket.emit(
        "signal",
        {
          target: peerId,

          data: {
            type: "candidate",
            candidate:
              event.candidate
          }
        }
      );
    };

  pc.ontrack =
    (event) => {
      const stream =
        event.streams[0];

      if (!stream) return;

      addVideoCard(
        peerId,
        peerNames.get(peerId) ||
          "Guest",
        stream
      );
    };

  pc.ondatachannel =
    (event) => {
      setupDataChannel(
        peerId,
        event.channel
      );
    };

  pc.oniceconnectionstatechange =
    () => {
      const state =
        pc.iceConnectionState;

      console.log(
        "ICE",
        peerId,
        state
      );

      if (
        state === "connected" ||
        state === "completed"
      ) {
        clearTimeout(
          peer.reconnectTimer
        );

        setConnectionStatus(
          "Connected",
          true
        );
      }

      if (
        state === "disconnected"
      ) {
        setConnectionStatus(
          "Recovering...",
          false
        );

        clearTimeout(
          peer.reconnectTimer
        );

        /*
          Avoid immediately restarting ICE for a tiny
          Wi-Fi hiccup.
        */

        peer.reconnectTimer =
          setTimeout(() => {
            if (
              pc.iceConnectionState ===
              "disconnected"
            ) {
              restartPeerIce(
                peerId
              );
            }
          }, 2500);
      }

      if (
        state === "failed"
      ) {
        restartPeerIce(
          peerId
        );
      }
    };

  pc.onconnectionstatechange =
    () => {
      if (
        pc.connectionState ===
        "failed"
      ) {
        restartPeerIce(
          peerId
        );
      }
    };

  return peer;
}

/* =========================================================
   ICE RESTART
========================================================= */

async function restartPeerIce(
  peerId
) {
  const peer =
    peers.get(peerId);

  if (!peer) return;

  const pc = peer.pc;

  if (
    pc.signalingState ===
    "closed"
  ) {
    return;
  }

  console.log(
    "NEXORA ICE restart:",
    peerId
  );

  setConnectionStatus(
    "Repairing connection...",
    false
  );

  try {
    pc.restartIce();

    /*
      The existing participant generates a restart offer.
    */

    const offer =
      await pc.createOffer({
        iceRestart: true
      });

    await pc.setLocalDescription(
      offer
    );

    socket.emit(
      "signal",
      {
        target: peerId,

        data: {
          type: "offer",
          sdp:
            pc.localDescription,
          iceRestart: true
        }
      }
    );
  }

  catch (error) {
    console.error(
      "ICE restart failed:",
      error
    );
  }
}

/* =========================================================
   OFFER
========================================================= */

async function createOffer(
  peerId
) {
  const peer =
    createPeer(
      peerId,
      peerNames.get(peerId)
    );

  if (!peer.channel) {
    const channel =
      peer.pc.createDataChannel(
        "nexora-data",
        {
          ordered: true
        }
      );

    setupDataChannel(
      peerId,
      channel
    );
  }

  const offer =
    await peer.pc.createOffer();

  await peer.pc.setLocalDescription(
    offer
  );

  socket.emit(
    "signal",
    {
      target: peerId,

      data: {
        type: "offer",
        sdp:
          peer.pc.localDescription
      }
    }
  );
}

/* =========================================================
   SIGNALING
========================================================= */

socket.on(
  "user-joined",
  async ({ id, name }) => {
    peerNames.set(id, name);

    try {
      await createOffer(id);
    }

    catch (error) {
      console.error(error);
    }
  }
);

socket.on(
  "signal",
  async ({
    from,
    name,
    data
  }) => {
    try {
      peerNames.set(
        from,
        name || "Guest"
      );

      const peer =
        createPeer(
          from,
          name
        );

      const pc = peer.pc;

      if (
        data.type === "offer"
      ) {
        await pc.setRemoteDescription(
          data.sdp
        );

        const answer =
          await pc.createAnswer();

        await pc.setLocalDescription(
          answer
        );

        socket.emit(
          "signal",
          {
            target: from,

            data: {
              type: "answer",
              sdp:
                pc.localDescription
            }
          }
        );
      }

      else if (
        data.type === "answer"
      ) {
        await pc.setRemoteDescription(
          data.sdp
        );
      }

      else if (
        data.type === "candidate"
      ) {
        if (data.candidate) {
          await pc.addIceCandidate(
            data.candidate
          );
        }
      }
    }

    catch (error) {
      console.error(
        "Signaling:",
        error
      );
    }
  }
);

socket.on(
  "user-left",
  ({ id }) => {
    removePeer(id);
  }
);

socket.on(
  "room-users",
  updateUsers
);

/* =========================================================
   VIDEO
========================================================= */

function addVideoCard(
  id,
  name,
  stream,
  muted = false
) {
  let card =
    document.querySelector(
      `[data-video-id="${id}"]`
    );

  if (!card) {
    card =
      document.createElement(
        "div"
      );

    card.className =
      "video-card";

    card.dataset.videoId =
      id;

    const video =
      document.createElement(
        "video"
      );

    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;

    const label =
      document.createElement(
        "div"
      );

    label.className =
      "video-name";

    label.textContent =
      name;

    card.append(
      video,
      label
    );

    videoGrid.appendChild(
      card
    );
  }

  const video =
    card.querySelector("video");

  video.srcObject =
    stream;

  emptyStage.classList.add(
    "hidden"
  );
}

function removePeer(peerId) {
  const peer =
    peers.get(peerId);

  if (peer) {
    clearTimeout(
      peer.reconnectTimer
    );

    try {
      peer.channel?.close();
    } catch {}

    try {
      peer.pc.close();
    } catch {}
  }

  peers.delete(peerId);
  peerNames.delete(peerId);

  document
    .querySelector(
      `[data-video-id="${peerId}"]`
    )
    ?.remove();
}

/* =========================================================
   USERS
========================================================= */

function updateUsers(users = []) {
  peopleCount.textContent =
    users.length;

  peopleList.innerHTML = "";

  users.forEach((user) => {
    const element =
      document.createElement(
        "div"
      );

    element.className =
      "person";

    const initial =
      (user.name || "?")
        .charAt(0)
        .toUpperCase();

    element.innerHTML = `
      <div class="avatar">
        ${escapeHtml(initial)}
      </div>

      <div class="person-name">
        ${escapeHtml(user.name)}
        ${
          user.id === socket.id
            ? " (You)"
            : ""
        }
      </div>

      <span class="person-status"></span>
    `;

    peopleList.appendChild(
      element
    );
  });
}

/* =========================================================
   ADAPTIVE CONNECTION STATISTICS
========================================================= */

async function collectNetworkStats() {
  if (peers.size === 0) {
    return;
  }

  const all = [];

  for (
    const [peerId, peer]
    of peers.entries()
  ) {
    try {
      const reports =
        await peer.pc.getStats();

      let inbound = null;
      let candidatePair = null;

      reports.forEach((report) => {
        if (
          report.type ===
            "inbound-rtp" &&
          report.kind ===
            "video"
        ) {
          inbound = report;
        }

        if (
          report.type ===
            "candidate-pair" &&
          report.state ===
            "succeeded" &&
          report.nominated
        ) {
          candidatePair =
            report;
        }
      });

      const stats =
        peer.stats;

      if (candidatePair) {
        if (
          Number.isFinite(
            candidatePair
              .currentRoundTripTime
          )
        ) {
          stats.rtt =
            candidatePair
              .currentRoundTripTime *
            1000;
        }
      }

      if (inbound) {
        if (
          Number.isFinite(
            inbound.jitter
          )
        ) {
          stats.jitter =
            inbound.jitter *
            1000;
        }

        const lost =
          Number(
            inbound.packetsLost ||
            0
          );

        const received =
          Number(
            inbound.packetsReceived ||
            0
          );

        const total =
          lost + received;

        stats.packetLoss =
          total > 0
            ? Math.max(
                0,
                lost / total * 100
              )
            : 0;

        const bytes =
          Number(
            inbound.bytesReceived ||
            0
          );

        const timestamp =
          Number(
            inbound.timestamp ||
            0
          );

        if (
          stats.previousTimestamp &&
          timestamp >
            stats.previousTimestamp
        ) {
          const seconds =
            (
              timestamp -
              stats.previousTimestamp
            ) / 1000;

          stats.bitrate =
            (
              bytes -
              stats.previousBytes
            ) *
            8 /
            seconds /
            1000;
        }

        stats.previousBytes =
          bytes;

        stats.previousTimestamp =
          timestamp;
      }

      all.push(stats);
    }

    catch (error) {
      console.warn(
        "getStats failed:",
        peerId,
        error
      );
    }
  }

  evaluateNetwork(all);
}

/* =========================================================
   NETWORK QUALITY ENGINE
========================================================= */

function evaluateNetwork(
  stats
) {
  if (!stats.length) return;

  const rtts =
    stats
      .map((s) => s.rtt)
      .filter(Number.isFinite);

  const losses =
    stats
      .map((s) => s.packetLoss)
      .filter(Number.isFinite);

  const jitters =
    stats
      .map((s) => s.jitter)
      .filter(Number.isFinite);

  const avg = (values) =>
    values.length
      ? values.reduce(
          (a, b) => a + b,
          0
        ) / values.length
      : 0;

  const rtt = avg(rtts);
  const loss = avg(losses);
  const jitter = avg(jitters);

  let quality = "Excellent";

  if (
    loss > 8 ||
    rtt > 600 ||
    jitter > 100
  ) {
    quality = "Poor";
  }

  else if (
    loss > 4 ||
    rtt > 350 ||
    jitter > 60
  ) {
    quality = "Weak";
  }

  else if (
    loss > 1.5 ||
    rtt > 180 ||
    jitter > 30
  ) {
    quality = "Good";
  }

  updateAdaptiveQuality(
    quality
  );

  const latencyText =
    rtt
      ? ` • ${Math.round(rtt)}ms`
      : "";

  connectionText.textContent =
    `${quality}${latencyText}`;

  connectionDot.style.background =
    quality === "Poor"
      ? "#ff4e70"
      : quality === "Weak"
        ? "#ffb84d"
        : "#43e6a5";
}

/* =========================================================
   SMART VIDEO QUALITY
========================================================= */

async function updateAdaptiveQuality(
  networkQuality
) {
  let desired;

  if (
    networkQuality === "Poor"
  ) {
    desired = "LOW";
  }

  else if (
    networkQuality === "Weak"
  ) {
    desired = "SD";
  }

  else {
    desired = "HD";
  }

  if (
    desired === currentQuality
  ) {
    return;
  }

  currentQuality = desired;

  for (
    const peer
    of peers.values()
  ) {
    const sender =
      peer.pc
        .getSenders()
        .find(
          (sender) =>
            sender.track?.kind ===
            "video"
        );

    if (!sender) continue;

    try {
      const parameters =
        sender.getParameters();

      if (!parameters.encodings) {
        parameters.encodings = [{}];
      }

      if (desired === "HD") {
        parameters.encodings[0]
          .maxBitrate =
          1_500_000;

        parameters.encodings[0]
          .scaleResolutionDownBy =
          1;
      }

      else if (
        desired === "SD"
      ) {
        parameters.encodings[0]
          .maxBitrate =
          650_000;

        parameters.encodings[0]
          .scaleResolutionDownBy =
          1.5;
      }

      else {
        parameters.encodings[0]
          .maxBitrate =
          250_000;

        parameters.encodings[0]
          .scaleResolutionDownBy =
          2.5;
      }

      await sender.setParameters(
        parameters
      );
    }

    catch (error) {
      console.warn(
        "Adaptive bitrate:",
        error
      );
    }
  }
}

setInterval(
  collectNetworkStats,
  3000
);

/* =========================================================
   MIC / CAMERA
========================================================= */

micButton.addEventListener(
  "click",
  () => {
    micEnabled =
      !micEnabled;

    localStream
      ?.getAudioTracks()
      .forEach((track) => {
        track.enabled =
          micEnabled;
      });

    micButton.classList.toggle(
      "off",
      !micEnabled
    );

    micButton.textContent =
      micEnabled
        ? "🎙"
        : "🔇";
  }
);

cameraButton.addEventListener(
  "click",
  () => {
    cameraEnabled =
      !cameraEnabled;

    localStream
      ?.getVideoTracks()
      .forEach((track) => {
        track.enabled =
          cameraEnabled;
      });

    cameraButton.classList.toggle(
      "off",
      !cameraEnabled
    );

    cameraButton.textContent =
      cameraEnabled
        ? "📹"
        : "🚫";
  }
);

/* =========================================================
   SCREEN SHARE
========================================================= */

screenButton.addEventListener(
  "click",
  async () => {
    if (sharingScreen) {
      await stopScreenShare();
      return;
    }

    if (
      !navigator.mediaDevices
        ?.getDisplayMedia
    ) {
      toast(
        "Screen sharing isn't supported here."
      );

      return;
    }

    try {
      screenStream =
        await navigator.mediaDevices
          .getDisplayMedia({
            video: {
              frameRate: {
                ideal: 30,
                max: 30
              }
            },
            audio: true
          });

      const screenTrack =
        screenStream
          .getVideoTracks()[0];

      for (
        const peer
        of peers.values()
      ) {
        const sender =
          peer.pc
            .getSenders()
            .find(
              (sender) =>
                sender.track?.kind ===
                "video"
            );

        if (sender) {
          await sender.replaceTrack(
            screenTrack
          );
        }
      }

      const localVideo =
        document.querySelector(
          `[data-video-id="${socket.id}"] video`
        );

      if (localVideo) {
        localVideo.srcObject =
          screenStream;
      }

      sharingScreen = true;

      screenButton.textContent =
        "■";

      screenTrack.onended =
        stopScreenShare;

      toast(
        "Screen sharing started"
      );
    }

    catch (error) {
      console.log(error);
    }
  }
);

async function stopScreenShare() {
  if (!sharingScreen) return;

  const cameraTrack =
    localStream
      ?.getVideoTracks()[0];

  if (cameraTrack) {
    for (
      const peer
      of peers.values()
    ) {
      const sender =
        peer.pc
          .getSenders()
          .find(
            (sender) =>
              sender.track?.kind ===
              "video"
          );

      if (sender) {
        await sender.replaceTrack(
          cameraTrack
        );
      }
    }
  }

  screenStream
    ?.getTracks()
    .forEach(
      (track) =>
        track.stop()
    );

  screenStream = null;
  sharingScreen = false;

  const localVideo =
    document.querySelector(
      `[data-video-id="${socket.id}"] video`
    );

  if (localVideo) {
    localVideo.srcObject =
      localStream;
  }

  screenButton.textContent =
    "▣";
}

/* =========================================================
   CHAT
========================================================= */

messageForm.addEventListener(
  "submit",
  (event) => {
    event.preventDefault();

    const text =
      messageInput.value.trim();

    if (!text) return;

    socket.emit(
      "chat-message",
      { text }
    );

    messageInput.value = "";
  }
);

socket.on(
  "chat-message",
  (message) => {
    const item =
      document.createElement(
        "div"
      );

    item.className =
      "message";

    if (
      message.senderId ===
      socket.id
    ) {
      item.classList.add(
        "mine"
      );
    }

    const time =
      new Date(
        message.timestamp
      ).toLocaleTimeString(
        [],
        {
          hour: "2-digit",
          minute: "2-digit"
        }
      );

    item.innerHTML = `
      <div class="message-head">
        <span>${escapeHtml(message.name)}</span>
        <span>${time}</span>
      </div>

      <div class="message-body">
        ${escapeHtml(message.text)}
      </div>
    `;

    messages.appendChild(item);

    messages.scrollTop =
      messages.scrollHeight;
  }
);

/* =========================================================
   TABS
========================================================= */

document
  .querySelectorAll(".tab")
  .forEach((tab) => {
    tab.addEventListener(
      "click",
      () => {
        document
          .querySelectorAll(".tab")
          .forEach((item) =>
            item.classList.remove(
              "active"
            )
          );

        document
          .querySelectorAll(
            ".tab-content"
          )
          .forEach((item) =>
            item.classList.remove(
              "active"
            )
          );

        tab.classList.add(
          "active"
        );

        $(
          `${tab.dataset.tab}Tab`
        ).classList.add(
          "active"
        );
      }
    );
  });

sidebarButton.addEventListener(
  "click",
  () => {
    sidePanel.classList.toggle(
      "open"
    );
  }
);

/* =========================================================
   INVITE
========================================================= */

copyButton.addEventListener(
  "click",
  async () => {
    const url =
      `${location.origin}/?room=${encodeURIComponent(roomId)}`;

    try {
      await navigator.clipboard
        .writeText(url);

      toast(
        "Invite link copied"
      );
    }

    catch {
      prompt(
        "Copy invite:",
        url
      );
    }
  }
);

/* =========================================================
   REACTIONS
========================================================= */

reactionButton.addEventListener(
  "click",
  () => {
    reactionMenu.classList.toggle(
      "hidden"
    );
  }
);

reactionMenu
  .querySelectorAll("button")
  .forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        socket.emit(
          "reaction",
          {
            emoji:
              button.textContent
          }
        );

        reactionMenu.classList.add(
          "hidden"
        );
      }
    );
  });

socket.on(
  "reaction",
  ({ emoji }) => {
    const element =
      document.createElement(
        "div"
      );

    element.className =
      "floating-reaction";

    element.textContent =
      emoji;

    element.style.left =
      `${30 + Math.random() * 40}%`;

    reactionLayer.appendChild(
      element
    );

    setTimeout(
      () => element.remove(),
      2500
    );
  }
);

/* =========================================================
   FILE TRANSFER
========================================================= */

function setupDataChannel(
  peerId,
  channel
) {
  const peer =
    peers.get(peerId);

  if (!peer) return;

  peer.channel =
    channel;

  channel.binaryType =
    "arraybuffer";

  channel.onmessage =
    (event) => {
      handleFileMessage(
        event.data
      );
    };
}

function handleFileMessage(data) {
  if (
    typeof data === "string"
  ) {
    let message;

    try {
      message =
        JSON.parse(data);
    }

    catch {
      return;
    }

    if (
      message.type ===
      "file-meta"
    ) {
      incomingFiles.set(
        message.id,
        {
          ...message,
          chunks: [],
          received: 0
        }
      );

      return;
    }

    if (
      message.type ===
      "file-end"
    ) {
      finishIncomingFile(
        message.id
      );

      return;
    }
  }

  if (
    data instanceof ArrayBuffer
  ) {
    const file =
      [...incomingFiles.values()]
        .find(
          (item) =>
            item.received <
            item.size
        );

    if (!file) return;

    file.chunks.push(data);
    file.received +=
      data.byteLength;
  }
}

function finishIncomingFile(id) {
  const file =
    incomingFiles.get(id);

  if (!file) return;

  const blob =
    new Blob(
      file.chunks,
      {
        type:
          file.mime ||
          "application/octet-stream"
      }
    );

  const url =
    URL.createObjectURL(blob);

  addFileItem(
    file.name,
    file.size,
    "Received",
    url
  );

  incomingFiles.delete(id);

  toast(
    `Received ${file.name}`
  );
}

fileInput.addEventListener(
  "change",
  async () => {
    const file =
      fileInput.files[0];

    if (!file) return;

    if (
      file.size >
      25 * 1024 * 1024
    ) {
      toast(
        "Maximum P2P file size is currently 25 MB."
      );

      fileInput.value = "";

      return;
    }

    const channels =
      [...peers.values()]
        .map((peer) =>
          peer.channel
        )
        .filter(
          (channel) =>
            channel?.readyState ===
            "open"
        );

    if (!channels.length) {
      toast(
        "No participant connected for file transfer."
      );

      fileInput.value = "";

      return;
    }

    const id =
      crypto.randomUUID();

    const buffer =
      await file.arrayBuffer();

    const chunkSize =
      16 * 1024;

    addFileItem(
      file.name,
      file.size,
      "Sent"
    );

    for (
      const channel
      of channels
    ) {
      channel.send(
        JSON.stringify({
          type: "file-meta",
          id,
          name: file.name,
          size: file.size,
          mime: file.type
        })
      );

      for (
        let offset = 0;
        offset < buffer.byteLength;
        offset += chunkSize
      ) {
        while (
          channel.bufferedAmount >
          1024 * 1024
        ) {
          await new Promise(
            (resolve) =>
              setTimeout(
                resolve,
                20
              )
          );
        }

        channel.send(
          buffer.slice(
            offset,
            offset + chunkSize
          )
        );
      }

      channel.send(
        JSON.stringify({
          type: "file-end",
          id
        })
      );
    }

    toast("File sent");

    fileInput.value = "";
  }
);

function addFileItem(
  name,
  size,
  status,
  url = null
) {
  const item =
    document.createElement(
      "div"
    );

  item.className =
    "file-item";

  item.innerHTML = `
    <div class="file-name">
      ${escapeHtml(name)}
    </div>

    <div class="file-meta">
      ${formatBytes(size)}
      • ${escapeHtml(status)}
    </div>
  `;

  if (url) {
    const link =
      document.createElement(
        "a"
      );

    link.href = url;
    link.download = name;
    link.className =
      "file-download";
    link.textContent =
      "Save file";

    item.appendChild(link);
  }

  filesList.prepend(item);
}

/* =========================================================
   MEDIA HUB
========================================================= */

watchButton.addEventListener(
  "click",
  () =>
    watchDialog.showModal()
);

openMediaHubButton.addEventListener(
  "click",
  () =>
    watchDialog.showModal()
);

closeMediaHubButton.addEventListener(
  "click",
  () =>
    watchDialog.close()
);

document
  .querySelectorAll(
    ".source-card"
  )
  .forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        document
          .querySelectorAll(
            ".source-card"
          )
          .forEach((item) =>
            item.classList.remove(
              "active"
            )
          );

        document
          .querySelectorAll(
            ".source-panel"
          )
          .forEach((item) =>
            item.classList.remove(
              "active"
            )
          );

        button.classList.add(
          "active"
        );

        $(
          `${button.dataset.source}Source`
        ).classList.add(
          "active"
        );
      }
    );
  });

/* YOUTUBE */

function extractYouTubeId(value) {
  try {
    const url = new URL(value);

    if (
      url.hostname === "youtu.be" ||
      url.hostname.endsWith(
        ".youtu.be"
      )
    ) {
      return url.pathname
        .slice(1)
        .split("/")[0];
    }

    if (
      url.hostname.includes(
        "youtube.com"
      )
    ) {
      if (
        url.pathname.startsWith(
          "/shorts/"
        )
      ) {
        return url.pathname
          .split("/")[2];
      }

      if (
        url.pathname.startsWith(
          "/embed/"
        )
      ) {
        return url.pathname
          .split("/")[2];
      }

      return url.searchParams.get(
        "v"
      );
    }
  }

  catch {}

  return null;
}

loadMediaButton.addEventListener(
  "click",
  () => {
    const url =
      mediaUrlInput.value.trim();

    const videoId =
      extractYouTubeId(url);

    if (!videoId) {
      toast(
        "Enter a valid YouTube URL."
      );

      return;
    }

    const media = {
      id:
        crypto.randomUUID(),

      type: "youtube",
      title: "YouTube Video",
      url,
      videoId,
      playing: false,
      currentTime: 0
    };

    loadYouTube(media);

    socket.emit(
      "media-load",
      media
    );

    watchDialog.close();
  }
);

function loadYouTube(media) {
  resetPlayers(false);

  currentMedia = media;

  watchStage.classList.remove(
    "hidden"
  );

  youtubeContainer.classList.remove(
    "hidden"
  );

  watchTypeBadge.textContent =
    "YOUTUBE";

  watchTitle.textContent =
    media.title ||
    "YouTube";

  watchStatus.textContent =
    "Loading...";

  youtubeContainer.innerHTML =
    '<div id="youtubePlayerMount"></div>';

  const createPlayer = () => {
    youtubeReady = false;

    youtubePlayer =
      new YT.Player(
        "youtubePlayerMount",
        {
          videoId:
            media.videoId,

          playerVars: {
            autoplay: 0,
            controls: 1,
            rel: 0,
            playsinline: 1
          },

          events: {
            onReady(event) {
              youtubeReady = true;

              watchStatus.textContent =
                "Ready";

              if (
                media.currentTime > 0
              ) {
                event.target.seekTo(
                  media.currentTime,
                  true
                );
              }

              if (media.playing) {
                event.target
                  .playVideo();
              }
            },

            onStateChange(event) {
              if (
                applyingRemoteState
              ) {
                return;
              }

              if (
                event.data ===
                YT.PlayerState.PLAYING
              ) {
                broadcastYouTubeState(
                  true
                );
              }

              if (
                event.data ===
                YT.PlayerState.PAUSED
              ) {
                broadcastYouTubeState(
                  false
                );
              }
            }
          }
        }
      );
  };

  if (window.YT?.Player) {
    createPlayer();
  }

  else {
    const timer =
      setInterval(() => {
        if (
          window.YT?.Player
        ) {
          clearInterval(timer);
          createPlayer();
        }
      }, 200);
  }
}

function broadcastYouTubeState(
  playing
) {
  if (
    !youtubeReady ||
    !youtubePlayer ||
    !currentMedia ||
    applyingRemoteState
  ) {
    return;
  }

  socket.emit(
    "media-state",
    {
      mediaId:
        currentMedia.id,

      type: "youtube",

      playing,

      currentTime:
        youtubePlayer
          .getCurrentTime()
    }
  );
}

/* DIRECT VIDEO */

loadDirectVideoButton
  .addEventListener(
    "click",
    () => {
      const value =
        directVideoUrl
          .value
          .trim();

      let url;

      try {
        url =
          new URL(value);
      }

      catch {
        toast(
          "Enter a valid video URL."
        );

        return;
      }

      if (
        ![
          "http:",
          "https:"
        ].includes(
          url.protocol
        )
      ) {
        toast(
          "Only HTTP/HTTPS URLs are supported."
        );

        return;
      }

      const media = {
        id:
          crypto.randomUUID(),

        type: "direct",

        title:
          decodeURIComponent(
            url.pathname
              .split("/")
              .pop() ||
            "Shared Video"
          ),

        url: value,

        playing: false,
        currentTime: 0
      };

      loadDirectVideo(media);

      socket.emit(
        "media-load",
        media
      );

      watchDialog.close();
    }
  );

function loadDirectVideo(media) {
  resetPlayers(false);

  currentMedia = media;

  watchStage.classList.remove(
    "hidden"
  );

  sharedVideoPlayer.classList.remove(
    "hidden"
  );

  watchTypeBadge.textContent =
    "VIDEO";

  watchTitle.textContent =
    media.title;

  watchStatus.textContent =
    "Loading...";

  sharedVideoPlayer.src =
    media.url;

  sharedVideoPlayer.load();

  sharedVideoPlayer.onloadedmetadata =
    () => {
      watchStatus.textContent =
        "Ready";

      if (
        media.currentTime > 0
      ) {
        sharedVideoPlayer.currentTime =
          media.currentTime;
      }

      if (media.playing) {
        sharedVideoPlayer
          .play()
          .catch(() => {});
      }
    };
}

/* LOCAL CINEMA */

localCinemaInput.addEventListener(
  "change",
  () => {
    const file =
      localCinemaInput.files[0];

    if (!file) return;

    selectedCinemaFile = file;

    selectedLocalFile.classList.remove(
      "hidden"
    );

    selectedLocalFile.textContent =
      `${file.name} • ${formatBytes(file.size)}`;

    startLocalCinemaButton.disabled =
      false;
  }
);

async function createFileFingerprint(file) {
  const sampleSize =
    Math.min(
      512 * 1024,
      file.size
    );

  const first =
    await file
      .slice(
        0,
        sampleSize
      )
      .arrayBuffer();

  const last =
    await file
      .slice(
        Math.max(
          0,
          file.size -
          sampleSize
        ),
        file.size
      )
      .arrayBuffer();

  const metadata =
    new TextEncoder()
      .encode(
        `${file.name}|${file.size}|${file.type}`
      );

  const combined =
    new Uint8Array(
      metadata.byteLength +
      first.byteLength +
      last.byteLength
    );

  combined.set(metadata, 0);

  combined.set(
    new Uint8Array(first),
    metadata.byteLength
  );

  combined.set(
    new Uint8Array(last),
    metadata.byteLength +
      first.byteLength
  );

  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      combined
    );

  return Array.from(
    new Uint8Array(digest)
  )
    .map(
      (byte) =>
        byte
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}

startLocalCinemaButton
  .addEventListener(
    "click",
    async () => {
      if (!selectedCinemaFile) {
        return;
      }

      const fingerprint =
        await createFileFingerprint(
          selectedCinemaFile
        );

      const media = {
        id:
          crypto.randomUUID(),

        type: "local",

        title:
          selectedCinemaFile.name,

        fileName:
          selectedCinemaFile.name,

        fileSize:
          selectedCinemaFile.size,

        fingerprint,

        playing: false,
        currentTime: 0
      };

      loadLocalFile(
        selectedCinemaFile,
        media
      );

      socket.emit(
        "media-load",
        media
      );

      watchDialog.close();
    }
  );

function loadLocalFile(
  file,
  media
) {
  resetPlayers(false);

  if (localCinemaUrl) {
    URL.revokeObjectURL(
      localCinemaUrl
    );
  }

  localCinemaUrl =
    URL.createObjectURL(file);

  currentMedia = media;

  watchStage.classList.remove(
    "hidden"
  );

  sharedVideoPlayer.classList.remove(
    "hidden"
  );

  localCinemaWaiting.classList.add(
    "hidden"
  );

  sharedVideoPlayer.src =
    localCinemaUrl;

  sharedVideoPlayer.load();

  watchTypeBadge.textContent =
    "LOCAL";

  watchTitle.textContent =
    media.title;

  watchStatus.textContent =
    "Local Cinema";
}

function showLocalWaiting(media) {
  resetPlayers(false);

  currentMedia = media;

  watchStage.classList.remove(
    "hidden"
  );

  localCinemaWaiting.classList.remove(
    "hidden"
  );

  watchTypeBadge.textContent =
    "LOCAL";

  watchTitle.textContent =
    media.title;

  watchStatus.textContent =
    "Select local movie";

  localWaitingText.textContent =
    `Select "${media.fileName}" on this device.`;
}

localJoinInput.addEventListener(
  "change",
  async () => {
    const file =
      localJoinInput.files[0];

    if (
      !file ||
      currentMedia?.type !==
        "local"
    ) {
      return;
    }

    const fingerprint =
      await createFileFingerprint(
        file
      );

    if (
      fingerprint !==
      currentMedia.fingerprint
    ) {
      toast(
        "This is not the matching video file."
      );

      return;
    }

    loadLocalFile(
      file,
      currentMedia
    );

    toast(
      "Local Cinema connected"
    );
  }
);

/* MEDIA RECEIVE */

socket.on(
  "media-load",
  openRemoteMedia
);

function openRemoteMedia(media) {
  if (!media?.type) return;

  currentMedia = media;

  if (
    media.type === "youtube"
  ) {
    loadYouTube(media);
  }

  else if (
    media.type === "direct"
  ) {
    loadDirectVideo(media);
  }

  else if (
    media.type === "local"
  ) {
    showLocalWaiting(media);
  }
}

/* MEDIA SYNC */

sharedVideoPlayer.addEventListener(
  "play",
  () =>
    broadcastVideoState(true)
);

sharedVideoPlayer.addEventListener(
  "pause",
  () =>
    broadcastVideoState(false)
);

sharedVideoPlayer.addEventListener(
  "seeked",
  () =>
    broadcastVideoState(
      !sharedVideoPlayer.paused
    )
);

function broadcastVideoState(
  playing
) {
  if (
    applyingRemoteState ||
    !currentMedia ||
    ![
      "direct",
      "local"
    ].includes(
      currentMedia.type
    )
  ) {
    return;
  }

  socket.emit(
    "media-state",
    {
      mediaId:
        currentMedia.id,

      type:
        currentMedia.type,

      playing,

      currentTime:
        sharedVideoPlayer
          .currentTime || 0
    }
  );
}

socket.on(
  "media-state",
  async (state) => {
    if (
      !currentMedia ||
      !state
    ) {
      return;
    }

    if (
      state.mediaId !==
      currentMedia.id
    ) {
      return;
    }

    applyingRemoteState = true;

    try {
      const delay =
        state.playing &&
        state.sentAt
          ? Math.max(
              0,
              (
                Date.now() -
                state.sentAt
              ) / 1000
            )
          : 0;

      const target =
        Number(
          state.currentTime ||
          0
        ) + delay;

      if (
        currentMedia.type ===
          "youtube" &&
        youtubeReady &&
        youtubePlayer
      ) {
        if (
          Math.abs(
            youtubePlayer
              .getCurrentTime() -
            target
          ) > 0.75
        ) {
          youtubePlayer.seekTo(
            target,
            true
          );
        }

        if (state.playing) {
          youtubePlayer
            .playVideo();
        }

        else {
          youtubePlayer
            .pauseVideo();
        }
      }

      else if (
        !sharedVideoPlayer
          .classList
          .contains(
            "hidden"
          )
      ) {
        if (
          Math.abs(
            sharedVideoPlayer
              .currentTime -
            target
          ) > 0.75
        ) {
          sharedVideoPlayer.currentTime =
            target;
        }

        if (state.playing) {
          await sharedVideoPlayer
            .play()
            .catch(() => {});
        }

        else {
          sharedVideoPlayer.pause();
        }
      }

      cinemaSyncText.textContent =
        "Synchronized";
    }

    finally {
      setTimeout(
        () => {
          applyingRemoteState =
            false;
        },
        150
      );
    }
  }
);

syncMediaButton.addEventListener(
  "click",
  () => {
    if (!currentMedia) {
      toast(
        "No active media."
      );

      return;
    }

    if (
      currentMedia.type ===
        "youtube"
    ) {
      if (
        youtubeReady &&
        youtubePlayer
      ) {
        broadcastYouTubeState(
          youtubePlayer
            .getPlayerState() ===
            YT.PlayerState.PLAYING
        );
      }
    }

    else {
      broadcastVideoState(
        !sharedVideoPlayer.paused
      );
    }

    toast(
      "Sync sent"
    );
  }
);

setInterval(
  () => {
    if (!currentMedia) return;

    let current = 0;
    let duration = 0;

    if (
      currentMedia.type ===
        "youtube" &&
      youtubeReady &&
      youtubePlayer
    ) {
      try {
        current =
          youtubePlayer
            .getCurrentTime();

        duration =
          youtubePlayer
            .getDuration();
      }

      catch {}
    }

    else {
      current =
        sharedVideoPlayer
          .currentTime || 0;

      duration =
        sharedVideoPlayer
          .duration || 0;
    }

    cinemaTime.textContent =
      `${formatTime(current)} / ${formatTime(duration)}`;
  },
  1000
);

socket.on(
  "media-queue",
  renderQueue
);

function renderQueue(queue = []) {
  mediaQueue.innerHTML = "";

  if (!queue.length) {
    mediaQueue.innerHTML =
      `<div class="empty-queue">Nothing queued yet.</div>`;

    return;
  }

  queue
    .slice()
    .reverse()
    .forEach((media) => {
      const item =
        document.createElement(
          "div"
        );

      item.className =
        "queue-item";

      const icon =
        media.type === "youtube"
          ? "▶"
          : media.type === "local"
            ? "🎬"
            : "🔗";

      item.innerHTML = `
        <div class="queue-icon">${icon}</div>

        <div class="queue-info">
          <strong>${escapeHtml(media.title)}</strong>
          <span>${escapeHtml(media.type)}</span>
        </div>
      `;

      mediaQueue.appendChild(item);
    });
}

fullscreenMediaButton
  .addEventListener(
    "click",
    async () => {
      try {
        if (
          !document.fullscreenElement
        ) {
          await watchStage
            .requestFullscreen();
        }

        else {
          await document
            .exitFullscreen();
        }
      }

      catch {
        toast(
          "Fullscreen unavailable."
        );
      }
    }
  );

closeWatchButton.addEventListener(
  "click",
  () => {
    watchStage.classList.add(
      "hidden"
    );
  }
);

function resetPlayers(
  revokeLocal = false
) {
  try {
    youtubePlayer?.destroy();
  }

  catch {}

  youtubePlayer = null;
  youtubeReady = false;

  youtubeContainer.innerHTML =
    "";

  youtubeContainer.classList.add(
    "hidden"
  );

  try {
    sharedVideoPlayer.pause();
  }

  catch {}

  sharedVideoPlayer
    .removeAttribute("src");

  sharedVideoPlayer.load();

  sharedVideoPlayer.classList.add(
    "hidden"
  );

  localCinemaWaiting.classList.add(
    "hidden"
  );

  if (
    revokeLocal &&
    localCinemaUrl
  ) {
    URL.revokeObjectURL(
      localCinemaUrl
    );

    localCinemaUrl = null;
  }
}

/* =========================================================
   SOCKET STATUS + RECONNECT
========================================================= */

function setConnectionStatus(
  text,
  good
) {
  connectionText.textContent =
    text;

  connectionDot.style.background =
    good
      ? "#43e6a5"
      : "#ffb84d";
}

socket.on(
  "connect",
  () => {
    setConnectionStatus(
      "Connected",
      true
    );
  }
);

socket.on(
  "disconnect",
  () => {
    setConnectionStatus(
      "Reconnecting...",
      false
    );
  }
);

socket.io.on(
  "reconnect",
  () => {
    if (
      !roomId ||
      !displayName
    ) {
      return;
    }

    /*
      New Socket.IO connection = new socket ID.
      Rebuild the peer graph.
    */

    for (
      const peerId
      of [...peers.keys()]
    ) {
      removePeer(peerId);
    }

    socket.emit(
      "join-room",
      {
        roomId,
        name: displayName
      },

      (response) => {
        if (!response?.ok) {
          return;
        }

        document
          .querySelectorAll(
            ".video-card"
          )
          .forEach(
            (card) =>
              card.remove()
          );

        addVideoCard(
          socket.id,
          `${displayName} (You)`,
          localStream,
          true
        );

        updateUsers(
          response.users || []
        );

        renderQueue(
          response.queue || []
        );

        toast(
          "Connection restored"
        );
      }
    );
  }
);

/* =========================================================
   NETWORK CHANGE DETECTION
========================================================= */

window.addEventListener(
  "online",
  () => {
    setConnectionStatus(
      "Network restored",
      false
    );

    /*
      Give the network stack a moment to settle,
      then repair every peer.
    */

    setTimeout(
      () => {
        for (
          const peerId
          of peers.keys()
        ) {
          restartPeerIce(
            peerId
          );
        }
      },
      1200
    );
  }
);

window.addEventListener(
  "offline",
  () => {
    setConnectionStatus(
      "Offline",
      false
    );
  }
);

/* =========================================================
   LEAVE
========================================================= */

leaveButton.addEventListener(
  "click",
  () => {
    socket.emit(
      "leave-room"
    );

    localStream
      ?.getTracks()
      .forEach(
        (track) =>
          track.stop()
      );

    screenStream
      ?.getTracks()
      .forEach(
        (track) =>
          track.stop()
      );

    for (
      const peerId
      of [...peers.keys()]
    ) {
      removePeer(peerId);
    }

    socket.disconnect();

    location.href =
      location.origin;
  }
);