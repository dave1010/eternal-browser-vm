const fs = require("fs");
const { Readable } = require("stream");
const { XzReadableStream } = require("./vendor/xz-decompress.min.js");

async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error("usage: node test_xz.js <capsule.xz>");

  const compressed = Readable.toWeb(fs.createReadStream(filename));
  const decompressed = new Response(new XzReadableStream(compressed));
  const capsule = await decompressed.arrayBuffer();
  const firstWords = new Int32Array(capsule, 0, 3);

  if (firstWords[0] !== 0 || firstWords[1] !== 0 || firstWords[2] !== 12) {
    throw new Error("decompressed file does not begin with the ESI boot instruction");
  }

  let output = "";
  const wasm = fs.readFileSync("vm.wasm");
  const { instance } = await WebAssembly.instantiate(wasm, {
    env: {
      putchar(value) {
        if (output.length < 4096) output += String.fromCharCode(value);
      },
      clock_seconds() {
        return BigInt(Math.floor(Date.now() / 1000));
      },
      clock_nanoseconds() {
        return (Date.now() % 1000) * 1_000_000;
      },
    },
  });

  const vm = instance.exports;
  new Uint8Array(vm.memory.buffer, vm.vm_memory_ptr(), capsule.byteLength)
    .set(new Uint8Array(capsule));
  vm.vm_start();

  for (let i = 0; i < 20 && vm.vm_running(); i++) {
    vm.vm_run(500_000);
  }

  if (!output.includes("Linux version") || !output.includes("ESI Subleq+ OISC")) {
    throw new Error(`capsule did not emit the expected Linux boot banner: ${output.slice(0, 200)}`);
  }

  console.log(
    `XZ VM integration test passed (${(capsule.byteLength / 2 ** 20).toFixed(1)} MiB decompressed)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
