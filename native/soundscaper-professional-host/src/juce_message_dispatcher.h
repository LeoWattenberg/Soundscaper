/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_JUCE_MESSAGE_DISPATCHER_H
#define SOUNDSCAPER_JUCE_MESSAGE_DISPATCHER_H

#include "professional_host_api.h"

#include <functional>

namespace soundscaper {

soundscaper_pro_status dispatchJuceMessageTask(
	const std::function<soundscaper_pro_status()> &task);
bool postJuceMessageTask(const std::function<void()> &task);
void shutdownJuceMessageDispatcher();
#if defined(__APPLE__)
int runMacJuceMessageDispatcher(const std::function<int()> &framedPeer);
#endif

} // namespace soundscaper

#endif
