/* =========================================================
   NEXORA TWO
========================================================= */

const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000
});

const $ = (id) =>
  document.getElementById(id);


/* ELEMENTS */

const entry =
  $("twoEntry");

const home =
  $("twoHome");

const nameInput =
  $("twoName");

const spaceInput =
  $("twoSpace");

const randomButton =
  $("randomTwoSpace");

const enterButton =
  $("enterTwo");

const myVideo =
  $("myTwoVideo");

const partnerVideo =
  $("partnerTwoVideo");

const myFallback =
  $("myFallback");

const partnerFallback =
  $("partnerFallback");

const myNameLabel =
  $("myTwoName");

const partnerName =
  $("partnerName");

const partnerStatus =
  $("partnerStatus");

const myActivity =
  $("myActivity");

const partnerActivity =
  $("partnerActivity");

const modeBadge =
  $("presenceModeBadge");

const togetherDuration =
  $("togetherDuration");

const touchButton =
  $("touchButton");

const touchMessage =
  $("touchMessage");

const incomingTouch =
  $("incomingTouch");

const incomingTouchText =
  $("incomingTouchText");

const pulseButton =
  $("pulseButton");

const studyPanel =
  $("studyPanel");

const studyTimer =
  $("studyTimer");

const studyStart =
  $("studyStart");

const studyReset =
  $("studyReset");

const cinemaPanel =
  $("cinemaPanel");

const coupleYoutubeUrl =
  $("coupleYoutubeUrl");

const coupleYoutubeStart =
  $("coupleYoutubeStart");

const couplePlayer =
  $("couplePlayer");

const motionToggle =
  $("motionToggle");

const motionStatus =
  $("motionStatus");

const settingsMotionToggle =
  $("settingsMotionToggle");

const settingsButton =
  $("twoSettingsButton");

const settings =
  $("twoSettings");

const closeSettings =
  $("closeTwoSettings");

const cameraToggle =
  $("twoCameraToggle");

const micToggle =
  $("twoMicToggle");

const hapticToggle =
  $("hapticToggle");

const inviteButton =
  $("invitePartnerButton");

const leaveButton =
  $("leaveTwoButton");

const toastElement =
  $("twoToast");


/* STATE */

let myName = "";

let spaceId = "";

let localStream = null;

let peer = null;

let partnerId = null;

let currentMode = "quiet";

let joinedAt = null;

let touchTimer = null;

let studySeconds = 25 * 60;

let studyRunning = false;

let studyInterval = null;

let hapticsEnabled = true;

let youtubePlayer = null;


/* ICE */

let rtcConfig = {
  iceServers: [
    {
      urls:
        "stun:stun.l.google.com:19302"
    }
  ]
};


async function loadIce() {
  try {
    const response =
      await fetch(
        "/api/ice",
        {
          cache: "no-store"
        }
      );

    const data =
      await response.json();

    if (
      Array.isArray(
        data.iceServers
      )
    ) {
      rtcConfig = {
        iceServers:
          data.iceServers
      };
    }
  }

  catch {}
}


/* HELPERS */

function toast(text) {
  toastElement.textContent =
    text;

  toastElement.classList.add(
    "show"
  );

  clearTimeout(
    toastElement.timer
  );

  toastElement.timer =
    setTimeout(() => {
      toastElement.classList.remove(
        "show"
      );
    }, 2000);
}


function randomSpace() {
  return (
    "us-" +
    crypto.randomUUID()
      .slice(0, 8)
  );
}


function cleanSpace(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(
      /[^a-z0-9-_]/g,
      ""
    )
    .slice(0, 64);
}


function formatTimer(seconds) {
  const m =
    Math.floor(
      seconds / 60
    );

  const s =
    seconds % 60;

  return (
    String(m)
      .padStart(2, "0") +
    ":" +
    String(s)
      .padStart(2, "0")
  );
}


/* URL */

const params =
  new URLSearchParams(
    location.search
  );

if (
  params.get("space")
) {
  spaceInput.value =
    params.get("space");
}

const savedName =
  localStorage.getItem(
    "nexora-two-name"
  );

if (savedName) {
  nameInput.value =
    savedName;
}


/* ENTRY */

$("backToNexora")
  .addEventListener(
    "click",
    () => {
      location.href = "/";
    }
  );


randomButton.addEventListener(
  "click",
  () => {
    spaceInput.value =
      randomSpace();
  }
);


enterButton.addEventListener(
  "click",
  enterSpace
);


