/* SPDX-License-Identifier: AGPL-3.0-only */

#include "v12_transition_authority.hpp"

#include "v12_host_invocation.hpp"
#include "unified_plan_common.hpp"

#if __has_include(<boost/multiprecision/cpp_int.hpp>)
#include "exact_retime_ordinal.hpp"
#define FRAMESCAPER_OPENFX_HAS_EXACT_TRANSITION 1
#endif

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstdint>
#include <limits>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace framescaper::openfx {
namespace {

namespace json = framescaper::media::json;
using Rational = std::pair<std::int64_t, std::int64_t>;

[[nodiscard]] int compare_rationals(const Rational& left, const Rational& right) {
	if (left.first < 0 && right.first >= 0) return -1;
	if (left.first >= 0 && right.first < 0) return 1;
	const bool negative = left.first < 0;
	auto left_num = static_cast<std::uint64_t>(negative ? -left.first : left.first);
	auto right_num = static_cast<std::uint64_t>(negative ? -right.first : right.first);
	auto left_den = static_cast<std::uint64_t>(left.second);
	auto right_den = static_cast<std::uint64_t>(right.second);
	bool inverse = false;
	for (;;) {
		const auto left_whole = left_num / left_den;
		const auto right_whole = right_num / right_den;
		if (left_whole != right_whole) {
			const auto result = left_whole < right_whole ? -1 : 1;
			return (inverse ? -result : result) * (negative ? -1 : 1);
		}
		const auto left_remainder = left_num % left_den;
		const auto right_remainder = right_num % right_den;
		if (left_remainder == 0 || right_remainder == 0) {
			if (left_remainder == right_remainder) return 0;
			const auto result = left_remainder == 0 ? -1 : 1;
			return (inverse ? -result : result) * (negative ? -1 : 1);
		}
		left_num = left_den; left_den = left_remainder;
		right_num = right_den; right_den = right_remainder;
		inverse = !inverse;
	}
}

[[noreturn]] void fail(std::string message) {
	throw v12_invocation_error{"transition-value-mismatch", std::move(message)};
}

[[maybe_unused, nodiscard]] std::uint64_t exact_integer(
	const json::value& value,
	const std::string_view label
) {
	const auto result = json::integer(value, label);
	if (result < 0 || result > 9'007'199'254'740'991LL) {
		fail(std::string{label} + " is outside its exact domain.");
	}
	return static_cast<std::uint64_t>(result);
}

[[nodiscard]] double number(
	const json::value& value,
	const std::string_view label
) {
	framescaper::media::unified::finite_number(value, label);
	double result = 0;
	const auto converted = std::from_chars(
		value.text.data(), value.text.data() + value.text.size(), result
	);
	if (converted.ec != std::errc{} || converted.ptr != value.text.data() + value.text.size()) {
		fail(std::string{label} + " is not an exact finite number token.");
	}
	return result;
}

[[nodiscard]] double stable_interpolate(
	const double start,
	const double end,
	const double amount
) {
	const auto legacy = start + (end - start) * amount;
	if (std::isfinite(legacy)) return legacy;
	const auto convex = start * (1 - amount) + end * amount;
	if (std::isfinite(convex)) return convex;
	return convex < 0 ? std::min(start, end) : std::max(start, end);
}

[[nodiscard]] double stable_cubic(
	const double start,
	const double control1,
	const double control2,
	const double end,
	const double amount
) {
	const auto first = stable_interpolate(start, control1, amount);
	const auto second = stable_interpolate(control1, control2, amount);
	const auto third = stable_interpolate(control2, end, amount);
	return stable_interpolate(
		stable_interpolate(first, second, amount),
		stable_interpolate(second, third, amount), amount
	);
}

[[nodiscard]] double normalized_position(
	const Rational start,
	const Rational end,
	const Rational position
) {
	const auto start_value = static_cast<long double>(start.first) / start.second;
	const auto end_value = static_cast<long double>(end.first) / end.second;
	const auto position_value = static_cast<long double>(position.first) / position.second;
	return static_cast<double>((position_value - start_value) / (end_value - start_value));
}

[[nodiscard]] double bezier_parameter(
	const double target,
	const double control1,
	const double control2
) {
	if (target <= 0) return 0;
	if (target >= 1) return 1;
	double low = 0;
	double high = 1;
	for (int iteration = 0; iteration < 64; ++iteration) {
		const auto middle = low + (high - low) / 2;
		if (stable_cubic(0, control1, control2, 1, middle) < target) low = middle;
		else high = middle;
	}
	return high;
}

struct Anchor final { Rational position; double value{}; };

[[maybe_unused, nodiscard]] std::vector<Anchor> anchors(
	const json::value& curve,
	const std::uint64_t duration
) {
	std::vector<Anchor> result;
	for (const auto& value : json::array(json::member(curve, "anchors"), "transition anchors")) {
		const auto position = framescaper::media::unified::rational(
			json::member(value, "position"), "transition anchor position"
		);
		const auto progress = number(json::member(value, "value"), "transition anchor value");
		if (progress < 0 || progress > 1
			|| (!result.empty() && compare_rationals(
				result.back().position, position
			) >= 0)) fail("The transition curve is outside its canonical progress domain.");
		result.push_back({position, progress});
	}
	if (result.size() < 2 || result.front().position != Rational{0, 1}
		|| result.front().value != 0
		|| result.back().position != Rational{static_cast<std::int64_t>(duration), 1}
		|| result.back().value != 1) {
		fail("The transition curve does not bind its exact duration endpoints.");
	}
	return result;
}

[[maybe_unused, nodiscard]] const json::value& matching_transition(
	const json::value& plan,
	const std::string_view transition_id
) {
	const json::value* found = nullptr;
	for (const auto& node : json::array(json::member(plan, "nodes"), "V12 nodes")) {
		if (json::string(json::member(node, "kind"), "node kind") != "transition") continue;
		const auto& transition = json::member(node, "transition");
		if (json::string(json::member(transition, "id"), "transition ID") != transition_id) continue;
		if (found != nullptr) fail("The OpenFX Transition attachment is ambiguous.");
		found = &node;
	}
	if (found == nullptr) fail("The OpenFX Transition attachment is absent.");
	return *found;
}

#if defined(FRAMESCAPER_OPENFX_HAS_EXACT_TRANSITION)
using soundscaper::framescaper::cpp_int;
using soundscaper::framescaper::exact_output_sample;

[[nodiscard]] cpp_int point_round(cpp_int numerator, const cpp_int& denominator) {
	if (denominator <= 0 || numerator < 0) fail("The exact transition cadence is invalid.");
	const cpp_int quotient = numerator / denominator;
	const cpp_int remainder = numerator % denominator;
	return remainder * 2 >= denominator ? quotient + 1 : quotient;
}

[[nodiscard]] std::uint64_t sequence_frame_at_sample(
	const std::uint64_t sample,
	const std::uint64_t rate_num,
	const std::uint64_t rate_den,
	const std::uint64_t sample_rate
) {
	const cpp_int denominator = cpp_int(rate_den) * sample_rate;
	auto frame = cpp_int(sample) * rate_num / denominator;
	const auto boundary = [&](const cpp_int& value) {
		return point_round(value * rate_den * sample_rate, cpp_int(rate_num));
	};
	while (frame > 0 && boundary(frame) > sample) --frame;
	while (boundary(frame + 1) <= sample) ++frame;
	if (frame > std::numeric_limits<std::uint64_t>::max()) {
		fail("The exact transition sequence frame overflows.");
	}
	return frame.convert_to<std::uint64_t>();
}

[[nodiscard]] std::uint64_t sequence_frame(
	const json::value& plan,
	const std::uint64_t ordinal
) {
	const auto& timebase = json::member(plan, "timebase");
	const auto& output = json::member(plan, "output");
	const auto& output_rate = json::member(output, "frameRate");
	const auto& sequence_rate = json::member(timebase, "sequenceRate");
	const auto sample_rate = exact_integer(json::member(timebase, "sampleRate"), "sample rate");
	const auto sample = exact_output_sample(
		ordinal,
		exact_integer(json::member(timebase, "sampleStart"), "sample start"),
		sample_rate,
		exact_integer(json::member(output_rate, "num"), "output rate numerator"),
		exact_integer(json::member(output_rate, "den"), "output rate denominator")
	);
	return sequence_frame_at_sample(
		sample,
		exact_integer(json::member(sequence_rate, "num"), "sequence rate numerator"),
		exact_integer(json::member(sequence_rate, "den"), "sequence rate denominator"),
		sample_rate
	);
}
#endif

[[maybe_unused, nodiscard]] double evaluate_curve(
	const json::value& curve,
	const std::vector<Anchor>& points,
	const Rational position
) {
	std::size_t segment_index = 0;
	while (segment_index + 1 < points.size()
		&& compare_rationals(
			points[segment_index + 1].position, position
		) <= 0) ++segment_index;
	if (segment_index >= points.size() - 1) return points.back().value;
	const auto& start = points[segment_index];
	const auto& end = points[segment_index + 1];
	if (compare_rationals(position, start.position) == 0) {
		return start.value;
	}
	const auto& segment = json::array(json::member(curve, "segments"), "transition segments")[segment_index];
	const auto kind = json::string(json::member(segment, "kind"), "transition segment kind");
	if (kind == "hold") return start.value;
	const auto amount = normalized_position(start.position, end.position, position);
	if (kind == "linear") return stable_interpolate(start.value, end.value, amount);
	if (kind == "eased") {
		return stable_interpolate(start.value, end.value, amount * amount * (3 - 2 * amount));
	}
	if (kind != "bezier") fail("The transition curve segment kind is unsupported.");
	const auto control = [&](const char* key) {
		const auto& value = json::member(segment, key);
		const auto control_position = framescaper::media::unified::rational(
			json::member(value, "position"), "transition control position"
		);
		const auto control_value = number(json::member(value, "value"), "transition control value");
		if (control_value < 0 || control_value > 1
			|| compare_rationals(start.position, control_position) > 0
			|| compare_rationals(control_position, end.position) > 0) {
			fail("The transition Bézier control is outside its segment.");
		}
		return std::pair{normalized_position(start.position, end.position, control_position), control_value};
	};
	const auto first = control("control1");
	const auto second = control("control2");
	if (first.first > second.first) fail("The transition Bézier controls are reversed.");
	return stable_cubic(
		start.value, first.second, second.second, end.value,
		bezier_parameter(amount, first.first, second.first)
	);
}

} // namespace

