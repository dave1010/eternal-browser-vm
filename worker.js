const BATCH_SIZE = 500_000;
const FRAME_INTERVAL_MS = 1000 / 30;
const STATUS_INTERVAL_MS = 500;

let instance;
let memory;
let canvas;
let context;
let framebuffer;
let imageData;
let imagePixels;
let lastFrame = 0;
let lastStatus = 0;
let consoleBuffer = "";
let stepping = false;

function flushConsole() {
  if (!consoleBuffer) return;
  postMessage({ type: "console", text: consoleBuffer });
  consoleBuffer = "";
}

function render(now) {
  if (!context || !framebuffer || now - lastFrame < FRAME_INTERVAL_MS) return;

  for (let i = 0; i < framebuffer.length; i++) {
    const pixel = framebuffer[i];
    imagePixels[i] =
      0xff000000 |
      ((pixel & 0x0000ff) << 16) |
      (pixel & 0x00ff00) |
      ((pixel & 0xff0000) >>> 16);
  }

  context.putImageData(imageData, 0, 0);
  lastFrame = now;
}

function reportStatus(now) {
  if (now - lastStatus < STATUS_INTERVAL_MS) return;
  postMessage({
    type: "status",
    running: Boolean(instance.exports.vm_running()),
    pc: instance.exports.vm_pc(),
  });
  lastStatus = now;
}

function step() {
  if (!instance || stepping || !instance.exports.vm_running()) return;
  stepping = true;

  instance.exports.vm_run(BATCH_SIZE);

  const now = performance.now();
  render(now);
  flushConsole();
  reportStatus(now);
  stepping = false;

  if (instance.exports.vm_running()) {
    setTimeout(step, 0);
  } else {
    postMessage({ type: "status", running: false, pc: instance.exports.vm_pc() });
  }
}

async function initialize(wasmUrl, offscreenCanvas) {
  canvas = offscreenCanvas;
  context = canvas.getContext("2d", { alpha: false });
  imageData = context.createImageData(canvas.width, canvas.height);
  imagePixels = new Uint32Array(imageData.data.buffer);

  const imports = {
    env: {
      putchar(value) {
        consoleBuffer += String.fromCharCode(value & 0xff);
        if (consoleBuffer.length >= 1024 || value === 10) flushConsole();
      },
      clock_seconds() {
        return BigInt(Math.floor(Date.now() / 1000));
      },
      clock_nanoseconds() {
        return (Date.now() % 1000) * 1_000_000;
      },
    },
  };

  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Unable to load ${wasmUrl}: ${response.status}`);

  const result = await WebAssembly.instantiateStreaming(response, imports);
  instance = result.instance;
  memory = instance.exports.memory;

  const framebufferPtr = instance.exports.vm_framebuffer_ptr();
  const framebufferPixels = canvas.width * canvas.height;
  framebuffer = new Uint32Array(memory.buffer, framebufferPtr, framebufferPixels);

  postMessage({
    type: "ready",
    memoryBytes: instance.exports.vm_memory_size(),
  });
}

async function loadCapsule(buffer) {
  if (!instance) throw new Error("VM is not ready");

  const guestSize = instance.exports.vm_memory_size();
  if (buffer.byteLength > guestSize) {
    throw new Error(`Capsule is ${buffer.byteLength} bytes; guest memory is ${guestSize} bytes`);
  }

  instance.exports.vm_stop();
  const guest = new Uint8Array(memory.buffer, instance.exports.vm_memory_ptr(), guestSize);
  guest.fill(0);
  guest.set(new Uint8Array(buffer));
  instance.exports.vm_reset();

  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  postMessage({ type: "loaded", bytes: buffer.byteLength });
}

self.onmessage = async (event) => {
  try {
    const message = event.data;

    if (message.type === "init") {
      await initialize(message.wasmUrl, message.canvas);
    } else if (message.type === "load") {
      await loadCapsule(message.buffer);
    } else if (message.type === "start") {
      instance.exports.vm_start();
      step();
    } else if (message.type === "stop") {
      instance.exports.vm_stop();
      flushConsole();
      reportStatus(performance.now());
    } else if (message.type === "key") {
      instance.exports.vm_key_event(message.scancode);
    }
  } catch (error) {
    postMessage({ type: "error", message: error.message || String(error) });
  }
};
