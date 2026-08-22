/* SPDX-License-Identifier: AGPL-3.0-only */

#include "ffmpeg_selected_v20_adapter.hpp"
#include "selected_v20_frame_pack.hpp"
#include "sha256.hpp"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/audio_fifo.h>
#include <libavutil/error.h>
#include <libavutil/imgutils.h>
#include <libavutil/opt.h>
#include <libavutil/pixdesc.h>
#include <libavutil/samplefmt.h>
#include <libswresample/swresample.h>
#include <libswscale/swscale.h>
}

#include <algorithm>
#include <array>
#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <limits>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

namespace framescaper::media {
namespace {

class adapter_failure final : public std::runtime_error {
public:
	adapter_failure(std::string code, std::string message, const int status = 70)
		: std::runtime_error(std::move(message)), code_{std::move(code)}, status_{status} {}
	[[nodiscard]] const std::string& code() const noexcept { return code_; }
	[[nodiscard]] int status() const noexcept { return status_; }
private:
	std::string code_;
	int status_;
};

[[nodiscard]] std::string escaped(const std::string_view value) {
	std::string result;
	for (const char character : value) {
		if (character == '\\' || character == '"') result += '\\';
		if (character == '\n') result += "\\n";
		else if (character == '\r') result += "\\r";
		else result += character;
	}
	return result;
}

[[nodiscard]] std::string ffmpeg_error(const int code) {
	std::array<char, AV_ERROR_MAX_STRING_SIZE> bytes{};
	av_strerror(code, bytes.data(), bytes.size());
	return std::string{bytes.data()};
}

void require(const int status, const std::string_view action) {
	if (status < 0) throw adapter_failure(
		"ffmpeg-operation-failed", std::string{action} + ": " + ffmpeg_error(status)
	);
}

void not_cancelled() {
	if (media_cancellation_requested()) {
		throw adapter_failure("cancelled", "The selected-V20 render was cancelled.", 75);
	}
}

class bounded_output final {
public:
	bounded_output(std::filesystem::path path, const std::uint64_t maximum_bytes)
		: path_{std::move(path)}, maximum_bytes_{maximum_bytes} {
#if defined(_WIN32)
		if (_wfopen_s(&file_, path_.c_str(), L"w+bx") != 0 || file_ == nullptr) {
#else
		file_ = std::fopen(path_.c_str(), "w+bx");
		if (file_ == nullptr) {
#endif
			throw adapter_failure("output-create", "The selected-V20 output cannot be created exclusively.", 74);
		}
	}
	~bounded_output() {
		if (file_ != nullptr) std::fclose(file_);
		if (!committed_) { std::error_code ignored; std::filesystem::remove(path_, ignored); }
	}
	[[nodiscard]] int write(const std::uint8_t* bytes, const int count) noexcept {
		const auto current = tell();
		if (count < 0 || failed_ || current < 0
			|| static_cast<std::uint64_t>(current) > maximum_bytes_
			|| static_cast<std::uint64_t>(count) > maximum_bytes_ - static_cast<std::uint64_t>(current)) {
			failed_ = true; return AVERROR(ENOSPC);
		}
		if (count > 0 && std::fwrite(bytes, 1, static_cast<std::size_t>(count), file_)
			!= static_cast<std::size_t>(count)) { failed_ = true; return AVERROR(EIO); }
		const auto after = tell();
		if (after < 0) { failed_ = true; return AVERROR(EIO); }
		high_water_ = std::max(high_water_, static_cast<std::uint64_t>(after));
		return count;
	}
	[[nodiscard]] std::int64_t seek(const std::int64_t offset, const int whence) noexcept {
		if (whence == AVSEEK_SIZE) return static_cast<std::int64_t>(high_water_);
#if defined(_WIN32)
		if (_fseeki64(file_, offset, whence) != 0) return AVERROR(errno);
#else
		if (fseeko(file_, static_cast<off_t>(offset), whence) != 0) return AVERROR(errno);
#endif
		return tell();
	}
	void close_for_verification() {
		if (failed_ || std::fflush(file_) != 0) {
			throw adapter_failure("output-flush", "The selected-V20 output cannot be flushed.", 74);
		}
		if (std::fclose(file_) != 0) {
			file_ = nullptr;
			throw adapter_failure("output-flush", "The selected-V20 output cannot be closed.", 74);
		}
		file_ = nullptr;
	}
	void commit() noexcept { committed_ = true; }
	[[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }
	[[nodiscard]] std::uint64_t byte_length() const noexcept { return high_water_; }
private:
	[[nodiscard]] std::int64_t tell() const noexcept {
#if defined(_WIN32)
		return _ftelli64(file_);
#else
		return static_cast<std::int64_t>(ftello(file_));
#endif
	}
	std::filesystem::path path_;
	std::uint64_t maximum_bytes_{};
	std::uint64_t high_water_{};
	std::FILE* file_{};
	bool failed_{};
	bool committed_{};
};

[[nodiscard]] int mux_write(void* opaque, const std::uint8_t* bytes, const int count) {
	return static_cast<bounded_output*>(opaque)->write(bytes, count);
}

[[nodiscard]] std::int64_t mux_seek(void* opaque, const std::int64_t offset, const int whence) {
	return static_cast<bounded_output*>(opaque)->seek(offset, whence);
}

struct audio_input final {
	AVFormatContext* format{};
	AVCodecContext* decoder{};
	AVPacket* packet{};
	AVFrame* frame{};
	int stream_index{-1};
	audio_input() = default;
	audio_input(const audio_input&) = delete;
	audio_input& operator=(const audio_input&) = delete;
	audio_input(audio_input&& other) noexcept
		: format{std::exchange(other.format, nullptr)}, decoder{std::exchange(other.decoder, nullptr)},
		packet{std::exchange(other.packet, nullptr)}, frame{std::exchange(other.frame, nullptr)},
		stream_index{std::exchange(other.stream_index, -1)} {}
	~audio_input() {
		av_frame_free(&frame); av_packet_free(&packet); avcodec_free_context(&decoder);
		avformat_close_input(&format);
	}
};

[[nodiscard]] audio_input open_audio(const std::filesystem::path& path, const std::uint64_t sample_rate) {
	audio_input input;
	AVDictionary* options = nullptr;
	av_dict_set(&options, "protocol_whitelist", "file", 0);
	av_dict_set(&options, "format_whitelist", "wav", 0);
	const auto path_text = path.string();
	auto status = avformat_open_input(&input.format, path_text.c_str(), nullptr, &options);
	av_dict_free(&options);
	require(status, "Open the authenticated staged WAV");
	require(avformat_find_stream_info(input.format, nullptr), "Read staged WAV stream information");
	const AVCodec* codec = nullptr;
	input.stream_index = av_find_best_stream(input.format, AVMEDIA_TYPE_AUDIO, -1, -1, &codec, 0);
	if (input.stream_index < 0 || codec == nullptr) {
		throw adapter_failure("audio-stream-missing", "The staged WAV has no supported audio stream.", 65);
	}
	input.decoder = avcodec_alloc_context3(codec);
	if (input.decoder == nullptr) throw adapter_failure("audio-allocation", "The audio decoder cannot be allocated.");
	require(avcodec_parameters_to_context(
		input.decoder, input.format->streams[input.stream_index]->codecpar
	), "Copy staged audio parameters");
	if (input.decoder->sample_rate != static_cast<int>(sample_rate)) {
		throw adapter_failure("audio-rate-mismatch", "The staged WAV rate disagrees with the canonical plan.", 65);
	}
	input.decoder->thread_count = 1;
	require(avcodec_open2(input.decoder, codec, nullptr), "Open the staged audio decoder");
	input.packet = av_packet_alloc(); input.frame = av_frame_alloc();
	if (input.packet == nullptr || input.frame == nullptr) {
		throw adapter_failure("audio-allocation", "Staged audio decode storage cannot be allocated.");
	}
	return input;
}

struct mux_session final {
	AVFormatContext* format{};
	AVCodecContext* video{};
	AVCodecContext* audio{};
	AVStream* video_stream{};
	AVStream* audio_stream{};
	AVIOContext* io{};
	AVFrame* video_frame{};
	SwsContext* video_scaler{};
	SwrContext* audio_resampler{};
	AVAudioFifo* audio_fifo{};
	mux_session() = default;
	mux_session(const mux_session&) = delete;
	mux_session& operator=(const mux_session&) = delete;
	mux_session(mux_session&& other) noexcept
		: format{std::exchange(other.format, nullptr)}, video{std::exchange(other.video, nullptr)},
		audio{std::exchange(other.audio, nullptr)},
		video_stream{std::exchange(other.video_stream, nullptr)},
		audio_stream{std::exchange(other.audio_stream, nullptr)},
		io{std::exchange(other.io, nullptr)}, video_frame{std::exchange(other.video_frame, nullptr)},
		video_scaler{std::exchange(other.video_scaler, nullptr)},
		audio_resampler{std::exchange(other.audio_resampler, nullptr)},
		audio_fifo{std::exchange(other.audio_fifo, nullptr)} {}
	~mux_session() {
		av_audio_fifo_free(audio_fifo); swr_free(&audio_resampler); sws_freeContext(video_scaler);
		av_frame_free(&video_frame); avcodec_free_context(&audio); avcodec_free_context(&video);
		if (io != nullptr) { av_freep(&io->buffer); avio_context_free(&io); }
		avformat_free_context(format);
	}
};

[[nodiscard]] std::array<std::string_view, 4> quality_settings(
	const std::string& container, const std::string& quality
) {
	if (container == "mp4") {
		if (quality == "draft") return {"28", "veryfast", "", "128000"};
		if (quality == "balanced") return {"23", "medium", "", "192000"};
		if (quality == "high") return {"18", "slow", "", "256000"};
	} else {
		if (quality == "draft") return {"36", "good", "6", "96000"};
		if (quality == "balanced") return {"31", "good", "4", "160000"};
		if (quality == "high") return {"24", "good", "2", "192000"};
	}
	throw adapter_failure("quality-policy", "The selected-V20 quality tier is unsupported.", 65);
}

void copy_audio_layout(AVChannelLayout& target, const audio_input& source, const selected_v20_audio_layout layout) {
	if (layout == selected_v20_audio_layout::mono) av_channel_layout_default(&target, 1);
	else if (layout == selected_v20_audio_layout::stereo) av_channel_layout_default(&target, 2);
	else require(av_channel_layout_copy(&target, &source.decoder->ch_layout), "Copy staged audio channel layout");
	if (target.nb_channels < 1 || target.nb_channels > 8) {
		throw adapter_failure("audio-layout", "The staged audio channel count exceeds the closed layout domain.", 78);
	}
}

[[nodiscard]] AVSampleFormat audio_sample_format(AVCodecContext* context, const AVCodec* codec) {
	const void* configurations = nullptr;
	int count = 0;
	require(avcodec_get_supported_config(
		context, codec, AV_CODEC_CONFIG_SAMPLE_FORMAT, 0, &configurations, &count
	), "Read the selected-V20 audio sample-format set");
	if (configurations == nullptr) return AV_SAMPLE_FMT_FLTP;
	if (count < 1) throw adapter_failure(
		"codec-policy-unavailable", "The planned audio encoder has no supported sample format.", 78
	);
	return static_cast<const AVSampleFormat*>(configurations)[0];
}

void configure_video(
	mux_session& output, const invocation& job,
	const selected_v20_execution_plan& plan, const std::array<std::string_view, 4>& quality
) {
	const AVCodec* codec = avcodec_find_encoder_by_name(job.admitted_plan.video_encoder.c_str());
	if (codec == nullptr) throw adapter_failure(
		"codec-policy-unavailable", "The planned selected-V20 video encoder is absent.", 78
	);
	output.video = avcodec_alloc_context3(codec);
	if (output.video == nullptr) throw adapter_failure("video-allocation", "The video encoder cannot be allocated.");
	output.video->width = static_cast<int>(plan.width); output.video->height = static_cast<int>(plan.height);
	output.video->pix_fmt = AV_PIX_FMT_YUV420P;
	output.video->time_base = {
		plan.output_rate.denominator().convert_to<int>(), plan.output_rate.numerator().convert_to<int>(),
	};
	output.video->framerate = {output.video->time_base.den, output.video->time_base.num};
	output.video->thread_count = 1; output.video->gop_size = 12; output.video->max_b_frames = 0;
	if ((output.format->oformat->flags & AVFMT_GLOBALHEADER) != 0) output.video->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
	if (job.admitted_plan.video_encoder == "libx264") {
		require(av_opt_set(output.video->priv_data, "preset", quality[1].data(), 0), "Set H.264 quality preset");
		require(av_opt_set(output.video->priv_data, "crf", quality[0].data(), 0), "Set H.264 CRF");
	} else if (job.admitted_plan.video_encoder == "libvpx-vp9") {
		require(av_opt_set(output.video->priv_data, "deadline", quality[1].data(), 0), "Set VP9 deadline");
		require(av_opt_set(output.video->priv_data, "cpu-used", quality[2].data(), 0), "Set VP9 CPU effort");
		require(av_opt_set(output.video->priv_data, "crf", quality[0].data(), 0), "Set VP9 CRF");
		output.video->bit_rate = 0;
	} else throw adapter_failure("codec-policy-unavailable", "The selected-V20 video encoder is outside the closed set.", 78);
	require(avcodec_open2(output.video, codec, nullptr), "Open the selected-V20 video encoder");
	output.video_stream = avformat_new_stream(output.format, nullptr);
	if (output.video_stream == nullptr) throw adapter_failure("video-allocation", "The video stream cannot be allocated.");
	output.video_stream->time_base = output.video->time_base;
	require(avcodec_parameters_from_context(output.video_stream->codecpar, output.video), "Copy video stream parameters");
}

void configure_audio(
	mux_session& output, const invocation& job, const selected_v20_execution_plan& plan,
	const std::array<std::string_view, 4>& quality, audio_input& input
) {
	const auto encoder_name = job.admitted_plan.container == "mp4" ? "aac" : "libopus";
	const AVCodec* codec = avcodec_find_encoder_by_name(encoder_name);
	if (codec == nullptr) throw adapter_failure("codec-policy-unavailable", "The planned audio encoder is absent.", 78);
	output.audio = avcodec_alloc_context3(codec);
	if (output.audio == nullptr) throw adapter_failure("audio-allocation", "The audio encoder cannot be allocated.");
	output.audio->sample_rate = static_cast<int>(plan.sample_rate);
	output.audio->sample_fmt = audio_sample_format(output.audio, codec);
	output.audio->time_base = {1, output.audio->sample_rate};
	output.audio->bit_rate = std::stoll(std::string{quality[3]});
	copy_audio_layout(output.audio->ch_layout, input, plan.audio_layout);
	if ((output.format->oformat->flags & AVFMT_GLOBALHEADER) != 0) output.audio->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
	require(avcodec_open2(output.audio, codec, nullptr), "Open the selected-V20 audio encoder");
	output.audio_stream = avformat_new_stream(output.format, nullptr);
	if (output.audio_stream == nullptr) throw adapter_failure("audio-allocation", "The audio stream cannot be allocated.");
	output.audio_stream->time_base = output.audio->time_base;
	require(avcodec_parameters_from_context(output.audio_stream->codecpar, output.audio), "Copy audio stream parameters");
	require(swr_alloc_set_opts2(
		&output.audio_resampler, &output.audio->ch_layout, output.audio->sample_fmt,
		output.audio->sample_rate, &input.decoder->ch_layout, input.decoder->sample_fmt,
		input.decoder->sample_rate, 0, nullptr
	), "Create the staged audio conversion");
	require(swr_init(output.audio_resampler), "Initialize the staged audio conversion");
	output.audio_fifo = av_audio_fifo_alloc(
		output.audio->sample_fmt, output.audio->ch_layout.nb_channels,
		std::max(1, output.audio->frame_size * 2)
	);
	if (output.audio_fifo == nullptr) throw adapter_failure("audio-allocation", "The audio FIFO cannot be allocated.");
}

[[nodiscard]] mux_session open_mux(
	const invocation& job, const selected_v20_execution_plan& plan,
	bounded_output& bytes, audio_input* audio
) {
	mux_session output;
	require(avformat_alloc_output_context2(&output.format, nullptr, job.admitted_plan.container.c_str(), nullptr),
		"Create the selected-V20 muxer");
	const auto quality = quality_settings(job.admitted_plan.container, plan.quality);
	configure_video(output, job, plan, quality);
	if (audio != nullptr) configure_audio(output, job, plan, quality, *audio);
	auto* buffer = static_cast<unsigned char*>(av_malloc(64U * 1024U));
	if (buffer == nullptr) throw adapter_failure("output-allocation", "The mux output buffer cannot be allocated.");
	output.io = avio_alloc_context(buffer, 64U * 1024U, 1, &bytes, nullptr, mux_write, mux_seek);
	if (output.io == nullptr) { av_free(buffer); throw adapter_failure("output-allocation", "The mux IO cannot be allocated."); }
	output.format->pb = output.io; output.format->flags |= AVFMT_FLAG_CUSTOM_IO;
	require(avformat_write_header(output.format, nullptr), "Write the selected-V20 container header");
	output.video_frame = av_frame_alloc();
	if (output.video_frame == nullptr) throw adapter_failure("video-allocation", "The video frame cannot be allocated.");
	output.video_frame->format = output.video->pix_fmt;
	output.video_frame->width = output.video->width; output.video_frame->height = output.video->height;
	require(av_frame_get_buffer(output.video_frame, 32), "Allocate a selected-V20 video frame");
	output.video_scaler = sws_getContext(
		output.video->width, output.video->height, AV_PIX_FMT_RGBA,
		output.video->width, output.video->height, output.video->pix_fmt,
		SWS_BICUBIC, nullptr, nullptr, nullptr
	);
	if (output.video_scaler == nullptr) throw adapter_failure("video-scale", "The RGBA conversion cannot be created.");
	return output;
}

void drain_encoder(AVCodecContext* encoder, AVStream* stream, AVFormatContext* format) {
	AVPacket* packet = av_packet_alloc();
	if (packet == nullptr) throw adapter_failure("encode-allocation", "An encoded packet cannot be allocated.");
	try {
		while (true) {
			not_cancelled();
			const auto status = avcodec_receive_packet(encoder, packet);
			if (status == AVERROR(EAGAIN) || status == AVERROR_EOF) break;
			require(status, "Receive an encoded selected-V20 packet");
			av_packet_rescale_ts(packet, encoder->time_base, stream->time_base);
			packet->stream_index = stream->index;
			require(av_interleaved_write_frame(format, packet), "Write an encoded selected-V20 packet");
			av_packet_unref(packet);
		}
	} catch (...) { av_packet_free(&packet); throw; }
	av_packet_free(&packet);
}

void write_video_frame(mux_session& output, const selected_v20_output_frame& frame) {
	not_cancelled();
	require(av_frame_make_writable(output.video_frame), "Make a selected-V20 video frame writable");
	const std::array<const std::uint8_t*, 4> planes{frame.rgba.data(), nullptr, nullptr, nullptr};
	const std::array<int, 4> strides{output.video->width * 4, 0, 0, 0};
	sws_scale(output.video_scaler, planes.data(), strides.data(), 0, output.video->height,
		output.video_frame->data, output.video_frame->linesize);
	output.video_frame->pts = static_cast<std::int64_t>(frame.output_ordinal);
	output.video_frame->duration = 1;
	require(avcodec_send_frame(output.video, output.video_frame), "Send a selected-V20 video frame");
	drain_encoder(output.video, output.video_stream, output.format);
}

void encode_audio_fifo(mux_session& output, std::int64_t& pts, const bool final) {
	const int configured = output.audio->frame_size > 0 ? output.audio->frame_size : 1'024;
	while (av_audio_fifo_size(output.audio_fifo) >= configured
		|| (final && av_audio_fifo_size(output.audio_fifo) > 0)) {
		const int count = std::min(configured, av_audio_fifo_size(output.audio_fifo));
		AVFrame* frame = av_frame_alloc();
		if (frame == nullptr) throw adapter_failure("audio-allocation", "An audio frame cannot be allocated.");
		try {
			frame->format = output.audio->sample_fmt; frame->sample_rate = output.audio->sample_rate;
			frame->nb_samples = count; frame->pts = pts;
			require(av_channel_layout_copy(&frame->ch_layout, &output.audio->ch_layout), "Copy encoded audio layout");
			require(av_frame_get_buffer(frame, 0), "Allocate an encoded audio frame");
			if (av_audio_fifo_read(output.audio_fifo, reinterpret_cast<void**>(frame->data), count) != count) {
				throw adapter_failure("audio-fifo", "The staged audio FIFO was short.");
			}
			pts += count;
			require(avcodec_send_frame(output.audio, frame), "Send selected-V20 audio samples");
			drain_encoder(output.audio, output.audio_stream, output.format);
		} catch (...) { av_frame_free(&frame); throw; }
		av_frame_free(&frame);
	}
}

void append_converted_audio(
	mux_session& output, const AVFrame* input, const int maximum_samples,
	std::uint64_t& accepted_samples, const std::uint64_t target_samples, std::int64_t& pts
) {
	if (maximum_samples <= 0 || accepted_samples >= target_samples) return;
	const auto remaining = target_samples - accepted_samples;
	const auto capacity = static_cast<int>(std::min<std::uint64_t>(remaining, maximum_samples));
	std::uint8_t** converted = nullptr;
	int linesize = 0;
	require(av_samples_alloc_array_and_samples(
		&converted, &linesize, output.audio->ch_layout.nb_channels,
		capacity, output.audio->sample_fmt, 0
	), "Allocate converted selected-V20 audio");
	try {
		const auto count = swr_convert(
			output.audio_resampler, converted, capacity,
			input == nullptr ? nullptr : const_cast<const std::uint8_t**>(input->extended_data),
			input == nullptr ? 0 : input->nb_samples
		);
		require(count, "Convert selected-V20 staged audio");
		if (count > 0) {
			if (av_audio_fifo_realloc(output.audio_fifo, av_audio_fifo_size(output.audio_fifo) + count) < 0
				|| av_audio_fifo_write(output.audio_fifo, reinterpret_cast<void**>(converted), count) != count) {
				throw adapter_failure("audio-fifo", "Converted staged audio cannot be queued.");
			}
			accepted_samples += static_cast<std::uint64_t>(count);
			encode_audio_fifo(output, pts, false);
		}
	} catch (...) { av_freep(&converted[0]); av_freep(&converted); throw; }
	av_freep(&converted[0]); av_freep(&converted);
}

void write_staged_audio(mux_session& output, audio_input& input, const std::uint64_t target_samples) {
	std::uint64_t accepted = 0;
	std::int64_t pts = 0;
	auto drain = [&]() {
		while (true) {
			not_cancelled();
			const auto status = avcodec_receive_frame(input.decoder, input.frame);
			if (status == AVERROR(EAGAIN) || status == AVERROR_EOF) return;
			require(status, "Receive staged audio samples");
			const auto capacity = swr_get_out_samples(output.audio_resampler, input.frame->nb_samples);
			append_converted_audio(output, input.frame, capacity, accepted, target_samples, pts);
			av_frame_unref(input.frame);
		}
	};
	while (accepted < target_samples) {
		not_cancelled();
		const auto status = av_read_frame(input.format, input.packet);
		if (status == AVERROR_EOF) break;
		require(status, "Read staged audio packet");
		if (input.packet->stream_index == input.stream_index) {
			const auto sent = avcodec_send_packet(input.decoder, input.packet);
			av_packet_unref(input.packet); require(sent, "Send staged audio packet"); drain();
		} else av_packet_unref(input.packet);
	}
	if (accepted < target_samples) {
		require(avcodec_send_packet(input.decoder, nullptr), "Flush staged audio decoder"); drain();
	}
	while (accepted < target_samples) {
		const auto capacity = swr_get_out_samples(output.audio_resampler, 0);
		if (capacity <= 0) break;
		const auto before = accepted;
		append_converted_audio(output, nullptr, capacity, accepted, target_samples, pts);
		if (accepted == before) break;
	}
	while (accepted < target_samples) {
		const auto count = static_cast<int>(std::min<std::uint64_t>(target_samples - accepted, 8'192));
		std::uint8_t** silence = nullptr; int linesize = 0;
		require(av_samples_alloc_array_and_samples(
			&silence, &linesize, output.audio->ch_layout.nb_channels,
			count, output.audio->sample_fmt, 0
		), "Allocate staged audio padding");
		av_samples_set_silence(silence, 0, count, output.audio->ch_layout.nb_channels, output.audio->sample_fmt);
		if (av_audio_fifo_realloc(output.audio_fifo, av_audio_fifo_size(output.audio_fifo) + count) < 0
			|| av_audio_fifo_write(output.audio_fifo, reinterpret_cast<void**>(silence), count) != count) {
			av_freep(&silence[0]); av_freep(&silence);
			throw adapter_failure("audio-fifo", "Staged audio padding cannot be queued.");
		}
		av_freep(&silence[0]); av_freep(&silence);
		accepted += static_cast<std::uint64_t>(count); encode_audio_fifo(output, pts, false);
	}
	encode_audio_fifo(output, pts, true);
	require(avcodec_send_frame(output.audio, nullptr), "Flush the selected-V20 audio encoder");
	drain_encoder(output.audio, output.audio_stream, output.format);
}

void reauthenticate_sources(const invocation& job) {
	for (std::size_t index = 0; index < job.sources.size(); ++index) {
		not_cancelled();
		if (std::filesystem::file_size(job.sources[index]) != job.source_byte_lengths[index]
			|| sha256_file(job.sources[index]) != job.source_sha256[index]) {
			throw adapter_failure("source-changed", "A selected-V20 source changed during execution.", 65);
		}
	}
}

} // namespace

engine_result execute_selected_v20_keyed_adapter(
	const invocation& job,
	const selected_v20_execution_plan& plan,
	const std::size_t carrier_index,
	const std::optional<std::size_t> audio_index
) {
	try {
		selected_v20_frame_pack carrier(
			job.sources.at(carrier_index), job.source_byte_lengths.at(carrier_index)
		);
		carrier.require_output_cadence(plan);
		std::optional<audio_input> audio;
		if (audio_index) audio.emplace(open_audio(job.sources.at(*audio_index), plan.sample_rate));
		bounded_output bytes{job.temporary_output, job.maximum_output_bytes};
		auto output = open_mux(job, plan, bytes, audio ? &*audio : nullptr);
		selected_v20_executor_ports ports;
		ports.cancelled = [] { return media_cancellation_requested(); };
		ports.keyed_frame = [&](const selected_v20_keyed_frame_request& request) {
			return carrier.frame(request.output_ordinal);
		};
		ports.write_frame = [&](const selected_v20_output_frame& frame) { write_video_frame(output, frame); };
		const auto report = execute_selected_v20_frames(plan, ports);
		require(avcodec_send_frame(output.video, nullptr), "Flush the selected-V20 video encoder");
		drain_encoder(output.video, output.video_stream, output.format);
		if (audio) write_staged_audio(output, *audio, plan.audio_sample_count);
		require(av_write_trailer(output.format), "Finalize the selected-V20 container");
		reauthenticate_sources(job);
		bytes.close_for_verification();
		if (std::filesystem::file_size(bytes.path()) != bytes.byte_length()) {
			throw adapter_failure("output-length", "The selected-V20 output length changed before verification.", 74);
		}
		const auto sha256 = sha256_file(bytes.path());
		std::ostringstream result;
		const auto profile = plan.family == selected_v20_family::keyed_evaluated_rgba_v7
			? std::string{"selected-v20-v7-keyed-rgba"}
			: std::string{"selected-v20-v8-evaluated-rgba"};
		result << "{\"contractVersion\":1,\"operation\":\"" << operation_name(job.kind) << "\","
			<< "\"profile\":\"" << profile << "\",\"frameCount\":" << report.frames_written << ','
			<< "\"maximumInFlightFrames\":" << report.maximum_in_flight_frames << ','
			<< "\"byteLength\":" << bytes.byte_length() << ",\"sha256\":\"" << sha256 << "\"}";
		auto control = result.str();
		bytes.commit();
		return {0, std::move(control)};
	} catch (const adapter_failure& error) {
		return {error.status(), "{\"error\":\"" + error.code() + "\",\"operation\":\""
			+ std::string{operation_name(job.kind)} + "\",\"detail\":\"" + escaped(error.what()) + "\"}"};
	} catch (const selected_v20_execution_error& error) {
		return {error.code() == selected_v20_execution_error_code::cancelled ? 75 : 65,
			"{\"error\":\"selected-v20-frame-contract\",\"operation\":\""
			+ std::string{operation_name(job.kind)} + "\",\"detail\":\"" + escaped(error.what()) + "\"}"};
	} catch (const std::exception& error) {
		return {70, "{\"error\":\"selected-v20-adapter-failure\",\"operation\":\""
			+ std::string{operation_name(job.kind)} + "\",\"detail\":\"" + escaped(error.what()) + "\"}"};
	}
}

bool self_test_selected_v20_keyed_adapter() noexcept {
	return selected_v20_maximum_frame_bytes == 8U * 1024U * 1024U
		&& av_get_pix_fmt("rgba") == AV_PIX_FMT_RGBA
		&& av_get_pix_fmt("yuv420p") == AV_PIX_FMT_YUV420P;
}

} // namespace framescaper::media
