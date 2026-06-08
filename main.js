const canvas = document.querySelector("#screen");
const capsuleInput = document.querySelector("#capsule");
const capsuleUrlForm = document.querySelector("#capsule-url-form");
const capsuleUrlInput = document.querySelector("#capsule-url");
const loadUrlButton = document.querySelector("#load-url");
const remoteCapsuleButtons = document.querySelectorAll("[data-capsule-url]");
const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const status = document.querySelector("#status");
const consoleOutput = document.querySelector("#console");

const queryCapsuleUrl = new URL(location.href).searchParams.get("capsule");
let startAfterLoad = false;

if (queryCapsuleUrl) capsuleUrlInput.value = queryCapsuleUrl;

const worker = new Worker("./worker.js", { type: "module" });
const offscreen = canvas.transferControlToOffscreen();
worker.postMessage(
  { type: "init", wasmUrl: "./vm.wasm", canvas: offscreen },
  [offscreen],
);

function setStatus(text, kind = "") {
  status.textContent = text;
  status.dataset.kind = kind;
}

function disableCapsuleControls(disabled) {
  capsuleInput.disabled = disabled;
  capsuleUrlInput.disabled = disabled;
  loadUrlButton.disabled = disabled;
  for (const button of remoteCapsuleButtons) button.disabled = disabled;
}

function setCapsuleQuery(url = "") {
  const pageUrl = new URL(location.href);
  if (url) {
    pageUrl.searchParams.set("capsule", url);
  } else {
    pageUrl.searchParams.delete("capsule");
  }
  history.replaceState(null, "", pageUrl);
}

function appendConsole(text) {
  consoleOutput.textContent += text;
  if (consoleOutput.textContent.length > 200_000) {
    consoleOutput.textContent = consoleOutput.textContent.slice(-150_000);
  }
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

worker.onmessage = (event) => {
  const message = event.data;

  if (message.type === "ready") {
    setStatus(`Ready. ${(message.memoryBytes / 2 ** 30).toFixed(1)} GiB guest memory allocated.`);
    disableCapsuleControls(false);
    if (queryCapsuleUrl) {
      startAfterLoad = true;
      loadCapsuleUrl(queryCapsuleUrl, "shared capsule");
    }
  } else if (message.type === "loaded") {
    setStatus(`Loaded ${(message.bytes / 2 ** 20).toFixed(1)} MiB capsule.`);
    disableCapsuleControls(false);
    startButton.disabled = false;
    stopButton.disabled = true;
    consoleOutput.textContent = "";
    if (startAfterLoad) {
      startAfterLoad = false;
      worker.postMessage({ type: "start" });
      canvas.focus();
    }
  } else if (message.type === "console") {
    appendConsole(message.text);
  } else if (message.type === "status") {
    setStatus(`${message.running ? "Running" : "Stopped"} at guest PC 0x${(message.pc * 4).toString(16)}.`);
    startButton.disabled = message.running;
    stopButton.disabled = !message.running;
  } else if (message.type === "error") {
    setStatus(message.message, "error");
    disableCapsuleControls(false);
  }
};

worker.onerror = (event) => {
  setStatus(event.message || "Worker failed to start.", "error");
};

capsuleInput.addEventListener("change", async () => {
  const file = capsuleInput.files[0];
  if (!file) return;

  capsuleUrlInput.value = "";
  setCapsuleQuery();
  await loadCapsule(file, file.name);
});

for (const button of remoteCapsuleButtons) {
  button.addEventListener("click", async () => {
    capsuleUrlInput.value = button.dataset.capsuleUrl;
    setCapsuleQuery(button.dataset.capsuleUrl);
    await loadCapsuleUrl(button.dataset.capsuleUrl, button.dataset.capsuleName);
  });
}

capsuleUrlForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = capsuleUrlInput.value.trim();
  setCapsuleQuery(url);
  await loadCapsuleUrl(url, "URL capsule");
});

