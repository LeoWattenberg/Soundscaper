/* SPDX-License-Identifier: AGPL-3.0-only */

#include <vamp/vamp.h>

#include <algorithm>
#include <new>

#if defined(_WIN32)
#define SOUNDSCAPER_VAMP_EXPORT extern "C" __declspec(dllexport)
#else
#define SOUNDSCAPER_VAMP_EXPORT extern "C" __attribute__((visibility("default")))
#endif

namespace {

struct Instance {
	float gain = 1.0F;
	unsigned int channels = 0u;
};

VampPluginHandle instantiate(const VampPluginDescriptor *, float)
{
	return new (std::nothrow) Instance();
}

void cleanup(VampPluginHandle handle) { delete static_cast<Instance *>(handle); }

int initialise(VampPluginHandle handle, unsigned int channels, unsigned int, unsigned int)
{
	auto *instance = static_cast<Instance *>(handle);
	if (instance == nullptr || channels != 1u) return 0;
	instance->channels = channels;
	return 1;
}

void reset(VampPluginHandle) {}

float getParameter(VampPluginHandle handle, int index)
{
	return handle != nullptr && index == 0 ? static_cast<Instance *>(handle)->gain : 0.0F;
}

void setParameter(VampPluginHandle handle, int index, float value)
{
	if (handle != nullptr && index == 0) static_cast<Instance *>(handle)->gain = value;
}

unsigned int currentProgram(VampPluginHandle) { return 0u; }
void selectProgram(VampPluginHandle, unsigned int) {}
unsigned int preferredStep(VampPluginHandle) { return 2u; }
unsigned int preferredBlock(VampPluginHandle) { return 4u; }
unsigned int minimumChannels(VampPluginHandle) { return 1u; }
unsigned int maximumChannels(VampPluginHandle) { return 1u; }
unsigned int outputCount(VampPluginHandle) { return 1u; }

VampOutputDescriptor *outputDescriptor(VampPluginHandle, unsigned int index)
{
	if (index != 0u) return nullptr;
	auto *value = new (std::nothrow) VampOutputDescriptor{};
	if (value == nullptr) return nullptr;
	value->identifier = "amplitude";
	value->name = "Amplitude";
	value->description = "First sample amplitude";
	value->unit = "";
	value->hasFixedBinCount = 1;
	value->binCount = 1u;
	value->hasKnownExtents = 1;
	value->minValue = -2.0F;
	value->maxValue = 2.0F;
	value->sampleType = vampOneSamplePerStep;
	return value;
}

void releaseOutputDescriptor(VampOutputDescriptor *value) { delete value; }

VampFeatureList *oneFeature(VampPluginHandle handle, const float *const *inputs, int sec, int nsec)
{
	auto *instance = static_cast<Instance *>(handle);
	auto *set = new (std::nothrow) VampFeatureList[1]{};
	auto *unions = new (std::nothrow) VampFeatureUnion[2]{};
	auto *values = new (std::nothrow) float[1]{};
	if (instance == nullptr || set == nullptr || unions == nullptr || values == nullptr) {
		delete[] set; delete[] unions; delete[] values; return nullptr;
	}
	values[0] = inputs == nullptr ? 0.0F : inputs[0][0] * instance->gain;
	unions[0].v1.hasTimestamp = 1;
	unions[0].v1.sec = sec;
	unions[0].v1.nsec = nsec;
	unions[0].v1.valueCount = 1u;
	unions[0].v1.values = values;
	unions[0].v1.label = nullptr;
	set[0].featureCount = 1u;
	set[0].features = unions;
	return set;
}

VampFeatureList *process(
	VampPluginHandle handle, const float *const *inputs, int sec, int nsec)
{
	return oneFeature(handle, inputs, sec, nsec);
}

VampFeatureList *remaining(VampPluginHandle)
{
	return new (std::nothrow) VampFeatureList[1]{};
}

void releaseFeatures(VampFeatureList *set)
{
	if (set == nullptr) return;
	if (set[0].features != nullptr) {
		for (unsigned int index = 0u; index < set[0].featureCount; ++index) {
			delete[] set[0].features[index].v1.values;
		}
		delete[] set[0].features;
	}
	delete[] set;
}

const char *valueNames[] = { "silent", "unity", nullptr };
const VampParameterDescriptor gain{
	"gain", "Gain", "Analysis gain", "", 0.0F, 2.0F, 1.0F, 1, 1.0F, valueNames,
};
const VampParameterDescriptor *parameters[] = { &gain };
const char *programs[] = { "Default" };
const VampPluginDescriptor descriptor{
	VAMP_API_VERSION,
	"org.soundscaper.fixture.amplitude", "Soundscaper amplitude fixture",
	"Exact-library Vamp host fixture", "Soundscaper", 1, "AGPL-3.0-only",
	1u, parameters, 1u, programs, vampTimeDomain,
	instantiate, cleanup, initialise, reset, getParameter, setParameter,
	currentProgram, selectProgram, preferredStep, preferredBlock,
	minimumChannels, maximumChannels, outputCount, outputDescriptor,
	releaseOutputDescriptor, process, remaining, releaseFeatures,
};

} // namespace

SOUNDSCAPER_VAMP_EXPORT const VampPluginDescriptor *vampGetPluginDescriptor(
	unsigned int hostApiVersion, unsigned int index)
{
	return hostApiVersion >= VAMP_API_VERSION && index == 0u ? &descriptor : nullptr;
}
