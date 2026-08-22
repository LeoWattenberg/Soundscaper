/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <boost/multiprecision/cpp_int.hpp>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <utility>
#include <vector>

namespace soundscaper::framescaper {

using boost::multiprecision::cpp_int;
constexpr std::size_t kMaximumExactBits = 4096;
constexpr std::size_t kMaximumWorkingExactBits = kMaximumExactBits * 6;

inline cpp_int absolute(cpp_int value) { return value < 0 ? -value : value; }

inline std::size_t exact_bits(const cpp_int& value) {
	const cpp_int magnitude = absolute(value);
	return magnitude == 0 ? 1 : static_cast<std::size_t>(boost::multiprecision::msb(magnitude)) + 1;
}

inline void require_working_bounded(const cpp_int& value) {
	if (exact_bits(value) > kMaximumWorkingExactBits) {
		throw std::range_error("exact retime complexity exceeds its fixed working bound");
	}
}

inline cpp_int greatest_common_divisor(cpp_int left, cpp_int right) {
	left = absolute(std::move(left));
	right = absolute(std::move(right));
	while (right != 0) {
		cpp_int remainder = left % right;
		left = std::move(right);
		right = std::move(remainder);
	}
	return left == 0 ? cpp_int(1) : left;
}

class ExactRational final {
public:
	ExactRational(cpp_int numerator, cpp_int denominator)
		: numerator_(std::move(numerator)), denominator_(std::move(denominator)) {
		if (denominator_ == 0) throw std::range_error("exact retime denominator is zero");
		if (denominator_ < 0) {
			numerator_ = -numerator_;
			denominator_ = -denominator_;
		}
		const cpp_int divisor = greatest_common_divisor(numerator_, denominator_);
		numerator_ /= divisor;
		denominator_ /= divisor;
		require_working_bounded(numerator_);
		require_working_bounded(denominator_);
	}

	explicit ExactRational(std::int64_t integer) : ExactRational(cpp_int(integer), cpp_int(1)) {}

