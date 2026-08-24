/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_JUCE_AUDIO_ADAPTER_H
#define SOUNDSCAPER_JUCE_AUDIO_ADAPTER_H

#include "professional_host_api.h"

#include <memory>
#include <string>

namespace soundscaper {

class JuceAudioSession {
public:
	virtual ~JuceAudioSession() = default;
	virtual soundscaper_pro_status read(float **planes, uint32_t channels, uint32_t frames) = 0;
	virtual soundscaper_pro_status write(const float *const *planes, uint32_t channels, uint32_t frames) = 0;
};

soundscaper_pro_status enumerateJuceAudio(
	const std::string &backend, std::string &json);
soundscaper_pro_audio_result openJuceAudio(
	const soundscaper_pro_audio_request &request, std::unique_ptr<JuceAudioSession> &session);
soundscaper_pro_status readJuceAudio(
	JuceAudioSession &session, float **planes, uint32_t channels, uint32_t frames);
soundscaper_pro_status writeJuceAudio(
	JuceAudioSession &session, const float *const *planes, uint32_t channels, uint32_t frames);

} // namespace soundscaper

#endif
