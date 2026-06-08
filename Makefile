CLANG ?= clang
CAPSULE ?= ../eternal/capsules/vmlinux.bootimage.xz
WASM_LD_FLAGS := \
	-Wl,--no-entry \
	-Wl,--export-memory \
	-Wl,--initial-memory=1611661312 \
	-Wl,--max-memory=1611661312 \
	-Wl,--strip-all

all: vm.wasm

vm.wasm: vm_wasm.c
	$(CLANG) --target=wasm32 -O3 -fwrapv -nostdlib $(WASM_LD_FLAGS) -o $@ $<

serve: vm.wasm
	python3 -m http.server 8000

test: vm.wasm
	node test_vm.js

test-xz: vm.wasm
	node test_xz.js $(CAPSULE)

clean:
	rm -f vm.wasm

.PHONY: all serve test test-xz clean
