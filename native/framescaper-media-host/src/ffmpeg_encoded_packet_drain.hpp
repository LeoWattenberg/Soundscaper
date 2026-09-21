/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

// Include after the FFmpeg codec/format headers. Adapter callbacks preserve
// each operation's cancellation and exact status/error identity.
#include <cerrno>
#include <string_view>

namespace framescaper::media {

template <typename Cancellation, typename RequireStatus, typename AllocationFailure>
void drain_encoded_packets(
	AVCodecContext& encoder,
	AVStream& stream,
	AVFormatContext& format,
	Cancellation check_cancellation,
	RequireStatus require_status,
	AllocationFailure allocation_failure,
	const std::string_view receive_action,
	const std::string_view write_action
) {
	AVPacket* packet = av_packet_alloc();
	if (packet == nullptr) {
		allocation_failure();
		return;
	}
	try {
		while (true) {
			check_cancellation();
			const auto status = avcodec_receive_packet(&encoder, packet);
			if (status == AVERROR(EAGAIN) || status == AVERROR_EOF) break;
			require_status(status, receive_action);
			av_packet_rescale_ts(packet, encoder.time_base, stream.time_base);
			packet->stream_index = stream.index;
			require_status(av_interleaved_write_frame(&format, packet), write_action);
			av_packet_unref(packet);
		}
	} catch (...) {
		av_packet_free(&packet);
		throw;
	}
	av_packet_free(&packet);
}

} // namespace framescaper::media
