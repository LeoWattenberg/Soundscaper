/* SPDX-License-Identifier: AGPL-3.0-only */
#include "webgpu_probe.h"
#include <array>
#include <fstream>

struct OrtKeyValuePairs { const char* library; };
struct OrtEpDevice { const char* name; const OrtKeyValuePairs* metadata; };

int main(int argc, char** argv) {
	if (argc != 2) return 1;
	const auto path = std::filesystem::absolute(argv[1]);
	std::ofstream(path).put('x');
	const auto encoded = path.u8string();
	const std::string library(encoded.begin(), encoded.end());
	const OrtKeyValuePairs valid{library.c_str()}, foreign{"/outside/untrusted-provider"};
	const OrtEpDevice builtin{"WebGpuExecutionProvider", nullptr};
	const OrtEpDevice plugin{"WebGpuExecutionProvider", &valid};
	const OrtEpDevice substitute{"WebGpuExecutionProvider", &foreign};
	const OrtEpDevice cpu{"CPUExecutionProvider", &valid};
	OrtApi api{};
	api.EpDevice_EpName = [](const OrtEpDevice* device) -> const char* { return device->name; };
	api.EpDevice_EpMetadata = [](const OrtEpDevice* device) -> const OrtKeyValuePairs* { return device->metadata; };
	api.GetKeyValue = [](const OrtKeyValuePairs* metadata, const char*) -> const char* { return metadata->library; };
	Ort::InitApi(&api);
	const std::array<const OrtEpDevice*, 4> devices{&builtin, &plugin, &substitute, &cpu};
	const OrtEpDevice* selected = nullptr;
	for (const auto* device : devices) {
		if (ScapeIsWebGpuPluginDevice(device, path)) { selected = device; break; }
	}
	const bool valid_selection = selected == &plugin && !ScapeIsWebGpuPluginDevice(&builtin, path)
		&& !ScapeIsWebGpuPluginDevice(&substitute, path) && !ScapeIsWebGpuPluginDevice(&cpu, path);
	std::filesystem::remove(path);
	return valid_selection ? 0 : 1;
}
