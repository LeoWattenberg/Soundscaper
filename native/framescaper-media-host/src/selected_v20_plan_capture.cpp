/* SPDX-License-Identifier: AGPL-3.0-only */

#include "selected_v20_plan_capture.hpp"
#include "legacy_plan_values.hpp"
#include "strict_json.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <cstdint>
#include <limits>
#include <string>
#include <string_view>
#include <vector>

namespace framescaper::media {
namespace {

using legacy::finite_number;
using legacy::safe_integer;
using soundscaper::framescaper::cpp_int;

[[nodiscard]] cpp_int power_of_ten(const unsigned exponent) {
	cpp_int result = 1;
	for (unsigned index = 0; index < exponent; ++index) result *= 10;
	return result;
}

[[nodiscard]] ExactRational decimal_rational(
	const json::value& value,
	const std::string_view label
) {
	static_cast<void>(finite_number(value, label));
	const auto& token = value.text;
	std::size_t offset = token.starts_with('-') ? 1 : 0;
	const bool negative = offset == 1;
	const auto exponent_at = token.find_first_of("eE", offset);
	const auto mantissa_end = exponent_at == std::string::npos ? token.size() : exponent_at;
	const auto decimal_at = token.find('.', offset);
	std::string digits;
	digits.reserve(mantissa_end - offset);
	unsigned fractional_digits = 0;
	for (std::size_t index = offset; index < mantissa_end; ++index) {
		if (token[index] == '.') continue;
		digits += token[index];
		if (decimal_at != std::string::npos && index > decimal_at) ++fractional_digits;
	}
	int exponent = 0;
	if (exponent_at != std::string::npos) {
		auto begin = token.data() + exponent_at + 1;
		const auto end = token.data() + token.size();
		if (begin != end && *begin == '+') ++begin;
		const auto converted = std::from_chars(begin, end, exponent);
		if (converted.ec != std::errc{} || converted.ptr != end) {
			throw json::parse_error(std::string{label} + " has an invalid decimal exponent.");
		}
	}
	cpp_int numerator{digits};
	if (negative) numerator = -numerator;
	const auto scale = static_cast<long long>(fractional_digits) - exponent;
	if (scale > 0) return ExactRational(numerator, power_of_ten(static_cast<unsigned>(scale)));
	if (scale < 0) numerator *= power_of_ten(static_cast<unsigned>(-scale));
	return ExactRational(numerator, cpp_int(1));
}

[[nodiscard]] ExactRational integer_rational(const json::value& value, const std::string_view label) {
	legacy::exact(value, {"num", "den"});
	return ExactRational(
		cpp_int(safe_integer(json::member(value, "num"), label, 1)),
		cpp_int(safe_integer(json::member(value, "den"), label, 1))
	);
}

[[nodiscard]] std::uint8_t hex_byte(const std::string_view value) {
	unsigned parsed{};
	const auto converted = std::from_chars(value.data(), value.data() + value.size(), parsed, 16);
	if (converted.ec != std::errc{} || converted.ptr != value.data() + value.size() || parsed > 255) {
		throw json::parse_error("A selected-V20 execution color has an invalid hexadecimal channel.");
	}
	return static_cast<std::uint8_t>(parsed);
}

[[nodiscard]] std::uint8_t alpha_byte(const std::string_view value) {
	json::value token;
	token.kind = json::type::number;
	token.text = std::string{value};
	const auto alpha = decimal_rational(token, "selected-V20 color alpha");
	if (soundscaper::framescaper::compare(alpha, ExactRational(0)) < 0
		|| soundscaper::framescaper::compare(alpha, ExactRational(1)) > 0) {
		throw json::parse_error("A selected-V20 execution color alpha is outside the unit interval.");
	}
	const cpp_int scaled = alpha.numerator() * 255;
	return ((scaled * 2 + alpha.denominator()) / (alpha.denominator() * 2)).convert_to<std::uint8_t>();
}

[[nodiscard]] std::array<std::uint8_t, 4> color(const json::value& value) {
	const auto token = json::string(value, "selected-V20 execution color");
	const auto prefix = token.starts_with('#') ? 1U
		: token.starts_with("0x") || token.starts_with("0X") ? 2U : 0U;
	if (prefix != 0 && (token.size() - prefix == 6 || token.size() - prefix == 8)) {
		return {
			hex_byte(token.substr(prefix, 2)), hex_byte(token.substr(prefix + 2, 2)),
			hex_byte(token.substr(prefix + 4, 2)),
			token.size() - prefix == 8 ? hex_byte(token.substr(prefix + 6, 2)) : std::uint8_t{255},
		};
	}
	const auto at = token.find('@');
	const auto name = token.substr(0, at);
	std::array<std::uint8_t, 4> result{};
	if (name == "black") result = {0, 0, 0, 255};
	else if (name == "white") result = {255, 255, 255, 255};
	else if (name == "transparent") result = {0, 0, 0, 0};
	else throw selected_v20_execution_error(
		selected_v20_execution_error_code::plan_contract,
		"The selected-V20 CPU executor does not assign guessed RGB values to named colors."
	);
	if (at != std::string_view::npos) result[3] = alpha_byte(token.substr(at + 1));
	return result;
}

void capture_staged_inputs(const json::value& root, selected_v20_execution_plan& result) {
	for (const auto& input : json::array(json::member(root, "inputs"), "selected-V20 inputs")) {
		const auto kind = json::string(json::member(input, "kind"), "selected-V20 input kind");
		if (kind == "staged-captions") continue;
		if (kind != "staged-audio-mix") continue;
		result.includes_staged_audio = true;
		result.sample_rate = static_cast<std::uint64_t>(safe_integer(
			json::member(input, "sampleRate"), "selected-V20 staged audio rate", 1
		));
		result.audio_sample_count = static_cast<std::uint64_t>(safe_integer(
			json::member(input, "durationFrames"), "selected-V20 staged audio samples", 1
		));
		const auto layout = json::string(json::member(input, "channelLayout"), "selected-V20 audio layout");
		if (layout == "preserve") result.audio_layout = selected_v20_audio_layout::preserve;
		else if (layout == "mono") result.audio_layout = selected_v20_audio_layout::mono;
		else if (layout == "stereo") result.audio_layout = selected_v20_audio_layout::stereo;
		else throw json::parse_error("The selected-V20 staged audio layout is unsupported.");
	}
}

[[nodiscard]] selected_v20_caption_delivery capture_caption_delivery(const json::value& root) {
	const auto& captions = json::member(root, "captions");
	if (legacy::is_null(captions)) return {};
	return {
		json::boolean(json::member(captions, "mux"), "selected-V20 caption mux delivery"),
		json::boolean(json::member(captions, "burnIn"), "selected-V20 caption burn-in delivery"),
		!legacy::is_null(json::member(captions, "sidecarFormat")),
	};
}

[[nodiscard]] selected_v20_execution_plan capture_v7(const json::value& root) {
	selected_v20_execution_plan result;
	result.family = selected_v20_family::keyed_evaluated_rgba_v7;
	result.output_frame_count = static_cast<std::uint64_t>(safe_integer(
		json::member(root, "outputFrameCount"), "V7 execution frame count", 1
	));
	const auto& range = json::member(root, "range");
	result.sample_start = static_cast<std::uint64_t>(safe_integer(
		json::member(range, "startFrame"), "V7 execution sample start"
	));
	result.sample_rate = static_cast<std::uint64_t>(safe_integer(
		json::member(root, "sampleRate"), "V7 execution sample rate", 1
	));
	result.quality = std::string{json::string(json::member(root, "quality"), "V7 execution quality")};
	const auto& canvas = json::member(root, "canvas");
	result.width = static_cast<std::uint32_t>(safe_integer(json::member(canvas, "width"), "V7 execution width", 1));
	result.height = static_cast<std::uint32_t>(safe_integer(json::member(canvas, "height"), "V7 execution height", 1));
	result.output_rate = integer_rational(json::member(canvas, "frameRate"), "V7 execution frame rate");
	result.background_rgba = color(json::member(canvas, "backgroundColor"));
	capture_staged_inputs(root, result);
	return result;
}

[[nodiscard]] captured_selected_v20_execution_plan capture_v8(const json::value& root) {
	captured_selected_v20_execution_plan result;
	result.execution.family = selected_v20_family::evaluated_rgba_v8;
	result.execution.sample_rate = 1;
	result.execution.output_frame_count = static_cast<std::uint64_t>(safe_integer(
		json::member(root, "outputFrameCount"), "V8 execution frame count", 1
	));
	result.execution.quality = std::string{
		json::string(json::member(root, "quality"), "V8 execution quality")
	};
	const auto& canvas = json::member(root, "canvas");
	result.execution.width = static_cast<std::uint32_t>(safe_integer(
		json::member(canvas, "width"), "V8 execution width", 1
	));
	result.execution.height = static_cast<std::uint32_t>(safe_integer(
		json::member(canvas, "height"), "V8 execution height", 1
	));
	result.execution.output_rate = decimal_rational(
		json::member(canvas, "frameRate"), "V8 execution frame rate"
	);
	result.execution.background_rgba = color(json::member(canvas, "backgroundColor"));
	capture_staged_inputs(root, result.execution);
	result.caption_delivery = capture_caption_delivery(root);
	return result;
}

} // namespace

captured_selected_v20_execution_plan capture_selected_v20_execution_plan(
	const int admitted_version,
	const std::string_view authenticated_plan_json
) {
	const auto root = json::parse(authenticated_plan_json);
	if (json::integer(json::member(root, "version"), "selected-V20 plan version") != admitted_version) {
		throw selected_v20_execution_error(
			selected_v20_execution_error_code::plan_contract,
			"The selected-V20 execution snapshot changed generation."
		);
	}
	if (admitted_version == 7) return {capture_v7(root), {}};
	if (admitted_version == 8) return capture_v8(root);
	throw selected_v20_execution_error(
		selected_v20_execution_error_code::plan_contract,
		"Only selected V7/V8 plans have a selected-V20 execution adapter."
	);
}

} // namespace framescaper::media
