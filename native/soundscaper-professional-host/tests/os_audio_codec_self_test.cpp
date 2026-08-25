/* SPDX-License-Identifier: AGPL-3.0-only */

#include "os_audio_codec.h"
#include "os_aac_m4a_profile.h"
#include "os_mp3_profile.h"

#include <algorithm>
#include <array>
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

/* AAC-LC test media generated from the same 997 Hz source with
 * docker.io/mwader/static-ffmpeg@sha256:
 * b90574a4e2ae62b763c39c384526689e7eb435da6398f4fb3f6c3f1c6a14ce33.
 * M4A sha256: 1db255988826f9f6f8322f6cfb6c82c6ee7873c3252c822bc0ac1793d5729451 */
constexpr char aacM4aCanaryBase64[] =
	"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";

/* The negative fixture carries the identical AAC-LC elementary stream in
 * ADTS, not M4A. sha256: 20eac200d9047ae50a6f34b7fbbe610a49a48bb58c7208df28f6a4789b67e826 */
constexpr char aacAdtsCanaryBase64[] =
	"//FMgCXf/NwATGF2YzYzLjEuMTAwAEJVH/////gCOucMIeocyVu2+9/fqRcmTW5MkknY9YIDtbtW2rZzFmHY3Fuktm09hO4u"
	"ae4vWdneI3l1L/iQIjtivJcR/8/9a6mUXp3sPN3cPJW4dlaR1tiuLYTbVk09l3FsJwrFcvWzZVMzFhNNWTTUwz1rcbFxsW2x"
	"cbFxsXG8Hddrutbrtbrps6bOmzps6bOmzps6bOmxps6bOmzos6LOJKJKJKJKJKJKJKJKJKJKJKJKJKJKJKJKJKJKJKJKJKJK"
	"JKJKJKJKJKJKJKJKJKJKJKJKJKJKJKJKeKeKefefiiiiiiiiiiiiiiiiiiiiiiiijh+Lw6hzJW7b739+pFyZNbkySSdj1ggA"
	"AAAAAAAAAAAAAAAAAA7/8UyAM3/8IUxs/gf+f+f+RdpputVGRS7EYorlZk/7f4+pbx1Navr+nx8cWLub/8f9S+LlUn/x/iON"
	"auqCJd2x2Kz4uzs7P6TYzOxyAZ2QhZ1rUA/vYkWXsDJ9CmdRhrGYszHLaafYWaRtL83YWaRpX5SqZmBxJKRZMZJpJoWD68Ma"
	"5GdiMDpdn+Xy4gD6fT6fLLEAPp9PpFFxUB9Po8CQhQA3c/08yMZ5LH28hsIWNoSfTIweOEIY6GASXM5QuuzTuA0qKQTjIswJ"
	"IMG3Rey7K5rwjxLROOZCi7osKI+DrsXGq5jbHlbHKyfB12txp7DbHC2OVk63GxcZsgYMrJyqnFnTZ02cMAwDNlVNKppM4Y4T"
	"V4wpGAY14yNWDAwM8D65CQkGBgZE7u4SVemRy2PJcp5gQwFSZnEZQKyJ8bt7hcd0HbsbYspyqw1rKcqsNiymxWGxWGOfWylk"
	"pVYY4TSNJM7OxNFjtw9+h79D36f9v8fUt46mtX1/T4+OLFj/x/1L4uUP/j/Eca1dAAAAAAAAAAAAAAAAAAAAAA7/8UyAMJ/8"
	"IUzY/8f8f8fsRNmGnNmKlE37e009T/4/29tNa1q9f8f+n/X8WTWrf6/9P/LzYD3+evPlAhoGP0yRp1JPPw2Ub9V5D8cCS5pR"
	"YEkWSgzVPyaZZW6DAy3K3QYGdwm6DAzu4SVyBgYGW7hITdBgYGfBwkJhBgY2t3WVuiWgYGNyrfrFLcdNbN1AqnuqvIPnkWEO"
	"ta59ZqrHwcaviWUnFqn3jmSRSDNaZKmmCboMDTPdugwNNMsrdugwMDTTYBJW6DAwNg7hIm0GBgYGs9v8/57/2nQExPBNKrXA"
	"QTBohZNEKs2EBLrBGd0UWXKhaIHkMdBiugVAAusHtf5T0D2/uf2zrTxvrvxDrjxPrPmTiHM/E+ZOIcz7L35sjdey90bI+i8y"
	"p1ybKm3UOUqKFdIOzfGuuvEei8VvXE6zsWvbDoOxaFsNxw1ywsSPXsevY9ex2kV51P/j/b201rQ/T/0/6/iyaH8f9P/LzYD3"
	"+evPlAhoAAAAAAAAAAAAAAAAAADg//FMgAHf/CFA2kYIwcA=";

