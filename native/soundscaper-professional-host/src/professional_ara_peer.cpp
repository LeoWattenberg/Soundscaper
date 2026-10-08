/* SPDX-License-Identifier: AGPL-3.0-only */
#include "professional_ara_peer.h"
namespace soundscaper::professional {
namespace {
constexpr size_t maximumArchiveBytes = SOUNDSCAPER_PRO_MAX_STATE_BYTES - 64u;
soundscaper_pro_status configure(soundscaper_pro_plugin_instance *plugin, codec::Reader &reader)
{
	std::string id, name;
	soundscaper_pro_ara_clip clip{};
	if (!reader.text(id, SOUNDSCAPER_PRO_MAX_TEXT - 1u) || !reader.text(name, SOUNDSCAPER_PRO_MAX_TEXT - 1u)
		|| !reader.number(clip.sample_rate) || !reader.unsigned32(clip.channel_count) || !reader.unsigned32(clip.frame_count)
		|| !reader.number(clip.source_start_seconds) || !reader.number(clip.playback_start_seconds) || !reader.number(clip.duration_seconds)) {
		return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	}
	clip.source_id = id.c_str(); clip.name = name.c_str();
	return soundscaper_pro_plugin_ara_configure(plugin, &clip);
}
soundscaper_pro_status write(soundscaper_pro_plugin_instance *plugin, codec::Reader &reader)
{
	uint32_t start = 0u, frames = 0u, channels = 0u;
	if (!reader.unsigned32(start) || !reader.unsigned32(frames) || !reader.unsigned32(channels)
		|| frames == 0u || frames > 65536u || channels == 0u || channels > 64u) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	std::vector<std::vector<float>> data(channels);
	std::vector<const float *> planes(channels);
	for (uint32_t channel = 0u; channel < channels; ++channel) {
		if (!reader.floats(data[channel], frames)) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
		planes[channel] = data[channel].data();
	}
	return soundscaper_pro_plugin_ara_write(plugin, start, planes.data(), channels, frames);
}
soundscaper_pro_status render(soundscaper_pro_plugin_instance *plugin, codec::Reader &reader, codec::Writer &writer)
{
	uint32_t start = 0u, frames = 0u, channels = 0u;
	if (!reader.unsigned32(start) || !reader.unsigned32(frames) || !reader.unsigned32(channels)
		|| frames == 0u || frames > 65536u || channels == 0u || channels > 64u) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	std::vector<std::vector<float>> data(channels, std::vector<float>(frames));
	std::vector<float *> planes(channels);
	for (uint32_t channel = 0u; channel < channels; ++channel) planes[channel] = data[channel].data();
	const auto status = soundscaper_pro_plugin_ara_render(plugin, start, planes.data(), channels, frames);
	if (status != SOUNDSCAPER_PRO_OK) return status;
	if (!writer.unsigned32(soundscaper_pro_plugin_latency(plugin)) || !writer.unsigned32(channels)) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
	for (const auto &plane : data) if (!writer.floats(plane)) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
	return SOUNDSCAPER_PRO_OK;
}
soundscaper_pro_status save(soundscaper_pro_plugin_instance *plugin, codec::Writer &writer)
{
	size_t length = 0u;
	auto status = soundscaper_pro_plugin_ara_save(plugin, nullptr, 0u, &length);
	if ((status != SOUNDSCAPER_PRO_OK && status != SOUNDSCAPER_PRO_STATE_TOO_LARGE) || length > maximumArchiveBytes) return status;
	std::vector<uint8_t> bytes(length);
	status = soundscaper_pro_plugin_ara_save(plugin, bytes.data(), bytes.size(), &length);
	return status == SOUNDSCAPER_PRO_OK && writer.blob(bytes.data(), length) ? SOUNDSCAPER_PRO_OK : SOUNDSCAPER_PRO_STATE_REJECTED;
}
}
soundscaper_pro_status dispatchAraPeer(uint8_t operation, soundscaper_pro_plugin_instance *plugin,
	codec::Reader &reader, codec::Writer &writer)
{
	if (plugin == nullptr) return SOUNDSCAPER_PRO_MODE_REFUSED;
	switch (operation) {
	case 13u: return configure(plugin, reader);
	case 14u: return write(plugin, reader);
	case 15u: return soundscaper_pro_plugin_ara_bind(plugin);
	case 16u: return render(plugin, reader, writer);
	case 17u: return save(plugin, writer);
	case 18u: {
		std::vector<uint8_t> bytes;
		if (!reader.blob(bytes, maximumArchiveBytes)) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
		return soundscaper_pro_plugin_ara_load(plugin, bytes.data(), bytes.size());
	}
	case 19u: return writer.byte(static_cast<uint8_t>(soundscaper_pro_plugin_ara_supported(plugin)))
		? SOUNDSCAPER_PRO_OK : SOUNDSCAPER_PRO_STATE_TOO_LARGE;
	default: return SOUNDSCAPER_PRO_UNSUPPORTED;
	}
}
}
