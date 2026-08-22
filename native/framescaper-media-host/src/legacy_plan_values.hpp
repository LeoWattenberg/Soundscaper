/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "strict_json.hpp"

#include <algorithm>
#include <cctype>
#include <charconv>
#include <cmath>
#include <cstdint>
#include <initializer_list>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace framescaper::media::legacy {

inline constexpr std::int64_t maximum_safe_integer = 9'007'199'254'740'991;

[[nodiscard]] inline std::string multiply_decimal(std::string left, const std::uint64_t right_value) {
	const auto right = std::to_string(right_value);
	std::vector<unsigned> digits(left.size() + right.size(), 0);
	for (std::size_t left_index = left.size(); left_index-- > 0;) {
		for (std::size_t right_index = right.size(); right_index-- > 0;) {
			digits[left_index + right_index + 1] += static_cast<unsigned>(
				(left[left_index] - '0') * (right[right_index] - '0')
			);
		}
	}
	for (std::size_t index = digits.size(); index-- > 1;) {
		digits[index - 1] += digits[index] / 10;
		digits[index] %= 10;
	}
	std::string result;
	bool started = false;
	for (const auto digit : digits) {
		if (digit != 0 || started) { result += static_cast<char>('0' + digit); started = true; }
	}
	return started ? result : "0";
}

[[nodiscard]] inline std::string decimal_product(const std::initializer_list<std::uint64_t> factors) {
	std::string result{"1"};
	for (const auto factor : factors) result = multiply_decimal(std::move(result), factor);
	return result;
}

[[nodiscard]] inline int compare_decimal(const std::string& left, const std::string& right) {
	if (left.size() != right.size()) return left.size() < right.size() ? -1 : 1;
	if (left == right) return 0;
	return left < right ? -1 : 1;
}

inline void exact(const json::value& value, const std::initializer_list<std::string_view> keys) {
	json::require_exact_keys(value, std::vector<std::string_view>{keys});
}

inline void exact_optional(
	const json::value& value,
	const std::initializer_list<std::string_view> keys,
	const std::string_view optional
) {
	if (value.kind != json::type::object) throw json::parse_error("A closed legacy value must be an object.");
	std::size_t present = 0;
	for (const auto key : keys) {
		if (present < value.members.size() && value.members[present].first == key) ++present;
		else if (key != optional) throw json::parse_error("A closed legacy object's canonical member order is invalid.");
	}
	if (present != value.members.size()) {
		throw json::parse_error("A closed legacy object has unknown or reordered members.");
	}
}

[[nodiscard]] inline std::int64_t safe_integer(
	const json::value& value,
	const std::string_view label,
	const std::int64_t minimum = 0
) {
	const auto result = json::integer(value, label);
	if (result < minimum || result > maximum_safe_integer || value.text == "-0") {
		throw json::parse_error(std::string{label} + " is outside its safe integer domain.");
	}
	return result;
}

[[nodiscard]] inline double finite_number(const json::value& value, const std::string_view label) {
	if (value.kind != json::type::number || value.text.empty() || value.text.size() > 64 || value.text == "-0") {
		throw json::parse_error(std::string{label} + " is not a bounded canonical number.");
	}
	double result{};
	const auto converted = std::from_chars(
		value.text.data(), value.text.data() + value.text.size(), result, std::chars_format::general
	);
	if (converted.ec != std::errc{} || converted.ptr != value.text.data() + value.text.size()
		|| !std::isfinite(result)) {
		throw json::parse_error(std::string{label} + " is not a finite number.");
	}
	return result;
}

[[nodiscard]] inline double bounded_number(
	const json::value& value,
	const std::string_view label,
	const double minimum,
	const double maximum
) {
	const auto result = finite_number(value, label);
	if (result < minimum || result > maximum) {
		throw json::parse_error(std::string{label} + " is outside its closed numeric domain.");
	}
	return result;
}

[[nodiscard]] inline std::string text(
	const json::value& value,
	const std::string_view label,
	const std::size_t maximum = 4'096
) {
	const auto result = json::string(value, label);
	if (result.empty() || result.size() > maximum || result.find('\0') != std::string_view::npos) {
		throw json::parse_error(std::string{label} + " is not bounded nonempty text.");
	}
	return std::string{result};
}

inline void literal(
	const json::value& value,
	const std::string_view expected,
	const std::string_view label
) {
	if (json::string(value, label) != expected) {
		throw json::parse_error(std::string{label} + " is not canonical.");
	}
}

[[nodiscard]] inline bool one_of(
	const json::value& value,
	const std::initializer_list<std::string_view> choices,
	const std::string_view label
) {
	const auto candidate = json::string(value, label);
	return std::find(choices.begin(), choices.end(), candidate) != choices.end();
}

