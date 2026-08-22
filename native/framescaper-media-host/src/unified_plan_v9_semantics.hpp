/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "media_plan.hpp"
#include "unified_plan_common.hpp"
#include "unified_plan_picture_crop_semantics.hpp"
#include "unified_plan_v9_intent_authority.hpp"

#include <map>
#include <set>
#include <string>
#include <tuple>
#include <utility>

namespace framescaper::media::unified {

struct source_authority final {
	std::string node_id;
	std::string source_id;
	std::string storage_key;
	std::string mime_type;
	std::string sha256;
	std::int64_t frame_count{};
	std::pair<std::int64_t, std::int64_t> rate{};
	bool cfr{};
};

struct retime_segment_authority final {
	std::string mode;
	std::pair<std::int64_t, std::int64_t> start_velocity{0, 1};
	std::pair<std::int64_t, std::int64_t> end_velocity{0, 1};
	bool has_velocities{};
	bool operator==(const retime_segment_authority&) const = default;
};

struct retime_map_authority final {
	bool present{};
	std::vector<std::int64_t> outer_frames;
	std::vector<std::pair<std::int64_t, std::int64_t>> source_frames;
	std::vector<retime_segment_authority> segments;
	bool operator==(const retime_map_authority&) const = default;
};

struct clip_authority final {
	std::string node_id;
	std::string clip_id;
	std::string track_id;
	std::string source_node_id;
	std::int64_t sequence_start{};
	std::int64_t sequence_count{};
	std::int64_t source_in{};
	std::int64_t source_count{};
	std::pair<std::int64_t, std::int64_t> source_rate{};
	retime_map_authority retime_map;
	std::vector<std::string> effect_ids;
	bool uses_curve{};
};

struct track_authority final {
	std::string track_id;
	std::int64_t sequence_order{};
};

struct temporal_authority final {
	std::int64_t sample_start{};
	std::int64_t sample_duration{};
	std::int64_t sample_rate{};
	std::string sequence_id;
	std::pair<std::int64_t, std::int64_t> sequence_rate;
	std::pair<std::int64_t, std::int64_t> output_rate;
	std::int64_t output_count{};
};

using source_index = std::map<std::string, source_authority>;
using clip_index = std::map<std::string, clip_authority>;
using track_index = std::map<std::string, track_authority>;

[[nodiscard]] inline track_index validate_tracks(const json::value& root) {
	const auto& values = json::array(json::member(root, "tracks"), "unified render tracks");
	if (values.size() > 4'096) throw json::parse_error("The unified track ceiling is exceeded.");
	track_index result;
	std::set<std::int64_t> orders;
	std::pair<std::int64_t, std::string> previous{-1, {}};
	for (const auto& value : values) {
		exact(value, {"trackId", "sequenceOrder", "mute", "solo", "hidden"});
		track_authority track{
			stable_id(json::member(value, "trackId"), "track ID"),
			safe_integer(json::member(value, "sequenceOrder"), "track sequence order"),
		};
		for (const auto key : {"mute", "solo", "hidden"}) {
			static_cast<void>(json::boolean(json::member(value, key), key));
		}
		const auto order = std::pair{track.sequence_order, track.track_id};
		if ((!previous.second.empty() && order <= previous)
			|| !orders.insert(track.sequence_order).second
			|| !result.emplace(track.track_id, track).second) {
			throw json::parse_error("Unified tracks are not unique canonical order.");
		}
		previous = order;
	}
	return result;
}

[[nodiscard]] inline temporal_authority temporal(const json::value& root) {
	const auto& timebase = json::member(root, "timebase");
	const auto& output = json::member(root, "output");
	return {
		safe_integer(json::member(timebase, "sampleStart"), "sample start"),
		safe_integer(json::member(timebase, "sampleDuration"), "sample duration", 1),
		safe_integer(json::member(timebase, "sampleRate"), "sample rate", 1),
		text(json::member(timebase, "sequenceId"), "sequence ID"),
		rate(json::member(timebase, "sequenceRate"), "sequence rate"),
		rate(json::member(output, "frameRate"), "output rate"),
		safe_integer(json::member(output, "frameCount"), "output frame count", 1),
	};
}

inline void validate_timing_reference(const json::value& value, const std::string& source_sha, source_authority& source) {
	exact(value, {"encoding", "storageKey", "sha256", "sourceSha256", "byteLength", "frameCount", "timescale", "finalFrameDurationTicks"});
	literal(json::member(value, "encoding"), "soundscaper-video-timing-v1", "timing encoding");
	const auto sha = digest(json::member(value, "sha256"), "timing digest");
	if (text(json::member(value, "storageKey"), "timing storage key") != "video-timing-sha256:" + sha
		|| digest(json::member(value, "sourceSha256"), "timing source digest") != source_sha) {
		throw json::parse_error("VFR timing does not bind its exact source and storage identities.");
	}
	const auto frames = safe_integer(json::member(value, "frameCount"), "timing frame count", 1);
	if (frames > 2'000'000 || safe_integer(json::member(value, "byteLength"), "timing byte length", 1)
		!= 32 + frames * 8 || safe_integer(json::member(value, "timescale"), "timing timescale", 1) > 0xffff'ffffLL) {
		throw json::parse_error("VFR timing summary exceeds or disagrees with its closed authority.");
	}
	const auto duration = json::string(json::member(value, "finalFrameDurationTicks"), "final duration");
	static constexpr std::string_view maximum_signed_int64{"9223372036854775807"};
	if (duration.empty() || duration.front() < '1' || duration.front() > '9'
		|| duration.size() > maximum_signed_int64.size()
		|| (duration.size() == maximum_signed_int64.size() && duration > maximum_signed_int64)
		|| !std::all_of(duration.begin() + 1, duration.end(), [](const unsigned char byte) {
			return std::isdigit(byte) != 0;
		})) throw json::parse_error("VFR final duration is not a positive signed 64-bit decimal.");
	source.frame_count = frames;
}

[[nodiscard]] inline source_index validate_sources(const json::value& root, admitted_media_plan& result) {
	const auto& values = json::array(json::member(root, "sources"), "unified sources");
	if (values.size() > 4'096) throw json::parse_error("The unified source ceiling is exceeded.");
	source_index by_node;
	std::set<std::string> source_ids;
	for (std::size_t index = 0; index < values.size(); ++index) {
		const auto& value = values[index];
		exact(value, {"inputIndex", "nodeId", "sourceId", "storageKey", "mimeType", "contentSha256", "timing"});
		if (safe_integer(json::member(value, "inputIndex"), "source index") != static_cast<std::int64_t>(index)) {
			throw json::parse_error("Unified source indices must be dense.");
		}
		source_authority source;
		source.node_id = stable_id(json::member(value, "nodeId"), "source node ID");
		source.source_id = stable_id(json::member(value, "sourceId"), "source ID");
		source.storage_key = text(json::member(value, "storageKey"), "source storage key");
		source.mime_type = text(json::member(value, "mimeType"), "source MIME type");
		source.sha256 = digest(json::member(value, "contentSha256"), "source digest");
		const auto& timing = json::member(value, "timing");
		const auto kind = text(json::member(timing, "kind"), "source timing kind");
		if (kind == "cfr") {
			exact(timing, {"kind", "frameCount", "rate"});
			source.frame_count = safe_integer(json::member(timing, "frameCount"), "source frame count", 1);
			source.rate = rate(json::member(timing, "rate"), "source rate");
			source.cfr = true;
		} else if (kind == "vfr") {
			exact(timing, {"kind", "reference"});
			validate_timing_reference(json::member(timing, "reference"), source.sha256, source);
		} else throw json::parse_error("Unified source timing kind is unsupported.");
		if (!by_node.emplace(source.node_id, source).second || !source_ids.insert(source.source_id).second) {
			throw json::parse_error("Unified source identities are duplicated.");
		}
		result.source_sha256.push_back(source.sha256);
	}
	return by_node;
}

[[nodiscard]] inline bool exact_decimal_equals(
	const json::value& value,
	const std::pair<std::int64_t, std::int64_t>& expected,
	const std::string_view label
) {
	decimal_rational(value, label);
#if defined(FRAMESCAPER_HAS_EXACT_RETIME_MULTIPRECISION)
	using soundscaper::framescaper::cpp_int;
	using soundscaper::framescaper::exact_wire_rational;
	const auto actual = exact_wire_rational(
		cpp_int{std::string{json::string(json::member(value, "numerator"), label)}},
		cpp_int{std::string{json::string(json::member(value, "denominator"), label)}}
	);
	return soundscaper::framescaper::compare(
		actual,
		soundscaper::framescaper::ExactRational(expected.first, expected.second)
	) == 0;
#else
	return json::string(json::member(value, "numerator"), label) == std::to_string(expected.first)
		&& json::string(json::member(value, "denominator"), label) == std::to_string(expected.second);
#endif
}

[[nodiscard]] inline retime_map_authority validate_retime_map(
	const json::value& value,
	const clip_authority& clip
) {
	retime_map_authority result;
	if (value.kind == json::type::null_value) return result;
	result.present = true;
	exact(value, {"feature", "version", "points", "segments"});
	literal(json::member(value, "feature"), "video-retime", "retime feature");
	literal(json::member(value, "version"), 2, "retime version");
	const auto& points = json::array(json::member(value, "points"), "retime points");
	const auto& segments = json::array(json::member(value, "segments"), "retime segments");
	if (segments.empty() || segments.size() > 4'096 || points.size() != segments.size() + 1) {
		throw json::parse_error("A retime map has inconsistent point and segment counts.");
	}
	std::int64_t previous = -1;
	const auto source_start = std::pair{clip.source_in, std::int64_t{1}};
	const auto source_end = std::pair{clip.source_in + clip.source_count, std::int64_t{1}};
	for (const auto& point : points) {
		exact(point, {"outerFrame", "sourceFrame"});
		const auto outer = safe_integer(json::member(point, "outerFrame"), "retime outer frame");
		const auto source = rational(json::member(point, "sourceFrame"), "retime source position");
		if (outer <= previous || compare_rationals(source, source_start) < 0
			|| compare_rationals(source, source_end) > 0) {
			throw json::parse_error("Retime points escape their ordered clip/source authority.");
		}
		previous = outer;
		result.outer_frames.push_back(outer);
		result.source_frames.push_back(source);
	}
	if (result.outer_frames.front() != 0 || result.outer_frames.back() != clip.sequence_count) {
		throw json::parse_error("Retime endpoints do not bind the clip.");
	}
	std::vector<int> directions;
	std::vector<bool> start_zero;
	std::vector<bool> end_zero;
	for (std::size_t index = 0; index < segments.size(); ++index) {
		const auto& segment = segments[index];
		retime_segment_authority authority;
		authority.mode = text(json::member(segment, "mode"), "retime mode");
		const auto source_direction = compare_rationals(
			result.source_frames[index + 1], result.source_frames[index]
		);
		const bool ramp = authority.mode == "ramp-forward" || authority.mode == "ramp-reverse";
		int direction{};
		if (ramp) {
			exact(segment, {"mode", "startVelocity", "endVelocity"});
			authority.start_velocity = rational(json::member(segment, "startVelocity"), "retime start velocity");
			authority.end_velocity = rational(json::member(segment, "endVelocity"), "retime end velocity");
			authority.has_velocities = true;
			if (authority.start_velocity.first < 0 || authority.end_velocity.first < 0
				|| (authority.start_velocity.first == 0 && authority.end_velocity.first == 0)) {
				throw json::parse_error("Retime ramp velocities are outside their exact domain.");
			}
			direction = authority.mode == "ramp-forward" ? 1 : -1;
			if (source_direction != direction) throw json::parse_error("Retime ramp direction disagrees with its points.");
#if defined(FRAMESCAPER_HAS_EXACT_RETIME_MULTIPRECISION)
			using soundscaper::framescaper::ExactRational;
			const auto delta = ExactRational(
				result.source_frames[index + 1].first, result.source_frames[index + 1].second
			) - ExactRational(result.source_frames[index].first, result.source_frames[index].second);
			const auto magnitude = direction < 0 ? -delta : delta;
			const auto span = ExactRational(result.outer_frames[index + 1] - result.outer_frames[index]);
			const auto expected = span * (
				ExactRational(authority.start_velocity.first, authority.start_velocity.second)
				+ ExactRational(authority.end_velocity.first, authority.end_velocity.second)
			) / ExactRational(2);
			if (soundscaper::framescaper::compare(magnitude, expected) != 0) {
				throw json::parse_error("Retime ramp endpoints do not match their exact velocity integral.");
			}
#else
			throw json::parse_error("Retime ramps require the pinned exact arithmetic closure.");
#endif
		} else {
			exact(segment, {"mode"});
			if (authority.mode == "constant-forward") direction = 1;
			else if (authority.mode == "constant-reverse") direction = -1;
			else if (authority.mode != "freeze") throw json::parse_error("Retime mode is unsupported.");
			if (source_direction != direction) throw json::parse_error("Retime segment direction disagrees with its points.");
		}
		directions.push_back(direction);
		start_zero.push_back(direction == 0 || (ramp && authority.start_velocity.first == 0));
		end_zero.push_back(direction == 0 || (ramp && authority.end_velocity.first == 0));
		result.segments.push_back(std::move(authority));
	}
	for (std::size_t index = 1; index < directions.size(); ++index) {
		if (directions[index - 1] != 0 && directions[index] != 0
			&& directions[index - 1] != directions[index]
			&& (!end_zero[index - 1] || !start_zero[index])) {
			throw json::parse_error("A direct retime direction change requires zero incident velocities.");
		}
	}
	return result;
}

inline void validate_intent_row(
	const json::value& row,
	const std::size_t index,
	const temporal_authority& clock,
	const clip_authority& clip,
	const source_authority& source,
	bool& uses_curve,
	const retime_map_authority& retime_map
) {
	const auto mapping = text(json::member(row, "mapping"), "retime mapping");
	const auto mode_member = json::optional_member(row, "mode");
	const auto ramp = mode_member != nullptr && (json::string(*mode_member, "retime mode") == "ramp-forward"
		|| json::string(*mode_member, "retime mode") == "ramp-reverse");
	if (mapping == "uniform-wall-clock") {
		if (retime_map.present) throw json::parse_error("A wall-clock intent row cannot claim a retime map.");
		exact(row, {"index", "topologyIntervalIndex", "layerIndex", "clipIndex", "clipId", "sourceId", "sequenceStartFrame", "outerFrameCount", "sourceInFrame", "sourceOutFrame", "startSample", "endSample", "startOutputFrame", "endOutputFrame", "mapping", "clipStartSample", "clipEndSample", "sourceStartTime", "sourceEndTime", "clippedSourceStartTime", "clippedSourceEndTime"});
		for (const auto key : {"sourceStartTime", "sourceEndTime", "clippedSourceStartTime", "clippedSourceEndTime"}) {
			static_cast<void>(decimal_rational(json::member(row, key), key));
		}
		if (safe_integer(json::member(row, "clipEndSample"), "clip end", 1)
			<= safe_integer(json::member(row, "clipStartSample"), "clip start")) {
			throw json::parse_error("A wall-clock retime clip range is empty.");
		}
	} else if (mapping == "curve") {
		if (!retime_map.present) throw json::parse_error("A curve intent row requires an authenticated retime map.");
		if (ramp) exact(row, {"index", "topologyIntervalIndex", "layerIndex", "clipIndex", "clipId", "sourceId", "sequenceStartFrame", "outerFrameCount", "sourceInFrame", "sourceOutFrame", "startSample", "endSample", "startOutputFrame", "endOutputFrame", "mapping", "segmentIndex", "mode", "segmentStartOuterCell", "segmentEndOuterCell", "sourceStart", "sourceEnd", "startVelocity", "endVelocity", "startOuterCell", "endOuterCell", "clippedSourceStart", "clippedSourceEnd", "drawableStartTime", "drawableEndTime"});
		else exact(row, {"index", "topologyIntervalIndex", "layerIndex", "clipIndex", "clipId", "sourceId", "sequenceStartFrame", "outerFrameCount", "sourceInFrame", "sourceOutFrame", "startSample", "endSample", "startOutputFrame", "endOutputFrame", "mapping", "segmentIndex", "mode", "segmentStartOuterCell", "segmentEndOuterCell", "sourceStart", "sourceEnd", "startOuterCell", "endOuterCell", "clippedSourceStart", "clippedSourceEnd", "drawableStartTime", "drawableEndTime"});
		const auto mode = text(json::member(row, "mode"), "retime mode");
		if (mode != "constant-forward" && mode != "constant-reverse" && mode != "freeze"
			&& mode != "ramp-forward" && mode != "ramp-reverse") throw json::parse_error("Retime curve mode is unsupported.");
		for (const auto key : {"sourceStart", "sourceEnd", "clippedSourceStart", "clippedSourceEnd", "drawableStartTime", "drawableEndTime"}) {
			static_cast<void>(decimal_rational(json::member(row, key), key));
		}
		if (ramp) for (const auto key : {"startVelocity", "endVelocity"}) {
			static_cast<void>(decimal_rational(json::member(row, key), key));
		}
		const auto segment_start = safe_integer(json::member(row, "segmentStartOuterCell"), "segment start");
		const auto segment_end = safe_integer(json::member(row, "segmentEndOuterCell"), "segment end", 1);
		const auto clipped_start = safe_integer(json::member(row, "startOuterCell"), "clipped outer start");
		const auto clipped_end = safe_integer(json::member(row, "endOuterCell"), "clipped outer end", 1);
		if (segment_end <= segment_start || clipped_start < segment_start || clipped_end > segment_end
			|| clipped_end <= clipped_start) throw json::parse_error("Retime curve cell bounds are invalid.");
		const auto segment_index = safe_integer(json::member(row, "segmentIndex"), "retime segment index");
		if (static_cast<std::size_t>(segment_index) >= retime_map.segments.size()
			|| mode != retime_map.segments[segment_index].mode
			|| segment_start != retime_map.outer_frames[segment_index]
			|| segment_end != retime_map.outer_frames[segment_index + 1]
			|| !exact_decimal_equals(json::member(row, "sourceStart"), retime_map.source_frames[segment_index], "intent source start")
			|| !exact_decimal_equals(json::member(row, "sourceEnd"), retime_map.source_frames[segment_index + 1], "intent source end")) {
			throw json::parse_error("A curve intent row does not bind its authenticated retime segment.");
		}
		const auto& segment = retime_map.segments[segment_index];
		if (segment.has_velocities && (
			!exact_decimal_equals(json::member(row, "startVelocity"), segment.start_velocity, "intent start velocity")
			|| !exact_decimal_equals(json::member(row, "endVelocity"), segment.end_velocity, "intent end velocity")
		)) throw json::parse_error("A curve intent row does not bind its ramp velocities.");
		uses_curve = true;
	} else throw json::parse_error("Retime mapping is unsupported.");
	if (safe_integer(json::member(row, "index"), "intersection index") != static_cast<std::int64_t>(index)
		|| text(json::member(row, "clipId"), "intersection clip ID") != clip.clip_id
		|| text(json::member(row, "sourceId"), "intersection source ID") != source.source_id
		|| safe_integer(json::member(row, "sequenceStartFrame"), "intersection sequence start") != clip.sequence_start
		|| safe_integer(json::member(row, "outerFrameCount"), "intersection outer count", 1) != clip.sequence_count
		|| safe_integer(json::member(row, "sourceInFrame"), "intersection source in") != clip.source_in
		|| safe_integer(json::member(row, "sourceOutFrame"), "intersection source out", 1) != clip.source_in + clip.source_count) {
		throw json::parse_error("A retime intersection escapes its clip/source authority.");
	}
	for (const auto key : {"topologyIntervalIndex", "layerIndex", "clipIndex"}) {
		static_cast<void>(safe_integer(json::member(row, key), key));
	}
	const auto start_sample = safe_integer(json::member(row, "startSample"), "intersection start sample");
	const auto end_sample = safe_integer(json::member(row, "endSample"), "intersection end sample", 1);
	const auto start_frame = safe_integer(json::member(row, "startOutputFrame"), "intersection start frame");
	const auto end_frame = safe_integer(json::member(row, "endOutputFrame"), "intersection end frame", 1);
	if (end_sample <= start_sample || end_frame <= start_frame || end_frame > clock.output_count) {
		throw json::parse_error("A retime intersection output range is invalid.");
	}
}

inline void validate_clip_mapping(
	const json::value& value,
	const temporal_authority& clock,
	clip_authority& clip,
	const source_authority& source
) {
	exact(value, {"kind", "sourceRate", "retimeMap", "intent"});
	literal(json::member(value, "kind"), "video-retime-export-intent-v6", "source-time mapping kind");
	if (!source.cfr) {
		throw json::parse_error("Unified VFR retime admission requires verified timing asset bytes.");
	}
	clip.source_rate = rate(json::member(value, "sourceRate"), "clip source rate");
	if (source.cfr && clip.source_rate != source.rate) {
		throw json::parse_error("A clip source rate disagrees with its exact CFR source authority.");
	}
	clip.retime_map = validate_retime_map(json::member(value, "retimeMap"), clip);
	const auto& intent = json::member(value, "intent");
	exact(intent, {"kind", "version", "sampleStart", "sampleDuration", "sampleRate", "sequenceBinding", "outputRate", "outputFrameCount", "intersections", "limits"});
	literal(json::member(intent, "kind"), "video-retime-export-intent", "retime intent kind");
	literal(json::member(intent, "version"), 6, "retime intent version");
	const auto& binding = json::member(intent, "sequenceBinding");
	exact(binding, {"id", "rate"});
	if (safe_integer(json::member(intent, "sampleStart"), "intent sample start") != clock.sample_start
		|| safe_integer(json::member(intent, "sampleDuration"), "intent sample duration", 1) != clock.sample_duration
		|| safe_integer(json::member(intent, "sampleRate"), "intent sample rate", 1) != clock.sample_rate
		|| text(json::member(binding, "id"), "intent sequence ID") != clock.sequence_id
		|| rate(json::member(binding, "rate"), "intent sequence rate") != clock.sequence_rate
		|| rate(json::member(intent, "outputRate"), "intent output rate") != clock.output_rate
		|| safe_integer(json::member(intent, "outputFrameCount"), "intent output count", 1) != clock.output_count) {
		throw json::parse_error("A retime intent disagrees with the plan time authority.");
	}
	const auto& rows = json::array(json::member(intent, "intersections"), "retime intersections");
	if (rows.empty() || rows.size() > 16'384) throw json::parse_error("A clip requires a bounded nonempty retime intersection list.");
	for (std::size_t index = 0; index < rows.size(); ++index) {
		validate_intent_row(rows[index], index, clock, clip, source, clip.uses_curve, clip.retime_map);
	}
	if (clip.uses_curve != clip.retime_map.present) {
		throw json::parse_error("A clip retime intent disagrees with its authenticated map authority.");
	}
	const auto& limits = json::member(intent, "limits");
	exact(limits, {"topologyRecordCount", "compiledSegmentCount", "geometricCandidateCount", "serializedIntersectionCount", "decimalByteCount"});
	for (const auto key : {"topologyRecordCount", "compiledSegmentCount", "geometricCandidateCount", "decimalByteCount"}) {
		static_cast<void>(safe_integer(json::member(limits, key), key));
	}
	if (safe_integer(json::member(limits, "serializedIntersectionCount"), "serialized intersection count")
		!= static_cast<std::int64_t>(rows.size())) throw json::parse_error("Retime intersection count is inconsistent.");
	validate_exact_intent_authority(intent, clock, clip, source);
}

[[nodiscard]] inline clip_authority validate_clip(
	const json::value& node,
	const temporal_authority& clock,
	const source_index& sources,
	const track_index& tracks
) {
	exact(node, {"kind", "nodeId", "clipId", "trackId", "sourceNodeId", "sequenceStartFrame", "sequenceFrameCount", "sourceInFrame", "sourceFrameCount", "pictureState", "sourceTimeMapping"});
	clip_authority clip;
	clip.node_id = stable_id(json::member(node, "nodeId"), "clip node ID");
	clip.clip_id = stable_id(json::member(node, "clipId"), "clip ID");
	clip.track_id = stable_id(json::member(node, "trackId"), "clip track ID");
	clip.source_node_id = stable_id(json::member(node, "sourceNodeId"), "clip source node ID");
	clip.sequence_start = safe_integer(json::member(node, "sequenceStartFrame"), "clip sequence start");
	clip.sequence_count = safe_integer(json::member(node, "sequenceFrameCount"), "clip sequence count", 1);
	clip.source_in = safe_integer(json::member(node, "sourceInFrame"), "clip source in");
	clip.source_count = safe_integer(json::member(node, "sourceFrameCount"), "clip source count", 1);
	if (!tracks.contains(clip.track_id)) throw json::parse_error("A clip references an unknown video track.");
	const auto& picture_state = json::member(node, "pictureState");
	const auto effects = validate_picture_state(picture_state, clip.sequence_count);
	validate_picture_crop_keyframe_closure(picture_state);
	for (const auto& [effect_id, parameters] : effects) {
		static_cast<void>(parameters);
		clip.effect_ids.push_back(effect_id);
	}
	const auto found = sources.find(clip.source_node_id);
	if (found == sources.end() || clip.source_in > maximum_safe_integer - clip.source_count
		|| clip.source_in + clip.source_count > found->second.frame_count
		|| clip.sequence_start > maximum_safe_integer - clip.sequence_count) {
		throw json::parse_error("A clip escapes its exact source or sequence authority.");
	}
	validate_clip_mapping(json::member(node, "sourceTimeMapping"), clock, clip, found->second);
	return clip;
}

struct transition_order final {
	std::int64_t overlap_start{};
	std::string outgoing;
	std::string incoming;
	std::string id;
	std::string track;
	[[nodiscard]] auto tuple() const { return std::tie(overlap_start, outgoing, incoming, id); }
};

inline transition_order validate_transition(
	const json::value& node,
	const temporal_authority& clock,
	const clip_index& clips,
	const source_index& sources
) {
	exact(node, {"kind", "nodeId", "transition", "edges"});
	const auto& transition = json::member(node, "transition");
	exact(transition, {"schemaVersion", "id", "type", "outgoingClipId", "incomingClipId", "alignment", "durationFrames", "curve"});
	literal(json::member(transition, "schemaVersion"), 1, "transition schema");
	literal(json::member(transition, "type"), "dissolve", "transition type");
	const auto id = stable_id(json::member(transition, "id"), "transition ID");
	const auto outgoing_id = stable_id(json::member(transition, "outgoingClipId"), "outgoing clip ID");
	const auto incoming_id = stable_id(json::member(transition, "incomingClipId"), "incoming clip ID");
	if (outgoing_id == incoming_id) throw json::parse_error("A transition requires distinct clips.");
	const auto alignment = text(json::member(transition, "alignment"), "transition alignment");
	if (alignment != "start-at-cut" && alignment != "center-on-cut" && alignment != "end-at-cut") {
		throw json::parse_error("Transition alignment is unsupported.");
	}
	const auto duration = safe_integer(json::member(transition, "durationFrames"), "transition duration", 1);
	if (duration > 2'000'000) throw json::parse_error("Transition duration exceeds 2,000,000 frames.");
	const auto& curve = json::member(transition, "curve");
	exact(curve, {"anchors", "segments"});
	const auto& anchors = json::array(json::member(curve, "anchors"), "transition anchors");
	const auto& segments = json::array(json::member(curve, "segments"), "transition segments");
	if (anchors.size() < 2 || anchors.size() > 4'096 || anchors.size() != segments.size() + 1) {
		throw json::parse_error("Transition curve shape is invalid.");
	}
	std::vector<std::pair<std::int64_t, std::int64_t>> anchor_positions;
	std::vector<double> anchor_values;
	for (const auto& anchor : anchors) {
		exact(anchor, {"position", "value"});
		const auto position = rational(json::member(anchor, "position"), "transition anchor position");
		if (!anchor_positions.empty() && compare_rationals(anchor_positions.back(), position) >= 0) {
			throw json::parse_error("Transition anchors are not in strict canonical order.");
		}
		anchor_positions.push_back(position);
		anchor_values.push_back(bounded_number(json::member(anchor, "value"), "transition anchor value", 0, 1));
	}
	if (anchor_positions.front() != std::pair<std::int64_t, std::int64_t>{0, 1}
		|| anchor_values.front() != 0
		|| anchor_positions.back() != std::pair<std::int64_t, std::int64_t>{duration, 1}
		|| anchor_values.back() != 1) {
		throw json::parse_error("Transition curve endpoints do not bind exact duration and unit weight.");
	}
	for (std::size_t index = 0; index < segments.size(); ++index) {
		const auto& segment = segments[index];
		const auto kind = text(json::member(segment, "kind"), "transition segment kind");
		if (kind == "bezier") {
			exact(segment, {"kind", "control1", "control2"});
			std::vector<std::pair<std::int64_t, std::int64_t>> controls;
			for (const auto key : {"control1", "control2"}) {
				const auto& control = json::member(segment, key);
				exact(control, {"position", "value"});
				controls.push_back(rational(json::member(control, "position"), "transition control position"));
				static_cast<void>(bounded_number(json::member(control, "value"), "transition control value", 0, 1));
			}
			if (compare_rationals(anchor_positions[index], controls[0]) > 0
				|| compare_rationals(controls[0], controls[1]) > 0
				|| compare_rationals(controls[1], anchor_positions[index + 1]) > 0) {
				throw json::parse_error("Transition Bezier controls escape their owning segment span.");
			}
		} else {
			exact(segment, {"kind"});
			if (kind != "hold" && kind != "linear" && kind != "eased") throw json::parse_error("Transition curve segment is unsupported.");
		}
	}
	const auto& edges = json::member(node, "edges");
	exact(edges, {"schemaVersion", "sequenceId", "trackId", "outgoing", "incoming"});
	literal(json::member(edges, "schemaVersion"), 1, "transition edge schema");
	if (text(json::member(edges, "sequenceId"), "transition sequence ID") != clock.sequence_id) {
		throw json::parse_error("Transition edges reference the wrong sequence.");
	}
	const auto track = stable_id(json::member(edges, "trackId"), "transition track ID");
	const auto validate_edge = [&](const std::string_view key, const std::string& expected_id) -> const clip_authority& {
		const auto& edge = json::member(edges, key);
		exact(edge, {"clipId", "sourceId", "sequenceStartFrame", "sequenceFrameCount", "sequenceRate", "sourceInFrame", "sourceFrameCount", "sourceRate", "retimeMap"});
		const auto found = clips.find(stable_id(json::member(edge, "clipId"), "transition edge clip ID"));
		if (found == clips.end() || found->first != expected_id || found->second.track_id != track) {
			throw json::parse_error("Transition edge references an unknown clip or track.");
		}
		const auto source = sources.find(found->second.source_node_id);
		if (source == sources.end() || text(json::member(edge, "sourceId"), "transition edge source ID") != source->second.source_id
			|| safe_integer(json::member(edge, "sequenceStartFrame"), "edge sequence start") != found->second.sequence_start
			|| safe_integer(json::member(edge, "sequenceFrameCount"), "edge sequence count", 1) != found->second.sequence_count
			|| rate(json::member(edge, "sequenceRate"), "edge sequence rate") != clock.sequence_rate
			|| safe_integer(json::member(edge, "sourceInFrame"), "edge source in") != found->second.source_in
			|| safe_integer(json::member(edge, "sourceFrameCount"), "edge source count", 1) != found->second.source_count) {
			throw json::parse_error("Transition edge disagrees with exact clip/source authority.");
		}
		if (rate(json::member(edge, "sourceRate"), "edge source rate") != found->second.source_rate
			|| validate_retime_map(json::member(edge, "retimeMap"), found->second)
				!= found->second.retime_map) {
			throw json::parse_error("Transition edge mapping disagrees with exact clip authority.");
		}
		return found->second;
	};
	const auto& outgoing = validate_edge("outgoing", outgoing_id);
	const auto& incoming = validate_edge("incoming", incoming_id);
	const auto overlap_start = incoming.sequence_start;
	const auto overlap_end = outgoing.sequence_start + outgoing.sequence_count;
	if (!(outgoing.sequence_start < overlap_start && overlap_start < overlap_end
		&& overlap_end < incoming.sequence_start + incoming.sequence_count)
		|| overlap_end - overlap_start != duration) throw json::parse_error("Transition proper-overlap geometry is inconsistent.");
	return {overlap_start, outgoing_id, incoming_id, id, track};
}

} // namespace framescaper::media::unified
