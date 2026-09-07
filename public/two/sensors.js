/* =========================================================
   NEXORA TWO — SENSOR LAYER
========================================================= */

window.NexoraSensors = (() => {

  let motionEnabled = false;

  let lastShake = 0;

  let previous = {
    x: null,
    y: null,
    z: null
  };

  let shakeHandler = null;


  function canVibrate() {
    return (
      typeof navigator.vibrate ===
      "function"
    );
  }


  function vibrate(pattern) {
    if (!canVibrate()) {
      return false;
    }

    try {
      navigator.vibrate(pattern);

      return true;
    }

    catch {
      return false;
    }
  }


  function touchHaptic() {
    return vibrate(
      [45, 55, 90]
    );
  }


  function pulseHaptic() {
    return vibrate(
      [35, 45, 35]
    );
  }


  function shakeHaptic() {
    return vibrate(60);
  }


  function supportsMotion() {
    return (
      "DeviceMotionEvent" in window
    );
  }


  async function requestMotionPermission() {
    if (!supportsMotion()) {
      return false;
    }

    /*
      Some browsers, especially iOS variants,
      require an explicit user gesture.
    */

    if (
      typeof DeviceMotionEvent
        .requestPermission ===
      "function"
    ) {
      try {
        const result =
          await DeviceMotionEvent
            .requestPermission();

        return result ===
          "granted";
      }

      catch {
        return false;
      }
    }

    return true;
  }


  async function enableShake(callback) {
    if (motionEnabled) {
      shakeHandler = callback;

      return true;
    }

    const permission =
      await requestMotionPermission();

    if (!permission) {
      return false;
    }

    shakeHandler = callback;

    window.addEventListener(
      "devicemotion",
      onMotion,
      {
        passive: true
      }
    );

    motionEnabled = true;

    return true;
  }


  function disableShake() {
    window.removeEventListener(
      "devicemotion",
      onMotion
    );

    motionEnabled = false;

    previous = {
      x: null,
      y: null,
      z: null
    };
  }


  function onMotion(event) {
    const acceleration =
      event.accelerationIncludingGravity;

    if (!acceleration) {
      return;
    }

    const x =
      acceleration.x || 0;

    const y =
      acceleration.y || 0;

    const z =
      acceleration.z || 0;


    if (
      previous.x === null
    ) {
      previous = {
        x,
        y,
        z
      };

      return;
    }


    const delta =
      Math.abs(x - previous.x) +
      Math.abs(y - previous.y) +
      Math.abs(z - previous.z);


    previous = {
      x,
      y,
      z
    };


    /*
      Conservative threshold to avoid normal
      hand movement causing Touch events.
    */

    if (delta < 24) {
      return;
    }


    const now = Date.now();


    if (
      now - lastShake <
      2500
    ) {
      return;
    }


    lastShake = now;

    shakeHaptic();

    if (
      typeof shakeHandler ===
      "function"
    ) {
      shakeHandler();
    }
  }


  return {
    canVibrate,
    supportsMotion,
    touchHaptic,
    pulseHaptic,
    enableShake,
    disableShake
  };

})();