async function enterSpace() {
  myName =
    nameInput.value.trim() ||
    "Me";

  spaceId =
    cleanSpace(
      spaceInput.value
    );

  if (!spaceId) {
    spaceId =
      randomSpace();
  }

  enterButton.disabled = true;

  enterButton.textContent =
    "Opening our space…";

  await loadIce();

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
            facingMode:
              "user",

            width: {
              ideal: 720
            },

            height: {
              ideal: 720
            },

            frameRate: {
              ideal: 24,
              max: 30
            }
          }
        });
  }

  catch {
    try {
      localStream =
        await navigator.mediaDevices
          .getUserMedia({
            audio: true,
            video: false
          });
    }

    catch {
      toast(
        "Microphone permission is required."
      );

      enterButton.disabled =
        false;

      enterButton.textContent =
        "Enter Together";

      return;
    }
  }


  localStorage.setItem(
    "nexora-two-name",
    myName
  );


  history.replaceState(
    {},
    "",
    `/two/?space=${encodeURIComponent(spaceId)}`
  );


  myVideo.srcObject =
    localStream;


  myNameLabel.textContent =
    myName;


  myFallback.textContent =
    myName
      .charAt(0)
      .toUpperCase();


  socket.emit(
    "two-join",
    {
      spaceId,
      name: myName
    },

    (response) => {
      if (!response?.ok) {
        toast(
          response?.error ||
          "Unable to enter."
        );

        enterButton.disabled =
          false;

        return;
      }


      entry.classList.add(
        "hidden"
      );

      home.classList.remove(
        "hidden"
      );


      joinedAt =
        Date.now();


      if (
        response.partner
      ) {
        partnerId =
          response.partner.id;

        partnerName.textContent =
          response.partner.name;

        setPartnerOnline(true);

        createOffer();
      }


      setMode(
        response.mode ||
        "quiet",
        false
      );


      enterButton.disabled =
        false;

      enterButton.textContent =
        "Enter Together";


      updateMotionStatus();
    }
  );
}


/* WEBRTC */

function createPeer() {
  if (peer) {
    return peer;
  }


  peer =
    new RTCPeerConnection(
      rtcConfig
    );


  localStream
    ?.getTracks()
    .forEach((track) => {
      peer.addTrack(
        track,
        localStream
      );
    });


  peer.onicecandidate =
    (event) => {
      if (
        !event.candidate ||
        !partnerId
      ) {
        return;
      }

      socket.emit(
        "two-signal",
        {
          target:
            partnerId,

          data: {
            type:
              "candidate",

            candidate:
              event.candidate
          }
        }
      );
    };


  peer.ontrack =
    (event) => {
      const stream =
        event.streams[0];

      if (!stream) return;

      partnerVideo.srcObject =
        stream;

      partnerFallback.style.display =
        "none";
    };


  peer.onconnectionstatechange =
    () => {
      if (
        peer.connectionState ===
        "connected"
      ) {
        setPartnerOnline(true);
      }

      if (
        [
          "failed",
          "disconnected"
        ].includes(
          peer.connectionState
        )
      ) {
        partnerActivity.textContent =
          "Reconnecting…";
      }

      if (
        peer.connectionState ===
        "failed"
      ) {
        try {
          peer.restartIce();
        } catch {}
      }
    };


  return peer;
}


async function createOffer() {
  if (!partnerId) return;

  const pc =
    createPeer();

  const offer =
    await pc.createOffer();

  await pc.setLocalDescription(
    offer
  );


  socket.emit(
    "two-signal",
    {
      target:
        partnerId,

      data: {
        type:
          "offer",

        sdp:
          pc.localDescription
      }
    }
  );
}


socket.on(
  "two-partner-joined",
  async ({
    id,
    name
  }) => {
    partnerId = id;

    partnerName.textContent =
      name;

    setPartnerOnline(true);

    await createOffer();
  }
);


socket.on(
  "two-signal",
  async ({
    from,
    name,
    data
  }) => {
    partnerId = from;

    partnerName.textContent =
      name ||
      "Your person";

    setPartnerOnline(true);

    const pc =
      createPeer();


    try {
      if (
        data.type ===
        "offer"
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
          "two-signal",
          {
            target:
              from,

            data: {
              type:
                "answer",

              sdp:
                pc.localDescription
            }
          }
        );
      }

      else if (
        data.type ===
        "answer"
      ) {
        await pc.setRemoteDescription(
          data.sdp
        );
      }

      else if (
        data.type ===
        "candidate"
      ) {
        await pc.addIceCandidate(
          data.candidate
        );
      }
    }

    catch (error) {
      console.error(
        "TWO WebRTC:",
        error
      );
    }
  }
);