	const cpp_int& numerator() const { return numerator_; }
	const cpp_int& denominator() const { return denominator_; }

private:
	cpp_int numerator_;
	cpp_int denominator_;
};

inline ExactRational exact_wire_rational(cpp_int numerator, cpp_int denominator) {
	if (exact_bits(numerator) > kMaximumExactBits || exact_bits(denominator) > kMaximumExactBits) {
		throw std::range_error("exact retime wire complexity exceeds 4096 bits");
	}
	return ExactRational(std::move(numerator), std::move(denominator));
}

inline ExactRational operator-(const ExactRational& value) {
	return ExactRational(-value.numerator(), value.denominator());
}

inline ExactRational operator+(const ExactRational& left, const ExactRational& right) {
	const cpp_int common = greatest_common_divisor(left.denominator(), right.denominator());
	const cpp_int left_scale = right.denominator() / common;
	const cpp_int right_scale = left.denominator() / common;
	const cpp_int left_term = left.numerator() * left_scale;
	const cpp_int right_term = right.numerator() * right_scale;
	const cpp_int numerator = left_term + right_term;
	const cpp_int denominator = left.denominator() * left_scale;
	return ExactRational(numerator, denominator);
}

inline ExactRational operator-(const ExactRational& left, const ExactRational& right) {
	return left + (-right);
}

inline ExactRational operator*(const ExactRational& left, const ExactRational& right) {
	const cpp_int left_cancel = greatest_common_divisor(left.numerator(), right.denominator());
	const cpp_int right_cancel = greatest_common_divisor(right.numerator(), left.denominator());
	const cpp_int numerator = (left.numerator() / left_cancel) * (right.numerator() / right_cancel);
	const cpp_int denominator = (left.denominator() / right_cancel) * (right.denominator() / left_cancel);
	return ExactRational(numerator, denominator);
}

inline ExactRational operator/(const ExactRational& left, const ExactRational& right) {
	if (right.numerator() == 0) throw std::range_error("exact retime division by zero");
	return left * ExactRational(right.denominator(), right.numerator());
}

inline int compare(const ExactRational& left, const ExactRational& right) {
	const cpp_int difference = left.numerator() * right.denominator()
		- right.numerator() * left.denominator();
	return difference < 0 ? -1 : difference > 0 ? 1 : 0;
}

inline cpp_int exact_floor(const ExactRational& value) {
	cpp_int quotient = value.numerator() / value.denominator();
	if (value.numerator() % value.denominator() < 0) --quotient;
	return quotient;
}

inline cpp_int exact_ceiling(const ExactRational& value) {
	cpp_int quotient = value.numerator() / value.denominator();
	if (value.numerator() % value.denominator() > 0) ++quotient;
	return quotient;
}

enum class RetimeMode {
	constant_forward,
	constant_reverse,
	freeze,
	ramp_forward,
	ramp_reverse,
};

struct ExactRetimeSegment final {
	RetimeMode mode;
	std::uint64_t start_outer_cell;
	std::uint64_t end_outer_cell;
	ExactRational source_start;
	ExactRational source_end;
	ExactRational start_velocity;
	ExactRational end_velocity;
};

inline ExactRational exact_source_position(
	const ExactRetimeSegment& segment,
	std::uint64_t outer_cell
) {
	if (outer_cell < segment.start_outer_cell || outer_cell >= segment.end_outer_cell) {
		throw std::range_error("outer cell is outside its exact retime segment");
	}
	if (segment.mode == RetimeMode::freeze) return segment.source_start;
	const auto elapsed_value = outer_cell - segment.start_outer_cell;
	const auto span_value = segment.end_outer_cell - segment.start_outer_cell;
	const ExactRational elapsed(cpp_int(elapsed_value), cpp_int(1));
	const ExactRational span(cpp_int(span_value), cpp_int(1));
	if (segment.mode == RetimeMode::constant_forward
		|| segment.mode == RetimeMode::constant_reverse) {
		return segment.source_start + (segment.source_end - segment.source_start) * elapsed / span;
	}
	const ExactRational acceleration = segment.end_velocity - segment.start_velocity;
	ExactRational magnitude = segment.start_velocity * elapsed
		+ acceleration * elapsed * elapsed / (ExactRational(2) * span);
	if (segment.mode == RetimeMode::ramp_reverse) magnitude = -magnitude;
	return segment.source_start + magnitude;
}

inline std::uint64_t exact_picture_ordinal(
	const ExactRetimeSegment& segment,
	std::uint64_t outer_cell,
	std::uint64_t source_in,
	std::uint64_t source_out
) {
	if (source_out <= source_in) throw std::range_error("source binding is empty");
	const ExactRational position = exact_source_position(segment, outer_cell);
	cpp_int ordinal = segment.mode == RetimeMode::constant_reverse
		|| segment.mode == RetimeMode::ramp_reverse
		? exact_ceiling(position) - 1
		: exact_floor(position);
	ordinal = std::max(ordinal, cpp_int(source_in));
	ordinal = std::min(ordinal, cpp_int(source_out - 1));
	return ordinal.convert_to<std::uint64_t>();
}

inline std::uint64_t exact_picture_ordinal_at_time(
	const std::vector<ExactRational>& boundaries,
	const ExactRational& source_time
) {
	if (boundaries.size() < 2 || compare(source_time, boundaries.front()) < 0
		|| compare(source_time, boundaries.back()) >= 0) {
		throw std::range_error("source time is outside its exact timing boundaries");
	}
	std::size_t lower = 0;
	std::size_t upper = boundaries.size() - 1;
	while (lower + 1 < upper) {
		const std::size_t middle = lower + (upper - lower) / 2;
		if (compare(boundaries[middle], source_time) <= 0) lower = middle;
		else upper = middle;
	}
	return static_cast<std::uint64_t>(lower);
}

inline std::uint64_t exact_output_sample(
	std::uint64_t output_ordinal,
	std::uint64_t sample_start,
	std::uint64_t sample_rate,
	std::uint64_t output_rate_num,
	std::uint64_t output_rate_den
) {
	if (sample_rate == 0 || output_rate_num == 0 || output_rate_den == 0) {
		throw std::range_error("exact output cadence rate is zero");
	}
	const cpp_int offset = cpp_int(output_ordinal) * sample_rate * output_rate_den / output_rate_num;
	const cpp_int sample = cpp_int(sample_start) + offset;
	if (sample > std::numeric_limits<std::uint64_t>::max()) {
		throw std::range_error("exact output sample exceeds its integer domain");
	}
	return sample.convert_to<std::uint64_t>();
}

}  // namespace soundscaper::framescaper
