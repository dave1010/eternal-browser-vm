#include <stddef.h>
#include <stdint.h>

#define MEM_WORDS (3u << 27)
#define FB_WIDTH 800u
#define FB_HEIGHT 512u
#define FB_WORDS (FB_WIDTH * FB_HEIGHT)
#define FB_ADDR_WORDS (MEM_WORDS - FB_WORDS)
#define TIMER_INTERVAL 800000u
#define KEY_QUEUE_SIZE 256u

__attribute__((import_module("env"), import_name("putchar")))
extern void host_putchar(int value);

__attribute__((import_module("env"), import_name("clock_seconds")))
extern int64_t host_clock_seconds(void);

__attribute__((import_module("env"), import_name("clock_nanoseconds")))
extern int32_t host_clock_nanoseconds(void);

static int32_t mem[MEM_WORDS];
static uint32_t pc;
static uint32_t timer;
static uint32_t running;
static int32_t key_queue[KEY_QUEUE_SIZE];
static uint32_t key_read;
static uint32_t key_write;

static int32_t poll_key(void) {
    int32_t value;

    if (key_read == key_write)
        return 0;

    value = key_queue[key_read];
    key_read = (key_read + 1) % KEY_QUEUE_SIZE;
    return value;
}

static int32_t fetch_operand(void) {
    int32_t raw = mem[pc++];

    if (raw & 1)
        return mem[(uint32_t)raw / 4] / 4;
    return raw / 4;
}

__attribute__((export_name("vm_memory_ptr")))
uint32_t vm_memory_ptr(void) {
    return (uint32_t)(uintptr_t)mem;
}

__attribute__((export_name("vm_memory_size")))
uint32_t vm_memory_size(void) {
    return sizeof(mem);
}

__attribute__((export_name("vm_framebuffer_ptr")))
uint32_t vm_framebuffer_ptr(void) {
    return (uint32_t)(uintptr_t)&mem[FB_ADDR_WORDS];
}

__attribute__((export_name("vm_reset")))
void vm_reset(void) {
    pc = 0;
    timer = 0;
    running = 0;
    key_read = 0;
    key_write = 0;
}

__attribute__((export_name("vm_start")))
void vm_start(void) {
    pc = 0;
    timer = 0;
    running = 1;
}

__attribute__((export_name("vm_stop")))
void vm_stop(void) {
    running = 0;
}

__attribute__((export_name("vm_running")))
uint32_t vm_running(void) {
    return running;
}

__attribute__((export_name("vm_pc")))
uint32_t vm_pc(void) {
    return pc;
}

__attribute__((export_name("vm_key_event")))
void vm_key_event(int32_t value) {
    uint32_t next = (key_write + 1) % KEY_QUEUE_SIZE;

    if (next == key_read)
        return;

    key_queue[key_write] = value;
    key_write = next;
}

__attribute__((export_name("vm_run")))
uint32_t vm_run(uint32_t budget) {
    uint32_t executed = 0;

    while (running && executed < budget) {
        int32_t a = fetch_operand();
        int32_t b = fetch_operand();
        int32_t c = fetch_operand();

        if (c == 0) {
            running = 0;
            break;
        }

        if (a == -1) {
            mem[(uint32_t)b] = poll_key();
        } else if (b == -1) {
            host_putchar(mem[(uint32_t)a] & 0xff);
        } else {
            if (a == 64) {
                int64_t seconds = host_clock_seconds();
                mem[64] = (int32_t)seconds;
                mem[65] = (int32_t)(seconds >> 32);
                mem[66] = host_clock_nanoseconds();
            }

            mem[(uint32_t)b] -= mem[(uint32_t)a];
            if (mem[(uint32_t)b] <= 0) {
                pc = (uint32_t)c;
            }

            if (mem[0] && ++timer > TIMER_INTERVAL) {
                mem[1] = (int32_t)(pc * 4);
                pc = (uint32_t)mem[0] / 4;
                timer = 0;
            }
        }

        executed++;
    }

    return executed;
}
