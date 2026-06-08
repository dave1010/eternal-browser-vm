const fs = require("fs");

async function main() {
  let output = "";
  const bytes = fs.readFileSync("vm.wasm");
  const imports = {
    env: {
      putchar(value) {
        output += String.fromCharCode(value);
      },
      clock_seconds() {
        return 0n;
      },
      clock_nanoseconds() {
        return 0;
      },
    },
  };

  const { instance } = await WebAssembly.instantiate(bytes, imports);
  const vm = instance.exports;
  const words = new Int32Array(vm.memory.buffer, vm.vm_memory_ptr(), 7);

  // Output the value at word 6, then encounter a zero-C halt instruction.
  words.set([24, -4, 12, 0, 0, 0, 65]);
  vm.vm_start();
  const executed = vm.vm_run(10);

  if (output !== "A")
    throw new Error(`expected console output A, got ${JSON.stringify(output)}`);
  if (executed !== 1)
    throw new Error(`expected one executed instruction, got ${executed}`);
  if (vm.vm_running())
    throw new Error("expected VM to halt");

  console.log(`VM smoke test passed (${bytes.length} byte Wasm module)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