double verified_v12_transition_value(
	const json::value& plan,
	const std::string_view transition_id,
	const std::uint64_t output_ordinal
) {
#if !defined(FRAMESCAPER_OPENFX_HAS_EXACT_TRANSITION)
	static_cast<void>(plan);
	static_cast<void>(transition_id);
	static_cast<void>(output_ordinal);
	throw v12_invocation_error{
		"exact-transition-oracle-unavailable",
		"The pinned Boost.Multiprecision exact transition ordinal oracle is unavailable in this host build."
	};
#else
	const auto& node = matching_transition(plan, transition_id);
	const auto& transition = json::member(node, "transition");
	const auto duration = exact_integer(json::member(transition, "durationFrames"), "transition duration");
	const auto& edges = json::member(node, "edges");
	const auto& outgoing = json::member(edges, "outgoing");
	const auto& incoming = json::member(edges, "incoming");
	const auto overlap_start = exact_integer(json::member(incoming, "sequenceStartFrame"), "overlap start");
	const auto overlap_end = exact_integer(json::member(outgoing, "sequenceStartFrame"), "outgoing start")
		+ exact_integer(json::member(outgoing, "sequenceFrameCount"), "outgoing duration");
	const auto frame = sequence_frame(plan, output_ordinal);
	if (overlap_end - overlap_start != duration || frame < overlap_start || frame >= overlap_end) {
		fail("The output ordinal is outside its attached transition overlap.");
	}
	const Rational local{static_cast<std::int64_t>(frame - overlap_start), 1};
	const auto& curve = json::member(transition, "curve");
	const auto result = evaluate_curve(curve, anchors(curve, duration), local);
	if (!std::isfinite(result) || result < 0 || result > 1) {
		fail("The host-owned Transition value left its exact [0, 1] domain.");
	}
	return result;
#endif
}

} // namespace framescaper::openfx
