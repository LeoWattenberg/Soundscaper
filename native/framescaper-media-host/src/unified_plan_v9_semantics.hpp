/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "media_plan.hpp"
#include "unified_plan_common.hpp"

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
	std::string sha256;
	std::int64_t frame_count{};
	std::pair<std::int64_t, std::int64_t> rate{};
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
	bool uses_curve{};
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
	if (duration.empty() || duration.front() < '1' || duration.front() > '9'
		|| duration.size() > 19 || !std::all_of(duration.begin() + 1, duration.end(), [](const unsigned char byte) {
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
		source.node_id = text(json::member(value, "nodeId"), "source node ID");
		source.source_id = text(json::member(value, "sourceId"), "source ID");
		source.storage_key = text(json::member(value, "storageKey"), "source storage key");
		static_cast<void>(text(json::member(value, "mimeType"), "source MIME type"));
		source.sha256 = digest(json::member(value, "contentSha256"), "source digest");
		const auto& timing = json::member(value, "timing");
		const auto kind = text(json::member(timing, "kind"), "source timing kind");
		if (kind == "cfr") {
			exact(timing, {"kind", "frameCount", "rate"});
			source.frame_count = safe_integer(json::member(timing, "frameCount"), "source frame count", 1);
			source.rate = rate(json::member(timing, "rate"), "source rate");
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

inline void validate_intent_row(
	const json::value& row,
	const std::size_t index,
	const temporal_authority& clock,
	const clip_authority& clip,
	const source_authority& source,
	bool& uses_curve
) {
	const auto mapping = text(json::member(row, "mapping"), "retime mapping");
	const auto mode_member = json::optional_member(row, "mode");
	const auto ramp = mode_member != nullptr && (json::string(*mode_member, "retime mode") == "ramp-forward"
		|| json::string(*mode_member, "retime mode") == "ramp-reverse");
	if (mapping == "uniform-wall-clock") {
		exact(row, {"index", "topologyIntervalIndex", "layerIndex", "clipIndex", "clipId", "sourceId", "sequenceStartFrame", "outerFrameCount", "sourceInFrame", "sourceOutFrame", "startSample", "endSample", "startOutputFrame", "endOutputFrame", "mapping", "clipStartSample", "clipEndSample", "sourceStartTime", "sourceEndTime", "clippedSourceStartTime", "clippedSourceEndTime"});
		for (const auto key : {"sourceStartTime", "sourceEndTime", "clippedSourceStartTime", "clippedSourceEndTime"}) {
			static_cast<void>(decimal_rational(json::member(row, key), key));
		}
		if (safe_integer(json::member(row, "clipEndSample"), "clip end", 1)
			<= safe_integer(json::member(row, "clipStartSample"), "clip start")) {
			throw json::parse_error("A wall-clock retime clip range is empty.");
		}
	} else if (mapping == "curve") {
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
	exact(value, {"kind", "intent"});
	literal(json::member(value, "kind"), "video-retime-export-intent-v6", "source-time mapping kind");
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
		validate_intent_row(rows[index], index, clock, clip, source, clip.uses_curve);
	}
	const auto& limits = json::member(intent, "limits");
	exact(limits, {"topologyRecordCount", "compiledSegmentCount", "geometricCandidateCount", "serializedIntersectionCount", "decimalByteCount"});
	for (const auto key : {"topologyRecordCount", "compiledSegmentCount", "geometricCandidateCount", "decimalByteCount"}) {
		static_cast<void>(safe_integer(json::member(limits, key), key));
	}
	if (safe_integer(json::member(limits, "serializedIntersectionCount"), "serialized intersection count")
		!= static_cast<std::int64_t>(rows.size())) throw json::parse_error("Retime intersection count is inconsistent.");
}

[[nodiscard]] inline clip_authority validate_clip(
	const json::value& node,
	const temporal_authority& clock,
	const source_index& sources
) {
	exact(node, {"kind", "nodeId", "clipId", "trackId", "sourceNodeId", "sequenceStartFrame", "sequenceFrameCount", "sourceInFrame", "sourceFrameCount", "sourceTimeMapping"});
	clip_authority clip;
	clip.node_id = text(json::member(node, "nodeId"), "clip node ID");
	clip.clip_id = text(json::member(node, "clipId"), "clip ID");
	clip.track_id = text(json::member(node, "trackId"), "clip track ID");
	clip.source_node_id = text(json::member(node, "sourceNodeId"), "clip source node ID");
	clip.sequence_start = safe_integer(json::member(node, "sequenceStartFrame"), "clip sequence start");
	clip.sequence_count = safe_integer(json::member(node, "sequenceFrameCount"), "clip sequence count", 1);
	clip.source_in = safe_integer(json::member(node, "sourceInFrame"), "clip source in");
	clip.source_count = safe_integer(json::member(node, "sourceFrameCount"), "clip source count", 1);
	const auto found = sources.find(clip.source_node_id);
	if (found == sources.end() || clip.source_in > maximum_safe_integer - clip.source_count
		|| clip.source_in + clip.source_count > found->second.frame_count
		|| clip.sequence_start > maximum_safe_integer - clip.sequence_count) {
		throw json::parse_error("A clip escapes its exact source or sequence authority.");
	}
	validate_clip_mapping(json::member(node, "sourceTimeMapping"), clock, clip, found->second);
	return clip;
}

inline void validate_retime_map(const json::value& value, const clip_authority& clip) {
	if (value.kind == json::type::null_value) return;
	exact(value, {"feature", "version", "points", "segments"});
	literal(json::member(value, "feature"), "video-retime", "transition retime feature");
	literal(json::member(value, "version"), 2, "transition retime version");
	const auto& points = json::array(json::member(value, "points"), "transition retime points");
	const auto& segments = json::array(json::member(value, "segments"), "transition retime segments");
	if (segments.empty() || segments.size() > 4'096 || points.size() != segments.size() + 1) {
		throw json::parse_error("A transition retime map has inconsistent point and segment counts.");
	}
	std::int64_t previous = -1;
	for (const auto& point : points) {
		exact(point, {"outerFrame", "sourceFrame"});
		const auto outer = safe_integer(json::member(point, "outerFrame"), "transition retime outer frame");
		static_cast<void>(rational(json::member(point, "sourceFrame"), "transition retime source position"));
		if (outer <= previous) throw json::parse_error("Transition retime points are not strictly ordered.");
		previous = outer;
	}
	if (safe_integer(json::member(points.front(), "outerFrame"), "first retime outer frame") != 0
		|| safe_integer(json::member(points.back(), "outerFrame"), "last retime outer frame") != clip.sequence_count) {
		throw json::parse_error("Transition retime endpoints do not bind the clip.");
	}
	for (const auto& segment : segments) {
		const auto mode = text(json::member(segment, "mode"), "transition retime mode");
		const auto ramp = mode == "ramp-forward" || mode == "ramp-reverse";
		if (ramp) {
			exact(segment, {"mode", "startVelocity", "endVelocity"});
			const auto start = rational(json::member(segment, "startVelocity"), "retime start velocity");
			const auto end = rational(json::member(segment, "endVelocity"), "retime end velocity");
			if (start.first < 0 || end.first < 0) throw json::parse_error("Retime velocities cannot be negative.");
		} else {
			exact(segment, {"mode"});
			if (mode != "constant-forward" && mode != "constant-reverse" && mode != "freeze") {
				throw json::parse_error("Transition retime mode is unsupported.");
			}
		}
	}
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
	const auto id = text(json::member(transition, "id"), "transition ID");
	const auto outgoing_id = text(json::member(transition, "outgoingClipId"), "outgoing clip ID");
	const auto incoming_id = text(json::member(transition, "incomingClipId"), "incoming clip ID");
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
	for (const auto& anchor : anchors) {
		exact(anchor, {"position", "value"});
		static_cast<void>(rational(json::member(anchor, "position"), "transition anchor position"));
		finite_number(json::member(anchor, "value"), "transition anchor value");
	}
	for (const auto& segment : segments) {
		const auto kind = text(json::member(segment, "kind"), "transition segment kind");
		if (kind == "bezier") {
			exact(segment, {"kind", "control1", "control2"});
			for (const auto key : {"control1", "control2"}) {
				const auto& control = json::member(segment, key);
				exact(control, {"position", "value"});
				static_cast<void>(rational(json::member(control, "position"), "transition control position"));
				finite_number(json::member(control, "value"), "transition control value");
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
	const auto track = text(json::member(edges, "trackId"), "transition track ID");
	const auto validate_edge = [&](const std::string_view key, const std::string& expected_id) -> const clip_authority& {
		const auto& edge = json::member(edges, key);
		exact(edge, {"clipId", "sourceId", "sequenceStartFrame", "sequenceFrameCount", "sequenceRate", "sourceInFrame", "sourceFrameCount", "sourceRate", "retimeMap"});
		const auto found = clips.find(text(json::member(edge, "clipId"), "transition edge clip ID"));
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
		static_cast<void>(rate(json::member(edge, "sourceRate"), "edge source rate"));
		validate_retime_map(json::member(edge, "retimeMap"), found->second);
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
