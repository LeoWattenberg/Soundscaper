/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const SOURCE_ROOT = join(ROOT, 'native/framescaper-openfx-host/src');
const FAILURE = 'FRAMESCAPER_GPU_STUB_FAILURE';

let retainedFixture;
let retainedCleanup = () => undefined;

const OPENCL_STUB = String.raw`
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <cstdint>

static int contexts_created;
static int contexts_released;
static int queues_created;
static int queues_released;
static int buffers_created;
static int buffers_released;
static int programs_created;
static int programs_released;

static bool failure(const char *name)
{
	const char *value = std::getenv("${FAILURE}");
	return value != nullptr && std::strcmp(value, name) == 0;
}

static void *handle(const std::uintptr_t value)
{
	return reinterpret_cast<void *>(value);
}

extern "C" int clGetPlatformIDs(unsigned count, void **platforms, unsigned *total)
{
	if (total != nullptr) *total = 1;
	if (platforms != nullptr && count > 0) platforms[0] = handle(1);
	return 0;
}

extern "C" int clGetDeviceIDs(void *, unsigned long long, unsigned count, void **devices, unsigned *total)
{
	if (total != nullptr) *total = 1;
	if (devices != nullptr && count > 0) devices[0] = handle(2);
	return 0;
}

extern "C" void *clCreateContext(const std::intptr_t *, unsigned, const void **,
	void (*)(const char *, const void *, std::size_t, void *), void *, int *error)
{
	++contexts_created;
	*error = 0;
	return handle(10);
}

extern "C" void *clCreateCommandQueue(void *, void *, unsigned long long, int *error)
{
	++queues_created;
	*error = failure("opencl-queue") ? -1 : 0;
	return handle(20);
}

extern "C" void *clCreateBuffer(void *, unsigned long long, std::size_t, void *, int *error)
{
	++buffers_created;
	*error = failure("opencl-buffer-2") && buffers_created == 2 ? -1 : 0;
	return handle(100 + static_cast<std::uintptr_t>(buffers_created));
}

extern "C" int clEnqueueReadBuffer(void *, void *, unsigned, std::size_t, std::size_t,
	void *, unsigned, const void **, void **)
{
	return 0;
}

extern "C" int clFinish(void *) { return 0; }
extern "C" int clReleaseMemObject(void *) { ++buffers_released; return 0; }
extern "C" int clReleaseCommandQueue(void *) { ++queues_released; return 0; }
extern "C" int clReleaseContext(void *) { ++contexts_released; return 0; }

extern "C" void *clCreateProgramWithSource(void *, unsigned, const char **,
	const std::size_t *, int *error)
{
	++programs_created;
	*error = failure("opencl-program-create") ? -1 : 0;
	return handle(200);
}

extern "C" int clBuildProgram(void *, unsigned, const void **, const char *,
	void (*)(void *, void *), void *)
{
	return failure("opencl-program-build") ? -1 : 0;
}

extern "C" int clReleaseProgram(void *) { ++programs_released; return 0; }

extern "C" int framescaper_gpu_stub_counter(const char *name)
{
	if (std::strcmp(name, "contexts-created") == 0) return contexts_created;
	if (std::strcmp(name, "contexts-released") == 0) return contexts_released;
	if (std::strcmp(name, "queues-created") == 0) return queues_created;
	if (std::strcmp(name, "queues-released") == 0) return queues_released;
	if (std::strcmp(name, "buffers-created") == 0) return buffers_created;
	if (std::strcmp(name, "buffers-released") == 0) return buffers_released;
	if (std::strcmp(name, "programs-created") == 0) return programs_created;
	if (std::strcmp(name, "programs-released") == 0) return programs_released;
	return 0;
}
`;

