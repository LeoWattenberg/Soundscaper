/* SPDX-License-Identifier: AGPL-3.0-only */
#include "../src/prores_encoder.hpp"
#include "../src/pcm_carrier.hpp"
#include "pcm_fixture.hpp"
extern "C" {
#include <libavformat/avformat.h>
}
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <cmath>
namespace {
void require(const bool value, const char* message) { if (!value) throw std::runtime_error(message); }
struct input_file final { AVFormatContext* format{}; AVPacket* packet{av_packet_alloc()}; ~input_file() { av_packet_free(&packet); avformat_close_input(&format); } };
}
int main(const int argc, char** argv) {
	std::filesystem::path output;
	try {
		require(argc == 2, "Provide disposable PCM test directory"); std::filesystem::create_directories(argv[1]); output = std::filesystem::path{argv[1]} / "pcm.mov";
		const auto frames = motionscaper::media::fixture::frames(); const auto samples = motionscaper::media::fixture::pcm();
		std::istringstream video{frames}, audio{samples};
		motionscaper::media::frame_carrier carrier{video, frames.size(), {"p", std::string(64, 'a'), "c"}};
		motionscaper::media::pcm_carrier pcm{audio, samples.size(), carrier.header()};
		const auto poisoned = motionscaper::media::fixture::pcm(true); std::istringstream bad_audio{poisoned};
		motionscaper::media::pcm_carrier bad{bad_audio, poisoned.size(), carrier.header()};
		bool refused = false; try { static_cast<void>(bad.read(0)); } catch (const std::exception&) { refused = true; } require(refused, "Nonfinite PCM was accepted");
		refused = false; try { std::istringstream short_audio{samples}; motionscaper::media::pcm_carrier short_carrier{short_audio, samples.size() - 1, carrier.header()}; } catch (const std::exception&) { refused = true; } require(refused, "Truncated PCM was accepted");
		motionscaper::media::encode_prores4444(carrier, output, &pcm);
		input_file input; const auto utf8 = output.u8string(); const std::string path{reinterpret_cast<const char*>(utf8.data()), utf8.size()};
		require(avformat_open_input(&input.format, path.c_str(), nullptr, nullptr) >= 0 && avformat_find_stream_info(input.format, nullptr) >= 0, "Open PCM MOV");
		const auto stream = av_find_best_stream(input.format, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0); require(stream >= 0, "PCM audio track missing");
		const auto* track = input.format->streams[stream]; const auto* format = track->codecpar;
		require(format->codec_id == AV_CODEC_ID_PCM_S24LE && format->sample_rate == 96000 && format->ch_layout.nb_channels == 2 && format->bits_per_coded_sample == 24, "PCM precision, rate or layout changed");
		require(track->time_base.num == 1 && track->time_base.den == 96000 && track->duration == 6407 && track->start_time == 0, "PCM timing changed");
		std::uint64_t count = 0;
		while (av_read_frame(input.format, input.packet) >= 0) {
			if (input.packet->stream_index == stream) {
				require(input.packet->pts == static_cast<std::int64_t>(count) && input.packet->size % 6 == 0, "PCM packet cadence changed");
				for (int offset = 0; offset < input.packet->size; offset += 6) {
					for (int channel = 0; channel < 2; ++channel) {
						const auto* bytes = input.packet->data + offset + channel * 3;
						const auto word = static_cast<std::int32_t>(bytes[0] | bytes[1] << 8 | bytes[2] << 16);
						const auto sample = (word & 0x800000) ? word - 0x1000000 : word;
						const double expected = count % 3 == 0 ? (channel == 0 ? 8388607.0 / 8388608 : -1.0) : (channel == 0 ? 0.1234567F : -0.7654321F);
						require(std::abs(sample / 8388608.0 - expected) <= 0.5 / 8388608, "PCM24 precision or channel order changed");
					} ++count;
				}
			} av_packet_unref(input.packet);
		}
		require(count == 6407, "PCM sample count changed"); std::filesystem::remove(output);
		std::cout << "Motionscaper PCM24 precision, clipping, channel order and exact A/V cadence passed\n"; return 0;
	} catch (const std::exception& error) { if (!output.empty()) { std::error_code ignored; std::filesystem::remove(output, ignored); } std::cerr << error.what() << '\n'; return 1; }
}
