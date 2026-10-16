/* SPDX-License-Identifier: AGPL-3.0-only */
#ifndef SOUNDSCAPER_ARA_CLIP_DATA_H
#define SOUNDSCAPER_ARA_CLIP_DATA_H
#include "professional_host_api.h"
#include <string>
#include <vector>
namespace soundscaper {
class AraClipData final {
public:
	static constexpr size_t maximumBytes = 512u * 1024u * 1024u;
	soundscaper_pro_status configure(const soundscaper_pro_ara_clip &clip);
	soundscaper_pro_status write(uint32_t start, const float *const *planes, uint32_t channels, uint32_t frames);
	bool read(int64_t start, int64_t frames, void *const *planes, bool use64Bit) const noexcept;
	bool ready() const { return written == frameCount && frameCount > 0u; }
	std::string id, name;
	double sampleRate = 0.0, sourceStart = 0.0, playbackStart = 0.0, duration = 0.0;
	uint32_t channelCount = 0u, frameCount = 0u;
private:
	std::vector<std::vector<float>> samples;
	uint32_t written = 0u;
};
}
#endif