const CUDA_STUB = String.raw`
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <cstdint>

static int contexts_created;
static int contexts_released;
static int queues_created;
static int queues_released;
static int buffers_created;
static int buffers_released;

extern "C" int cuInit(unsigned) { return 0; }
extern "C" int cuDeviceGet(int *device, int) { *device = 1; return 0; }
extern "C" int cuCtxCreate_v2(void **context, unsigned, int)
{
	++contexts_created;
	*context = reinterpret_cast<void *>(static_cast<std::uintptr_t>(10));
	return 0;
}
extern "C" int cuCtxDestroy_v2(void *) { ++contexts_released; return 0; }
extern "C" int cuStreamCreate(void **stream, unsigned)
{
	++queues_created;
	*stream = reinterpret_cast<void *>(static_cast<std::uintptr_t>(20));
	return 0;
}
extern "C" int cuStreamDestroy_v2(void *) { ++queues_released; return 0; }
extern "C" int cuMemAlloc_v2(std::uintptr_t *allocation, std::size_t)
{
	++buffers_created;
	*allocation = 100 + static_cast<std::uintptr_t>(buffers_created);
	return 0;
}
extern "C" int cuMemFree_v2(std::uintptr_t) { ++buffers_released; return 0; }
extern "C" int cuMemcpyHtoD_v2(std::uintptr_t, const void *, std::size_t)
{
	const char *value = std::getenv("${FAILURE}");
	return value != nullptr && std::strcmp(value, "cuda-copy") == 0 ? -1 : 0;
}
extern "C" int cuMemcpyDtoH_v2(void *, std::uintptr_t, std::size_t) { return 0; }
extern "C" int cuCtxSynchronize() { return 0; }

extern "C" int framescaper_gpu_stub_counter(const char *name)
{
	if (std::strcmp(name, "contexts-created") == 0) return contexts_created;
	if (std::strcmp(name, "contexts-released") == 0) return contexts_released;
	if (std::strcmp(name, "queues-created") == 0) return queues_created;
	if (std::strcmp(name, "queues-released") == 0) return queues_released;
	if (std::strcmp(name, "buffers-created") == 0) return buffers_created;
	if (std::strcmp(name, "buffers-released") == 0) return buffers_released;
	return 0;
}
`;

const EGL_STUB = String.raw`
#include <cstdlib>
#include <cstring>
#include <cstdint>

static int contexts_created;
static int contexts_released;
static int surfaces_created;
static int surfaces_released;
static int displays_terminated;

static void *handle(const std::uintptr_t value)
{
	return reinterpret_cast<void *>(value);
}

extern "C" void *eglGetDisplay(void *) { return handle(1); }
extern "C" unsigned eglInitialize(void *, int *major, int *minor)
{
	*major = 1;
	*minor = 5;
	return 1;
}
extern "C" unsigned eglBindAPI(unsigned) { return 1; }
extern "C" unsigned eglChooseConfig(void *, const int *, void **config, int, int *count)
{
	*config = handle(2);
	*count = 1;
	return 1;
}
extern "C" void *eglCreatePbufferSurface(void *, void *, const int *)
{
	++surfaces_created;
	return handle(3);
}
extern "C" void *eglCreateContext(void *, void *, void *, const int *)
{
	++contexts_created;
	return handle(4);
}
extern "C" unsigned eglMakeCurrent(void *, void *, void *, void *context)
{
	const char *value = std::getenv("${FAILURE}");
	return context != nullptr && value != nullptr
		&& std::strcmp(value, "egl-make-current") == 0 ? 0 : 1;
}
extern "C" unsigned eglDestroyContext(void *, void *) { ++contexts_released; return 1; }
extern "C" unsigned eglDestroySurface(void *, void *) { ++surfaces_released; return 1; }
extern "C" unsigned eglTerminate(void *) { ++displays_terminated; return 1; }
extern "C" void *eglGetProcAddress(const char *) { return nullptr; }

extern "C" int framescaper_gpu_stub_counter(const char *name)
{
	if (std::strcmp(name, "contexts-created") == 0) return contexts_created;
	if (std::strcmp(name, "contexts-released") == 0) return contexts_released;
	if (std::strcmp(name, "surfaces-created") == 0) return surfaces_created;
	if (std::strcmp(name, "surfaces-released") == 0) return surfaces_released;
	if (std::strcmp(name, "displays-terminated") == 0) return displays_terminated;
	return 0;
}
`;

