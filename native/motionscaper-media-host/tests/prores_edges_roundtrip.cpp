/* SPDX-License-Identifier: AGPL-3.0-only */
#include "../src/prores_encoder.hpp"
#include "frame_fixture.hpp"
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/pixdesc.h>
#include <libswscale/swscale.h>
}
#include <algorithm>
#include <array>
#include <cmath>
#include <iostream>
#include <sstream>
#include <stdexcept>
namespace {
constexpr int width = 64, height = 32;
void need(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
double rec709(double v) { return v < .018 ? 4.5 * v : 1.099 * std::pow(v, .45) - .099; }
// Three-pixel antialiased stroke ends on blue reproduce the authored title
// regression. Solid swatches miss the high-frequency quantization error.
std::array<float, 4> pixel(int x, int y, int frame) {
	const bool edge = (x + frame * 8) % 8 == 0 && y % 8 < 3;
	const float a = y < 8 ? 0 : y < 16 ? .2345678F : 1;
	return { (edge ? .7990835905075073F : .06847816705703735F) * a,
		(edge ? .8308719396591187F : .2158605009317398F) * a, a, a };
}
std::string carrier_bytes() {
	using motionscaper::media::fixture::integer;
	const std::string header = "{\"identity\":{\"projectId\":\"p\",\"revisionDigest\":\"" + std::string(64, 'a')
		+ "\",\"compositionId\":\"c\"},\"width\":64,\"height\":32,\"frameRate\":{\"num\":30000,\"den\":1001},\"firstFrame\":123,\"frameCount\":2,\"format\":\"motionscaper-linear-rgba-frame-pack\",\"version\":1,\"pixelFormat\":\"rgba-f32le\",\"colorSpace\":\"linear-rec709-d65\",\"alphaMode\":\"premultiplied\"}";
	std::string result = "motionscaper-linear-rgba-frame-pack-v1\n";
	integer(result, static_cast<std::uint32_t>(header.size())); result += header;
	for (std::uint64_t frame = 0; frame < 2; ++frame) {
		std::string pixels;
		for (int y = 0; y < height; ++y) for (int x = 0; x < width; ++x)
			for (float value : pixel(x, y, static_cast<int>(frame))) integer(pixels, std::bit_cast<std::uint32_t>(value));
		scape::native_common::sha256 digest; digest.update(std::as_bytes(std::span{pixels.data(), pixels.size()}));
		const auto hex = digest.finish_hex();
		integer(result, frame); integer(result, static_cast<std::uint64_t>(pixels.size())); result += pixels;
		for (std::size_t at = 0; at < hex.size(); at += 2) result.push_back(static_cast<char>(std::stoul(hex.substr(at, 2), nullptr, 16)));
	}
	return result;
}
struct decoder {
	AVFormatContext* format{}; AVCodecContext* codec{}; AVFrame* frame{}; AVPacket* packet{};
	~decoder() { av_packet_free(&packet); av_frame_free(&frame); avcodec_free_context(&codec); avformat_close_input(&format); }
};
void inspect(AVFrame& frame, int ordinal, double& maximum_color, double& maximum_alpha) {
	need(frame.width == width && frame.height == height, "Edge frame dimensions changed");
	const auto* desc = av_pix_fmt_desc_get(static_cast<AVPixelFormat>(frame.format));
	need(desc && desc->nb_components == 4 && desc->comp[0].depth >= 10 && desc->comp[3].depth >= 10, "Color or alpha precision changed");
	auto* scale = sws_getContext(width, height, static_cast<AVPixelFormat>(frame.format), width, height, AV_PIX_FMT_RGBA64,
		SWS_POINT | SWS_ACCURATE_RND | SWS_BITEXACT, nullptr, nullptr, nullptr);
	need(scale, "Reference conversion unavailable"); const auto* matrix = sws_getCoefficients(SWS_CS_ITU709);
	need(sws_setColorspaceDetails(scale, matrix, 0, matrix, 1, 0, 1 << 16, 1 << 16) >= 0, "Reference matrix failed");
	std::vector<std::uint16_t> rgba(width * height * 4);
	std::uint8_t* output[] = {reinterpret_cast<std::uint8_t*>(rgba.data()), nullptr, nullptr, nullptr};
	const int stride[] = {width * 8, 0, 0, 0};
	const auto rows = sws_scale(scale, frame.data, frame.linesize, 0, height, output, stride); sws_freeContext(scale);
	need(rows == height, "Reference conversion incomplete");
	for (int y = 0; y < height; ++y) for (int x = 0; x < width; ++x) {
		const auto reference = pixel(x, y, ordinal); const auto at = static_cast<std::size_t>((y * width + x) * 4);
		const auto alpha = reinterpret_cast<const std::uint16_t*>(frame.data[3] + y * frame.linesize[3])[x]
			/ static_cast<double>((1U << desc->comp[3].depth) - 1);
		maximum_alpha = std::max(maximum_alpha, std::abs(alpha - reference[3]));
		if (reference[3] == 0 || reference[3] == 1) need(alpha == reference[3], "Alpha endpoint changed");
		if (reference[3] > 0) for (int c = 0; c < 3; ++c) {
			const double error = std::abs(rgba[at + c] / 65535.0 - rec709(reference[c] / reference[3]));
			if (error > maximum_color) {
				maximum_color = error;
				if (error > 8.0 / 1023) std::cout << "Exceeded RGB bound at " << x << ',' << y << " channel " << c << " alpha " << reference[3] << '\n';
			}
		}
	}
}
}
int main(int argc, char** argv) {
	std::filesystem::path output;
	try {
		need(argc == 2, "Provide one disposable test directory"); std::filesystem::create_directories(argv[1]);
		output = std::filesystem::path(argv[1]) / "motionscaper-prores-edges.mov"; need(!std::filesystem::exists(output), "Output already exists");
		const auto bytes = carrier_bytes(); std::istringstream input(bytes);
		motionscaper::media::frame_carrier carrier(input, bytes.size(), {"p", std::string(64, 'a'), "c"});
		motionscaper::media::encode_prores4444(carrier, output);
		decoder d; const auto utf8 = output.u8string(); const std::string path(reinterpret_cast<const char*>(utf8.data()), utf8.size());
		need(avformat_open_input(&d.format, path.c_str(), nullptr, nullptr) >= 0 && avformat_find_stream_info(d.format, nullptr) >= 0, "Open encoded edges");
		need(d.format->nb_streams == 1, "Unexpected stream count"); auto* stream = d.format->streams[0];
		need(stream->codecpar->codec_id == AV_CODEC_ID_PRORES && stream->codecpar->profile == AV_PROFILE_PRORES_4444, "Profile changed");
		need(stream->codecpar->color_primaries == AVCOL_PRI_BT709 && stream->codecpar->color_trc == AVCOL_TRC_BT709 && stream->codecpar->color_space == AVCOL_SPC_BT709, "709 tags changed");
		d.codec = avcodec_alloc_context3(avcodec_find_decoder(AV_CODEC_ID_PRORES)); need(d.codec, "Allocate decoder");
		need(avcodec_parameters_to_context(d.codec, stream->codecpar) >= 0 && avcodec_open2(d.codec, nullptr, nullptr) >= 0, "Open decoder");
		d.frame = av_frame_alloc(); d.packet = av_packet_alloc(); need(d.frame && d.packet, "Allocate frame/packet");
		int count = 0; double color = 0, alpha = 0;
		const auto drain = [&]() { int status; while ((status = avcodec_receive_frame(d.codec, d.frame)) >= 0) {
			need(count < 2 && d.frame->best_effort_timestamp * stream->time_base.num * 30000 == static_cast<std::int64_t>(count) * 1001 * stream->time_base.den, "Frame PTS changed");
			inspect(*d.frame, count++, color, alpha); av_frame_unref(d.frame);
		} need(status == AVERROR(EAGAIN) || status == AVERROR_EOF, "Decoder receive failed"); };
		int status; while ((status = av_read_frame(d.format, d.packet)) >= 0) {
			need(d.packet->stream_index == 0 && avcodec_send_packet(d.codec, d.packet) >= 0, "Decode packet failed"); drain(); av_packet_unref(d.packet);
		}
		need(status == AVERROR_EOF && avcodec_send_packet(d.codec, nullptr) >= 0, "Decoder flush failed"); drain();
		std::cout << "Motionscaper fine-edge maximum RGB codes " << color * 1023 << "; alpha codes " << alpha * 1023 << '\n';
		need(count == 2 && color <= 8.0 / 1023 && alpha <= 2.0 / 1023, "ProRes fine edges exceed the unchanged RGB/alpha bounds");
		std::filesystem::remove(output); return 0;
	} catch (const std::exception& e) {
		if (!output.empty()) { std::error_code ignored; std::filesystem::remove(output, ignored); }
		std::cerr << e.what() << '\n'; return 1;
	}
}
