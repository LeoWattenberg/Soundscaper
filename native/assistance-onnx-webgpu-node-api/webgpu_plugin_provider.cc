/* SPDX-License-Identifier: AGPL-3.0-only */
#include "webgpu_plugin_provider.h"
#include "ort_singleton_data.h"
#include "webgpu_probe.h"

#ifndef _WIN32
#include <dlfcn.h>
#endif
#include <cstring>
#include <filesystem>
#include <mutex>
#include <stdexcept>
#include <vector>

void ScapeAppendWebGpuPlugin(Ort::SessionOptions& options,
	const std::unordered_map<std::string, std::string>& provider_options) {
	auto& env = OrtSingletonData::GetOrtObjects()->env;
	static std::once_flag registration;
	std::call_once(registration, [&env]() {
#ifdef _WIN32
		HMODULE module = nullptr;
		if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
			reinterpret_cast<LPCWSTR>(&ScapeAppendWebGpuPlugin), &module)) {
			throw std::runtime_error("Cannot locate the authenticated WebGPU plugin closure.");
		}
		wchar_t location[32768];
		const DWORD length = GetModuleFileNameW(module, location, 32768);
		if (!length || length >= 32768) throw std::runtime_error("Cannot locate the authenticated WebGPU plugin closure.");
		const auto root = std::filesystem::path(location).parent_path();
		ScapeRunWebGpuProbe(root / L"onnx-webgpu-device-probe.exe");
		const auto plugin = root / L"onnxruntime_providers_webgpu.dll";
#else
		Dl_info location{};
		if (!dladdr(reinterpret_cast<const void*>(&ScapeAppendWebGpuPlugin), &location) || !location.dli_fname) {
			throw std::runtime_error("Cannot locate the authenticated WebGPU plugin closure.");
		}
		const auto root = std::filesystem::absolute(location.dli_fname).parent_path();
		ScapeRunWebGpuProbe(root / "onnx-webgpu-device-probe");
		const auto plugin = root
#ifdef __APPLE__
			/ "libonnxruntime_providers_webgpu.dylib";
#else
			/ "libonnxruntime_providers_webgpu.so";
#endif
#endif
		env.RegisterExecutionProviderLibrary("soundscaper_webgpu", plugin.c_str());
	});
	const auto& api = Ort::GetApi();
	const OrtEpDevice* const* devices = nullptr;
	size_t count = 0;
	Ort::ThrowOnError(api.GetEpDevices(env, &devices, &count));
	std::vector<const char*> keys, values;
	for (const auto& [key, value] : provider_options) {
		keys.push_back(key.c_str());
		values.push_back(value.c_str());
	}
	for (size_t i = 0; i < count; ++i) {
		if (std::strcmp(api.EpDevice_EpName(devices[i]), "WebGpuExecutionProvider") == 0) {
			Ort::ThrowOnError(api.SessionOptionsAppendExecutionProvider_V2(
				options, env, &devices[i], 1, keys.data(), values.data(), keys.size()));
			return;
		}
	}
	throw std::runtime_error("No compatible WebGPU adapter is available.");
}