const HARNESS = String.raw`
#include "gpu_runtime.hpp"

#include <dlfcn.h>
#include <iostream>
#include <string>
#include <vector>

using framescaper::openfx::Backend;
using framescaper::openfx::GpuFrameBinding;
using framescaper::openfx::GpuRenderSession;
using framescaper::openfx::RgbaFrame;
using framescaper::openfx::compile_active_opencl_program;
using framescaper::openfx::gpu_runtime_error;

int main(int argc, char **argv)
{
	if (argc != 3) return 2;
	const std::string backend_name{argv[1]};
	const bool compile_program = std::string{argv[2]} == "compile";
	const char *library_name = backend_name == "opencl" ? "libOpenCL.so.1"
		: backend_name == "cuda" ? "libcuda.so.1" : "libEGL.so.1";
	void *retained = dlopen(library_name, RTLD_NOW | RTLD_LOCAL);
	if (retained == nullptr) return 3;
	using Counter = int (*)(const char *);
	auto counter = reinterpret_cast<Counter>(dlsym(retained, "framescaper_gpu_stub_counter"));
	if (counter == nullptr) return 4;

	const Backend backend = backend_name == "opencl" ? Backend::opencl
		: backend_name == "cuda" ? Backend::cuda : Backend::opengl;
	RgbaFrame input;
	RgbaFrame output;
	input.rgba.assign(input.layout.byte_length, 0);
	output.rgba.assign(output.layout.byte_length, 0);
	std::vector<GpuFrameBinding> frames{
		{"Source", &input, false}, {"Output", &output, true},
	};
	int caught = 0;
	int compile_status = -1;
	std::string error_code;
	try {
		auto session = GpuRenderSession::create(backend, frames);
		if (compile_program) {
			void *program = nullptr;
			session->make_active();
			compile_status = compile_active_opencl_program("invalid kernel", 0, &program);
			session->clear_active();
		}
	} catch (const gpu_runtime_error &error) {
		caught = 1;
		error_code = error.code();
	}

	std::cout << "{\"caught\":" << caught
		<< ",\"compileStatus\":" << compile_status
		<< ",\"errorCode\":\"" << error_code << "\""
		<< ",\"contextsCreated\":" << counter("contexts-created")
		<< ",\"contextsReleased\":" << counter("contexts-released")
		<< ",\"queuesCreated\":" << counter("queues-created")
		<< ",\"queuesReleased\":" << counter("queues-released")
		<< ",\"buffersCreated\":" << counter("buffers-created")
		<< ",\"buffersReleased\":" << counter("buffers-released")
		<< ",\"programsCreated\":" << counter("programs-created")
		<< ",\"programsReleased\":" << counter("programs-released")
		<< ",\"surfacesCreated\":" << counter("surfaces-created")
		<< ",\"surfacesReleased\":" << counter("surfaces-released")
		<< ",\"displaysTerminated\":" << counter("displays-terminated")
		<< "}\n";
	dlclose(retained);
	return 0;
}
`;

export function buildOpenFxGpuDriverFixture(context) {
	if (retainedFixture !== undefined) return retainedFixture;
	if (process.platform !== 'linux') {
		context.skip('The fake GPU driver loader fixture currently targets Linux dlopen semantics.');
		retainedFixture = null;
		return null;
	}
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++20 compiler is unavailable.');
		retainedFixture = null;
		return null;
	}
	const directory = mkdtempSync(join(tmpdir(), 'framescaper-openfx-gpu-driver-'));
	try {
		compileShared(directory, 'libOpenCL.so.1', OPENCL_STUB);
		compileShared(directory, 'libcuda.so.1', CUDA_STUB);
		compileShared(directory, 'libEGL.so.1', EGL_STUB);
		const harnessSource = join(directory, 'gpu-driver-harness.cpp');
		const harness = join(directory, 'gpu-driver-harness');
		writeFileSync(harnessSource, HARNESS);
		assertBuilt(spawnSync('c++', [
			'-std=c++20', '-Wall', '-Wextra', '-Werror',
			'-DFRAMESCAPER_OPENFX_CONTRACT_ONLY=1', '-I', SOURCE_ROOT,
			join(SOURCE_ROOT, 'gpu_runtime.cpp'), harnessSource, '-ldl', '-o', harness,
		], { encoding: 'utf8' }), 'GPU driver harness');
		retainedCleanup = () => rmSync(directory, { recursive: true, force: true });
		retainedFixture = Object.freeze({
			run(backend, failure, operation = 'construct') {
				const result = spawnSync(harness, [backend, operation], {
					encoding: 'utf8',
					env: {
						...process.env,
						LD_LIBRARY_PATH: directory,
						[FAILURE]: failure,
					},
				});
				if (result.status !== 0) {
					throw new Error(`The GPU driver harness failed (${String(result.status)}):\n${result.stderr || result.stdout}`);
				}
				return JSON.parse(result.stdout);
			},
		});
		return retainedFixture;
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

export function cleanupOpenFxGpuDriverFixture() { retainedCleanup(); }

function compileShared(directory, name, source) {
	const sourcePath = join(directory, `${name}.cpp`);
	writeFileSync(sourcePath, source);
	assertBuilt(spawnSync('c++', [
		'-std=c++20', '-Wall', '-Wextra', '-Werror', '-fPIC', '-shared',
		sourcePath, '-o', join(directory, name),
	], { encoding: 'utf8' }), name);
}

function assertBuilt(result, label) {
	if (result.status !== 0) throw new Error(`${label} failed to build:\n${result.stderr || result.stdout}`);
}
