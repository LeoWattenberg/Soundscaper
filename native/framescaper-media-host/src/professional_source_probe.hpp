// SPDX-License-Identifier: AGPL-3.0-only
#pragma once

#include <string>

extern "C" {
struct AVFormatContext;
}

namespace framescaper::media {

/** Serializes the single integrated V25 source-characteristics record. */
[[nodiscard]] std::string professional_source_characteristics_json(
	const AVFormatContext& format,
	int video_stream_index
);

/** Exercises every admitted V25 mapping without reading external media. */
[[nodiscard]] bool professional_source_characteristics_self_test();

} // namespace framescaper::media
