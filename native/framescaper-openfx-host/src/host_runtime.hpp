/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "dynamic_library.hpp"
#include "isolation_contract.hpp"
#include "openfx_abi.hpp"
#include "parameter_values.hpp"
#include "rgba_frame.hpp"

#include <filesystem>
#include <functional>
#include <array>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace framescaper::openfx {

class LoadedPluginBinary {
public:
	LoadedPluginBinary(const std::filesystem::path& binary, const std::string& sha256);
	~LoadedPluginBinary();
	LoadedPluginBinary(const LoadedPluginBinary&) = delete;
	LoadedPluginBinary& operator=(const LoadedPluginBinary&) = delete;

	void bind_host(OfxHost* host);
	int plugin_count() const;
	OfxPlugin& plugin(int index) const;
	const std::string& sha256() const { return library_.sha256(); }

private:
	using NumberFunction = int (*)();
	using PluginFunction = OfxPlugin* (*)(int);
	using SetHostFunction = OfxStatus (*)(const OfxHost*);

	DynamicLibrary library_;
	NumberFunction number_ = nullptr;
	PluginFunction plugin_ = nullptr;
	SetHostFunction set_host_ = nullptr;
	int count_ = -1;
};

struct InvocationResult {
	std::string requested_backend;
	std::string backend;
	bool retried_on_cpu = false;
	bool reports_degradation = false;
	bool suites_dispatched = false;
	bool cpu_rendered = false;
	bool gpu_context_setup = false;
	bool gpu_context_released = false;
	bool cancellation_observed = false;
	bool offscreen_ui_rendered = false;
	int overlay_interact_version = 0;
	std::size_t offscreen_draw_calls = 0;
	std::size_t offscreen_pixels_touched = 0;
	std::size_t hydrated_parameter_count = 0;
	std::size_t hydrated_keyframe_count = 0;
	std::string host_standard_parameter;
	bool host_standard_parameter_bound = false;
	bool retimer_source_time_enforced = false;
	RgbaFrame output_frame;
};

struct InvocationFrame final {
	std::string name;
	RgbaFrame frame;
};

struct InteractEvent final {
	std::string kind;
	std::string phase;
	std::uint64_t sequence{};
	double x{};
	double y{};
	int button{};
	std::string key;
	std::string code;
	bool focused{};
	std::vector<std::string> modifiers;
};

struct InteractRequest final {
	std::string project_id;
	std::uint64_t project_revision{};
	std::string instance_id;
	std::string effect_state_sha256;
	std::string target;
	std::string parameter_name;
	std::vector<HydratedParameterState> parameters;
	std::vector<InteractEvent> events;
};

struct InteractResult final {
	std::string project_id;
	std::uint64_t project_revision{};
	std::string instance_id;
	std::string effect_state_sha256;
	std::string target;
	std::string parameter_name;
	std::vector<std::uint64_t> accepted_sequences;
	bool redraw_requested{};
	std::string surface_disposition;
	std::vector<HydratedParameterState> parameter_mutations;
	std::size_t draw_calls{};
	std::size_t pixels_touched{};
	std::array<unsigned char, 64U * 64U * 4U> rgba{};
};

struct InspectedParameter final {
	std::string name;
	std::string type;
	bool animates = false;
};

struct PluginInspection final {
	std::vector<std::string> contexts;
	std::vector<InspectedParameter> parameters;
	std::vector<std::string> components;
	std::vector<std::string> pixel_depths;
	std::string threading;
	std::vector<std::string> render_backends;
	std::vector<std::string> requested_suites;
};

class HostRuntime {
public:
	explicit HostRuntime(std::vector<Backend> supported_backends = {Backend::cpu});
	~HostRuntime();
	HostRuntime(const HostRuntime&) = delete;
	HostRuntime& operator=(const HostRuntime&) = delete;

	OfxHost* host();
	InvocationResult invoke(
		OfxPlugin& plugin,
		Context context,
		std::string_view action,
		Backend requested_backend,
		bool cancelled,
		std::vector<InvocationFrame> inputs = {},
		const std::vector<HydratedParameterState>& parameters = {},
		std::function<bool()> cancellation_probe = {},
		RgbaFrameLayout output_layout = {},
		bool exact_frames = false,
		OfxTime render_time = 0,
		std::optional<double> host_standard_parameter_value = std::nullopt
	);
	std::optional<PluginInspection> inspect(OfxPlugin& plugin);
	InteractResult run_interact(
		OfxPlugin& plugin,
		Context context,
		const InteractRequest& request
	);

private:
	class Impl;
	std::unique_ptr<Impl> impl_;
};

bool valid_plugin_entry(const OfxPlugin& plugin);
const char* official_context(Context context);

} // namespace framescaper::openfx
