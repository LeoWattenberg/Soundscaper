/* SPDX-License-Identifier: AGPL-3.0-only */

#include "v12_retime_authority.hpp"

#include "v12_host_invocation.hpp"
#include "unified_plan_video_timing.hpp"

#if __has_include(<boost/multiprecision/cpp_int.hpp>)
#include "exact_retime_ordinal.hpp"
#define FRAMESCAPER_OPENFX_HAS_EXACT_RETIME 1
#endif

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <string>
#include <string_view>
#include <utility>

namespace framescaper::openfx {
namespace {

namespace json = framescaper::media::json;

[[maybe_unused, nodiscard]] std::uint64_t exact_integer(
	const json::value& value,
	const std::string_view label
) {
	const auto result = json::integer(value, label);
	if (result < 0 || result > 9'007'199'254'740'991LL) {
		throw v12_invocation_error{"source-time-mismatch", std::string{label} + " is outside its exact domain."};
	}
	return static_cast<std::uint64_t>(result);
}

#if defined(FRAMESCAPER_OPENFX_HAS_EXACT_RETIME)
using soundscaper::framescaper::ExactRational;
using soundscaper::framescaper::ExactRetimeSegment;
using soundscaper::framescaper::RetimeMode;
using soundscaper::framescaper::cpp_int;
using soundscaper::framescaper::exact_floor;
using soundscaper::framescaper::exact_output_sample;
using soundscaper::framescaper::exact_source_position;
using soundscaper::framescaper::exact_wire_rational;

[[nodiscard]] ExactRational decimal_tokens(
	const json::value& numerator_value,
	const json::value& denominator_value,
	const std::string_view label
) {
	const auto numerator = std::string{json::string(numerator_value, label)};
	const auto denominator = std::string{json::string(denominator_value, label)};
	try {
		const cpp_int raw_numerator{numerator};
		const cpp_int raw_denominator{denominator};
		const auto exact = exact_wire_rational(raw_numerator, raw_denominator);
		if (exact.numerator() != raw_numerator || exact.denominator() != raw_denominator) {
			throw v12_invocation_error{"source-time-mismatch", std::string{label} + " is not reduced."};
		}
		return exact;
	} catch (const v12_invocation_error&) {
		throw;
	} catch (const std::exception& error) {
		throw v12_invocation_error{"source-time-mismatch", std::string{label} + " is invalid: " + error.what()};
	}
}

[[nodiscard]] ExactRational decimal(
	const json::value& value,
	const std::string_view label
) {
	json::require_exact_keys(value, {"numerator", "denominator"});
	return decimal_tokens(
		json::member(value, "numerator"), json::member(value, "denominator"), label
	);
}

[[nodiscard]] cpp_int point_round(cpp_int numerator, const cpp_int& denominator) {
	if (denominator <= 0 || numerator < 0) {
		throw v12_invocation_error{"source-time-mismatch", "The exact sequence cadence is invalid."};
	}
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
		throw v12_invocation_error{"source-time-mismatch", "The exact sequence frame overflows."};
	}
	return frame.convert_to<std::uint64_t>();
}

[[nodiscard]] RetimeMode retime_mode(const std::string_view value) {
	if (value == "constant-forward") return RetimeMode::constant_forward;
	if (value == "constant-reverse") return RetimeMode::constant_reverse;
	if (value == "freeze") return RetimeMode::freeze;
	if (value == "ramp-forward") return RetimeMode::ramp_forward;
	if (value == "ramp-reverse") return RetimeMode::ramp_reverse;
	throw v12_invocation_error{"source-time-mismatch", "The exact retime mode is unsupported."};
}

[[nodiscard]] const json::value& matching_clip(
	const json::value& plan,
	const std::string_view clip_id
) {
	const json::value* found = nullptr;
	for (const auto& node : json::array(json::member(plan, "nodes"), "V12 nodes")) {
		if (json::string(json::member(node, "kind"), "node kind") != "clip") continue;
		if (json::string(json::member(node, "clipId"), "clip ID") != clip_id) continue;
		if (found != nullptr) throw v12_invocation_error{"source-time-mismatch", "The Retimer clip is ambiguous."};
		found = &node;
	}
	if (found == nullptr) throw v12_invocation_error{"source-time-mismatch", "The Retimer clip is absent."};
	return *found;
}

[[nodiscard]] const json::value& matching_source(
	const json::value& plan,
	const json::value& clip,
	const std::string_view source_id
) {
	const auto node_id = json::string(json::member(clip, "sourceNodeId"), "clip source node ID");
	for (const auto& source : json::array(json::member(plan, "sources"), "V12 sources")) {
		if (json::string(json::member(source, "nodeId"), "source node ID") == node_id
			&& json::string(json::member(source, "sourceId"), "source ID") == source_id) return source;
	}
	throw v12_invocation_error{"source-time-mismatch", "The Retimer source does not bind its clip."};
}

[[nodiscard]] const json::value& matching_row(
	const json::value& clip,
	const std::uint64_t ordinal,
	const std::string_view clip_id,
	const std::string_view source_id
) {
	const auto& mapping = json::member(clip, "sourceTimeMapping");
	const auto& intent = json::member(mapping, "intent");
	const json::value* found = nullptr;
	for (const auto& row : json::array(json::member(intent, "intersections"), "retime intersections")) {
		if (json::string(json::member(row, "clipId"), "intersection clip ID") != clip_id
			|| json::string(json::member(row, "sourceId"), "intersection source ID") != source_id
			|| ordinal < exact_integer(json::member(row, "startOutputFrame"), "start output frame")
			|| ordinal >= exact_integer(json::member(row, "endOutputFrame"), "end output frame")) continue;
		if (found != nullptr) throw v12_invocation_error{"source-time-mismatch", "The Retimer ordinal is ambiguous."};
		found = &row;
	}
	if (found == nullptr) throw v12_invocation_error{"source-time-mismatch", "The Retimer ordinal has no picture."};
	return *found;
}

[[nodiscard]] ExactRational expected_source_time(
	const json::value& clip,
	const json::value& source,
	const json::value& row,
	const std::uint64_t ordinal,
	framescaper::media::video_timing_asset_registry& timing_assets
) {
	const auto& intent = json::member(json::member(clip, "sourceTimeMapping"), "intent");
	const auto sample_start = exact_integer(json::member(intent, "sampleStart"), "sample start");
	const auto sample_rate = exact_integer(json::member(intent, "sampleRate"), "sample rate");
	const auto& output_rate = json::member(intent, "outputRate");
	const auto output_num = exact_integer(json::member(output_rate, "num"), "output rate numerator");
	const auto output_den = exact_integer(json::member(output_rate, "den"), "output rate denominator");
	const auto absolute_sample = exact_output_sample(ordinal, sample_start, sample_rate, output_num, output_den);
	const auto mapping = json::string(json::member(row, "mapping"), "retime mapping");
	if (mapping == "uniform-wall-clock") {
		const auto start = exact_integer(json::member(row, "startSample"), "row start sample");
		const auto end = exact_integer(json::member(row, "endSample"), "row end sample");
		const auto progress = ExactRational(cpp_int(absolute_sample - start), cpp_int(end - start));
		const auto source_start = decimal(json::member(row, "clippedSourceStartTime"), "source start time");
		const auto source_end = decimal(json::member(row, "clippedSourceEndTime"), "source end time");
		return source_start + (source_end - source_start) * progress;
	}
	if (mapping != "curve") {
		throw v12_invocation_error{"source-time-mismatch", "The Retimer mapping is unsupported."};
	}
	const auto& sequence_rate = json::member(json::member(intent, "sequenceBinding"), "rate");
	const auto sequence_num = exact_integer(json::member(sequence_rate, "num"), "sequence rate numerator");
	const auto sequence_den = exact_integer(json::member(sequence_rate, "den"), "sequence rate denominator");
	const auto sequence_frame = sequence_frame_at_sample(
		absolute_sample, sequence_num, sequence_den, sample_rate
	);
	const auto sequence_start = exact_integer(json::member(row, "sequenceStartFrame"), "sequence start");
	if (sequence_frame < sequence_start) {
		throw v12_invocation_error{"source-time-mismatch", "The Retimer ordinal precedes its clip."};
	}
	const auto outer_cell = sequence_frame - sequence_start;
	const auto mode = retime_mode(json::string(json::member(row, "mode"), "retime mode"));
	const auto velocity = [&](const char* key) {
		return mode == RetimeMode::ramp_forward || mode == RetimeMode::ramp_reverse
			? decimal(json::member(row, key), key) : ExactRational(0);
	};
	const ExactRetimeSegment segment{
		mode,
		exact_integer(json::member(row, "segmentStartOuterCell"), "segment start"),
		exact_integer(json::member(row, "segmentEndOuterCell"), "segment end"),
		decimal(json::member(row, "sourceStart"), "source start"),
		decimal(json::member(row, "sourceEnd"), "source end"),
		velocity("startVelocity"), velocity("endVelocity"),
	};
	const auto position = exact_source_position(segment, outer_cell);
	const auto& timing = json::member(source, "timing");
	const auto timing_kind = json::string(json::member(timing, "kind"), "source timing kind");
	if (timing_kind == "vfr") {
		const auto reference = framescaper::media::unified::validate_video_timing_reference(
			json::member(timing, "reference"),
			std::string{json::string(json::member(source, "contentSha256"), "source digest")},
			timing_assets
		);
		const auto frame = exact_floor(position);
		if (frame < 0 || frame > reference.frame_count
			|| (frame == reference.frame_count && position.numerator() % position.denominator() != 0)) {
			throw v12_invocation_error{"source-time-mismatch", "VFR SourceTime escaped its timing asset."};
		}
		const auto index = frame.convert_to<std::int64_t>();
		const auto start = reference.asset->boundary_ticks(index);
		if (index == reference.frame_count) {
			return ExactRational(cpp_int(start), cpp_int(reference.timescale));
		}
		const auto end = reference.asset->boundary_ticks(index + 1);
		const auto remainder = position - ExactRational(frame, cpp_int(1));
		return ExactRational(cpp_int(start), cpp_int(reference.timescale))
			+ remainder * ExactRational(cpp_int(end - start), cpp_int(reference.timescale));
	}
	if (timing_kind != "cfr") {
		throw v12_invocation_error{"source-time-mismatch", "The Retimer source timing kind is unsupported."};
	}
	const auto& source_rate = json::member(timing, "rate");
	return position * ExactRational(
		cpp_int(exact_integer(json::member(source_rate, "den"), "source rate denominator")),
		cpp_int(exact_integer(json::member(source_rate, "num"), "source rate numerator"))
	);
}

[[nodiscard]] double ofx_time(const ExactRational& value) {
	const auto magnitude = soundscaper::framescaper::absolute(value.numerator());
	if (magnitude == 0) return 0;
	const auto bounded_mantissa = [](const cpp_int& integer) {
		const auto bits = soundscaper::framescaper::exact_bits(integer);
		const auto shift = bits > 63 ? bits - 63 : 0;
		return std::pair{
			(integer >> shift).convert_to<long double>(),
			static_cast<int>(shift),
		};
	};
	const auto [numerator, numerator_shift] = bounded_mantissa(magnitude);
	const auto [denominator, denominator_shift] = bounded_mantissa(value.denominator());
	const auto converted = std::ldexp(
		numerator / denominator, numerator_shift - denominator_shift
	) * (value.numerator() < 0 ? -1 : 1);
	const auto result = static_cast<double>(converted);
	if (!std::isfinite(converted) || !std::isfinite(result)) {
		throw v12_invocation_error{
			"source-time-mismatch", "SourceTime is outside the OFX time domain."
		};
	}
	return result;
}
#endif

} // namespace