int base64Value(char value)
{
	if (value >= 'A' && value <= 'Z') return value - 'A';
	if (value >= 'a' && value <= 'z') return value - 'a' + 26;
	if (value >= '0' && value <= '9') return value - '0' + 52;
	if (value == '+') return 62;
	if (value == '/') return 63;
	return -1;
}

std::vector<uint8_t> base64Bytes(const char *encoded)
{
	std::vector<uint8_t> result;
	uint32_t accumulator = 0u;
	uint32_t bits = 0u;
	for (const char value : std::string(encoded)) {
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

bool writeFixture(const std::filesystem::path &path, const std::vector<uint8_t> &bytes)
{
	std::ofstream file(path, std::ios::binary | std::ios::out);
	file.write(reinterpret_cast<const char *>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
	return static_cast<bool>(file);
}

constexpr uint64_t encodeCanaryFrameCount = 2048u;

std::vector<float> encodeCanarySamples()
{
	std::vector<float> samples;
	samples.reserve(encodeCanaryFrameCount * 2u);
	for (uint64_t frame = 0u; frame < encodeCanaryFrameCount; ++frame) {
		const float left = static_cast<float>(static_cast<int32_t>(frame % 31u) - 15) / 16.0f;
		samples.push_back(left);
		samples.push_back(-left * 0.5f);
	}
	return samples;
}

bool writeFloatFixture(const std::filesystem::path &path, const std::vector<float> &samples)
{
	std::ofstream file(path, std::ios::binary | std::ios::out);
	file.write(reinterpret_cast<const char *>(samples.data()),
		static_cast<std::streamsize>(samples.size() * sizeof(float)));
	return static_cast<bool>(file);
}

bool validDecode(
	const soundscaper_pro_os_mp3_decode_result &result,
	const std::filesystem::path &outputPath)
{
	std::error_code error;
	if (result.status != SOUNDSCAPER_PRO_OS_CODEC_OK || result.native_api_reached != 1u
		|| result.exact_tuple_passed != 1u || result.sample_rate != 48000u
		|| result.channel_count != 2u || result.frame_count == 0u
		|| result.output_bytes != result.frame_count * 2u * sizeof(float)
		|| std::filesystem::file_size(outputPath, error) != result.output_bytes || error) return false;
	std::ifstream decoded(outputPath, std::ios::binary);
	std::vector<float> samples(result.output_bytes / sizeof(float));
	decoded.read(reinterpret_cast<char *>(samples.data()), static_cast<std::streamsize>(result.output_bytes));
	return decoded && std::all_of(samples.begin(), samples.end(), [](float value) {
		return std::isfinite(value);
	}) && !std::all_of(samples.begin(), samples.end(), [](float value) { return value == 0.0f; });
}

bool validEncode(
	const soundscaper_pro_os_aac_m4a_encode_result &result,
	const std::filesystem::path &outputPath)
{
	std::error_code error;
	if (result.status != SOUNDSCAPER_PRO_OS_CODEC_OK || result.native_api_reached != 1u
		|| result.exact_tuple_passed != 1u || result.sample_rate != 48000u
		|| result.channel_count != 2u || result.bitrate_kbps != 160u
		|| result.frame_count != encodeCanaryFrameCount || result.output_bytes == 0u
		|| std::filesystem::file_size(outputPath, error) != result.output_bytes || error) return false;
	std::ifstream encoded(outputPath, std::ios::binary);
	const std::vector<uint8_t> bytes(std::istreambuf_iterator<char>(encoded), {});
	return !encoded.bad() && bytes.size() == result.output_bytes
		&& soundscaper::os_audio::exactAacLcM4a(bytes, 48000u, 2u);
}

#if defined(_WIN32)
bool validMp3Encode(
	const soundscaper_pro_os_mp3_encode_result &result,
	const std::filesystem::path &outputPath)
{
	std::error_code error;
	if (result.status != SOUNDSCAPER_PRO_OS_CODEC_OK || result.native_api_reached != 1u
		|| result.exact_tuple_passed != 1u || result.sample_rate != 48000u
		|| result.channel_count != 2u || result.bitrate_kbps != 192u
		|| result.frame_count != encodeCanaryFrameCount || result.output_bytes == 0u
		|| std::filesystem::file_size(outputPath, error) != result.output_bytes || error) return false;
	std::ifstream encoded(outputPath, std::ios::binary);
	const std::vector<uint8_t> bytes(std::istreambuf_iterator<char>(encoded), {});
	return !encoded.bad() && bytes.size() == result.output_bytes
		&& soundscaper::os_audio::exactMp3(bytes, 48000u, 2u, 192u);
}
#endif

} // namespace

int main()
{
	const auto suffix = std::to_string(std::chrono::steady_clock::now().time_since_epoch().count());
	const auto root = std::filesystem::temp_directory_path() / ("soundscaper-os-codec-" + suffix);
	const auto mp3InputPath = root / "canary.mp3";
	const auto mp3OutputPath = root / "mp3.f32le";
	const auto m4aInputPath = root / "canary.m4a";
	const auto m4aOutputPath = root / "m4a.f32le";
	const auto adtsInputPath = root / "canary.aac";
	const auto adtsOutputPath = root / "adts.f32le";
	const auto heInputPath = root / "implicit-he.m4a";
	const auto heOutputPath = root / "implicit-he.f32le";
	const auto encodeInputPath = root / "encode.f32le";
	const auto encodeOutputPath = root / "encode.m4a";
	const auto encodeDecodePath = root / "encode-decoded.f32le";
	const auto unsupportedEncodePath = root / "unsupported-encode.m4a";
	const auto mp3EncodeOutputPath = root / "encode.mp3";
	const auto mp3EncodeDecodePath = root / "encode-mp3-decoded.f32le";
	const auto unsupportedMp3EncodePath = root / "unsupported-encode.mp3";
	std::error_code error;
	if (!std::filesystem::create_directory(root, error) || error) return 1;
	const auto mp3Input = base64Bytes(canaryBase64);
	const auto m4aInput = base64Bytes(aacM4aCanaryBase64);
	const auto adtsInput = base64Bytes(aacAdtsCanaryBase64);
	const auto encodeInput = encodeCanarySamples();
	if (mp3Input.size() != 1536u || m4aInput.size() != 1909u || adtsInput.size() != 1115u) return 2;
	/* Same M4A with the AudioSpecificConfig sync-extension SBR-present bit set.
	 * This declares implicit HE-AAC and must not inherit the AAC-LC admission.
	 * sha256: 067e521e3f33e667840e5de1ca8b472d647e11aacce4ed052ef03137cb82a1d0 */
	auto heInput = m4aInput;
	constexpr std::array<uint8_t, 5u> lcConfig{ 0x11u, 0x90u, 0x56u, 0xe5u, 0x00u };
	const auto config = std::search(heInput.begin(), heInput.end(), lcConfig.begin(), lcConfig.end());
	if (config == heInput.end()
		|| std::search(config + 1, heInput.end(), lcConfig.begin(), lcConfig.end()) != heInput.end()) return 3;
	*(config + 4) = 0x80u;
	if (!soundscaper::os_audio::exactAacLcM4a(m4aInput, 48000u, 2u)
		|| soundscaper::os_audio::exactAacLcM4a(heInput, 48000u, 2u)) return 4;
	if (!writeFixture(mp3InputPath, mp3Input) || !writeFixture(m4aInputPath, m4aInput)
		|| !writeFixture(adtsInputPath, adtsInput) || !writeFixture(heInputPath, heInput)
		|| !writeFloatFixture(encodeInputPath, encodeInput)) return 5;
	const std::string mp3InputText = mp3InputPath.string();
	const std::string mp3OutputText = mp3OutputPath.string();
	const soundscaper_pro_os_mp3_decode_request mp3Request{
		mp3InputText.c_str(), mp3OutputText.c_str(), mp3Input.size(), 1024u * 1024u,
	};
	if (!validDecode(soundscaper_pro_os_mp3_decode(&mp3Request), mp3OutputPath)) return 6;
	const std::string m4aInputText = m4aInputPath.string();
	const std::string m4aOutputText = m4aOutputPath.string();
	const soundscaper_pro_os_mp3_decode_request m4aRequest{
		m4aInputText.c_str(), m4aOutputText.c_str(), m4aInput.size(), 1024u * 1024u,
	};
	if (!validDecode(soundscaper_pro_os_aac_m4a_decode(&m4aRequest), m4aOutputPath)) return 7;
	const std::string adtsInputText = adtsInputPath.string();
	const std::string adtsOutputText = adtsOutputPath.string();
	const soundscaper_pro_os_mp3_decode_request adtsRequest{
		adtsInputText.c_str(), adtsOutputText.c_str(), adtsInput.size(), 1024u * 1024u,
	};
	const auto adtsResult = soundscaper_pro_os_aac_m4a_decode(&adtsRequest);
	if (adtsResult.status != SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED
		|| adtsResult.native_api_reached != 1u || adtsResult.exact_tuple_passed != 0u
		|| adtsResult.output_bytes != 0u || adtsResult.frame_count != 0u
		|| std::filesystem::exists(adtsOutputPath)) return 8;
#if defined(__APPLE__)
	const std::string heInputText = heInputPath.string();
	const std::string heOutputText = heOutputPath.string();
	const soundscaper_pro_os_mp3_decode_request heRequest{
		heInputText.c_str(), heOutputText.c_str(), heInput.size(), 1024u * 1024u,
	};
	const auto heResult = soundscaper_pro_os_aac_m4a_decode(&heRequest);
	if (heResult.status != SOUNDSCAPER_PRO_OS_CODEC_TUPLE_UNSUPPORTED
		|| heResult.native_api_reached != 1u || heResult.exact_tuple_passed != 0u
		|| heResult.output_bytes != 0u || heResult.frame_count != 0u
		|| std::filesystem::exists(heOutputPath)) return 9;
#endif
	const std::string encodeInputText = encodeInputPath.string();
	const std::string encodeOutputText = encodeOutputPath.string();
	const soundscaper_pro_os_aac_m4a_encode_request encodeRequest{
		encodeInputText.c_str(), encodeOutputText.c_str(), encodeInput.size() * sizeof(float),
		1024u * 1024u, 48000u, 2u, 160u,
	};
	if (!validEncode(soundscaper_pro_os_aac_m4a_encode(&encodeRequest), encodeOutputPath)) return 10;
	const std::string encodeDecodeText = encodeDecodePath.string();
	const soundscaper_pro_os_mp3_decode_request encodedDecodeRequest{
		encodeOutputText.c_str(), encodeDecodeText.c_str(),
		std::filesystem::file_size(encodeOutputPath), 1024u * 1024u,
	};
	if (!validDecode(soundscaper_pro_os_aac_m4a_decode(&encodedDecodeRequest), encodeDecodePath)) return 11;
	const std::string unsupportedEncodeText = unsupportedEncodePath.string();
	auto unsupportedEncodeRequest = encodeRequest;
	unsupportedEncodeRequest.output_path_utf8 = unsupportedEncodeText.c_str();
	unsupportedEncodeRequest.bitrate_kbps = 192u;
	const auto unsupportedEncode = soundscaper_pro_os_aac_m4a_encode(&unsupportedEncodeRequest);
	if (unsupportedEncode.status != SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST
		|| unsupportedEncode.native_api_reached != 0u || unsupportedEncode.exact_tuple_passed != 0u
		|| unsupportedEncode.output_bytes != 0u || std::filesystem::exists(unsupportedEncodePath)) return 12;
#if defined(_WIN32) || defined(__APPLE__)
	const std::string mp3EncodeOutputText = mp3EncodeOutputPath.string();
	const soundscaper_pro_os_mp3_encode_request mp3EncodeRequest{
		encodeInputText.c_str(), mp3EncodeOutputText.c_str(), encodeInput.size() * sizeof(float),
		1024u * 1024u, 48000u, 2u, 192u,
	};
#if defined(_WIN32)
	if (!validMp3Encode(soundscaper_pro_os_mp3_encode(&mp3EncodeRequest), mp3EncodeOutputPath)) return 13;
	const std::string mp3EncodeDecodeText = mp3EncodeDecodePath.string();
	const soundscaper_pro_os_mp3_decode_request encodedMp3DecodeRequest{
		mp3EncodeOutputText.c_str(), mp3EncodeDecodeText.c_str(),
		std::filesystem::file_size(mp3EncodeOutputPath), 1024u * 1024u,
	};
	if (!validDecode(soundscaper_pro_os_mp3_decode(&encodedMp3DecodeRequest), mp3EncodeDecodePath)) return 14;
	const std::string unsupportedMp3EncodeText = unsupportedMp3EncodePath.string();
	auto unsupportedMp3EncodeRequest = mp3EncodeRequest;
	unsupportedMp3EncodeRequest.output_path_utf8 = unsupportedMp3EncodeText.c_str();
	unsupportedMp3EncodeRequest.bitrate_kbps = 160u;
	const auto unsupportedMp3Encode = soundscaper_pro_os_mp3_encode(&unsupportedMp3EncodeRequest);
	if (unsupportedMp3Encode.status != SOUNDSCAPER_PRO_OS_CODEC_INVALID_REQUEST
		|| unsupportedMp3Encode.native_api_reached != 0u || unsupportedMp3Encode.exact_tuple_passed != 0u
		|| unsupportedMp3Encode.output_bytes != 0u
		|| std::filesystem::exists(unsupportedMp3EncodePath)) return 15;
#elif defined(__APPLE__)
	const auto unavailableMp3Encode = soundscaper_pro_os_mp3_encode(&mp3EncodeRequest);
	if (unavailableMp3Encode.status != SOUNDSCAPER_PRO_OS_CODEC_API_UNAVAILABLE
		|| unavailableMp3Encode.native_api_reached != 0u || unavailableMp3Encode.exact_tuple_passed != 0u
		|| unavailableMp3Encode.output_bytes != 0u || std::filesystem::exists(mp3EncodeOutputPath)) return 13;
#endif
#endif
	std::filesystem::remove_all(root, error);
	return error ? 16 : 0;
}
