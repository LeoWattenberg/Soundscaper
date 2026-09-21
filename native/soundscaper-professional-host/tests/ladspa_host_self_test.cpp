/* SPDX-License-Identifier: AGPL-3.0-only */

#include "professional_host_api.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

namespace {

int fail(const char *message)
{
	std::cerr << message << '\n';
	return 1;
}

const soundscaper_pro_plugin_parameter *named(
	const std::vector<soundscaper_pro_plugin_parameter> &parameters, const char *name)
{
	const auto found = std::find_if(parameters.begin(), parameters.end(), [&](const auto &parameter) {
		return std::strcmp(parameter.name, name) == 0;
	});
	return found == parameters.end() ? nullptr : &*found;
}

uint32_t indexOf(
	const std::vector<soundscaper_pro_plugin_parameter> &parameters,
	const soundscaper_pro_plugin_parameter *parameter)
{
	return static_cast<uint32_t>(parameter - parameters.data());
}

bool near(double left, double right) { return std::abs(left - right) < 0.0001; }

struct InstanceGuard {
	soundscaper_pro_plugin_instance *value;
	~InstanceGuard() { soundscaper_pro_plugin_close(value); }
};

} // namespace

int main(int argc, char **argv)
{
	if (argc != 2) return fail("The LADSPA fixture path is required.");
	size_t count = 0u;
	auto status = soundscaper_pro_plugin_scan("ladspa", argv[1], nullptr, 0u, &count);
	if (status != SOUNDSCAPER_PRO_OK || count != 1u) return fail("LADSPA scan failed.");
	std::vector<soundscaper_pro_plugin_description> descriptions(count);
	status = soundscaper_pro_plugin_scan("ladspa", argv[1], descriptions.data(), descriptions.size(), &count);
	if (status != SOUNDSCAPER_PRO_OK || count != 1u
		|| std::strcmp(descriptions[0].format, "ladspa") != 0
		|| descriptions[0].input_channels != 2u || descriptions[0].output_channels != 2u) {
		return fail("The LADSPA descriptor was not preserved.");
	}

	soundscaper_pro_plugin_instance *instance = nullptr;
	status = soundscaper_pro_plugin_open("ladspa", argv[1], descriptions[0].stable_id,
		48000.0, 16u, &instance);
	if (status != SOUNDSCAPER_PRO_OK || instance == nullptr) return fail("LADSPA open failed.");
	InstanceGuard instanceGuard{ instance };

	soundscaper_pro_plugin_capability_report capabilities{};
	status = soundscaper_pro_plugin_get_capabilities(instance, &capabilities);
	if (status != SOUNDSCAPER_PRO_OK || capabilities.parameter_count != 4u
		|| capabilities.has_vendor_ui != 0u) return fail("LADSPA capabilities are wrong.");
	if (soundscaper_pro_plugin_open_vendor_window(instance, "fixture") != SOUNDSCAPER_PRO_UNSUPPORTED) {
		return fail("A LADSPA plug-in exposed a vendor window.");
	}

	size_t parameterCount = 0u;
	status = soundscaper_pro_plugin_describe_parameters(instance, nullptr, 0u, &parameterCount);
	if (status != SOUNDSCAPER_PRO_OK || parameterCount != capabilities.parameter_count) {
		return fail("The LADSPA parameter query failed.");
	}
	std::vector<soundscaper_pro_plugin_parameter> parameters(parameterCount);
	status = soundscaper_pro_plugin_describe_parameters(
		instance, parameters.data(), parameters.size(), &parameterCount);
	if (status != SOUNDSCAPER_PRO_OK || parameterCount != parameters.size()) {
		return fail("The LADSPA parameter descriptions failed.");
	}
	const auto *gain = named(parameters, "Gain");
	const auto *enabled = named(parameters, "Enabled");
	const auto *steps = named(parameters, "Steps");
	const auto *frequency = named(parameters, "Frequency");
	if (gain == nullptr || enabled == nullptr || steps == nullptr || frequency == nullptr
		|| !near(gain->default_value, 1.0) || gain->minimum_value != 0.0 || gain->maximum_value != 1.0
		|| enabled->flags != (SOUNDSCAPER_PRO_PARAMETER_BOOLEAN | SOUNDSCAPER_PRO_PARAMETER_AUTOMATABLE)
		|| (steps->flags & SOUNDSCAPER_PRO_PARAMETER_INTEGER) == 0u
		|| (frequency->flags & SOUNDSCAPER_PRO_PARAMETER_LOGARITHMIC) == 0u) {
		return fail("The LADSPA parameter metadata is wrong.");
	}

	const uint32_t gainIndex = indexOf(parameters, gain);
	if (soundscaper_pro_plugin_write_parameter(instance, gainIndex, 0.25) != SOUNDSCAPER_PRO_OK) {
		return fail("The LADSPA gain write failed.");
	}
	double currentGain = 0.0;
	if (soundscaper_pro_plugin_read_parameter(instance, gainIndex, &currentGain) != SOUNDSCAPER_PRO_OK
		|| !near(currentGain, 0.25)) return fail("The LADSPA gain read failed.");
	if (soundscaper_pro_plugin_write_parameter(instance, gainIndex,
		std::numeric_limits<double>::quiet_NaN()) != SOUNDSCAPER_PRO_FORMAT_REFUSED) {
		return fail("A non-finite LADSPA parameter write was accepted.");
	}

	std::array<float, 4> left{ 1.0F, -2.0F, 3.0F, -4.0F };
	std::array<float, 4> right{ 0.5F, 1.0F, -0.5F, -1.0F };
	std::array<float, 4> outputLeft{};
	std::array<float, 4> outputRight{};
	const float *inputs[]{ left.data(), right.data() };
	float *outputs[]{ outputLeft.data(), outputRight.data() };
	status = soundscaper_pro_plugin_process(instance, inputs, 2u, outputs, 2u, 4u);
	if (status != SOUNDSCAPER_PRO_OK || !near(outputLeft[0], 0.5) || !near(outputRight[1], 0.5)) {
		return fail("The LADSPA process path ignored its gain.");
	}

	size_t stateLength = 0u;
	status = soundscaper_pro_plugin_save_state(instance, nullptr, 0u, &stateLength);
	if (status != SOUNDSCAPER_PRO_STATE_TOO_LARGE || stateLength <= sizeof(float) * parameters.size()) {
		return fail("The LADSPA host-owned state size was not reported.");
	}
	std::vector<uint8_t> state(stateLength);
	status = soundscaper_pro_plugin_save_state(instance, state.data(), state.size(), &stateLength);
	if (status != SOUNDSCAPER_PRO_OK) return fail("The LADSPA host-owned state was not saved.");
	if (soundscaper_pro_plugin_write_parameter(instance, gainIndex, 1.0) != SOUNDSCAPER_PRO_OK
		|| soundscaper_pro_plugin_load_state(instance, state.data(), state.size()) != SOUNDSCAPER_PRO_OK
		|| soundscaper_pro_plugin_read_parameter(instance, gainIndex, &currentGain) != SOUNDSCAPER_PRO_OK
		|| !near(currentGain, 0.25)) return fail("The LADSPA host-owned state did not restore parameters.");

	const auto originalState = state;
	state.pop_back();
	if (soundscaper_pro_plugin_load_state(instance, state.data(), state.size()) != SOUNDSCAPER_PRO_STATE_REJECTED) {
		return fail("Truncated LADSPA state was accepted.");
	}
	state = originalState;
	state[0] ^= 0xffu;
	if (soundscaper_pro_plugin_load_state(instance, state.data(), state.size()) != SOUNDSCAPER_PRO_STATE_REJECTED) {
		return fail("Foreign LADSPA state was passed through to JUCE.");
	}
	state = originalState;
	const std::array<uint8_t, 4> quietNan{ 0x00u, 0x00u, 0xc0u, 0x7fu };
	std::copy(quietNan.begin(), quietNan.end(), state.begin() + 12);
	if (soundscaper_pro_plugin_load_state(instance, state.data(), state.size()) != SOUNDSCAPER_PRO_STATE_REJECTED) {
		return fail("Non-finite LADSPA state was accepted.");
	}
	if (soundscaper_pro_plugin_read_parameter(instance, gainIndex, &currentGain) != SOUNDSCAPER_PRO_OK
		|| !near(currentGain, 0.25)) return fail("Rejected LADSPA state mutated a parameter.");

	return 0;
}
