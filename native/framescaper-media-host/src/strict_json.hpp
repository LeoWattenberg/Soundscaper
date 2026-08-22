/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <cstdint>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace framescaper::media::json {

enum class type { null_value, boolean, number, string, array, object };

struct value final {
	type kind{type::null_value};
	bool boolean{};
	std::string text;
	std::vector<value> items;
	std::vector<std::pair<std::string, value>> members;
};

class parse_error final : public std::runtime_error {
public:
	using std::runtime_error::runtime_error;
};

[[nodiscard]] value parse(std::string_view source);
[[nodiscard]] const value& member(const value& object, std::string_view name);
[[nodiscard]] const value* optional_member(const value& object, std::string_view name);
void require_exact_keys(const value& object, const std::vector<std::string_view>& keys);
[[nodiscard]] std::int64_t integer(const value& input, std::string_view label);
[[nodiscard]] std::string_view string(const value& input, std::string_view label);
[[nodiscard]] bool boolean(const value& input, std::string_view label);
[[nodiscard]] const std::vector<value>& array(const value& input, std::string_view label);

} // namespace framescaper::media::json
