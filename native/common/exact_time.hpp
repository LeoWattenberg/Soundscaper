/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#if __has_include(<boost/multiprecision/cpp_int.hpp>)
#include <boost/multiprecision/cpp_int.hpp>
#define SCAPE_NATIVE_COMMON_HAS_EXACT_CADENCE 1
#endif

#include <cstdint>
#include <limits>
#include <utility>

namespace scape::native_common {

/** Compare signed rationals with positive denominators without cross-product overflow. */
[[nodiscard]] inline int compare_rationals(
	const std::pair<std::int64_t, std::int64_t>& left,
	const std::pair<std::int64_t, std::int64_t>& right
) {
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

#if defined(SCAPE_NATIVE_COMMON_HAS_EXACT_CADENCE)

enum class exact_cadence_status { ok, invalid, overflow };

struct exact_cadence_frame_result final {
	exact_cadence_status status;
	std::uint64_t frame;
};

namespace detail {

using boost::multiprecision::cpp_int;

[[nodiscard]] inline cpp_int round_nonnegative_ratio(
	const cpp_int& numerator,
	const cpp_int& denominator
) {
	const cpp_int quotient = numerator / denominator;
	const cpp_int remainder = numerator % denominator;
	return remainder * 2 >= denominator ? quotient + 1 : quotient;
}

} // namespace detail

/** Map a non-negative exact clock sample to its rounded sequence-frame interval. */
[[nodiscard]] inline exact_cadence_frame_result sequence_frame_at_sample(
	const std::uint64_t sample,
	const std::uint64_t rate_num,
	const std::uint64_t rate_den,
	const std::uint64_t sample_rate
) {
	if (rate_num == 0 || rate_den == 0 || sample_rate == 0) {
		return {exact_cadence_status::invalid, 0};
	}
	using detail::cpp_int;
	const cpp_int denominator = cpp_int(rate_den) * sample_rate;
	auto frame = cpp_int(sample) * rate_num / denominator;
	const auto boundary = [&](const cpp_int& value) {
		return detail::round_nonnegative_ratio(
			value * rate_den * sample_rate,
			cpp_int(rate_num)
		);
	};
	while (frame > 0 && boundary(frame) > sample) --frame;
	while (boundary(frame + 1) <= sample) ++frame;
	if (frame > std::numeric_limits<std::uint64_t>::max()) {
		return {exact_cadence_status::overflow, 0};
	}
	return {exact_cadence_status::ok, frame.convert_to<std::uint64_t>()};
}

#endif

} // namespace scape::native_common
