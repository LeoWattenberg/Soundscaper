/* SPDX-License-Identifier: AGPL-3.0-only */
// Test-only bounded decoder. Never packaged or linked into the production helper.
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/pixdesc.h>
#include <libswscale/swscale.h>
}
#include <cstdint>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <vector>
namespace {
void require(bool ok, const char* message) { if (!ok) throw std::runtime_error(message); }
struct decoder {
	AVCodecContext* codec{}; AVFrame* frame{};
	~decoder() { av_frame_free(&frame); avcodec_free_context(&codec); }
	void open(AVCodecParameters* parameters) {
		codec = avcodec_alloc_context3(avcodec_find_decoder(parameters->codec_id)); require(codec, "Decoder unavailable");
		require(avcodec_parameters_to_context(codec, parameters) >= 0 && avcodec_open2(codec, nullptr, nullptr) >= 0, "Decoder open failed");
		frame = av_frame_alloc(); require(frame, "Frame allocation failed");
	}
};
struct input {
	AVFormatContext* format{}; AVPacket* packet{};
	~input() { av_packet_free(&packet); avformat_close_input(&format); }
};
}
int main(int argc, char** argv) {
	try {
		require(argc == 4, "Expected input movie, RGBA float output and PCM float output");
		input file; require(avformat_open_input(&file.format, argv[1], nullptr, nullptr) >= 0 && avformat_find_stream_info(file.format, nullptr) >= 0, "Movie open failed");
		require(file.format->nb_streams >= 1 && file.format->nb_streams <= 2, "Unexpected movie streams");
		int vi = av_find_best_stream(file.format, AVMEDIA_TYPE_VIDEO, -1, -1, nullptr, 0), ai = av_find_best_stream(file.format, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);
		require(vi >= 0, "Video missing"); auto* video = file.format->streams[vi]; auto* vp = video->codecpar;
		require(vp->codec_id == AV_CODEC_ID_PRORES && vp->profile == AV_PROFILE_PRORES_4444, "Expected ProRes 4444");
		require(vp->width > 0 && vp->height > 0 && vp->width <= 256 && vp->height <= 256, "Reference geometry exceeds budget");
		decoder v; v.open(vp); int rate = 0, channels = 0;
		if (ai >= 0) { auto* ap = file.format->streams[ai]->codecpar; require(ap->codec_id == AV_CODEC_ID_PCM_S24LE && ap->sample_rate <= 192000 && ap->sample_rate > 0 && ap->ch_layout.nb_channels >= 1 && ap->ch_layout.nb_channels <= 2, "Expected bounded mono/stereo PCM24"); rate = ap->sample_rate; channels = ap->ch_layout.nb_channels; }
		std::ofstream rgba(argv[2], std::ios::binary | std::ios::trunc), pcm(argv[3], std::ios::binary | std::ios::trunc); require(rgba && pcm, "Reference output unavailable");
		std::vector<std::int64_t> times; int color_depth = 0, alpha_depth = 0; std::size_t samples = 0;
		const auto picture = [&]() {
			auto& f = *v.frame; require(times.size() < 32 && f.width == vp->width && f.height == vp->height, "Reference frame budget/geometry changed");
			const auto* desc = av_pix_fmt_desc_get(static_cast<AVPixelFormat>(f.format)); require(desc && desc->nb_components == 4 && desc->comp[3].depth >= 10, "Reference alpha precision unavailable");
			color_depth = desc->comp[0].depth; alpha_depth = desc->comp[3].depth;
			auto* sws = sws_getContext(f.width, f.height, static_cast<AVPixelFormat>(f.format), f.width, f.height, AV_PIX_FMT_RGBA64, SWS_POINT | SWS_ACCURATE_RND | SWS_BITEXACT, nullptr, nullptr, nullptr); require(sws, "Reference color conversion unavailable");
			const auto* matrix = sws_getCoefficients(SWS_CS_ITU709); require(sws_setColorspaceDetails(sws, matrix, 0, matrix, 1, 0, 1 << 16, 1 << 16) >= 0, "Reference matrix unavailable");
			std::vector<std::uint16_t> pixels(static_cast<std::size_t>(f.width * f.height * 4)); std::uint8_t* output[] = {reinterpret_cast<std::uint8_t*>(pixels.data()), nullptr, nullptr, nullptr}; const int stride[] = {f.width * 8, 0, 0, 0};
			int rows = sws_scale(sws, f.data, f.linesize, 0, f.height, output, stride); sws_freeContext(sws); require(rows == f.height, "Incomplete reference picture");
			std::vector<float> floats(pixels.size());
			for (int y = 0; y < f.height; ++y) for (int x = 0; x < f.width; ++x) {
				auto index = static_cast<std::size_t>((y * f.width + x) * 4); for (int c = 0; c < 3; ++c) floats[index + c] = pixels[index + c] / 65535.0F;
				const auto* alpha = reinterpret_cast<const std::uint16_t*>(f.data[3] + y * f.linesize[3]); floats[index + 3] = alpha[x] / static_cast<float>((1U << alpha_depth) - 1);
			}
			rgba.write(reinterpret_cast<const char*>(floats.data()), static_cast<std::streamsize>(floats.size() * sizeof(float))); require(bool(rgba), "Reference write failed"); times.push_back(f.best_effort_timestamp);
		};
		const auto sound = [&](const AVPacket& packet) {
			require(packet.size > 0 && packet.size % (channels * 3) == 0, "Invalid PCM24 packet");
			const auto count = static_cast<std::size_t>(packet.size / (channels * 3)); require(samples + count <= 192000, "Reference audio budget exceeded");
			const auto time = file.format->streams[ai]->time_base;
			require(packet.pts >= 0 && packet.pts * time.num * rate == static_cast<std::int64_t>(samples) * time.den, "PCM24 timestamps are not contiguous");
			std::vector<float> floats(count * static_cast<std::size_t>(channels));
			for (std::size_t i = 0; i < floats.size(); ++i) { const auto* bytes = packet.data + i * 3; auto value = static_cast<std::int32_t>(bytes[0] | bytes[1] << 8 | bytes[2] << 16); if (value & 0x800000) value -= 0x1000000; floats[i] = static_cast<float>(value / 8388608.0); }
			pcm.write(reinterpret_cast<const char*>(floats.data()), static_cast<std::streamsize>(floats.size() * sizeof(float))); require(bool(pcm), "Reference audio write failed"); samples += count;
		};
		const auto drain = [&](decoder& d) { int result; while ((result = avcodec_receive_frame(d.codec, d.frame)) >= 0) { picture(); av_frame_unref(d.frame); } require(result == AVERROR(EAGAIN) || result == AVERROR_EOF, "Reference decode failed"); };
		file.packet = av_packet_alloc(); require(file.packet, "Packet allocation failed"); int result;
		while ((result = av_read_frame(file.format, file.packet)) >= 0) { auto& p = *file.packet; require(p.stream_index == vi || p.stream_index == ai, "Unexpected stream"); if (p.stream_index == vi) { require(avcodec_send_packet(v.codec, &p) >= 0, "Reference packet decode failed"); drain(v); } else sound(p); av_packet_unref(file.packet); }
		require(result == AVERROR_EOF, "Reference input read failed"); require(avcodec_send_packet(v.codec, nullptr) >= 0, "Video flush failed"); drain(v);
		require(!times.empty(), "No decoded frames");
		std::cout << "{\"width\":" << vp->width << ",\"height\":" << vp->height << ",\"profile\":" << vp->profile << ",\"colorDepth\":" << color_depth << ",\"alphaDepth\":" << alpha_depth << ",\"colorPrimaries\":" << vp->color_primaries << ",\"colorTransfer\":" << vp->color_trc << ",\"colorSpace\":" << vp->color_space << ",\"frames\":[";
		for (std::size_t i = 0; i < times.size(); ++i) { if (i) std::cout << ','; std::cout << "{\"num\":" << times[i] * video->time_base.num << ",\"den\":" << video->time_base.den << '}'; }
		std::cout << "],\"audio\":"; if (ai < 0) std::cout << "null"; else std::cout << "{\"sampleRate\":" << rate << ",\"channels\":" << channels << ",\"sampleCount\":" << samples << '}'; std::cout << "}\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
