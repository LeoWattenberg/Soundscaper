/* SPDX-License-Identifier: AGPL-3.0-only */
#ifndef SOUNDSCAPER_JUCE_ARA_ADAPTER_H
#define SOUNDSCAPER_JUCE_ARA_ADAPTER_H
#include "ara_clip_data.h"
#include <juce_audio_processors/juce_audio_processors.h>
#include <memory>
namespace soundscaper {
/** Lives solely in the isolated third-party plugin peer. */
class JuceAraSession final {
public:
	static bool supported(juce::AudioPluginInstance &plugin);
	JuceAraSession(juce::AudioPluginInstance &plugin, uint32_t maximumFrames);
	~JuceAraSession();
	soundscaper_pro_status configure(const soundscaper_pro_ara_clip &clip);
	soundscaper_pro_status write(uint32_t start, const float *const *planes, uint32_t channels, uint32_t frames);
	soundscaper_pro_status bind();
	soundscaper_pro_status render(uint32_t start, float **planes, uint32_t channels, uint32_t frames);
	soundscaper_pro_status save(uint8_t *bytes, size_t capacity, size_t &written);
	soundscaper_pro_status load(const uint8_t *bytes, size_t length);
	void unregisterRenderers();
private:
	class Impl;
	std::unique_ptr<Impl> impl;
};
}
#endif
