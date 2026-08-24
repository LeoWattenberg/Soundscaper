// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/buffer.h>
#include <libavutil/pixfmt.h>
}

#include <filesystem>
#include <functional>
#include <stdexcept>
#include <string>

namespace framescaper::media {

class ffmpeg_decode_failure final : public std::runtime_error {
public:
	ffmpeg_decode_failure(std::string code, std::string message, int exit_code = 70);
	[[nodiscard]] const std::string& code() const noexcept;
	[[nodiscard]] int exit_code() const noexcept;
private:
	std::string code_;
	int exit_code_;
};

/**
 * Exact local-file FFmpeg decoder. A non-CPU backend must actually create its
 * OS device, select a matching decoder configuration, and return hardware
 * frames. Frames are downloaded one at a time before the closed compositor or
 * CPU fallback encoder sees them; a silent software decoder is never relabelled
 * as a hardware attempt.
 */
class ffmpeg_decode_session final {
public:
	ffmpeg_decode_session() = default;
	ffmpeg_decode_session(const ffmpeg_decode_session&) = delete;
	ffmpeg_decode_session& operator=(const ffmpeg_decode_session&) = delete;
	ffmpeg_decode_session(ffmpeg_decode_session&& other) noexcept;
	ffmpeg_decode_session& operator=(ffmpeg_decode_session&&) = delete;
	~ffmpeg_decode_session();

	[[nodiscard]] static ffmpeg_decode_session open(
		const std::filesystem::path& path,
		const std::string& backend,
		int (*interrupt)(void*) = nullptr
	);
	void decode_all(const std::function<void(AVFrame*)>& consume);

	AVFormatContext* format{};
	AVCodecContext* codec{};
	int stream_index{-1};
	[[nodiscard]] bool hardware() const noexcept;

private:
	struct hardware_state;
	static AVPixelFormat select_hardware_format(AVCodecContext* context, const AVPixelFormat* formats);
	void drain(const std::function<void(AVFrame*)>& consume);
	[[nodiscard]] AVFrame* software_frame();

	AVPacket* packet_{};
	AVFrame* frame_{};
	AVFrame* transferred_{};
	hardware_state* hardware_{};
};

/** True only for the OS baseline and explicit vendor backends admitted by argv. */
[[nodiscard]] bool ffmpeg_backend_is_hardware(const std::string& backend) noexcept;

} // namespace framescaper::media
