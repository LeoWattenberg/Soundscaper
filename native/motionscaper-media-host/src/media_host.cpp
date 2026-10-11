/* SPDX-License-Identifier: AGPL-3.0-only */
#include "frame_carrier.hpp"
#include "prores_encoder.hpp"
#include "../../common/sha256.hpp"
#include <array>
#include <charconv>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <span>
#include <stdexcept>
#include <string_view>

namespace {
std::string digest_file(std::ifstream& input) {
	scape::native_common::sha256 digest; std::array<std::byte, 65'536> buffer{};
	while (input) {
		input.read(reinterpret_cast<char*>(buffer.data()), static_cast<std::streamsize>(buffer.size()));
		if (input.gcount() > 0) digest.update(std::span{buffer}.first(static_cast<std::size_t>(input.gcount())));
	}
	if (!input.eof()) throw std::runtime_error("Motionscaper carrier digest read failed.");
	input.clear(); input.seekg(0); return digest.finish_hex();
}
std::uint64_t byte_length(const std::string_view value) {
	std::uint64_t result{}; const auto parsed = std::from_chars(value.data(), value.data() + value.size(), result);
	if (parsed.ec != std::errc{} || parsed.ptr != value.data() + value.size() || result == 0 || result > 9'007'199'254'740'991ULL) throw std::runtime_error("Invalid Motionscaper authenticated carrier length.");
	return result;
}
}

int main(const int argc, char** argv) {
	std::filesystem::path output;
	bool output_admitted = false;
	try {
		if (argc == 2 && std::string_view{argv[1]} == "--self-test") {
			if (!motionscaper::media::prores_available()) throw std::runtime_error("Pinned ProRes encoder is unavailable.");
			std::cout << "{\"productId\":\"motionscaper\",\"helperContractVersion\":1,\"carrierVersion\":1,\"operation\":\"prores-4444\",\"inputPixelFormat\":\"rgba-f32le\",\"encoderPixelFormat\":\"yuva444p10\",\"colorSpace\":\"rec709\",\"alphaMode\":\"straight\",\"maximumFrames\":32768,\"pcmCarrierVersion\":1,\"audioCodec\":\"pcm-s24le\",\"maximumAudioSamples\":134217728}\n";
			return 0;
		}
		const bool with_audio = argc == 12 && std::string_view{argv[1]} == "--encode-prores-4444-pcm-v1";
		if (!with_audio && (argc != 9 || std::string_view{argv[1]} != "--encode-prores-4444-v1")) throw std::runtime_error("Unsupported Motionscaper helper operation envelope.");
		const std::filesystem::path source{reinterpret_cast<const char8_t*>(argv[2])}; output = std::filesystem::path{reinterpret_cast<const char8_t*>(argv[3])};
		if (!source.is_absolute() || !output.is_absolute() || source == output || std::filesystem::is_symlink(source)
			|| !std::filesystem::is_regular_file(source) || std::filesystem::exists(output)) throw std::runtime_error("Motionscaper helper requires distinct main-owned carrier and fresh output paths.");
		const auto length = byte_length(argv[7]);
		if (std::filesystem::file_size(source) != length) throw std::runtime_error("Motionscaper carrier length does not match its grant.");
		std::ifstream input{source, std::ios::binary}; if (!input) throw std::runtime_error("Motionscaper carrier cannot be opened.");
		if (digest_file(input) != argv[8]) throw std::runtime_error("Motionscaper carrier SHA-256 does not match its grant.");
		motionscaper::media::frame_carrier carrier{input, length, {argv[4], argv[5], argv[6]}};
		std::ifstream audio_input; std::unique_ptr<motionscaper::media::pcm_carrier> audio;
		if (with_audio) {
			const std::filesystem::path audio_path{reinterpret_cast<const char8_t*>(argv[9])}; const auto audio_length = byte_length(argv[10]);
			if (!audio_path.is_absolute() || audio_path == source || audio_path == output || std::filesystem::is_symlink(audio_path)
				|| !std::filesystem::is_regular_file(audio_path) || std::filesystem::file_size(audio_path) != audio_length) throw std::runtime_error("Invalid main-owned PCM sidecar path or length.");
			audio_input.open(audio_path, std::ios::binary); if (!audio_input || digest_file(audio_input) != argv[11]) throw std::runtime_error("PCM sidecar SHA-256 does not match its grant.");
			audio = std::make_unique<motionscaper::media::pcm_carrier>(audio_input, audio_length, carrier.header());
		}
		output_admitted = true;
		motionscaper::media::encode_prores4444(carrier, output, audio.get());
		std::ifstream finished{output, std::ios::binary}; const auto sha = digest_file(finished);
		std::cout << "{\"productId\":\"motionscaper\",\"helperContractVersion\":1,\"operation\":\"prores-4444\",\"byteLength\":"
			<< std::filesystem::file_size(output) << ",\"sha256\":\"" << sha << "\",\"frameCount\":" << carrier.header().frame_count << ",\"audioSamples\":" << (audio ? audio->header().sample_count : 0) << "}\n";
		return 0;
	} catch (const std::exception& error) {
		// Main owns the fresh temporary path; failed delivery never becomes a user file.
		if (output_admitted) { std::error_code ignored; std::filesystem::remove(output, ignored); }
		std::cerr << error.what() << '\n'; return 1;
	}
}