socket.on(
  "two-partner-left",
  () => {
    setPartnerOnline(false);

    partnerId = null;

    partnerVideo.srcObject =
      null;

    partnerFallback.style.display =
      "grid";

    if (peer) {
      try {
        peer.close();
      } catch {}

      peer = null;
    }
  }
);


function setPartnerOnline(
  online
) {
  partnerStatus.classList.toggle(
    "online",
    online
  );

  partnerStatus.lastChild.textContent =
    online
      ? " Together"
      : " Waiting";

  partnerActivity.textContent =
    online
      ? "Here"
      : "Waiting";
}


/* TOUCH */

const startTouch = () => {
  touchButton.classList.add(
    "holding"
  );

  touchMessage.textContent =
    "Keep holding…";


  touchTimer =
    setTimeout(() => {
      sendTouch(
        "hold"
      );

      stopTouch();
    }, 650);
};


const stopTouch = () => {
  clearTimeout(
    touchTimer
  );

  touchButton.classList.remove(
    "holding"
  );

  touchMessage.textContent =
    "Hold ♡ to say “I'm here”";
};


touchButton.addEventListener(
  "pointerdown",
  startTouch
);


touchButton.addEventListener(
  "pointerup",
  stopTouch
);


touchButton.addEventListener(
  "pointercancel",
  stopTouch
);


function sendTouch(
  pattern = "touch"
) {
  if (!partnerId) {
    toast(
      "Your person isn't here yet."
    );

    return;
  }


  if (
    hapticsEnabled
  ) {
    NexoraSensors
      .touchHaptic();
  }


  socket.emit(
    "two-touch",
    {
      spaceId,
      pattern
    }
  );


  touchMessage.textContent =
    "♡ sent";


  setTimeout(
    () => {
      touchMessage.textContent =
        "Hold ♡ to say “I'm here”";
    },
    1200
  );
}


pulseButton.addEventListener(
  "click",
  () => {
    if (
      hapticsEnabled
    ) {
      NexoraSensors
        .pulseHaptic();
    }

    sendTouch(
      "pulse"
    );
  }
);


socket.on(
  "two-touch",
  ({
    name,
    pattern
  }) => {
    if (
      hapticsEnabled
    ) {
      if (
        pattern === "pulse"
      ) {
        NexoraSensors
          .pulseHaptic();
      }

      else {
        NexoraSensors
          .touchHaptic();
      }
    }


    incomingTouchText.textContent =
      pattern === "pulse"
        ? `${name} sent a pulse`
        : `${name} is here`;


    incomingTouch.classList.remove(
      "hidden"
    );


    setTimeout(
      () => {
        incomingTouch.classList.add(
          "hidden"
        );
      },
      1800
    );
  }
);


/* MODES */

document
  .querySelectorAll(
    ".moment-card[data-mode]"
  )
  .forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        setMode(
          button.dataset.mode,
          true
        );
      }
    );
  });


function setMode(
  mode,
  broadcast = true
) {
  currentMode = mode;


  document
    .querySelectorAll(
      ".moment-card[data-mode]"
    )
    .forEach(
      (button) => {
        button.classList.toggle(
          "active",
          button.dataset.mode ===
            mode
        );
      }
    );


  const labels = {
    conversation:
      "CONVERSATION",

    quiet:
      "QUIET TOGETHER",

    study:
      "STUDY TOGETHER",

    cinema:
      "COUPLE CINEMA",

    sleep:
      "NIGHT PRESENCE"
  };


  modeBadge.textContent =
    labels[mode] ||
    "TOGETHER";


  myActivity.textContent =
    {
      conversation:
        "Talking",

      quiet:
        "Here",

      study:
        "Focusing",

      cinema:
        "Watching",

      sleep:
        "Night mode"
    }[mode] ||
    "Here";


  studyPanel.classList.toggle(
    "hidden",
    mode !== "study"
  );


  cinemaPanel.classList.toggle(
    "hidden",
    mode !== "cinema"
  );


  /*
    Network-aware presence optimization.
  */

  applyModeQuality(
    mode
  );


  if (broadcast) {
    socket.emit(
      "two-mode",
      {
        spaceId,
        mode
      }
    );
  }
}


