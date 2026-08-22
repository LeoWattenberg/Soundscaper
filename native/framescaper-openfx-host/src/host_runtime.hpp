/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "dynamic_library.hpp"
#include "isolation_contract.hpp"
#include "openfx_abi.hpp"
#include "parameter_values.hpp"
#include "rgba_frame.hpp"

#include <filesystem>
#include <functional>
#include <memory>
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
	bool cancellation_observed = false;
	bool offscreen_ui_rendered = false;
	int overlay_interact_version = 0;
	std::size_t offscreen_draw_calls = 0;
	std::size_t offscreen_pixels_touched = 0;
	std::size_t hydrated_parameter_count = 0;
	std::size_t hydrated_keyframe_count = 0;
	RgbaFrame output_frame;
};

struct InvocationFrame final {
	std::string name;
	RgbaFrame frame;
};

class HostRuntime {
public:
	HostRuntime();
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
		bool exact_frames = false
	);
	bool inspect(OfxPlugin& plugin);

private:
	class Impl;
	std::unique_ptr<Impl> impl_;
};

bool valid_plugin_entry(const OfxPlugin& plugin);
const char* official_context(Context context);

} // namespace framescaper::openfx
