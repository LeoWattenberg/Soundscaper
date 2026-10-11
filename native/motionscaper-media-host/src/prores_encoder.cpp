/* SPDX-License-Identifier: AGPL-3.0-only */
#include "prores_encoder.hpp"
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/error.h>
#include <libavutil/opt.h>
#include <libswscale/swscale.h>
}
#include <array>
#include <memory>
#include <stdexcept>
#include <string>

namespace motionscaper::media {
namespace {
void require(const int code, const std::string& action) {
	if (code >= 0) return;
	std::array<char, AV_ERROR_MAX_STRING_SIZE> message{}; av_strerror(code, message.data(), message.size());
	throw std::runtime_error(action + ": " + message.data());
}
struct output_session final {
	AVFormatContext* format{}; AVCodecContext* codec{}; AVFrame* frame{}; AVPacket* packet{}; SwsContext* scale{};
	~output_session() {
		sws_freeContext(scale); av_packet_free(&packet); av_frame_free(&frame); avcodec_free_context(&codec);
		if (format) { if (format->pb) avio_closep(&format->pb); avformat_free_context(format); }
	}
};
void drain(output_session& session, AVStream& stream) {
	while (true) {
		const auto status = avcodec_receive_packet(session.codec, session.packet);
		if (status == AVERROR(EAGAIN) || status == AVERROR_EOF) return;
		require(status, "Receive Motionscaper ProRes packet");
		av_packet_rescale_ts(session.packet, session.codec->time_base, stream.time_base);
		session.packet->stream_index = stream.index;
		require(av_interleaved_write_frame(session.format, session.packet), "Write Motionscaper ProRes packet");
		av_packet_unref(session.packet);
	}
}
} // namespace

bool prores_available() noexcept { return avcodec_find_encoder_by_name("prores_ks") != nullptr; }

void encode_prores4444(frame_carrier& carrier, const std::filesystem::path& destination) {
	const auto& header = carrier.header();
	if (header.width > 16'384 || header.height > 16'384) throw std::runtime_error("Motionscaper ProRes dimensions exceed codec admission.");
	if (std::filesystem::exists(destination)) throw std::runtime_error("Motionscaper helper output must be a fresh main-owned temporary path.");
	const auto path_bytes = destination.u8string(); const std::string path{reinterpret_cast<const char*>(path_bytes.data()), path_bytes.size()};
	output_session session;
	require(avformat_alloc_output_context2(&session.format, nullptr, "mov", path.c_str()), "Allocate Motionscaper MOV output");
	if (!session.format) throw std::runtime_error("Motionscaper MOV allocation failed.");
	const auto* encoder = avcodec_find_encoder_by_name("prores_ks");
	if (!encoder) throw std::runtime_error("The pinned Motionscaper native payload has no prores_ks encoder.");
	session.codec = avcodec_alloc_context3(encoder); session.frame = av_frame_alloc(); session.packet = av_packet_alloc();
	if (!session.codec || !session.frame || !session.packet) throw std::runtime_error("Motionscaper ProRes allocation failed.");
	auto& codec = *session.codec;
	codec.width = static_cast<int>(header.width); codec.height = static_cast<int>(header.height);
	codec.time_base = {static_cast<int>(header.rate_den), static_cast<int>(header.rate_num)};
	codec.framerate = {static_cast<int>(header.rate_num), static_cast<int>(header.rate_den)};
	codec.pix_fmt = AV_PIX_FMT_YUVA444P10; codec.bits_per_raw_sample = 10; codec.thread_count = 1;
	codec.color_primaries = AVCOL_PRI_BT709; codec.color_trc = AVCOL_TRC_BT709;
	codec.colorspace = AVCOL_SPC_BT709; codec.color_range = AVCOL_RANGE_MPEG; codec.alpha_mode = AVALPHA_MODE_STRAIGHT;
	if (session.format->oformat->flags & AVFMT_GLOBALHEADER) codec.flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
	require(av_opt_set(codec.priv_data, "profile", "4444", 0), "Select ProRes 4444");
	require(av_opt_set(codec.priv_data, "alpha_bits", "16", 0), "Select ProRes alpha storage");
	require(avcodec_open2(&codec, encoder, nullptr), "Open Motionscaper ProRes encoder");
	AVStream* stream = avformat_new_stream(session.format, nullptr);
	if (!stream) throw std::runtime_error("Motionscaper MOV stream allocation failed.");
	stream->time_base = codec.time_base; stream->avg_frame_rate = codec.framerate;
	require(avcodec_parameters_from_context(stream->codecpar, &codec), "Bind Motionscaper MOV codec parameters");
	session.frame->format = codec.pix_fmt; session.frame->width = codec.width; session.frame->height = codec.height;
	session.frame->color_primaries = codec.color_primaries; session.frame->color_trc = codec.color_trc;
	session.frame->colorspace = codec.colorspace; session.frame->color_range = codec.color_range; session.frame->alpha_mode = codec.alpha_mode;
	require(av_frame_get_buffer(session.frame, 32), "Allocate Motionscaper encoder surface");
	session.scale = sws_getContext(codec.width, codec.height, AV_PIX_FMT_RGBA64, codec.width, codec.height, codec.pix_fmt,
		SWS_POINT | SWS_ACCURATE_RND | SWS_BITEXACT, nullptr, nullptr, nullptr);
	if (!session.scale) throw std::runtime_error("Motionscaper Rec.709 conversion allocation failed.");
	const auto* coefficients = sws_getCoefficients(SWS_CS_ITU709);
	require(sws_setColorspaceDetails(session.scale, coefficients, 1, coefficients, 0, 0, 1 << 16, 1 << 16), "Bind Motionscaper Rec.709 range conversion");
	require(avio_open(&session.format->pb, path.c_str(), AVIO_FLAG_WRITE), "Open Motionscaper temporary MOV");
	require(avformat_write_header(session.format, nullptr), "Write Motionscaper MOV header");
	for (std::uint64_t index = 0; index < header.frame_count; ++index) {
		const auto frame = carrier.read(index); const auto rgba = rgba64_rec709(frame);
		require(av_frame_make_writable(session.frame), "Reuse Motionscaper encoder surface");
		const std::uint8_t* source[] = {reinterpret_cast<const std::uint8_t*>(rgba.data()), nullptr, nullptr, nullptr};
		const int stride[] = {codec.width * 8, 0, 0, 0};
		const auto rows = sws_scale(session.scale, source, stride, 0, codec.height, session.frame->data, session.frame->linesize);
		if (rows != codec.height) throw std::runtime_error("Motionscaper color conversion returned an incomplete frame.");
		session.frame->pts = static_cast<std::int64_t>(index); session.frame->duration = 1;
		require(avcodec_send_frame(&codec, session.frame), "Send Motionscaper ProRes frame"); drain(session, *stream);
	}
	require(avcodec_send_frame(&codec, nullptr), "Flush Motionscaper ProRes frames"); drain(session, *stream);
	require(av_write_trailer(session.format), "Finish Motionscaper MOV");
	require(avio_closep(&session.format->pb), "Close Motionscaper MOV");
}
} // namespace motionscaper::media