socket.on(
  "two-mode",
  ({
    mode,
    name
  }) => {
    partnerActivity.textContent =
      {
        conversation:
          "Talking",

        quiet:
          "Here",

        study:
          "Focusing",

        cinema:
          "Watching",

        sleep:
          "Night mode"
      }[mode] ||
      "Here";


    /*
      Don't forcibly change this user's
      interface except for shared modes.
    */

    if (
      [
        "study",
        "cinema"
      ].includes(
        mode
      )
    ) {
      setMode(
        mode,
        false
      );
    }
  }
);


async function applyModeQuality(
  mode
) {
  const videoTrack =
    localStream
      ?.getVideoTracks()[0];


  if (!videoTrack) return;


  try {
    if (
      mode ===
      "conversation"
    ) {
      videoTrack.enabled =
        cameraToggle.checked;

      await videoTrack
        .applyConstraints({
          width: {
            ideal: 720
          },

          height: {
            ideal: 720
          },

          frameRate: {
            ideal: 24,
            max: 30
          }
        });
    }


    else if (
      mode === "quiet" ||
      mode === "study"
    ) {
      videoTrack.enabled =
        cameraToggle.checked;

      await videoTrack
        .applyConstraints({
          width: {
            ideal: 480
          },

          height: {
            ideal: 480
          },

          frameRate: {
            ideal: 10,
            max: 15
          }
        });
    }


    else if (
      mode === "cinema"
    ) {
      videoTrack.enabled =
        cameraToggle.checked;

      await videoTrack
        .applyConstraints({
          width: {
            ideal: 360
          },

          height: {
            ideal: 360
          },

          frameRate: {
            ideal: 10,
            max: 12
          }
        });
    }


    else if (
      mode === "sleep"
    ) {
      /*
        Privacy-friendly default:
        Night mode turns camera off.
      */

      videoTrack.enabled =
        false;
    }
  }

  catch (error) {
    console.warn(
      "Mode constraints:",
      error
    );
  }
}


/* STUDY */

studyTimer.textContent =
  formatTimer(
    studySeconds
  );


studyStart.addEventListener(
  "click",
  () => {
    if (studyRunning) {
      pauseStudy();

      socket.emit(
        "two-study",
        {
          spaceId,
          action:
            "pause",

          seconds:
            studySeconds
        }
      );

      return;
    }


    startStudy();

    socket.emit(
      "two-study",
      {
        spaceId,
        action:
          "start",

        seconds:
          studySeconds
      }
    );
  }
);


studyReset.addEventListener(
  "click",
  () => {
    resetStudy();

    socket.emit(
      "two-study",
      {
        spaceId,
        action:
          "reset",

        seconds:
          studySeconds
      }
    );
  }
);


function startStudy() {
  if (studyRunning) return;

  studyRunning = true;

  studyStart.textContent =
    "Pause";


  studyInterval =
    setInterval(
      () => {
        studySeconds--;

        if (
          studySeconds <= 0
        ) {
          resetStudy();

          toast(
            "Focus session complete ♡"
          );

          return;
        }

        studyTimer.textContent =
          formatTimer(
            studySeconds
          );
      },
      1000
    );
}


function pauseStudy() {
  studyRunning = false;

  clearInterval(
    studyInterval
  );

  studyStart.textContent =
    "Continue";
}


function resetStudy() {
  studyRunning = false;

  clearInterval(
    studyInterval
  );

  studySeconds =
    25 * 60;

  studyTimer.textContent =
    formatTimer(
      studySeconds
    );

  studyStart.textContent =
    "Start Together";
}


socket.on(
  "two-study",
  ({
    action,
    seconds
  }) => {
    studySeconds =
      Number(seconds) ||
      25 * 60;

    studyTimer.textContent =
      formatTimer(
        studySeconds
      );


    if (
      action === "start"
    ) {
      startStudy();
    }

    else if (
      action === "pause"
    ) {
      pauseStudy();
    }

    else if (
      action === "reset"
    ) {
      resetStudy();
    }
  }
);


/* CINEMA */

coupleYoutubeStart
  .addEventListener(
    "click",
    () => {
      const url =
        coupleYoutubeUrl
          .value
          .trim();

      const videoId =
        extractYouTubeId(
          url
        );

      if (!videoId) {
        toast(
          "Enter a valid YouTube link."
        );

        return;
      }


      loadCoupleVideo(
        videoId
      );


      socket.emit(
        "two-cinema",
        {
          spaceId,
          videoId
        }
      );
    }
  );


function extractYouTubeId(
  value
) {
  try {
    const url =
      new URL(value);


    if (
      url.hostname ===
        "youtu.be" ||
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

      return url.searchParams.get(
        "v"
      );
    }
  }

  catch {}


  return null;
}