[[nodiscard]] inline std::string digest(const json::value& value, const std::string_view label) {
	const auto result = json::string(value, label);
	if (result.size() != 64 || !std::all_of(result.begin(), result.end(), [](const unsigned char byte) {
		return std::isdigit(byte) != 0 || (byte >= 'a' && byte <= 'f');
	})) throw json::parse_error(std::string{label} + " is not lowercase SHA-256.");
	return std::string{result};
}

[[nodiscard]] inline std::string id(const json::value& value, const std::string_view label) {
	return text(value, label, 1'024);
}

[[nodiscard]] inline bool is_null(const json::value& value) noexcept {
	return value.kind == json::type::null_value;
}

[[nodiscard]] inline std::string nullable_id(const json::value& value, const std::string_view label) {
	return is_null(value) ? std::string{} : id(value, label);
}

inline void unique(std::set<std::string>& values, const std::string& value, const std::string_view label) {
	if (!values.insert(value).second) throw json::parse_error(std::string{label} + " is duplicated.");
}

[[nodiscard]] inline bool same_value(const json::value& left, const json::value& right) {
	if (left.kind != right.kind || left.boolean != right.boolean || left.text != right.text
		|| left.items.size() != right.items.size() || left.members.size() != right.members.size()) return false;
	for (std::size_t index = 0; index < left.items.size(); ++index) {
		if (!same_value(left.items[index], right.items[index])) return false;
	}
	for (std::size_t index = 0; index < left.members.size(); ++index) {
		if (left.members[index].first != right.members[index].first
			|| !same_value(left.members[index].second, right.members[index].second)) return false;
	}
	return true;
}

inline void require_same(
	const json::value& left,
	const json::value& right,
	const std::string_view label
) {
	if (!same_value(left, right)) {
		throw json::parse_error(std::string{label} + " is not structurally equivalent to its authority.");
	}
}

[[nodiscard]] inline bool approximately_equal(const double left, const double right) noexcept {
	const auto scale = std::max({1.0, std::abs(left), std::abs(right)});
	return std::abs(left - right) <= scale * 1e-12;
}

[[nodiscard]] inline bool video_mime(const std::string_view value) {
	if (value.size() < 7 || value.size() > 128 || !value.starts_with("video/")) return false;
	if (!std::isalnum(static_cast<unsigned char>(value[6]))) return false;
	return std::all_of(value.begin() + 6, value.end(), [](const unsigned char byte) {
		return (byte >= 'a' && byte <= 'z') || std::isdigit(byte) != 0
			|| byte == '.' || byte == '+' || byte == '-';
	});
}

[[nodiscard]] inline bool hex_color(const std::string_view value) {
	const auto offset = value.starts_with('#') ? 1U : value.starts_with("0x") || value.starts_with("0X") ? 2U : 0U;
	if (offset == 0 || (value.size() - offset != 6 && value.size() - offset != 8)) return false;
	return std::all_of(value.begin() + static_cast<std::ptrdiff_t>(offset), value.end(), [](const unsigned char byte) {
		return std::isxdigit(byte) != 0;
	});
}

[[nodiscard]] inline bool delivery_color(const std::string_view value) {
	if (hex_color(value)) return true;
	const auto at = value.find('@');
	const auto name = value.substr(0, at);
	if (name.empty() || !std::isalpha(static_cast<unsigned char>(name.front()))
		|| !std::all_of(name.begin() + 1, name.end(), [](const unsigned char byte) {
			return std::isalnum(byte) != 0 || byte == '_' || byte == '-';
		})) return false;
	if (at == std::string_view::npos) return true;
	const auto alpha = value.substr(at + 1);
	if (alpha.empty() || alpha.size() > 24) return false;
	double parsed{};
	const auto converted = std::from_chars(alpha.data(), alpha.data() + alpha.size(), parsed);
	return converted.ec == std::errc{} && converted.ptr == alpha.data() + alpha.size()
		&& parsed >= 0 && parsed <= 1;
}

inline void local_file_name(
	const json::value& value,
	const std::string_view suffix,
	const std::string_view label
) {
	const auto name = text(value, label, 255);
	if (name.find('/') != std::string::npos || name.find('\\') != std::string::npos
		|| name.size() < suffix.size()
		|| !std::equal(suffix.rbegin(), suffix.rend(), name.rbegin(), [](char left, char right) {
			return std::tolower(static_cast<unsigned char>(left))
				== std::tolower(static_cast<unsigned char>(right));
		})) throw json::parse_error(std::string{label} + " is not a local staged file name.");
}

} // namespace framescaper::media::legacy
