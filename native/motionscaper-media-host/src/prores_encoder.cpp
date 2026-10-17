/* SPDX-License-Identifier: AGPL-3.0-only */
#include "prores_encoder.hpp"
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/error.h>
#include <libavutil/opt.h>
#include <libswscale/swscale.h>
}
#include <algorithm>
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
		require(av_write_frame(session.format, session.packet), "Write Motionscaper ProRes packet");
		av_packet_unref(session.packet);
	}
}
} // namespace

bool prores_available() noexcept { return avcodec_find_encoder_by_name("prores_ks") != nullptr; }

void encode_prores4444(frame_carrier& carrier, const std::filesystem::path& destination, pcm_carrier* audio) {
	const auto& header = carrier.header();
	if (header.frame_count > 32'768) throw std::runtime_error("Motionscaper flat MOV exceeds its bounded 32768-frame sample index.");
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
	// FFmpeg 9.0.1 proresenc_kostya_common.h admits QUANT_MAT_XQ_LUMA = 5
	// through the integer quant_mat option. Its 2--4 weights preserve thin
	// antialiased strokes; automatic 4444 selects HQ weights up to 7 instead.
	// This changes quantization, not the 4444 profile or ten-bit input precision.
	constexpr int fine_detail_matrix = 5;
	codec.flags |= AV_CODEC_FLAG_QSCALE; codec.global_quality = FF_QP2LAMBDA;
	require(av_opt_set_int(codec.priv_data, "quant_mat", fine_detail_matrix, 0), "Select ProRes fine-detail quantization");
	require(avcodec_open2(&codec, encoder, nullptr), "Open Motionscaper ProRes encoder");
	AVStream* stream = avformat_new_stream(session.format, nullptr);
	if (!stream) throw std::runtime_error("Motionscaper MOV stream allocation failed.");
	stream->time_base = codec.time_base; stream->avg_frame_rate = codec.framerate;
	require(avcodec_parameters_from_context(stream->codecpar, &codec), "Bind Motionscaper MOV codec parameters");
	if (codec.delay != 0) throw std::runtime_error("Motionscaper direct packet ordering requires an intraframe encoder without delay.");
	AVStream* audio_stream = nullptr;
	if (audio) {
		audio_stream = avformat_new_stream(session.format, nullptr); if (!audio_stream) throw std::runtime_error("Motionscaper PCM stream allocation failed.");
		const auto& description = audio->header(); auto& parameters = *audio_stream->codecpar;
		audio_stream->time_base = {1, static_cast<int>(description.sample_rate)};
		parameters.codec_type = AVMEDIA_TYPE_AUDIO; parameters.codec_id = AV_CODEC_ID_PCM_S24LE; parameters.format = AV_SAMPLE_FMT_S32;
		parameters.sample_rate = static_cast<int>(description.sample_rate); parameters.bits_per_coded_sample = 24; parameters.bits_per_raw_sample = 24;
		parameters.block_align = static_cast<int>(description.channels * 3); parameters.bit_rate = static_cast<std::int64_t>(description.sample_rate) * description.channels * 24;
		av_channel_layout_default(&parameters.ch_layout, static_cast<int>(description.channels));
	}
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
	std::uint64_t audio_position = 0;
	const auto write_audio = [&]() {
		const auto bytes = audio->read(audio_position); const auto samples = bytes.size() / (audio->header().channels * 3);
		require(av_new_packet(session.packet, static_cast<int>(bytes.size())), "Allocate bounded Motionscaper PCM packet");
		std::copy(bytes.begin(), bytes.end(), session.packet->data); session.packet->pts = session.packet->dts = static_cast<std::int64_t>(audio_position);
		session.packet->duration = static_cast<std::int64_t>(samples); session.packet->stream_index = audio_stream->index; session.packet->flags = AV_PKT_FLAG_KEY;
		av_packet_rescale_ts(session.packet, {1, static_cast<int>(audio->header().sample_rate)}, audio_stream->time_base);
		require(av_write_frame(session.format, session.packet), "Write Motionscaper PCM packet"); av_packet_unref(session.packet); audio_position += samples;
	};
	for (std::uint64_t index = 0; index < header.frame_count; ++index) {
		// Merge by presentation time and write directly: no duration-sized interleave queue.
		while (audio && audio_position < audio->header().sample_count
			&& av_compare_ts(static_cast<std::int64_t>(audio_position), {1, static_cast<int>(audio->header().sample_rate)}, static_cast<std::int64_t>(index), codec.time_base) <= 0) write_audio();
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
	while (audio && audio_position < audio->header().sample_count) write_audio();
	require(av_write_trailer(session.format), "Finish Motionscaper MOV");
	require(avio_closep(&session.format->pb), "Close Motionscaper MOV");
}
} // namespace motionscaper::media
