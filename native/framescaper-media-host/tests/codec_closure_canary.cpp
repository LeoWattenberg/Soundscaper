// SPDX-License-Identifier: AGPL-3.0-only

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavfilter/avfilter.h>
#include <libavformat/avformat.h>
#include <libavutil/dict.h>
#include <libavutil/frame.h>
#include <libavutil/pixfmt.h>
}

#include <array>
#include <cstdint>
#include <iostream>

namespace {

[[nodiscard]] bool closed_component_set_is_present() {
	bool present = true;
	for (const auto* name : {
		"h264", "hevc", "vp9", "av1", "prores", "dnxhd", "png", "tiff", "exr",
	}) if (avcodec_find_decoder_by_name(name) == nullptr) {
		std::cerr << "missing decoder " << name << '\n'; present = false;
	}
	for (const auto* name : {
		"libx264", "libx265", "libvpx-vp9", "prores_ks", "dnxhd", "ffv1", "png",
		"tiff", "exr", "aac", "libopus", "pcm_s16le", "flac",
	}) if (avcodec_find_encoder_by_name(name) == nullptr) {
		std::cerr << "missing encoder " << name << '\n'; present = false;
	}
	for (const auto* name : {"mov", "matroska", "mxf", "image2"}) {
		if (av_find_input_format(name) == nullptr) {
			std::cerr << "missing demuxer " << name << '\n'; present = false;
		}
	}
	for (const auto* name : {"mp4", "webm", "mov", "mxf", "matroska", "image2"}) {
		if (av_guess_format(name, nullptr, nullptr) == nullptr) {
			std::cerr << "missing muxer " << name << '\n'; present = false;
		}
	}
	for (const auto* name : {"scale", "format", "aresample"}) {
		if (avfilter_get_by_name(name) == nullptr) {
			std::cerr << "missing filter " << name << '\n'; present = false;
		}
	}
	for (const auto codec : {
		AV_CODEC_ID_H264, AV_CODEC_ID_HEVC, AV_CODEC_ID_VP9, AV_CODEC_ID_AV1, AV_CODEC_ID_PNG,
	}) {
		auto* parser = av_parser_init(codec);
		if (parser == nullptr) {
			std::cerr << "missing parser " << static_cast<int>(codec) << '\n'; present = false;
		} else av_parser_close(parser);
	}
	return present;
}

[[nodiscard]] bool encode_one_main10_frame() {
	const auto* codec = avcodec_find_encoder_by_name("libx265");
	if (codec == nullptr) return false;
	auto* context = avcodec_alloc_context3(codec);
	auto* frame = av_frame_alloc();
	auto* packet = av_packet_alloc();
	AVDictionary* options = nullptr;
	if (context == nullptr || frame == nullptr || packet == nullptr) {
		avcodec_free_context(&context);
		av_frame_free(&frame);
		av_packet_free(&packet);
		return false;
	}
	context->width = 64;
	context->height = 64;
	context->time_base = {1, 24};
	context->framerate = {24, 1};
	context->pix_fmt = AV_PIX_FMT_YUV420P10LE;
	context->gop_size = 1;
	context->max_b_frames = 0;
	av_dict_set(&options, "preset", "ultrafast", 0);
	av_dict_set(&options, "tune", "zerolatency", 0);
	av_dict_set(&options, "profile", "main10", 0);
	av_dict_set(&options, "x265-params", "log-level=error", 0);
	bool encoded = false;
	if (avcodec_open2(context, codec, &options) >= 0 && av_dict_count(options) == 0) {
		frame->format = context->pix_fmt;
		frame->width = context->width;
		frame->height = context->height;
		frame->pts = 0;
		if (av_frame_get_buffer(frame, 32) >= 0 && av_frame_make_writable(frame) >= 0) {
			for (int plane = 0; plane < 3; ++plane) {
				const int height = plane == 0 ? frame->height : frame->height / 2;
				const int width = plane == 0 ? frame->width : frame->width / 2;
				const std::uint16_t value = plane == 0 ? 64U : 512U;
				for (int row = 0; row < height; ++row) {
					auto* samples = reinterpret_cast<std::uint16_t*>(
						frame->data[plane] + row * frame->linesize[plane]
					);
					for (int column = 0; column < width; ++column) samples[column] = value;
				}
			}
			if (avcodec_send_frame(context, frame) >= 0) {
				while (avcodec_receive_packet(context, packet) >= 0) {
					encoded = encoded || packet->size > 0;
					av_packet_unref(packet);
				}
				if (avcodec_send_frame(context, nullptr) >= 0) {
					while (avcodec_receive_packet(context, packet) >= 0) {
						encoded = encoded || packet->size > 0;
						av_packet_unref(packet);
					}
				}
			}
		}
	}
	av_dict_free(&options);
	av_packet_free(&packet);
	av_frame_free(&frame);
	avcodec_free_context(&context);
	return encoded;
}

} // namespace

int main() {
	const bool components = closed_component_set_is_present();
	const bool main10 = encode_one_main10_frame();
	std::cout << "{\"components\":" << (components ? "true" : "false")
		<< ",\"x265Main10\":" << (main10 ? "true" : "false") << "}\n";
	return components && main10 ? 0 : 1;
}