function loadCoupleVideo(
  videoId
) {
  couplePlayer.innerHTML =
    `<div id="twoYoutubeMount"></div>`;


  const create = () => {
    youtubePlayer =
      new YT.Player(
        "twoYoutubeMount",
        {
          videoId,

          playerVars: {
            playsinline: 1,
            controls: 1,
            rel: 0
          }
        }
      );
  };


  if (
    window.YT?.Player
  ) {
    create();
  }

  else {
    const wait =
      setInterval(
        () => {
          if (
            window.YT?.Player
          ) {
            clearInterval(
              wait
            );

            create();
          }
        },
        200
      );
  }
}


socket.on(
  "two-cinema",
  ({
    videoId
  }) => {
    setMode(
      "cinema",
      false
    );

    loadCoupleVideo(
      videoId
    );
  }
);


/* MOTION */

async function enableMotion() {
  const enabled =
    await NexoraSensors
      .enableShake(
        () => {
          sendTouch(
            "shake"
          );
        }
      );


  motionToggle.checked =
    enabled;

  settingsMotionToggle.checked =
    enabled;


  motionStatus.textContent =
    enabled
      ? "Shake gesture enabled"
      : "Motion unavailable or permission denied";
}


function disableMotion() {
  NexoraSensors
    .disableShake();

  motionToggle.checked =
    false;

  settingsMotionToggle.checked =
    false;

  updateMotionStatus();
}


function updateMotionStatus() {
  if (
    NexoraSensors
      .supportsMotion()
  ) {
    motionStatus.textContent =
      "Available on this device";
  }

  else {
    motionStatus.textContent =
      "Not supported by this browser";
  }
}


motionToggle.addEventListener(
  "change",
  () => {
    if (
      motionToggle.checked
    ) {
      enableMotion();
    }

    else {
      disableMotion();
    }
  }
);


settingsMotionToggle
  .addEventListener(
    "change",
    () => {
      if (
        settingsMotionToggle
          .checked
      ) {
        enableMotion();
      }

      else {
        disableMotion();
      }
    }
  );


/* SETTINGS */

settingsButton.addEventListener(
  "click",
  () => {
    settings.classList.remove(
      "hidden"
    );
  }
);


closeSettings.addEventListener(
  "click",
  () => {
    settings.classList.add(
      "hidden"
    );
  }
);


settings
  .querySelector(
    ".sheet-backdrop"
  )
  .addEventListener(
    "click",
    () => {
      settings.classList.add(
        "hidden"
      );
    }
  );


cameraToggle.addEventListener(
  "change",
  () => {
    localStream
      ?.getVideoTracks()
      .forEach(
        (track) => {
          track.enabled =
            cameraToggle.checked &&
            currentMode !==
              "sleep";
        }
      );
  }
);


micToggle.addEventListener(
  "change",
  () => {
    localStream
      ?.getAudioTracks()
      .forEach(
        (track) => {
          track.enabled =
            micToggle.checked;
        }
      );
  }
);


hapticToggle.addEventListener(
  "change",
  () => {
    hapticsEnabled =
      hapticToggle.checked;
  }
);


/* CLOSE EXPERIENCE */

document
  .querySelectorAll(
    ".close-experience"
  )
  .forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          setMode(
            "quiet",
            true
          );
        }
      );
    }
  );


/* INVITE */

inviteButton.addEventListener(
  "click",
  async () => {
    const url =
      `${location.origin}/two/?space=${encodeURIComponent(spaceId)}`;


    try {
      await navigator.clipboard
        .writeText(
          url
        );

      toast(
        "Private invite copied ♡"
      );
    }

    catch {
      prompt(
        "Copy this invite:",
        url
      );
    }
  }
);


/* DURATION */

setInterval(
  () => {
    if (!joinedAt) return;

    const seconds =
      Math.floor(
        (
          Date.now() -
          joinedAt
        ) /
        1000
      );

    const hours =
      Math.floor(
        seconds / 3600
      );

    const minutes =
      Math.floor(
        (
          seconds % 3600
        ) /
        60
      );

    togetherDuration.textContent =
      `${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}`;
  },
  1000
);


/* LEAVE */

leaveButton.addEventListener(
  "click",
  () => {
    localStream
      ?.getTracks()
      .forEach(
        (track) =>
          track.stop()
      );

    try {
      peer?.close();
    }

    catch {}


    socket.emit(
      "two-leave"
    );


    location.href =
      "/";
  }
);