/* SPDX-License-Identifier: AGPL-3.0-only */
#include "ara_clip_data.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
namespace soundscaper {
soundscaper_pro_status AraClipData::configure(const soundscaper_pro_ara_clip &clip)
{
	if (clip.source_id == nullptr || clip.name == nullptr || clip.source_id[0] == '\0' || clip.name[0] == '\0'
		|| std::strlen(clip.source_id) >= SOUNDSCAPER_PRO_MAX_TEXT || std::strlen(clip.name) >= SOUNDSCAPER_PRO_MAX_TEXT
		|| !std::isfinite(clip.sample_rate) || clip.sample_rate < 8000.0 || clip.sample_rate > 768000.0
		|| clip.channel_count == 0u || clip.channel_count > 64u || clip.frame_count == 0u
		|| !std::isfinite(clip.source_start_seconds) || clip.source_start_seconds < 0.0
		|| !std::isfinite(clip.playback_start_seconds) || clip.playback_start_seconds < 0.0
		|| clip.playback_start_seconds > 86400.0 * 365.0
		|| !std::isfinite(clip.duration_seconds) || clip.duration_seconds <= 0.0
		|| clip.source_start_seconds + clip.duration_seconds > static_cast<double>(clip.frame_count) / clip.sample_rate + 1e-9) {
		return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	}
	if (static_cast<uint64_t>(clip.frame_count) * clip.channel_count * sizeof(float) > maximumBytes) {
		return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
	}
	try {
		samples.clear();
		samples.resize(clip.channel_count);
		for (auto &plane : samples) plane.resize(clip.frame_count);
		id = clip.source_id; name = clip.name;
	} catch (...) { samples.clear(); frameCount = 0u; written = 0u; return SOUNDSCAPER_PRO_STATE_TOO_LARGE; }
	sampleRate = clip.sample_rate; channelCount = clip.channel_count; frameCount = clip.frame_count;
	sourceStart = clip.source_start_seconds; playbackStart = clip.playback_start_seconds; duration = clip.duration_seconds;
	written = 0u;
	return SOUNDSCAPER_PRO_OK;
}
soundscaper_pro_status AraClipData::write(uint32_t start, const float *const *planes, uint32_t channels, uint32_t frames)
{
	if (planes == nullptr || channels != channelCount || frames == 0u || frames > 65536u
		|| start != written || start > frameCount || frames > frameCount - start) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	for (uint32_t channel = 0u; channel < channels; ++channel) {
		if (planes[channel] == nullptr) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
		for (uint32_t frame = 0u; frame < frames; ++frame) {
			if (!std::isfinite(planes[channel][frame])) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
		}
	}
	for (uint32_t channel = 0u; channel < channels; ++channel) {
		std::copy_n(planes[channel], frames, samples[channel].data() + start);
	}
	written += frames;
	return SOUNDSCAPER_PRO_OK;
}
bool AraClipData::read(int64_t start, int64_t frames, void *const *planes, bool use64Bit) const noexcept
{
	if (!ready() || planes == nullptr || frames < 0 || frames > static_cast<int64_t>(maximumBytes / sizeof(double))
		|| start > std::numeric_limits<int64_t>::max() - frames) return false;
	for (uint32_t channel = 0u; channel < channelCount; ++channel) if (planes[channel] == nullptr) return false;
	for (uint32_t channel = 0u; channel < channelCount; ++channel) {
		for (int64_t frame = 0; frame < frames; ++frame) {
			const int64_t position = start + frame;
			const float sample = position >= 0 && position < frameCount ? samples[channel][static_cast<size_t>(position)] : 0.0F;
			if (use64Bit) static_cast<double *>(planes[channel])[frame] = static_cast<double>(sample);
			else static_cast<float *>(planes[channel])[frame] = sample;
		}
	}
	return true;
}
}
