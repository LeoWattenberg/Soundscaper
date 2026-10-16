/* SPDX-License-Identifier: AGPL-3.0-only */
#include "onnxruntime_cxx_api.h"
#include "webgpu_probe.h"

#include <chrono>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <thread>

// Self-authored ONNX identity graph: float32 input[1] -> output[1], opset 13.
// Creating and running a real session forces Dawn's asynchronous adapter
// initialization, which device enumeration alone does not exercise.
static constexpr unsigned char kProbeModel[] = {
	0x08,0x0a,0x3a,0x51,0x0a,0x19,0x0a,0x05,0x69,0x6e,0x70,0x75,0x74,0x12,0x06,0x6f,
	0x75,0x74,0x70,0x75,0x74,0x22,0x08,0x49,0x64,0x65,0x6e,0x74,0x69,0x74,0x79,0x12,
	0x09,0x67,0x70,0x75,0x2d,0x70,0x72,0x6f,0x62,0x65,0x5a,0x13,0x0a,0x05,0x69,0x6e,
	0x70,0x75,0x74,0x12,0x0a,0x0a,0x08,0x08,0x01,0x12,0x04,0x0a,0x02,0x08,0x01,0x62,
	0x14,0x0a,0x06,0x6f,0x75,0x74,0x70,0x75,0x74,0x12,0x0a,0x0a,0x08,0x08,0x01,0x12,
	0x04,0x0a,0x02,0x08,0x01,0x42,0x02,0x10,0x0d,
};

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <sys/resource.h>
#include <unistd.h>
#endif

int main(int argc, char** argv) {
	if (argc != 2) return 125;
	char* end = nullptr;
	const auto parent = std::strtoull(argv[1], &end, 10);
	if (!parent || !end || *end != '\0') return 125;
#ifdef _WIN32
	if (parent > MAXDWORD) return 125;
	HANDLE parent_process = OpenProcess(SYNCHRONIZE, FALSE, static_cast<DWORD>(parent));
	if (!parent_process) return 125;
	std::thread([parent_process]() {
		// Either the parent exits or this probe exceeds its hard deadline.
		WaitForSingleObject(parent_process, 5000);
		ExitProcess(125);
	}).detach();
	wchar_t executable[32768];
	const DWORD length = GetModuleFileNameW(nullptr, executable, 32768);
	if (!length || length >= 32768) return 125;
	const auto plugin = std::filesystem::path(executable).parent_path() / L"onnxruntime_providers_webgpu.dll";
#else
	const rlimit no_core{0, 0};
	setrlimit(RLIMIT_CORE, &no_core);
	if (parent != static_cast<unsigned long long>(getppid())) return 125;
	std::thread([parent]() {
		const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
		while (std::chrono::steady_clock::now() < deadline) {
			if (parent != static_cast<unsigned long long>(getppid())) std::_Exit(125);
			std::this_thread::sleep_for(std::chrono::milliseconds(25));
		}
		std::_Exit(125);
	}).detach();
	const auto plugin = std::filesystem::absolute(argv[0]).parent_path()
#ifdef __APPLE__
		/ "libonnxruntime_providers_webgpu.dylib";
#else
		/ "libonnxruntime_providers_webgpu.so";
#endif
#endif
	try {
		Ort::InitApi();
		Ort::Env env(ORT_LOGGING_LEVEL_FATAL, "soundscaper-webgpu-probe");
		env.RegisterExecutionProviderLibrary("soundscaper_webgpu_probe", plugin.c_str());
		const OrtEpDevice* const* devices = nullptr;
		size_t count = 0;
		const auto& api = Ort::GetApi();
		Ort::ThrowOnError(api.GetEpDevices(env, &devices, &count));
		for (size_t i = 0; i < count; ++i) {
			if (!ScapeIsWebGpuPluginDevice(devices[i], plugin)) continue;
			Ort::SessionOptions options;
			Ort::ThrowOnError(api.SessionOptionsAppendExecutionProvider_V2(options, env, &devices[i], 1, nullptr, nullptr, 0));
			options.AddConfigEntry("session.disable_cpu_ep_fallback", "1");
			options.SetIntraOpNumThreads(1);
			Ort::Session session(env, kProbeModel, sizeof(kProbeModel), options);
			float value = 42.0f;
			const int64_t shape[] = {1};
			auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
			auto input = Ort::Value::CreateTensor<float>(memory, &value, 1, shape, 1);
			const char* inputs[] = {"input"};
			const char* outputs[] = {"output"};
			auto result = session.Run(Ort::RunOptions{nullptr}, inputs, &input, 1, outputs, 1);
			return result.size() == 1 && result[0].IsTensor()
				&& result[0].GetTensorData<float>()[0] == value ? 0 : 1;
		}
	} catch (...) { return 1; }
	return 1;
}
