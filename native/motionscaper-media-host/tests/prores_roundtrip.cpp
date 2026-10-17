/* SPDX-License-Identifier: AGPL-3.0-only */
#include "../src/prores_encoder.hpp"
#include "frame_fixture.hpp"
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/pixdesc.h>
#include <libswscale/swscale.h>
}
#include <cmath>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace {
void require(const bool value, const char* message) { if (!value) throw std::runtime_error(message); }
double rec709(const double linear) { return linear < 0.018 ? linear * 4.5 : 1.099 * std::pow(linear, 0.45) - 0.099; }
struct decoder final {
	AVFormatContext* format{}; AVCodecContext* codec{}; AVFrame* frame{}; AVPacket* packet{};
	~decoder() { av_packet_free(&packet); av_frame_free(&frame); avcodec_free_context(&codec); avformat_close_input(&format); }
};
void inspect(AVFrame& frame) {
	require(frame.width == 32 && frame.height == 16, "ProRes round-trip dimensions changed");
	auto* scale = sws_getContext(frame.width, frame.height, static_cast<AVPixelFormat>(frame.format), 32, 16, AV_PIX_FMT_RGBA64,
		SWS_POINT | SWS_ACCURATE_RND | SWS_BITEXACT, nullptr, nullptr, nullptr);
	require(scale != nullptr, "ProRes decode conversion is unavailable");
	const auto* coefficients = sws_getCoefficients(SWS_CS_ITU709);
	require(sws_setColorspaceDetails(scale, coefficients, 0, coefficients, 1, 0, 1 << 16, 1 << 16) >= 0, "ProRes decode color matrix failed");
	std::vector<std::uint16_t> pixels(32 * 16 * 4); std::uint8_t* output[] = {reinterpret_cast<std::uint8_t*>(pixels.data()), nullptr, nullptr, nullptr};
	const int stride[] = {32 * 8, 0, 0, 0};
	const auto rows = sws_scale(scale, frame.data, frame.linesize, 0, 16, output, stride); sws_freeContext(scale);
	require(rows == 16, "ProRes decode conversion is incomplete");
	const auto sample = [&](const int x, const int channel) { return pixels[static_cast<std::size_t>((8 * 32 + x) * 4 + channel)] / 65535.0; };
	const auto* descriptor = av_pix_fmt_desc_get(static_cast<AVPixelFormat>(frame.format));
	require(descriptor && descriptor->nb_components == 4 && descriptor->comp[3].depth >= 10, "ProRes decoded precision dropped below ten bits");
	// Normalize the decoder's declared alpha depth: swscale's RGBA64 upshift
	// leaves a nominal twelve-bit opaque sample at 65520 instead of 65535.
	const auto alpha = [&](const int x) {
		const auto* row = reinterpret_cast<const std::uint16_t*>(frame.data[3] + 8 * frame.linesize[3]);
		return row[x] / static_cast<double>((1U << descriptor->comp[3].depth) - 1);
	};
	require(alpha(4) == 0 && alpha(28) == 1, "ProRes opaque/transparent alpha endpoints changed");
	require(std::abs(alpha(16) - 0.2345678) <= 0.0006, "ProRes partial alpha lost high precision");
	for (const int x : {16, 28}) {
		require(std::abs(sample(x, 0) - rec709(0.3456789)) < 0.006, "ProRes red conversion differs");
		require(std::abs(sample(x, 1) - rec709(0.1234567)) < 0.006, "ProRes green conversion differs");
		require(std::abs(sample(x, 2) - rec709(0.7891234)) < 0.006, "ProRes blue conversion differs");
	}
}
}
int main(const int argc, char** argv) {
	std::filesystem::path output;
	try {
		require(argc == 2, "Provide one disposable build-test directory");
		const std::filesystem::path directory{argv[1]}; std::filesystem::create_directories(directory);
		output = directory / "motionscaper-roundtrip.mov";
		require(!std::filesystem::exists(output), "Round-trip output already exists");
		// A header claiming a long movie must fail before reading frames or opening output.
		auto excessive = motionscaper::media::fixture::frames();
		const auto count_offset = excessive.find("\"frameCount\":2") + std::string{"\"frameCount\":"}.size();
		excessive.replace(count_offset, 1, "32769");
		const auto header_offset = std::string{"motionscaper-linear-rgba-frame-pack-v1\n"}.size();
		std::uint32_t header_length{};
		for (std::size_t byte = 0; byte < 4; ++byte) header_length |= static_cast<std::uint32_t>(static_cast<unsigned char>(excessive[header_offset + byte])) << (8U * byte);
		header_length += 4;
		for (std::size_t byte = 0; byte < 4; ++byte) excessive[header_offset + byte] = static_cast<char>((header_length >> (8U * byte)) & 255U);
		std::istringstream excessive_input{excessive};
		motionscaper::media::frame_carrier excessive_carrier{excessive_input, excessive.size() + 32'767ULL * (48 + 32 * 16 * 16), {"p", std::string(64, 'a'), "c"}};
		bool bound_rejected = false;
		try { motionscaper::media::encode_prores4444(excessive_carrier, output); }
		catch (const std::exception& error) { bound_rejected = std::string{error.what()}.find("32768-frame") != std::string::npos; }
		require(bound_rejected && !std::filesystem::exists(output), "MOV sample index bound was not enforced before output");
		const auto bytes = motionscaper::media::fixture::frames(); std::istringstream input{bytes};
		motionscaper::media::frame_carrier carrier{input, bytes.size(), {"p", std::string(64, 'a'), "c"}};
		motionscaper::media::encode_prores4444(carrier, output);
		decoder decode; const auto utf8 = output.u8string(); const std::string path{reinterpret_cast<const char*>(utf8.data()), utf8.size()};
		require(avformat_open_input(&decode.format, path.c_str(), nullptr, nullptr) >= 0, "Open ProRes round-trip output");
		require(avformat_find_stream_info(decode.format, nullptr) >= 0, "Probe ProRes round-trip output");
		const auto stream = av_find_best_stream(decode.format, AVMEDIA_TYPE_VIDEO, -1, -1, nullptr, 0); require(stream >= 0, "Find ProRes video stream");
		const auto* description = decode.format->streams[stream]->codecpar;
		require(description->codec_id == AV_CODEC_ID_PRORES && description->profile == AV_PROFILE_PRORES_4444, "ProRes output profile differs");
		decode.codec = avcodec_alloc_context3(avcodec_find_decoder(AV_CODEC_ID_PRORES)); require(decode.codec != nullptr, "Allocate ProRes decoder");
		require(avcodec_parameters_to_context(decode.codec, description) >= 0 && avcodec_open2(decode.codec, nullptr, nullptr) >= 0, "Open ProRes decoder");
		decode.frame = av_frame_alloc(); decode.packet = av_packet_alloc(); require(decode.frame && decode.packet, "Allocate decoder frame and packet");
		std::size_t frames = 0;
		const auto drain = [&]() { while (avcodec_receive_frame(decode.codec, decode.frame) >= 0) { inspect(*decode.frame); ++frames; av_frame_unref(decode.frame); } };
		while (av_read_frame(decode.format, decode.packet) >= 0) {
			if (decode.packet->stream_index == stream) { require(avcodec_send_packet(decode.codec, decode.packet) >= 0, "Decode ProRes packet"); drain(); }
			av_packet_unref(decode.packet);
		}
		require(avcodec_send_packet(decode.codec, nullptr) >= 0, "Flush ProRes decoder"); drain();
		require(frames == 2, "ProRes frame count changed"); std::filesystem::remove(output);
		std::cout << "Motionscaper ProRes 4444 float color and alpha round trip passed\n"; return 0;
	} catch (const std::exception& error) {
		if (!output.empty()) { std::error_code ignored; std::filesystem::remove(output, ignored); }
		std::cerr << error.what() << '\n'; return 1;
	}
}
