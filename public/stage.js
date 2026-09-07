/* =========================================================
   NEXORA STAGE ENGINE
   Active Speaker + Pin + Grid + Filmstrip + Presentation
========================================================= */

(() => {
  "use strict";

  const stageRoot = document.getElementById("stage");
  const videoGrid = document.getElementById("videoGrid");
  const watchStage = document.getElementById("watchStage");

  if (!stageRoot || !videoGrid) {
    console.warn("NEXORA Stage Engine: stage elements missing.");
    return;
  }

  /* -------------------------------------------------------
     STATE
  ------------------------------------------------------- */

  let mode = "stage";
  let pinnedId = null;
  let activeSpeakerId = null;

  let audioContext = null;

  const analysers = new Map();
  const speakingState = new Map();

  let lastSpeakerChange = 0;
  let fullscreenCard = null;

  const SPEAK_THRESHOLD = 0.035;
  const SPEAKER_HOLD_MS = 1600;

  /* -------------------------------------------------------
     STAGE TOOLBAR
  ------------------------------------------------------- */

  const toolbar = document.createElement("div");
  toolbar.className = "stage-toolbar";

  toolbar.innerHTML = `
    <div class="stage-toolbar-left">
      <span class="stage-mode-indicator">
        <span class="stage-live-dot"></span>
        <span id="stageModeText">Stage</span>
      </span>
    </div>

    <div class="stage-toolbar-actions">

      <button
        id="stageModeButton"
        class="stage-tool active"
        type="button"
        title="Stage view"
      >
        ◫
        <span>Stage</span>
      </button>

      <button
        id="gridModeButton"
        class="stage-tool"
        type="button"
        title="Grid view"
      >
        ▦
        <span>Grid</span>
      </button>

      <button
        id="stageFullscreenButton"
        class="stage-tool"
        type="button"
        title="Fullscreen stage"
      >
        ⛶
      </button>

    </div>
  `;

  stageRoot.appendChild(toolbar);

  const stageModeButton =
    document.getElementById("stageModeButton");

  const gridModeButton =
    document.getElementById("gridModeButton");

  const stageFullscreenButton =
    document.getElementById("stageFullscreenButton");

  const stageModeText =
    document.getElementById("stageModeText");

  /* -------------------------------------------------------
     MODE SWITCHING
  ------------------------------------------------------- */

  stageModeButton.addEventListener("click", () => {
    setStageMode("stage");
  });

  gridModeButton.addEventListener("click", () => {
    setStageMode("grid");
  });

  function setStageMode(newMode) {
    mode = newMode;

    stageRoot.classList.toggle(
      "nexora-stage-mode",
      mode === "stage"
    );

    stageRoot.classList.toggle(
      "nexora-grid-mode",
      mode === "grid"
    );

    stageModeButton.classList.toggle(
      "active",
      mode === "stage"
    );

    gridModeButton.classList.toggle(
      "active",
      mode === "grid"
    );

    stageModeText.textContent =
      mode === "stage"
        ? "Stage"
        : "Grid";

    refreshLayout();
  }

  /* -------------------------------------------------------
     FULLSCREEN
  ------------------------------------------------------- */

  stageFullscreenButton.addEventListener(
    "click",
    async () => {
      try {
        if (!document.fullscreenElement) {
          await stageRoot.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch {
        window.toast?.("Fullscreen unavailable");
      }
    }
  );

  /* -------------------------------------------------------
     OBSERVE VIDEO CARDS

     Your existing app.js dynamically creates .video-card.
  ------------------------------------------------------- */

  const observer = new MutationObserver(() => {
    enhanceCards();
    refreshLayout();
    attachAudioAnalysers();
  });

  observer.observe(videoGrid, {
    childList: true,
    subtree: true
  });

  /* -------------------------------------------------------
     ENHANCE VIDEO CARDS
  ------------------------------------------------------- */

  function enhanceCards() {
    const cards =
      videoGrid.querySelectorAll(".video-card");

    cards.forEach((card) => {
      if (card.dataset.stageEnhanced === "true") {
        return;
      }

      card.dataset.stageEnhanced = "true";

      const id =
        card.dataset.videoId || "";

      /* Pin button */

      const actions =
        document.createElement("div");

      actions.className =
        "participant-card-actions";

      const pinButton =
        document.createElement("button");

      pinButton.type = "button";
      pinButton.className =
        "participant-pin";

      pinButton.title =
        "Pin participant";

      pinButton.textContent =
        "📌";

      pinButton.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();

          if (pinnedId === id) {
            pinnedId = null;

            pinButton.classList.remove(
              "active"
            );

            pinButton.title =
              "Pin participant";
          } else {
            clearPinButtons();

            pinnedId = id;

            pinButton.classList.add(
              "active"
            );

            pinButton.title =
              "Unpin participant";
          }

          refreshLayout();
        }
      );

      /* Participant fullscreen */

      const fullButton =
        document.createElement("button");

      fullButton.type = "button";

      fullButton.className =
        "participant-fullscreen";

      fullButton.title =
        "Fullscreen participant";

      fullButton.textContent =
        "⛶";

      fullButton.addEventListener(
        "click",
        async (event) => {
          event.stopPropagation();

          try {
            fullscreenCard = card;

            await card.requestFullscreen();
          } catch {}
        }
      );

      actions.append(
        pinButton,
        fullButton
      );

      card.appendChild(actions);

      /* Speaking indicator */

      const speakerBadge =
        document.createElement("div");

      speakerBadge.className =
        "speaking-badge";

      speakerBadge.innerHTML = `
        <span></span>
        Speaking
      `;

      card.appendChild(speakerBadge);

      /* Double click/tap promotes to stage */

      card.addEventListener(
        "dblclick",
        () => {
          pinnedId = id;

          clearPinButtons();

          pinButton.classList.add(
            "active"
          );

          setStageMode("stage");

          refreshLayout();
        }
      );
    });
  }

  function clearPinButtons() {
    videoGrid
      .querySelectorAll(".participant-pin")
      .forEach((button) => {
        button.classList.remove("active");
      });
  }

  /* -------------------------------------------------------
     ACTIVE SPEAKER ANALYSIS
  ------------------------------------------------------- */

  function ensureAudioContext() {
    if (audioContext) {
      return audioContext;
    }

    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContextClass) {
      return null;
    }

    audioContext =
      new AudioContextClass();

    return audioContext;
  }

  function attachAudioAnalysers() {
    const context =
      ensureAudioContext();

    if (!context) return;

    const cards =
      videoGrid.querySelectorAll(".video-card");

    cards.forEach((card) => {
      const id =
        card.dataset.videoId;

      if (!id || analysers.has(id)) {
        return;
      }

      const video =
        card.querySelector("video");

      const stream =
        video?.srcObject;

      if (
        !stream ||
        !stream.getAudioTracks ||
        stream.getAudioTracks().length === 0
      ) {
        return;
      }

      try {
        const source =
          context.createMediaStreamSource(
            stream
          );

        const analyser =
          context.createAnalyser();

        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.65;

        source.connect(analyser);

        analysers.set(id, {
          analyser,
          source,
          card
        });
      } catch (error) {
        console.warn(
          "Stage audio analyser:",
          error
        );
      }
    });
  }

  function getAudioLevel(analyser) {
    const data =
      new Uint8Array(
        analyser.fftSize
      );

    analyser.getByteTimeDomainData(data);

    let sum = 0;

    for (let i = 0; i < data.length; i++) {
      const normalized =
        (data[i] - 128) / 128;

      sum +=
        normalized * normalized;
    }

    return Math.sqrt(
      sum / data.length
    );
  }

  function detectActiveSpeaker() {
    let strongestId = null;
    let strongestLevel = 0;

    analysers.forEach(
      ({ analyser, card }, id) => {
        if (!document.body.contains(card)) {
          analysers.delete(id);
          return;
        }

        const level =
          getAudioLevel(analyser);

        const speaking =
          level > SPEAK_THRESHOLD;

        card.classList.toggle(
          "participant-speaking",
          speaking
        );

        speakingState.set(
          id,
          speaking
        );

        if (
          speaking &&
          level > strongestLevel
        ) {
          strongestLevel = level;
          strongestId = id;
        }
      }
    );

    if (
      strongestId &&
      strongestId !== activeSpeakerId
    ) {
      const now = Date.now();

      if (
        now - lastSpeakerChange >
        SPEAKER_HOLD_MS
      ) {
        activeSpeakerId =
          strongestId;

        lastSpeakerChange = now;

        refreshLayout();
      }
    }

    requestAnimationFrame(
      detectActiveSpeaker
    );
  }

  /* -------------------------------------------------------
     LAYOUT PRIORITY

     Media > Pin > Active speaker > First participant
  ------------------------------------------------------- */

  function refreshLayout() {
    const cards =
      [...videoGrid.querySelectorAll(".video-card")];

    if (!cards.length) {
      return;
    }

    cards.forEach((card) => {
      card.classList.remove(
        "stage-primary",
        "stage-secondary"
      );
    });

    /*
      Media Hub already overlays the Stage.
      Don't fight with it.
    */

    const mediaActive =
      watchStage &&
      !watchStage.classList.contains(
        "hidden"
      );

    if (mediaActive) {
      stageModeText.textContent =
        "Cinema";

      return;
    }

    if (mode === "grid") {
      stageModeText.textContent =
        "Grid";

      return;
    }

    let primary = null;

    /* 1. Pinned */

    if (pinnedId) {
      primary =
        cards.find(
          (card) =>
            card.dataset.videoId ===
            pinnedId
        );

      if (!primary) {
        pinnedId = null;
      }
    }

    /* 2. Active speaker */

    if (
      !primary &&
      activeSpeakerId
    ) {
      primary =
        cards.find(
          (card) =>
            card.dataset.videoId ===
            activeSpeakerId
        );
    }

    /* 3. Prefer remote participant */

    if (!primary) {
      primary =
        cards.find(
          (card) =>
           !card
  .querySelector(".video-name")
  ?.textContent
  ?.includes("(You)")
        );
    }

    /* 4. Anything */

    if (!primary) {
      primary = cards[0];
    }

    cards.forEach((card) => {
      if (card === primary) {
        card.classList.add(
          "stage-primary"
        );
      } else {
        card.classList.add(
          "stage-secondary"
        );
      }
    });

    stageModeText.textContent =
      pinnedId
        ? "Pinned"
        : activeSpeakerId
          ? "Speaker"
          : "Stage";
  }

  /* -------------------------------------------------------
     WATCH MEDIA VISIBILITY
  ------------------------------------------------------- */

  if (watchStage) {
    const mediaObserver =
      new MutationObserver(() => {
        refreshLayout();
      });

    mediaObserver.observe(
      watchStage,
      {
        attributes: true,
        attributeFilter: [
          "class"
        ]
      }
    );
  }

  /* -------------------------------------------------------
     FULLSCREEN STATE
  ------------------------------------------------------- */

  document.addEventListener(
    "fullscreenchange",
    () => {
      if (!document.fullscreenElement) {
        fullscreenCard = null;
      }
    }
  );

  /* -------------------------------------------------------
     USER INTERACTION UNLOCKS AUDIO CONTEXT
  ------------------------------------------------------- */

  const unlockAudio = async () => {
    const context =
      ensureAudioContext();

    if (
      context &&
      context.state === "suspended"
    ) {
      try {
        await context.resume();
      } catch {}
    }

    attachAudioAnalysers();
  };

  document.addEventListener(
    "click",
    unlockAudio,
    {
      once: true
    }
  );

  document.addEventListener(
    "touchstart",
    unlockAudio,
    {
      once: true
    }
  );

  /* -------------------------------------------------------
     INITIALIZE
  ------------------------------------------------------- */

  enhanceCards();

  setStageMode("stage");

  attachAudioAnalysers();

  requestAnimationFrame(
    detectActiveSpeaker
  );

  console.log(
    "NEXORA Stage Engine: READY"
  );
})();