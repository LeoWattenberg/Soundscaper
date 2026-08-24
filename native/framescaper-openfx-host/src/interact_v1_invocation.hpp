/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "host_runtime.hpp"

#include <filesystem>
#include <stdexcept>
#include <string>

namespace framescaper::openfx {

class interact_invocation_error final : public std::runtime_error {
public:
	interact_invocation_error(std::string code, std::string message)
		: std::runtime_error(std::move(message)), code_{std::move(code)} {}
	const std::string& code() const { return code_; }

private:
	std::string code_;
};

struct InteractHostInvocation final {
	std::filesystem::path plugin_binary;
	std::string plugin_binary_sha256;
	std::string plugin_id;
	int plugin_index{};
	Context context{};
	InteractRequest request;
};

[[nodiscard]] InteractHostInvocation authenticate_interact_v1_invocation(
	const std::filesystem::path& grant_path,
	const std::string& grant_sha256
);

} // namespace framescaper::openfx
