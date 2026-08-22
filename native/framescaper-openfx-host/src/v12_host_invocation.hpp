/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "isolation_contract.hpp"
#include "parameter_values.hpp"
#include "rgba_frame.hpp"

#include <cstddef>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <vector>

namespace framescaper::openfx {

class v12_invocation_error final : public std::runtime_error {
public:
	v12_invocation_error(std::string code, std::string message)
		: std::runtime_error(std::move(message)), code_{std::move(code)} {}
	const std::string& code() const { return code_; }

private:
	std::string code_;
};

struct V12NamedInputFrame final {
	std::string name;
	std::string source_ref;
	std::string stream_id;
	RgbaFrame frame;
};

struct V12HostInvocation final {
	std::filesystem::path plugin_binary;
	std::string plugin_binary_sha256;
	int plugin_index{};
	std::string invocation_id;
	std::string plan_sha256;
	std::string node_id;
	std::string instance_id;
	std::string plugin_id;
	std::string state_sha256;
	Context context{};
	Backend requested_backend{};
	std::string abort_signal_id;
	std::vector<HydratedParameterState> parameters;
	std::vector<V12NamedInputFrame> inputs;
	std::string output_stream_id;
	std::filesystem::path output_path;
	RgbaFrameLayout output_layout;
	bool source_time_verified{};
};

/** Authenticate, fully reparse, and correlate one staged V12 helper grant. */
[[nodiscard]] V12HostInvocation authenticate_v12_host_invocation(
	const std::filesystem::path& grant_path,
	const std::string& grant_sha256
);

} // namespace framescaper::openfx
