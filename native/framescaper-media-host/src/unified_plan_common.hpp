/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "sha256.hpp"
#include "strict_json.hpp"

#if __has_include(<boost/multiprecision/cpp_int.hpp>)
#include "exact_retime_ordinal.hpp"
#define FRAMESCAPER_HAS_EXACT_RETIME_MULTIPRECISION 1
#endif

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <initializer_list>
#include <limits>
#include <set>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace framescaper::media::unified {

constexpr std::int64_t maximum_safe_integer = 9'007'199'254'740'991;

inline void exact(const json::value& value, const std::initializer_list<std::string_view> keys) {
	json::require_exact_keys(value, std::vector<std::string_view>{keys});
}

[[nodiscard]] inline std::int64_t safe_integer(
	const json::value& value,
	const std::string_view label,
	const std::int64_t minimum = 0
) {
	const auto result = json::integer(value, label);
	if (result < minimum || result > maximum_safe_integer) {
		throw json::parse_error(std::string{label} + " is outside its safe integer domain.");
	}
	return result;
}

[[nodiscard]] inline std::string text(const json::value& value, const std::string_view label) {
	const auto result = json::string(value, label);
	if (result.empty() || result.size() > 4'096 || result.find('\0') != std::string_view::npos) {
		throw json::parse_error(std::string{label} + " is not bounded nonempty text.");
	}
	return std::string{result};
}

[[nodiscard]] inline std::string digest(const json::value& value, const std::string_view label) {
	const auto result = json::string(value, label);
	if (result.size() != 64 || !std::all_of(result.begin(), result.end(), [](const unsigned char byte) {
		return std::isdigit(byte) != 0 || (byte >= 'a' && byte <= 'f');
	})) throw json::parse_error(std::string{label} + " is not lowercase SHA-256.");
	return std::string{result};
}

inline void literal(
	const json::value& value,
	const std::string_view expected,
	const std::string_view label
) {
	if (json::string(value, label) != expected) {
		throw json::parse_error(std::string{label} + " is unsupported.");
	}
}

inline void literal(
	const json::value& value,
	const std::int64_t expected,
	const std::string_view label
) {
	if (json::integer(value, label) != expected) {
		throw json::parse_error(std::string{label} + " is unsupported.");
	}
}

[[nodiscard]] inline std::pair<std::int64_t, std::int64_t> rational(
	const json::value& value,
	const std::string_view label,
	const bool positive_numerator = false
) {
	exact(value, {"num", "den"});
	auto left = json::integer(json::member(value, "num"), label);
	if (left < (positive_numerator ? 1 : -maximum_safe_integer) || left > maximum_safe_integer) {
		throw json::parse_error(std::string{label} + " numerator is outside its domain.");
	}
	auto right = safe_integer(json::member(value, "den"), label, 1);
	const auto result = std::pair{left, right};
	left = left < 0 ? -left : left;
	while (right != 0) { const auto remainder = left % right; left = right; right = remainder; }
	if (left != 1) throw json::parse_error(std::string{label} + " is not reduced.");
	return result;
}

[[nodiscard]] inline std::pair<std::int64_t, std::int64_t> rate(
	const json::value& value,
	const std::string_view label
) { return rational(value, label, true); }

inline void unique(std::set<std::string>& values, const std::string& value, const std::string_view label) {
	if (!values.insert(value).second) throw json::parse_error(std::string{label} + " is duplicated.");
}

inline void decimal_rational(
	const json::value& value,
	const std::string_view label
) {
	exact(value, {"numerator", "denominator"});
	const auto numerator = json::string(json::member(value, "numerator"), label);
	const auto denominator = json::string(json::member(value, "denominator"), label);
	const auto canonical_numerator = [](const std::string_view token) {
		if (token == "0") return true;
		std::size_t offset = token.starts_with('-') ? 1U : 0U;
		return offset < token.size() && token[offset] >= '1' && token[offset] <= '9'
			&& std::all_of(token.begin() + static_cast<std::ptrdiff_t>(offset + 1), token.end(), [](const unsigned char byte) {
				return std::isdigit(byte) != 0;
			});
	};
	if (!canonical_numerator(numerator) || denominator.empty() || denominator.front() < '1'
		|| denominator.front() > '9' || !std::all_of(denominator.begin() + 1, denominator.end(), [](const unsigned char byte) {
			return std::isdigit(byte) != 0;
		}) || numerator.size() > 1'235 || denominator.size() > 1'234) {
		throw json::parse_error(std::string{label} + " is not a bounded decimal rational.");
	}
	#if defined(FRAMESCAPER_HAS_EXACT_RETIME_MULTIPRECISION)
	using soundscaper::framescaper::cpp_int;
	using soundscaper::framescaper::exact_wire_rational;
	const cpp_int raw_numerator{std::string{numerator}};
	const cpp_int raw_denominator{std::string{denominator}};
	const auto normalized = exact_wire_rational(raw_numerator, raw_denominator);
	if (normalized.numerator() != raw_numerator || normalized.denominator() != raw_denominator) {
		throw json::parse_error(std::string{label} + " is not canonically reduced.");
	}
	#endif
}

inline void finite_number(const json::value& value, const std::string_view label) {
	if (value.kind != json::type::number || value.text == "-0") {
		throw json::parse_error(std::string{label} + " is not a canonical finite number.");
	}
}

inline void nullable_digest(const json::value& value, const std::string_view label) {
	if (value.kind != json::type::null_value) static_cast<void>(digest(value, label));
}

inline void append_json_string(std::string& output, const std::string_view value) {
	static constexpr char hex[] = "0123456789abcdef";
	output += '"';
	for (const unsigned char byte : value) {
		if (byte == '"' || byte == '\\') { output += '\\'; output += static_cast<char>(byte); }
		else if (byte == '\b') output += "\\b";
		else if (byte == '\f') output += "\\f";
		else if (byte == '\n') output += "\\n";
		else if (byte == '\r') output += "\\r";
		else if (byte == '\t') output += "\\t";
		else if (byte < 0x20U) {
			output += "\\u00";
			output += hex[byte >> 4U];
			output += hex[byte & 0x0fU];
		} else output += static_cast<char>(byte);
	}
	output += '"';
}

inline void append_canonical_json(std::string& output, const json::value& value) {
	switch (value.kind) {
	case json::type::null_value: output += "null"; return;
	case json::type::boolean: output += value.boolean ? "true" : "false"; return;
	case json::type::number: output += value.text; return;
	case json::type::string: append_json_string(output, value.text); return;
	case json::type::array:
		output += '[';
		for (std::size_t index = 0; index < value.items.size(); ++index) {
			if (index != 0) output += ',';
			append_canonical_json(output, value.items[index]);
		}
		output += ']';
		return;
	case json::type::object:
		output += '{';
		for (std::size_t index = 0; index < value.members.size(); ++index) {
			if (index != 0) output += ',';
			append_json_string(output, value.members[index].first);
			output += ':';
			append_canonical_json(output, value.members[index].second);
		}
		output += '}';
	}
}

[[nodiscard]] inline std::string semantic_sha256(const json::value& value) {
	std::string canonical;
	append_canonical_json(canonical, value);
	return sha256_bytes(reinterpret_cast<const std::uint8_t*>(canonical.data()), canonical.size());
}

} // namespace framescaper::media::unified
