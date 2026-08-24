// SPDX-License-Identifier: AGPL-3.0-only
#pragma once

#include "media_plan.hpp"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/frame.h>
#include <libavutil/pixfmt.h>
}

#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>

namespace framescaper::media {

class ffmpeg_encode_failure final : public std::runtime_error {
public:
	ffmpeg_encode_failure(std::string code, std::string message, int exit_code);
	[[nodiscard]] const std::string& code() const noexcept;
	[[nodiscard]] int exit_code() const noexcept;
private:
	std::string code_;
	int exit_code_;
};

struct ffmpeg_video_encode_request final {
	const admitted_media_plan& plan;
	std::string backend;
	std::uint32_t width{};
	std::uint32_t height{};
	AVRational time_base{};
	AVRational frame_rate{};
	bool global_header{};
};

/**
 * One exact CPU or hardware encoder. Hardware construction must find the named
 * hardware codec and create/bind its OS device. Where FFmpeg exposes hardware
 * frames, RGBA/source frames are converted into the declared upload format and
 * transferred into that device before avcodec_send_frame. Media Foundation
 * and VideoToolbox retain their explicit hardware-only encoder controls and
 * accept the converted software upload frame through their native API wrapper.
 */
class ffmpeg_video_encode_session final {
public:
	ffmpeg_video_encode_session(const ffmpeg_video_encode_session&) = delete;
	ffmpeg_video_encode_session& operator=(const ffmpeg_video_encode_session&) = delete;
	ffmpeg_video_encode_session(ffmpeg_video_encode_session&&) = delete;
	ffmpeg_video_encode_session& operator=(ffmpeg_video_encode_session&&) = delete;
	~ffmpeg_video_encode_session();

	[[nodiscard]] static std::unique_ptr<ffmpeg_video_encode_session> open(
		const ffmpeg_video_encode_request& request
	);
	[[nodiscard]] AVCodecContext* context() const noexcept;
	[[nodiscard]] const std::string& encoder_name() const noexcept;
	[[nodiscard]] bool hardware() const noexcept;

	/** Returned frame remains owned by this session until the next prepare call. */
	[[nodiscard]] AVFrame* prepare(
		const std::uint8_t* const source_data[4],
		const int source_linesize[4],
		int source_width,
		int source_height,
		AVPixelFormat source_format,
		std::int64_t pts,
		std::int64_t duration,
		const AVFrame* source_properties = nullptr
	);

private:
	ffmpeg_video_encode_session() = default;
	struct state;
	state* state_{};
};

/** Exact native tuple availability used by the authenticated operation self-test. */
[[nodiscard]] bool ffmpeg_professional_cpu_encoder_set_available() noexcept;

} // namespace framescaper::media