async function loadCapsuleUrl(url, name) {
  try {
    const parsedUrl = new URL(url, location.href);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Capsule URL must use HTTP or HTTPS.");
    }

    disableCapsuleControls(true);
    startButton.disabled = true;
    stopButton.disabled = true;
    setStatus(`Downloading ${name}...`);
    const response = await fetch(parsedUrl);
    if (!response.ok) {
      throw new Error(`Unable to download ${name}: ${response.status}`);
    }
    await loadCapsule(response, name, parsedUrl.pathname.toLowerCase().endsWith(".xz"));
  } catch (error) {
    startAfterLoad = false;
    setStatus(error.message || String(error), "error");
    disableCapsuleControls(false);
  }
}

async function loadCapsule(source, name, compressed = name.toLowerCase().endsWith(".xz")) {
  try {
    disableCapsuleControls(true);
    startButton.disabled = true;
    stopButton.disabled = true;

    let buffer;
    if (compressed) {
      setStatus(`Decompressing ${name}...`);
      buffer = await decompressXz(source.body || source.stream());
    } else {
      setStatus(`Loading ${name}...`);
      buffer = await source.arrayBuffer();
    }

    setStatus(`Loading ${(buffer.byteLength / 2 ** 20).toFixed(1)} MiB capsule...`);
    worker.postMessage({ type: "load", buffer }, [buffer]);
  } catch (error) {
    startAfterLoad = false;
    setStatus(error.message || String(error), "error");
    disableCapsuleControls(false);
  }
}

startButton.addEventListener("click", () => {
  worker.postMessage({ type: "start" });
  canvas.focus();
});

stopButton.addEventListener("click", () => {
  worker.postMessage({ type: "stop" });
});

canvas.addEventListener("keydown", (event) => {
  event.preventDefault();
  worker.postMessage({ type: "key", scancode: browserScancode(event.code) });
});

canvas.addEventListener("keyup", (event) => {
  event.preventDefault();
  worker.postMessage({ type: "key", scancode: -browserScancode(event.code) });
});

function browserScancode(code) {
  const known = {
    Enter: 40,
    Escape: 41,
    Backspace: 42,
    Tab: 43,
    Space: 44,
    Minus: 45,
    Equal: 46,
    BracketLeft: 47,
    BracketRight: 48,
    Backslash: 49,
    IntlHash: 50,
    Semicolon: 51,
    Quote: 52,
    Backquote: 53,
    Comma: 54,
    Period: 55,
    Slash: 56,
    CapsLock: 57,
    F1: 58,
    F2: 59,
    F3: 60,
    F4: 61,
    F5: 62,
    F6: 63,
    F7: 64,
    F8: 65,
    F9: 66,
    F10: 67,
    F11: 68,
    F12: 69,
    PrintScreen: 70,
    ScrollLock: 71,
    Pause: 72,
    Insert: 73,
    ArrowRight: 79,
    ArrowLeft: 80,
    ArrowDown: 81,
    ArrowUp: 82,
    NumLock: 83,
    NumpadDivide: 84,
    NumpadMultiply: 85,
    NumpadSubtract: 86,
    NumpadAdd: 87,
    NumpadEnter: 88,
    Numpad1: 89,
    Numpad2: 90,
    Numpad3: 91,
    Numpad4: 92,
    Numpad5: 93,
    Numpad6: 94,
    Numpad7: 95,
    Numpad8: 96,
    Numpad9: 97,
    Numpad0: 98,
    NumpadDecimal: 99,
    IntlBackslash: 100,
    ContextMenu: 101,
    NumpadEqual: 103,
    Delete: 76,
    Home: 74,
    End: 77,
    PageUp: 75,
    PageDown: 78,
    ShiftLeft: 225,
    ShiftRight: 229,
    ControlLeft: 224,
    ControlRight: 228,
    AltLeft: 226,
    AltRight: 230,
  };

  if (known[code]) return known[code];
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3) - 61;
  if (/^Digit[1-9]$/.test(code)) return Number(code.at(-1)) + 29;
  if (code === "Digit0") return 39;
  return 0;
}

async function decompressXz(stream) {
  const xz = globalThis["xz-decompress"];
  if (!xz?.XzReadableStream) {
    throw new Error("XZ decoder failed to load.");
  }

  return new Response(new xz.XzReadableStream(stream)).arrayBuffer();
}
