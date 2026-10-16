/* SPDX-License-Identifier: AGPL-3.0-only */
#include "ara_clip_data.h"
#include <array>
#include <cmath>
#include <cstdio>
#include <limits>
#define REQUIRE(condition) do { if (!(condition)) { std::fprintf(stderr, "ARA PCM check failed at %d\n", __LINE__); return 1; } } while (false)
int main()
{
	soundscaper::AraClipData data;
	soundscaper_pro_ara_clip clip{"stable-source", "Selected clip", 48000.0, 2u, 4u, 0.0, 12.0, 4.0 / 48000.0};
	REQUIRE(data.configure(clip) == SOUNDSCAPER_PRO_OK);
	REQUIRE(!data.ready());
	const std::array<float, 4> left{0.1F, 0.2F, 0.3F, 0.4F}, right{-0.1F, -0.2F, -0.3F, -0.4F};
	const float *input[]{left.data(), right.data()};
	REQUIRE(data.write(1u, input, 2u, 4u) == SOUNDSCAPER_PRO_FORMAT_REFUSED);
	REQUIRE(data.write(0u, input, 2u, 4u) == SOUNDSCAPER_PRO_OK);
	REQUIRE(data.ready());
	std::array<float, 6> first{}, second{};
	void *output[]{first.data(), second.data()};
	REQUIRE(data.read(-1, 6, output, false));
	REQUIRE(first[0] == 0.0F && first[1] == left[0] && first[4] == left[3] && first[5] == 0.0F);
	REQUIRE(second[2] == right[1]);
	std::array<double, 2> wideLeft{}, wideRight{};
	void *wide[]{wideLeft.data(), wideRight.data()};
	REQUIRE(data.read(2, 2, wide, true));
	REQUIRE(wideLeft[0] == static_cast<double>(left[2]) && wideRight[1] == static_cast<double>(right[3]));
	REQUIRE(!data.read(std::numeric_limits<int64_t>::max(), 2, output, false));
	REQUIRE(!data.read(0, -1, output, false));
	clip.frame_count = std::numeric_limits<uint32_t>::max();
	REQUIRE(data.configure(clip) == SOUNDSCAPER_PRO_STATE_TOO_LARGE);
	clip.frame_count = 4u;
	clip.duration_seconds = 1.0;
	REQUIRE(data.configure(clip) == SOUNDSCAPER_PRO_FORMAT_REFUSED);
	clip.duration_seconds = 4.0 / 48000.0;
	clip.source_start_seconds = std::numeric_limits<double>::quiet_NaN();
	REQUIRE(data.configure(clip) == SOUNDSCAPER_PRO_FORMAT_REFUSED);
	return 0;
}
