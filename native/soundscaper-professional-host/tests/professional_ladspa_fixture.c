/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic, redistributable LADSPA fixture for the isolated host. */

#include <ladspa.h>

#include <stdlib.h>

enum fixture_port {
	FIXTURE_INPUT_LEFT = 0,
	FIXTURE_INPUT_RIGHT,
	FIXTURE_OUTPUT_LEFT,
	FIXTURE_OUTPUT_RIGHT,
	FIXTURE_GAIN,
	FIXTURE_ENABLED,
	FIXTURE_STEPS,
	FIXTURE_FREQUENCY,
	FIXTURE_PORT_COUNT
};

typedef struct fixture_instance {
	LADSPA_Data *ports[FIXTURE_PORT_COUNT];
} fixture_instance;

static LADSPA_Handle instantiate(const LADSPA_Descriptor *descriptor, unsigned long sample_rate)
{
	(void)descriptor;
	(void)sample_rate;
	return calloc(1u, sizeof(fixture_instance));
}

static void connect_port(LADSPA_Handle handle, unsigned long port, LADSPA_Data *data)
{
	fixture_instance *instance = (fixture_instance *)handle;
	if (instance != NULL && port < FIXTURE_PORT_COUNT) instance->ports[port] = data;
}

static void run(LADSPA_Handle handle, unsigned long frames)
{
	fixture_instance *instance = (fixture_instance *)handle;
	const LADSPA_Data gain = *instance->ports[FIXTURE_GAIN];
	const LADSPA_Data enabled = *instance->ports[FIXTURE_ENABLED];
	unsigned long channel;
	for (channel = 0u; channel < 2u; ++channel) {
		const LADSPA_Data *input = instance->ports[FIXTURE_INPUT_LEFT + channel];
		LADSPA_Data *output = instance->ports[FIXTURE_OUTPUT_LEFT + channel];
		unsigned long frame;
		for (frame = 0u; frame < frames; ++frame) {
			output[frame] = enabled >= 0.5f ? input[frame] * gain : input[frame];
		}
	}
}

static void cleanup(LADSPA_Handle handle) { free(handle); }

static const LADSPA_PortDescriptor port_descriptors[FIXTURE_PORT_COUNT] = {
	LADSPA_PORT_INPUT | LADSPA_PORT_AUDIO,
	LADSPA_PORT_INPUT | LADSPA_PORT_AUDIO,
	LADSPA_PORT_OUTPUT | LADSPA_PORT_AUDIO,
	LADSPA_PORT_OUTPUT | LADSPA_PORT_AUDIO,
	LADSPA_PORT_INPUT | LADSPA_PORT_CONTROL,
	LADSPA_PORT_INPUT | LADSPA_PORT_CONTROL,
	LADSPA_PORT_INPUT | LADSPA_PORT_CONTROL,
	LADSPA_PORT_INPUT | LADSPA_PORT_CONTROL,
};

static const char *const port_names[FIXTURE_PORT_COUNT] = {
	"Input left",
	"Input right",
	"Output left",
	"Output right",
	"Gain",
	"Enabled",
	"Steps",
	"Frequency",
};

static const LADSPA_PortRangeHint port_hints[FIXTURE_PORT_COUNT] = {
	{ 0u, 0.0f, 0.0f },
	{ 0u, 0.0f, 0.0f },
	{ 0u, 0.0f, 0.0f },
	{ 0u, 0.0f, 0.0f },
	{ LADSPA_HINT_BOUNDED_BELOW | LADSPA_HINT_BOUNDED_ABOVE | LADSPA_HINT_DEFAULT_1, 0.0f, 2.0f },
	{ LADSPA_HINT_TOGGLED | LADSPA_HINT_DEFAULT_1, 0.0f, 1.0f },
	{ LADSPA_HINT_BOUNDED_BELOW | LADSPA_HINT_BOUNDED_ABOVE
		| LADSPA_HINT_INTEGER | LADSPA_HINT_DEFAULT_MINIMUM, 1.0f, 4.0f },
	{ LADSPA_HINT_BOUNDED_BELOW | LADSPA_HINT_BOUNDED_ABOVE
		| LADSPA_HINT_LOGARITHMIC | LADSPA_HINT_DEFAULT_MIDDLE, 20.0f, 20000.0f },
};

static const LADSPA_Descriptor descriptor = {
	424242u,
	"soundscaper_ladspa_fixture",
	LADSPA_PROPERTY_HARD_RT_CAPABLE,
	"Soundscaper deterministic LADSPA gain fixture",
	"Soundscaper",
	"AGPL-3.0-only",
	FIXTURE_PORT_COUNT,
	port_descriptors,
	port_names,
	port_hints,
	NULL,
	instantiate,
	connect_port,
	NULL,
	run,
	NULL,
	NULL,
	NULL,
	cleanup,
};

#if defined(_WIN32)
#define SOUNDSCAPER_LADSPA_EXPORT __declspec(dllexport)
#else
#define SOUNDSCAPER_LADSPA_EXPORT __attribute__((visibility("default")))
#endif

SOUNDSCAPER_LADSPA_EXPORT const LADSPA_Descriptor *ladspa_descriptor(unsigned long index)
{
	return index == 0u ? &descriptor : NULL;
}
