/* SPDX-License-Identifier: AGPL-3.0-only */

#include "os_audio_codec.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

namespace {

/* Generated only as test media with the digest-pinned mwader/static-ffmpeg 9.0
 * image from a 997 Hz, 48 kHz stereo, 50 ms source. It is not codec code.
 * sha256: 90971a846ba5d03488be96ada4f9ea6698aa47e7f487adfe65d606519b0270f2 */
constexpr char canaryBase64[] =
	"//uUZAAAAqcRzRVlgAAAAA0goAABGJlFGrnqgAAAADSDAAAAApakA6AdAOXLLxpFuvADuLnBIpnsm/GcspvsmiSCg1dhQJAg"
	"A0BoIhMMFi9evXr16+4OAgCAIOicH+CGc4Df3dPu6eD4IOqBMP5MEHYDP6QQ5d/d0gCAACUmEKH0YjYpz6jAEuBCBaZLpWRh"
	"K3PhgmQNw3JhKiDAc08SqjItGINBEFEKACGnyCaWoAzs3wNoLUhxXwM+IsDDZCAyGPC6YnuBj0jAYGEIGIg+kklwMQCkAUHA"
	"YRCAGEQsAgCsur8DAwHAwMDQsSACAQGAQEGy//g3CDYCH7BcMFoQm0MU/v/CwkQiC4YLhhSIZZDIor3/1eHzCCwzooEUCOoW"
	"ULmIaLl/22Wq3cipSIsTx0mS6ZF42WXXfoVXQWDqYC47UuhswAQAfMAcAUzBOAJ8wWAGFMDuAJzAVgaMw9IWrMUUaFzQDRGA"
	"xBcJaMCFANzAJgFMwHAA5EIAYhCaVLOt//uUZCEM800Lw49/AAAAAA0g4AABC0QtFFXsAAAAADSCgAAE+XHd8vKpN47YiVI3"
	"9f62tDiYtZGpc4rGHP5U0eWLvb4slE2Q+6OpU8qK0lmNqroblUC8wngPTAoCeMLYIAwzRPTGpEBMlDl86+QADDrGHMT8KUwT"
	"wNwKAwCgMBARM1l8P76cGCwKsYnVRuXKroXJRd9TPbXXTZ3DourldnvLe77MWgAAABGGCkJEEEEFNEoMOiUGcCgBAwJUiC2M"
	"CKAciCmMCh30wlwJTArb3OHsCkHAEHHKBGDgDAknsDAcNdgOwSAUNpt4GcIAcIMDhdCyMAIgAw0EO2Wv1gHBAJHBPwNjAFiG"
	"uv+LEDY4CIIMkFsAtYf/7xxBdQFyBmg2wOYQb+n/h6gfQgwggJIQYR4JJ/r/+RYR4KIRYToLYRYToNAmkv/V6/X2FKDYJoXA"
	"PBNC4B4JoZAlikOD//////////8likOC4IggWjYbD4fD4bDUagM0OWstUsD/ggAm//uUZG0ABg6BR2Z6gAAAAA0gwAAAGgFh"
	"a7mdEhAAADSDAAAABmq3+YYTS/1/mKYgxQ6MC/5i35knIwycJ9X5//C6UxichRPtKYr/+KuTRQQq8JFJnGsBVZbErv//+CWA"
	"ofMwrAqYLFTLJZbEt0sS////8AoAoPMofMCaBgkyRkwJSliX0sS7V////9OUAAS5ymJZUvcqUtLHsqseyqx7L/////QTLFLk"
	"onLpLwpDMFLwpjY1tbrZbrZb//////9kqDqYzNUUUwl+oop1MVR9TqY7Wy3Wy3Wy3Wy3WkxMQU1FMy4xMDCqqqqqqqqqqqqq"
	"qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
	"qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
	"//uUZFGP8AAAaQcAAAgAAA0g4AABAAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
	"qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
	"qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
	"qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
	"qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
	"qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

int base64Value(char value)
{
	if (value >= 'A' && value <= 'Z') return value - 'A';
	if (value >= 'a' && value <= 'z') return value - 'a' + 26;
	if (value >= '0' && value <= '9') return value - '0' + 52;
	if (value == '+') return 62;
	if (value == '/') return 63;
	return -1;
}

std::vector<uint8_t> canaryBytes()
{
	std::vector<uint8_t> result;
	uint32_t accumulator = 0u;
	uint32_t bits = 0u;
	for (const char value : std::string(canaryBase64)) {
		const int decoded = base64Value(value);
		if (decoded < 0) continue;
		accumulator = (accumulator << 6u) | static_cast<uint32_t>(decoded);
		bits += 6u;
		if (bits >= 8u) {
			bits -= 8u;
			result.push_back(static_cast<uint8_t>((accumulator >> bits) & 0xffu));
		}
	}
	return result;
}

} // namespace

int main()
{
	const auto suffix = std::to_string(std::chrono::steady_clock::now().time_since_epoch().count());
	const auto root = std::filesystem::temp_directory_path() / ("soundscaper-os-codec-" + suffix);
	const auto inputPath = root / "canary.mp3";
	const auto outputPath = root / "canary.f32le";
	std::error_code error;
	if (!std::filesystem::create_directory(root, error) || error) return 1;
	const auto input = canaryBytes();
	if (input.size() != 1536u) return 2;
	{
		std::ofstream file(inputPath, std::ios::binary | std::ios::out);
		file.write(reinterpret_cast<const char *>(input.data()), static_cast<std::streamsize>(input.size()));
		if (!file) return 3;
	}
	const std::string inputText = inputPath.string();
	const std::string outputText = outputPath.string();
	const soundscaper_pro_os_mp3_decode_request request{
		inputText.c_str(), outputText.c_str(), input.size(), 1024u * 1024u,
	};
	const auto result = soundscaper_pro_os_mp3_decode(&request);
	if (result.status != SOUNDSCAPER_PRO_OS_CODEC_OK || result.native_api_reached != 1u
		|| result.exact_tuple_passed != 1u || result.sample_rate != 48000u
		|| result.channel_count != 2u || result.frame_count == 0u
		|| result.output_bytes != result.frame_count * 2u * sizeof(float)
		|| std::filesystem::file_size(outputPath, error) != result.output_bytes || error) return 4;
	std::ifstream decoded(outputPath, std::ios::binary);
	std::vector<float> samples(result.output_bytes / sizeof(float));
	decoded.read(reinterpret_cast<char *>(samples.data()), static_cast<std::streamsize>(result.output_bytes));
	if (!decoded || !std::all_of(samples.begin(), samples.end(), [](float value) {
		return std::isfinite(value);
	}) || std::all_of(samples.begin(), samples.end(), [](float value) { return value == 0.0f; })) return 5;
	std::filesystem::remove_all(root, error);
	return error ? 6 : 0;
}
