/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "unified_plan_common.hpp"

#include <algorithm>
#include <cstdint>
#include <string_view>

namespace framescaper::media::unified {

#if defined(FRAMESCAPER_HAS_EXACT_RETIME_MULTIPRECISION)

using soundscaper::framescaper::cpp_int;
using soundscaper::framescaper::ExactRational;

[[nodiscard]] inline std::int64_t intent_exact_integer(
	const cpp_int& value,
	const std::string_view label
) {
	if (value < 0 || value > maximum_safe_integer) {
		throw json::parse_error(std::string{label} + " escapes its safe integer authority.");
	}
	return value.convert_to<std::int64_t>();
}

[[nodiscard]] inline ExactRational intent_decimal(
	const json::value& value,
	const std::string_view label
) {
	decimal_rational(value, label);
	return soundscaper::framescaper::exact_wire_rational(
		cpp_int{std::string{json::string(json::member(value, "numerator"), label)}},
		cpp_int{std::string{json::string(json::member(value, "denominator"), label)}}
	);
}

inline void require_intent_decimal(
	const json::value& value,
	const ExactRational& expected,
	const std::string_view label
) {
	if (soundscaper::framescaper::compare(intent_decimal(value, label), expected) != 0) {
		throw json::parse_error(std::string{label} + " does not bind its exact ordinal authority.");
	}
}

[[nodiscard]] inline std::int64_t intent_point_round(
	const cpp_int& numerator,
	const cpp_int& denominator,
	const std::string_view label
) {
	if (numerator < 0 || denominator <= 0) {
		throw json::parse_error(std::string{label} + " has an invalid nonnegative point-rounding ratio.");
	}
	return intent_exact_integer((numerator * 2 + denominator) / (denominator * 2), label);
}

template<typename Clock>
[[nodiscard]] std::int64_t intent_sequence_boundary(
	const std::int64_t frame,
	const Clock& clock
) {
	return intent_point_round(
		cpp_int{frame} * clock.sequence_rate.second * clock.sample_rate,
		cpp_int{clock.sequence_rate.first},
		"sequence frame boundary"
	);
}

template<typename Clock>
[[nodiscard]] std::int64_t intent_sequence_frame_at_sample(
	const std::int64_t sample,
	const Clock& clock
) {
	auto frame = intent_exact_integer(
		cpp_int{sample} * clock.sequence_rate.first
			/ (cpp_int{clock.sequence_rate.second} * clock.sample_rate),
		"sequence frame"
	);
	for (int correction = 0; correction < 2 && frame > 0; ++correction) {
		if (intent_sequence_boundary(frame, clock) <= sample) break;
		--frame;
	}
	for (int correction = 0; correction < 2; ++correction) {
		if (frame == maximum_safe_integer
			|| intent_sequence_boundary(frame + 1, clock) > sample) break;
		++frame;
	}
	if (intent_sequence_boundary(frame, clock) > sample || frame == maximum_safe_integer
		|| intent_sequence_boundary(frame + 1, clock) <= sample) {
		throw json::parse_error("A sample could not be resolved onto the exact sequence frame grid.");
	}
	return frame;
}

template<typename Clock>
[[nodiscard]] std::int64_t intent_output_boundary(
	const std::int64_t sample,
	const Clock& clock
) {
	if (sample <= clock.sample_start) return 0;
	const auto plan_end = clock.sample_start + clock.sample_duration;
	if (sample >= plan_end) return clock.output_count;
	const cpp_int numerator = cpp_int{sample - clock.sample_start} * clock.output_rate.first;
	const cpp_int denominator = cpp_int{clock.sample_rate} * clock.output_rate.second;
	return std::min(
		clock.output_count,
		intent_exact_integer((numerator + denominator - 1) / denominator, "output boundary")
	);
}

template<typename Clock, typename Clip>
[[nodiscard]] std::int64_t intent_local_cell(
	const std::int64_t output_frame,
	const Clock& clock,
	const Clip& clip
) {
	const auto offset = intent_exact_integer(
		cpp_int{output_frame} * clock.sample_rate * clock.output_rate.second
			/ clock.output_rate.first,
		"output sample offset"
	);
	if (clock.sample_start > maximum_safe_integer - offset) {
		throw json::parse_error("An output sample exceeds its safe integer authority.");
	}
	const auto sequence_frame = intent_sequence_frame_at_sample(clock.sample_start + offset, clock);
	const auto local = sequence_frame - clip.sequence_start;
	if (local < 0 || local >= clip.sequence_count) {
		throw json::parse_error("A retime cadence escaped its exact clip authority.");
	}
	return local;
}

template<typename Map>
[[nodiscard]] soundscaper::framescaper::RetimeMode intent_mode(
	const Map& map,
	const std::size_t index
) {
	using soundscaper::framescaper::RetimeMode;
	const auto& mode = map.segments[index].mode;
	if (mode == "constant-forward") return RetimeMode::constant_forward;
	if (mode == "constant-reverse") return RetimeMode::constant_reverse;
	if (mode == "freeze") return RetimeMode::freeze;
	if (mode == "ramp-forward") return RetimeMode::ramp_forward;
	if (mode == "ramp-reverse") return RetimeMode::ramp_reverse;
	throw json::parse_error("A retime segment has an unsupported exact mode.");
}

template<typename Map>
[[nodiscard]] soundscaper::framescaper::ExactRetimeSegment intent_segment(
	const Map& map,
	const std::size_t index
) {
	const auto& segment = map.segments[index];
	return {
		intent_mode(map, index),
		static_cast<std::uint64_t>(map.outer_frames[index]),
		static_cast<std::uint64_t>(map.outer_frames[index + 1]),
		ExactRational(map.source_frames[index].first, map.source_frames[index].second),
		ExactRational(map.source_frames[index + 1].first, map.source_frames[index + 1].second),
		ExactRational(segment.start_velocity.first, segment.start_velocity.second),
		ExactRational(segment.end_velocity.first, segment.end_velocity.second),
	};
}

template<typename Map>
[[nodiscard]] ExactRational intent_source_position(
	const Map& map,
	const std::int64_t outer_cell
) {
	if (outer_cell == map.outer_frames.back()) {
		return ExactRational(map.source_frames.back().first, map.source_frames.back().second);
	}
	for (std::size_t index = 0; index < map.segments.size(); ++index) {
		if (outer_cell >= map.outer_frames[index] && outer_cell < map.outer_frames[index + 1]) {
			return soundscaper::framescaper::exact_source_position(
				intent_segment(map, index), static_cast<std::uint64_t>(outer_cell)
			);
		}
	}
	throw json::parse_error("A clipped outer cell escapes its exact retime map.");
}

template<typename Map, typename Clip>
[[nodiscard]] std::int64_t intent_drawable_frame(
	const Map& map,
	const std::size_t segment_index,
	const std::int64_t outer_cell,
	const Clip& clip
) {
	return static_cast<std::int64_t>(soundscaper::framescaper::exact_picture_ordinal(
		intent_segment(map, segment_index),
		static_cast<std::uint64_t>(outer_cell),
		static_cast<std::uint64_t>(clip.source_in),
		static_cast<std::uint64_t>(clip.source_in + clip.source_count)
	));
}

[[nodiscard]] inline std::int64_t intent_decimal_bytes(const json::value& value) {
	if (value.kind == json::type::object) {
		const auto* numerator = json::optional_member(value, "numerator");
		const auto* denominator = json::optional_member(value, "denominator");
		if (value.members.size() == 2 && numerator != nullptr && denominator != nullptr
			&& numerator->kind == json::type::string && denominator->kind == json::type::string) {
			decimal_rational(value, "retime exact decimal");
			return static_cast<std::int64_t>(numerator->text.size() + denominator->text.size() + 4);
		}
		std::int64_t result{};
		for (const auto& [key, child] : value.members) {
			static_cast<void>(key);
			if (result > maximum_safe_integer - intent_decimal_bytes(child)) {
				throw json::parse_error("Retime decimal byte accounting overflows.");
			}
			result += intent_decimal_bytes(child);
		}
		return result;
	}
	if (value.kind == json::type::array) {
		std::int64_t result{};
		for (const auto& child : value.items) result += intent_decimal_bytes(child);
		return result;
	}
	return 0;
}

inline void intent_common_row(
	const json::value& row,
	const std::int64_t topology_index,
	const std::int64_t start_sample,
	const std::int64_t end_sample,
	const std::int64_t start_output,
	const std::int64_t end_output
) {
	if (safe_integer(json::member(row, "topologyIntervalIndex"), "topology interval") != topology_index
		|| safe_integer(json::member(row, "layerIndex"), "layer index") != 0
		|| safe_integer(json::member(row, "clipIndex"), "clip index") != 0
		|| safe_integer(json::member(row, "startSample"), "intersection start sample") != start_sample
		|| safe_integer(json::member(row, "endSample"), "intersection end sample", 1) != end_sample
		|| safe_integer(json::member(row, "startOutputFrame"), "intersection start output") != start_output
		|| safe_integer(json::member(row, "endOutputFrame"), "intersection end output", 1) != end_output) {
		throw json::parse_error("A retime intersection does not bind its exact topology/output authority.");
	}
}

template<typename Clock, typename Clip, typename Source>
void validate_exact_intent_authority(
	const json::value& intent,
	const Clock& clock,
	const Clip& clip,
	const Source& source
) {
	const auto clip_start = intent_sequence_boundary(clip.sequence_start, clock);
	const auto clip_end = intent_sequence_boundary(clip.sequence_start + clip.sequence_count, clock);
	const auto plan_end = clock.sample_start + clock.sample_duration;
	const auto active_start = std::max(clock.sample_start, clip_start);
	const auto active_end = std::min(plan_end, clip_end);
	if (active_end <= active_start) {
		throw json::parse_error("A unified retime clip has no active interval in the plan range.");
	}
	const std::int64_t topology_index = active_start == clock.sample_start ? 0 : 1;
	const std::int64_t topology_count = (active_start == clock.sample_start ? 0 : 1) + 1
		+ (active_end == plan_end ? 0 : 1) + 2;
	const auto& rows = json::array(json::member(intent, "intersections"), "retime intersections");
	std::size_t row_index{};
	std::int64_t geometric_count{};
	if (!clip.retime_map.present) {
		geometric_count = 1;
		const auto start_output = intent_output_boundary(active_start, clock);
		const auto end_output = intent_output_boundary(active_end, clock);
		if (start_output == end_output || rows.size() != 1) {
			throw json::parse_error("Wall-clock retime rows do not exactly cover their active output authority.");
		}
		const auto& row = rows.front();
		intent_common_row(row, topology_index, active_start, active_end, start_output, end_output);
		if (safe_integer(json::member(row, "clipStartSample"), "clip start sample") != clip_start
			|| safe_integer(json::member(row, "clipEndSample"), "clip end sample", 1) != clip_end) {
			throw json::parse_error("A wall-clock row does not bind its exact clip sample range.");
		}
		const ExactRational source_start(cpp_int{clip.source_in} * clip.source_rate.second, clip.source_rate.first);
		const ExactRational source_end(
			cpp_int{clip.source_in + clip.source_count} * clip.source_rate.second, clip.source_rate.first
		);
		require_intent_decimal(json::member(row, "sourceStartTime"), source_start, "source start time");
		require_intent_decimal(json::member(row, "sourceEndTime"), source_end, "source end time");
		const auto interpolate = [&](const std::int64_t sample) {
			return source_start + (source_end - source_start)
				* ExactRational(sample - clip_start, clip_end - clip_start);
		};
		require_intent_decimal(
			json::member(row, "clippedSourceStartTime"), interpolate(active_start), "clipped source start time"
		);
		require_intent_decimal(
			json::member(row, "clippedSourceEndTime"), interpolate(active_end), "clipped source end time"
		);
		row_index = 1;
	} else {
		for (std::size_t segment_index = 0; segment_index < clip.retime_map.segments.size(); ++segment_index) {
			const auto segment_start = intent_sequence_boundary(
				clip.sequence_start + clip.retime_map.outer_frames[segment_index], clock
			);
			const auto segment_end = intent_sequence_boundary(
				clip.sequence_start + clip.retime_map.outer_frames[segment_index + 1], clock
			);
			const auto start_sample = std::max(active_start, segment_start);
			const auto end_sample = std::min(active_end, segment_end);
			if (end_sample <= start_sample) continue;
			++geometric_count;
			const auto start_output = intent_output_boundary(start_sample, clock);
			const auto end_output = intent_output_boundary(end_sample, clock);
			if (start_output == end_output) continue;
			if (row_index >= rows.size()) {
				throw json::parse_error("Curve retime rows do not cover their active output authority.");
			}
			const auto& row = rows[row_index++];
			intent_common_row(row, topology_index, start_sample, end_sample, start_output, end_output);
			const auto start_outer = intent_local_cell(start_output, clock, clip);
			const auto end_outer = intent_local_cell(end_output - 1, clock, clip) + 1;
			if (safe_integer(json::member(row, "segmentIndex"), "retime segment index")
					!= static_cast<std::int64_t>(segment_index)
				|| safe_integer(json::member(row, "startOuterCell"), "clipped outer start") != start_outer
				|| safe_integer(json::member(row, "endOuterCell"), "clipped outer end", 1) != end_outer) {
				throw json::parse_error("A curve row does not bind its exact clipped cell authority.");
			}
			require_intent_decimal(
				json::member(row, "clippedSourceStart"),
				intent_source_position(clip.retime_map, start_outer), "clipped curve source start"
			);
			require_intent_decimal(
				json::member(row, "clippedSourceEnd"),
				intent_source_position(clip.retime_map, end_outer), "clipped curve source end"
			);
			const auto first = intent_drawable_frame(
				clip.retime_map, segment_index, start_outer, clip
			);
			const auto last = intent_drawable_frame(
				clip.retime_map, segment_index, end_outer - 1, clip
			);
			const auto lower = std::min(first, last);
			const auto upper = std::max(first, last);
			require_intent_decimal(
				json::member(row, "drawableStartTime"),
				ExactRational(cpp_int{lower} * clip.source_rate.second, clip.source_rate.first),
				"drawable source start time"
			);
			require_intent_decimal(
				json::member(row, "drawableEndTime"),
				ExactRational(cpp_int{upper + 1} * clip.source_rate.second, clip.source_rate.first),
				"drawable source end time"
			);
		}
	}
	if (row_index == 0 || row_index != rows.size()) {
		throw json::parse_error("Unified retime intersections do not exactly cover their ordinal authority.");
	}
	const auto& limits = json::member(intent, "limits");
	if (safe_integer(json::member(limits, "topologyRecordCount"), "topology record count") != topology_count
		|| safe_integer(json::member(limits, "compiledSegmentCount"), "compiled segment count")
			!= static_cast<std::int64_t>(clip.retime_map.segments.size())
		|| safe_integer(json::member(limits, "geometricCandidateCount"), "geometric candidate count") != geometric_count
		|| safe_integer(json::member(limits, "serializedIntersectionCount"), "serialized intersection count")
			!= static_cast<std::int64_t>(rows.size())
		|| safe_integer(json::member(limits, "decimalByteCount"), "decimal byte count")
			!= intent_decimal_bytes(json::member(intent, "intersections"))) {
		throw json::parse_error("Unified retime intent limit accounting is not its exact owning authority.");
	}
	static_cast<void>(source);
}

#else

template<typename Clock, typename Clip, typename Source>
void validate_exact_intent_authority(
	const json::value&,
	const Clock&,
	const Clip&,
	const Source&
) {
	throw json::parse_error("Unified retime admission requires the pinned exact arithmetic closure.");
}

#endif

} // namespace framescaper::media::unified
