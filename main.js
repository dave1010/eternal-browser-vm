const canvas = document.querySelector("#screen");
const capsuleInput = document.querySelector("#capsule");
const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const status = document.querySelector("#status");
const consoleOutput = document.querySelector("#console");

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
    capsuleInput.disabled = false;
  } else if (message.type === "loaded") {
    setStatus(`Loaded ${(message.bytes / 2 ** 20).toFixed(1)} MiB capsule.`);
    startButton.disabled = false;
    stopButton.disabled = true;
    consoleOutput.textContent = "";
  } else if (message.type === "console") {
    appendConsole(message.text);
  } else if (message.type === "status") {
    setStatus(`${message.running ? "Running" : "Stopped"} at guest PC 0x${(message.pc * 4).toString(16)}.`);
    startButton.disabled = message.running;
    stopButton.disabled = !message.running;
  } else if (message.type === "error") {
    setStatus(message.message, "error");
  }
};

worker.onerror = (event) => {
  setStatus(event.message || "Worker failed to start.", "error");
};

capsuleInput.addEventListener("change", async () => {
  const file = capsuleInput.files[0];
  if (!file) return;

  try {
    startButton.disabled = true;
    stopButton.disabled = true;

    let buffer;
    if (file.name.toLowerCase().endsWith(".xz")) {
      setStatus(`Decompressing ${file.name}...`);
      buffer = await decompressXz(file);
    } else {
      setStatus(`Loading ${file.name}...`);
      buffer = await file.arrayBuffer();
    }

    setStatus(`Loading ${(buffer.byteLength / 2 ** 20).toFixed(1)} MiB capsule...`);
    worker.postMessage({ type: "load", buffer }, [buffer]);
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
});

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
    ArrowRight: 79,
    ArrowLeft: 80,
    ArrowDown: 81,
    ArrowUp: 82,
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

async function decompressXz(file) {
  const xz = globalThis["xz-decompress"];
  if (!xz?.XzReadableStream) {
    throw new Error("XZ decoder failed to load.");
  }

  const stream = new xz.XzReadableStream(file.stream());
  return new Response(stream).arrayBuffer();
}
