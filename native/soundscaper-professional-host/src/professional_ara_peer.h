/* SPDX-License-Identifier: AGPL-3.0-only */
#ifndef SOUNDSCAPER_PROFESSIONAL_ARA_PEER_H
#define SOUNDSCAPER_PROFESSIONAL_ARA_PEER_H
#include "professional_host_api.h"
#include "professional_peer_codec.h"
namespace soundscaper::professional {
soundscaper_pro_status dispatchAraPeer(uint8_t operation, soundscaper_pro_plugin_instance *plugin,
	codec::Reader &reader, codec::Writer &writer);
}
#endif