double verified_v12_retimer_source_time(
	const json::value& plan,
	const json::value& source_time,
	const std::vector<framescaper::media::video_timing_asset_grant>& timing_grants
) {
#if !defined(FRAMESCAPER_OPENFX_HAS_EXACT_RETIME)
	static_cast<void>(plan);
	static_cast<void>(source_time);
	static_cast<void>(timing_grants);
	throw v12_invocation_error{
		"exact-retime-oracle-unavailable",
		"The pinned Boost.Multiprecision exact ordinal oracle is unavailable in this host build."
	};
#else
	json::require_exact_keys(source_time, {
		"parameter", "outputOrdinal", "clipId", "sourceId", "numerator", "denominator",
	});
	if (json::string(json::member(source_time, "parameter"), "Retimer parameter") != "SourceTime") {
		throw v12_invocation_error{"source-time-mismatch", "The Retimer parameter is not SourceTime."};
	}
	const auto ordinal = exact_integer(json::member(source_time, "outputOrdinal"), "SourceTime ordinal");
	const auto clip_id = json::string(json::member(source_time, "clipId"), "SourceTime clip ID");
	const auto source_id = json::string(json::member(source_time, "sourceId"), "SourceTime source ID");
	const auto& clip = matching_clip(plan, clip_id);
	const auto& source = matching_source(plan, clip, source_id);
	const auto& row = matching_row(clip, ordinal, clip_id, source_id);
	framescaper::media::video_timing_asset_registry timing_assets(timing_grants);
	const auto expected = expected_source_time(clip, source, row, ordinal, timing_assets);
	const auto supplied = decimal_tokens(
		json::member(source_time, "numerator"),
		json::member(source_time, "denominator"),
		"SourceTime"
	);
	if (soundscaper::framescaper::compare(expected, supplied) != 0) {
		throw v12_invocation_error{"source-time-mismatch", "SourceTime differs from the exact ordinal oracle."};
	}
	return ofx_time(expected);
#endif
}

} // namespace framescaper::openfx
