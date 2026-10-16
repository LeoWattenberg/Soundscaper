/* SPDX-License-Identifier: AGPL-3.0-only */
#include "professional_host_api.h"
#include "juce_message_dispatcher.h"
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>
#define REQUIRE(condition) do { if (!(condition)) { std::fprintf(stderr, "ARA host check failed at %d\n", __LINE__); return 1; } } while (false)
int run(const char *path)
{
	size_t count = 0u;
	REQUIRE(soundscaper_pro_plugin_scan("vst3", path, nullptr, 0u, &count) == SOUNDSCAPER_PRO_OK);
	REQUIRE(count == 1u);
	soundscaper_pro_plugin_description description{};
	REQUIRE(soundscaper_pro_plugin_scan("vst3", path, &description, 1u, &count) == SOUNDSCAPER_PRO_OK);
	std::array<float, 16> left{}, right{}, first{}, second{};
	for (uint32_t frame = 0u; frame < 16u; ++frame) { left[frame] = static_cast<float>(frame + 1u) / 32.0F; right[frame] = -left[frame]; }
	const float *inputs[]{left.data(), right.data()};
	float *outputs[]{first.data(), second.data()};
	soundscaper_pro_ara_clip clip{"test-source", "ARA selected clip", 48000.0, 2u, 16u, 4.0 / 48000.0, 12.0, 8.0 / 48000.0};
	std::vector<uint8_t> archive;
	for (int round = 0; round < 2; ++round) {
		soundscaper_pro_plugin_instance *instance = nullptr;
		REQUIRE(soundscaper_pro_plugin_open("vst3", path, description.stable_id, 48000.0, 8u, &instance) == SOUNDSCAPER_PRO_OK);
		REQUIRE(soundscaper_pro_plugin_ara_supported(instance) == 1u);
		REQUIRE(soundscaper_pro_plugin_ara_configure(instance, &clip) == SOUNDSCAPER_PRO_OK);
		REQUIRE(soundscaper_pro_plugin_ara_bind(instance) == SOUNDSCAPER_PRO_MODE_REFUSED);
		REQUIRE(soundscaper_pro_plugin_ara_write(instance, 0u, inputs, 2u, 8u) == SOUNDSCAPER_PRO_OK);
		const float *remaining[]{left.data() + 8u, right.data() + 8u};
		REQUIRE(soundscaper_pro_plugin_ara_write(instance, 8u, remaining, 2u, 8u) == SOUNDSCAPER_PRO_OK);
		REQUIRE(soundscaper_pro_plugin_ara_bind(instance) == SOUNDSCAPER_PRO_OK);
		REQUIRE(soundscaper_pro_plugin_latency(instance) == 4u);
		REQUIRE(soundscaper_pro_plugin_ara_write(instance, 0u, inputs, 2u, 8u) == SOUNDSCAPER_PRO_MODE_REFUSED);
		REQUIRE(soundscaper_pro_plugin_ara_bind(instance) == SOUNDSCAPER_PRO_MODE_REFUSED);
		const float gain = round == 0 ? 0.5F : 0.25F;
		if (round == 1) REQUIRE(soundscaper_pro_plugin_ara_load(instance, archive.data(), archive.size()) == SOUNDSCAPER_PRO_OK);
		REQUIRE(soundscaper_pro_plugin_ara_render(instance, 2u, outputs, 2u, 4u) == SOUNDSCAPER_PRO_OK);
		for (uint32_t frame = 0u; frame < 4u; ++frame) REQUIRE(first[frame] == left[frame + 6u] * gain && second[frame] == right[frame + 6u] * gain);
		REQUIRE(soundscaper_pro_plugin_ara_render(instance, 0u, outputs, 2u, 8u) == SOUNDSCAPER_PRO_OK);
		for (uint32_t frame = 0u; frame < 8u; ++frame) REQUIRE(first[frame] == left[frame + 4u] * gain && second[frame] == right[frame + 4u] * gain);
		REQUIRE(soundscaper_pro_plugin_ara_render(instance, 7u, outputs, 2u, 2u) == SOUNDSCAPER_PRO_FORMAT_REFUSED);
		size_t length = 0u;
		REQUIRE(soundscaper_pro_plugin_ara_save(instance, nullptr, 0u, &length) == SOUNDSCAPER_PRO_STATE_TOO_LARGE);
		REQUIRE(length > 0u && length < SOUNDSCAPER_PRO_MAX_STATE_BYTES);
		archive.resize(length);
		REQUIRE(soundscaper_pro_plugin_ara_save(instance, archive.data(), archive.size(), &length) == SOUNDSCAPER_PRO_OK);
		REQUIRE(length == 8u);
		// The deterministic fixture archive is a magic followed by its renderer gain.
		// Change it before reopening to prove restoration affects rendered audio.
		const float editedGain = 0.25F;
		std::memcpy(archive.data() + 4u, &editedGain, sizeof(editedGain));
		soundscaper_pro_plugin_close(instance);
	}
	soundscaper_pro_plugin_instance *mono = nullptr;
	REQUIRE(soundscaper_pro_plugin_open("vst3", path, description.stable_id, 48000.0, 8u, &mono) == SOUNDSCAPER_PRO_OK);
	clip.channel_count = 1u;
	REQUIRE(soundscaper_pro_plugin_ara_configure(mono, &clip) == SOUNDSCAPER_PRO_OK);
	REQUIRE(soundscaper_pro_plugin_ara_write(mono, 0u, inputs, 1u, 16u) == SOUNDSCAPER_PRO_OK);
	REQUIRE(soundscaper_pro_plugin_ara_bind(mono) == SOUNDSCAPER_PRO_OK);
	REQUIRE(soundscaper_pro_plugin_ara_render(mono, 0u, outputs, 1u, 8u) == SOUNDSCAPER_PRO_OK);
	for (uint32_t frame = 0u; frame < 8u; ++frame) REQUIRE(first[frame] == left[frame + 4u] * 0.5F);
	archive[0] = 0u;
	REQUIRE(soundscaper_pro_plugin_ara_load(mono, archive.data(), archive.size()) == SOUNDSCAPER_PRO_STATE_REJECTED);
	soundscaper_pro_plugin_close(mono);
	std::puts("{\"status\":\"passed\",\"canary\":\"ara-vst3-document-round-trip\",\"randomAccess\":true,\"archiveRoundTrip\":true}");
	return 0;
}
int main(int argc, char **argv)
{
	if (argc != 2) return 2;
#if defined(__APPLE__)
	return soundscaper::runMacJuceMessageDispatcher([&]() { return run(argv[1]); });
#else
	const int result = run(argv[1]);
	soundscaper::shutdownJuceMessageDispatcher();
	return result;
#endif
}
