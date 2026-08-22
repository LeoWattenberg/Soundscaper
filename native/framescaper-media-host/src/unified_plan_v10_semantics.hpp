/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "unified_plan_v9_semantics.hpp"

#include <array>
#include <map>
#include <set>
#include <string>

namespace framescaper::media::unified {

using freshness_identity = std::array<std::string, 4>;

[[nodiscard]] inline freshness_identity validate_freshness(const json::value& value) {
	exact(value, {"authoredStateSha256", "inputIdentitiesSha256", "renderPlanFingerprintSha256", "nativeEffectFingerprintSha256"});
	return {
		digest(json::member(value, "authoredStateSha256"), "authored-state digest"),
		digest(json::member(value, "inputIdentitiesSha256"), "input-identities digest"),
		digest(json::member(value, "renderPlanFingerprintSha256"), "render-plan digest"),
		digest(json::member(value, "nativeEffectFingerprintSha256"), "native-effect digest"),
	};
}

inline void validate_string_array(
	const json::value& value,
	const std::string_view label,
	const std::size_t maximum,
	const std::size_t minimum = 0
) {
	const auto& values = json::array(value, label);
	if (values.size() < minimum || values.size() > maximum) {
		throw json::parse_error(std::string{label} + " exceeds its collection bounds.");
	}
	std::string previous;
	for (const auto& item : values) {
		const auto current = text(item, label);
		if (!previous.empty() && current <= previous) throw json::parse_error(std::string{label} + " is not unique canonical order.");
		previous = current;
	}
}

inline void validate_generator_document(const json::value& value) {
	const auto kind = text(json::member(value, "kind"), "generator kind");
	if (kind == "title" || kind == "text") {
		exact(value, {"kind", "text", "fontFamily", "fontSize", "color", "horizontalAlign", "verticalAlign"});
		static_cast<void>(text(json::member(value, "text"), "generator text"));
		static_cast<void>(text(json::member(value, "fontFamily"), "generator font"));
		finite_number(json::member(value, "fontSize"), "generator font size");
		static_cast<void>(text(json::member(value, "color"), "generator color"));
		static_cast<void>(text(json::member(value, "horizontalAlign"), "generator horizontal alignment"));
		static_cast<void>(text(json::member(value, "verticalAlign"), "generator vertical alignment"));
	} else if (kind == "shape") {
		exact(value, {"kind", "shape", "fillColor", "strokeColor", "strokeWidth"});
		static_cast<void>(text(json::member(value, "shape"), "generator shape"));
		for (const auto key : {"fillColor", "strokeColor"}) {
			const auto& color = json::member(value, key);
			if (color.kind != json::type::null_value) static_cast<void>(text(color, key));
		}
		finite_number(json::member(value, "strokeWidth"), "generator stroke width");
	} else if (kind == "solid") {
		exact(value, {"kind", "color"});
		static_cast<void>(text(json::member(value, "color"), "generator color"));
	} else if (kind == "external-generator") {
		exact(value, {"kind", "bindingId", "inputs"});
		static_cast<void>(text(json::member(value, "bindingId"), "generator binding ID"));
		const auto& inputs = json::array(json::member(value, "inputs"), "generator inputs");
		if (inputs.size() > 64) throw json::parse_error("External generator input ceiling is exceeded.");
		std::string previous;
		for (const auto& input : inputs) {
			exact(input, {"name", "sourceRef"});
			const auto name = text(json::member(input, "name"), "generator input name");
			if (!previous.empty() && name <= previous) throw json::parse_error("External generator inputs are not canonical order.");
			previous = name;
			static_cast<void>(text(json::member(input, "sourceRef"), "generator input source"));
		}
	} else throw json::parse_error("Visual generator kind is unsupported.");
}

inline void validate_source_clip_authored(
	const json::value& value,
	const std::string& model_kind,
	const std::string& model_id,
	const std::string& sequence_id
) {
	exact(value, {"source", "clip"});
	const auto& source = json::member(value, "source");
	const auto& clip = json::member(value, "clip");
	if (model_kind == "still") {
		exact(source, {"schemaVersion", "kind", "id", "name", "mimeType", "storageKey", "contentSha256", "width", "height", "hasAlpha"});
		exact(clip, {"schemaVersion", "kind", "id", "sourceId", "sequenceId", "sequenceStartFrame", "sequenceFrameCount"});
		literal(json::member(source, "kind"), "still", "still source kind");
		literal(json::member(clip, "kind"), "still", "still clip kind");
		static_cast<void>(text(json::member(source, "mimeType"), "still MIME type"));
		static_cast<void>(text(json::member(source, "storageKey"), "still storage key"));
		static_cast<void>(digest(json::member(source, "contentSha256"), "still digest"));
		static_cast<void>(json::boolean(json::member(source, "hasAlpha"), "still alpha"));
	} else {
		exact(source, {"schemaVersion", "kind", "id", "name", "width", "height", "frameRate", "frameCount", "generator"});
		exact(clip, {"schemaVersion", "kind", "id", "sourceId", "sequenceId", "sequenceStartFrame", "sequenceFrameCount", "sourceInFrame", "sourceFrameCount"});
		literal(json::member(source, "kind"), "generator", "generator source kind");
		literal(json::member(clip, "kind"), "generator", "generator clip kind");
		static_cast<void>(rate(json::member(source, "frameRate"), "generator frame rate"));
		validate_generator_document(json::member(source, "generator"));
		const auto frame_count = safe_integer(json::member(source, "frameCount"), "generator frame count", 1);
		const auto source_in = safe_integer(json::member(clip, "sourceInFrame"), "generator source in");
		const auto source_count = safe_integer(json::member(clip, "sourceFrameCount"), "generator source count", 1);
		if (source_in > maximum_safe_integer - source_count || source_in + source_count > frame_count) {
			throw json::parse_error("Generator clip escapes its source range.");
		}
	}
	literal(json::member(source, "schemaVersion"), 1, "visual source schema");
	literal(json::member(clip, "schemaVersion"), 1, "visual clip schema");
	if (text(json::member(source, "id"), "visual source ID") != model_id
		|| text(json::member(clip, "sourceId"), "visual clip source ID") != model_id
		|| text(json::member(clip, "sequenceId"), "visual clip sequence ID") != sequence_id) {
		throw json::parse_error("Visual source/clip identities are inconsistent.");
	}
	static_cast<void>(text(json::member(source, "name"), "visual source name"));
	for (const auto key : {"width", "height"}) {
		const auto dimension = safe_integer(json::member(source, key), key, 1);
		if (dimension > 65'536) throw json::parse_error("Visual source dimension exceeds its ceiling.");
	}
	static_cast<void>(text(json::member(clip, "id"), "visual clip ID"));
	static_cast<void>(safe_integer(json::member(clip, "sequenceStartFrame"), "visual clip start"));
	if (safe_integer(json::member(clip, "sequenceFrameCount"), "visual clip count", 1) > 2'000'000) {
		throw json::parse_error("Visual clip exceeds its frame ceiling.");
	}
}

inline void validate_coordinate(const json::value& value) {
	exact(value, {"x", "y"});
	finite_number(json::member(value, "x"), "mask x coordinate");
	finite_number(json::member(value, "y"), "mask y coordinate");
}

inline void validate_mask_graph(const json::value& value, const std::string& model_id) {
	exact(value, {"schemaVersion", "id", "kind", "inputs", "nodes", "outputNodeId"});
	literal(json::member(value, "schemaVersion"), 1, "mask graph schema");
	if (text(json::member(value, "id"), "mask graph ID") != model_id) throw json::parse_error("Mask graph identity is inconsistent.");
	const auto graph_kind = text(json::member(value, "kind"), "mask graph kind");
	if (graph_kind != "mask" && graph_kind != "matte") throw json::parse_error("Mask graph kind is unsupported.");
	const auto& inputs = json::array(json::member(value, "inputs"), "mask graph inputs");
	if (inputs.size() > 256) throw json::parse_error("Mask input ceiling is exceeded.");
	std::set<std::string> input_names;
	std::string previous_input;
	for (const auto& input : inputs) {
		exact(input, {"name", "sourceRef", "kind"});
		const auto name = text(json::member(input, "name"), "mask input name");
		if (!previous_input.empty() && name <= previous_input) throw json::parse_error("Mask inputs are not canonical order.");
		previous_input = name;
		input_names.insert(name);
		static_cast<void>(text(json::member(input, "sourceRef"), "mask input source"));
		const auto kind = text(json::member(input, "kind"), "mask input kind");
		if (kind != "raster" && kind != "alpha") throw json::parse_error("Mask input kind is unsupported.");
	}
	const auto& nodes = json::array(json::member(value, "nodes"), "mask graph nodes");
	if (nodes.empty() || nodes.size() > 4'096) throw json::parse_error("Mask node count is outside its bounds.");
	std::map<std::string, std::vector<std::string>> dependencies;
	std::size_t point_count = 0;
	std::string previous_node;
	for (const auto& node : nodes) {
		const auto id = text(json::member(node, "id"), "mask node ID");
		if (!previous_node.empty() && id <= previous_node) throw json::parse_error("Mask nodes are not unique canonical order.");
		previous_node = id;
		const auto kind = text(json::member(node, "kind"), "mask node kind");
		std::vector<std::string> refs;
		if (kind == "vector-shape") {
			exact(node, {"id", "kind", "shape", "x", "y", "width", "height"});
			static_cast<void>(text(json::member(node, "shape"), "mask shape"));
			for (const auto key : {"x", "y", "width", "height"}) finite_number(json::member(node, key), key);
		} else if (kind == "vector-path") {
			exact(node, {"id", "kind", "fillRule", "paths"});
			static_cast<void>(text(json::member(node, "fillRule"), "mask fill rule"));
			const auto& paths = json::array(json::member(node, "paths"), "mask paths");
			if (paths.empty() || paths.size() > 4'096) throw json::parse_error("Mask path count is outside its bounds.");
			std::set<std::string> path_ids;
			for (const auto& path : paths) {
				exact(path, {"id", "closed", "points"});
				unique(path_ids, text(json::member(path, "id"), "mask path ID"), "mask path ID");
				const auto closed = json::boolean(json::member(path, "closed"), "mask path closed");
				const auto& points = json::array(json::member(path, "points"), "mask path points");
				if (points.size() < (closed ? 3U : 2U)) throw json::parse_error("A mask path has too few points.");
				point_count += points.size();
				if (point_count > 16'384) throw json::parse_error("Mask path point ceiling is exceeded.");
				for (const auto& point : points) {
					exact(point, {"position", "inHandle", "outHandle"});
					validate_coordinate(json::member(point, "position"));
					for (const auto key : {"inHandle", "outHandle"}) {
						const auto& handle = json::member(point, key);
						if (handle.kind != json::type::null_value) validate_coordinate(handle);
					}
				}
			}
		} else if (kind == "raster") {
			exact(node, {"id", "kind", "inputName", "channel"});
			if (!input_names.contains(text(json::member(node, "inputName"), "raster input name"))) throw json::parse_error("Raster mask input is missing.");
			static_cast<void>(text(json::member(node, "channel"), "raster channel"));
		} else if (kind == "alpha") {
			exact(node, {"id", "kind", "inputName"});
			if (!input_names.contains(text(json::member(node, "inputName"), "alpha input name"))) throw json::parse_error("Alpha mask input is missing.");
		} else if (kind == "feather" || kind == "invert") {
			if (kind == "feather") {
				exact(node, {"id", "kind", "inputNodeId", "radius"});
				finite_number(json::member(node, "radius"), "mask feather radius");
			} else exact(node, {"id", "kind", "inputNodeId"});
			refs.push_back(text(json::member(node, "inputNodeId"), "mask input node ID"));
		} else if (kind == "boolean") {
			exact(node, {"id", "kind", "operation", "inputNodeIds"});
			static_cast<void>(text(json::member(node, "operation"), "mask boolean operation"));
			const auto& values = json::array(json::member(node, "inputNodeIds"), "mask boolean inputs");
			if (values.size() < 2 || values.size() > 64) throw json::parse_error("Mask boolean inputs are outside their bounds.");
			for (const auto& ref : values) refs.push_back(text(ref, "mask boolean input ID"));
		} else throw json::parse_error("Mask node kind is unsupported.");
		dependencies.emplace(id, std::move(refs));
	}
	const auto output = text(json::member(value, "outputNodeId"), "mask output node ID");
	if (!dependencies.contains(output)) throw json::parse_error("Mask output node is missing.");
	std::map<std::string, std::size_t> depths;
	std::set<std::string> visiting;
	const auto depth = [&](const auto& self, const std::string& id) -> std::size_t {
		if (const auto found = depths.find(id); found != depths.end()) return found->second;
		if (!visiting.insert(id).second) throw json::parse_error("Mask graph contains a cycle.");
		const auto found = dependencies.find(id);
		if (found == dependencies.end()) throw json::parse_error("Mask graph references a missing node.");
		std::size_t result = 1;
		for (const auto& ref : found->second) result = std::max(result, self(self, ref) + 1);
		visiting.erase(id);
		if (result > 32) throw json::parse_error("Mask graph depth exceeds 32.");
		depths.emplace(id, result);
		return result;
	};
	static_cast<void>(depth(depth, output));
}

inline void validate_visual_authored(
	const json::value& value,
	const std::string& kind,
	const std::string& model_id,
	const std::string& sequence_id
) {
	if (kind == "still" || kind == "title" || kind == "text" || kind == "shape"
		|| kind == "solid" || kind == "external-generator") {
		validate_source_clip_authored(value, kind, model_id, sequence_id);
	} else if (kind == "adjustment-layer") {
		exact(value, {"schemaVersion", "kind", "id", "sequenceId", "sequenceStartFrame", "sequenceFrameCount", "targetTrackIds", "effectIds"});
		literal(json::member(value, "schemaVersion"), 1, "adjustment schema");
		literal(json::member(value, "kind"), "adjustment-layer", "adjustment kind");
		if (text(json::member(value, "id"), "adjustment ID") != model_id
			|| text(json::member(value, "sequenceId"), "adjustment sequence ID") != sequence_id) throw json::parse_error("Adjustment identity is inconsistent.");
		static_cast<void>(safe_integer(json::member(value, "sequenceStartFrame"), "adjustment start"));
		static_cast<void>(safe_integer(json::member(value, "sequenceFrameCount"), "adjustment count", 1));
		validate_string_array(json::member(value, "targetTrackIds"), "adjustment target tracks", 256, 1);
		validate_string_array(json::member(value, "effectIds"), "adjustment effects", 4'096);
	} else if (kind == "preset") {
		exact(value, {"schemaVersion", "kind", "id", "name", "modelKind", "authoredStateSha256"});
		literal(json::member(value, "schemaVersion"), 1, "preset schema");
		literal(json::member(value, "kind"), "video-preset", "preset kind");
		if (text(json::member(value, "id"), "preset ID") != model_id) throw json::parse_error("Preset identity is inconsistent.");
		static_cast<void>(text(json::member(value, "name"), "preset name"));
		static_cast<void>(text(json::member(value, "modelKind"), "preset model kind"));
		static_cast<void>(digest(json::member(value, "authoredStateSha256"), "preset state digest"));
	} else if (kind == "mask-matte") validate_mask_graph(value, model_id);
	else if (kind == "video-freeze") {
		exact(value, {"schemaVersion", "kind", "renderedSourceId"});
		literal(json::member(value, "schemaVersion"), 1, "video freeze schema");
		literal(json::member(value, "kind"), "video-freeze", "video freeze kind");
		if (text(json::member(value, "renderedSourceId"), "video freeze source ID") != model_id) throw json::parse_error("Video freeze identity is inconsistent.");
	} else throw json::parse_error("Visual model kind is unsupported.");
}

[[nodiscard]] inline std::string source_sha_by_id(const source_index& sources, const std::string& id) {
	for (const auto& [node, source] : sources) {
		static_cast<void>(node);
		if (source.source_id == id) return source.sha256;
	}
	throw json::parse_error("An external fallback references an unknown media source.");
}

inline void validate_visual(
	const json::value& node,
	const temporal_authority& clock,
	const source_index& sources
) {
	exact(node, {"kind", "nodeId", "modelId", "modelKind", "authoredState", "freshness", "frozenFallback"});
	static_cast<void>(text(json::member(node, "nodeId"), "visual node ID"));
	const auto model_id = text(json::member(node, "modelId"), "visual model ID");
	const auto model_kind = text(json::member(node, "modelKind"), "visual model kind");
	const auto& authored = json::member(node, "authoredState");
	validate_visual_authored(authored, model_kind, model_id, clock.sequence_id);
	const auto freshness = validate_freshness(json::member(node, "freshness"));
	if (semantic_sha256(authored) != freshness[0]) throw json::parse_error("Visual freshness does not bind complete authored state.");
	const auto& fallback = json::member(node, "frozenFallback");
	if (fallback.kind == json::type::null_value) return;
	exact(fallback, {"schemaVersion", "renderedSourceId", "renderedAssetSha256", "authoredStateSha256", "inputIdentitiesSha256", "renderPlanFingerprintSha256", "nativeEffectFingerprintSha256", "freshnessSha256"});
	literal(json::member(fallback, "schemaVersion"), 1, "visual fallback schema");
	const auto rendered_source = text(json::member(fallback, "renderedSourceId"), "visual fallback source ID");
	if (source_sha_by_id(sources, rendered_source) != digest(json::member(fallback, "renderedAssetSha256"), "visual fallback asset")) {
		throw json::parse_error("Visual fallback does not bind exact external media.");
	}
	freshness_identity fallback_freshness{
		digest(json::member(fallback, "authoredStateSha256"), "fallback authored digest"),
		digest(json::member(fallback, "inputIdentitiesSha256"), "fallback input digest"),
		digest(json::member(fallback, "renderPlanFingerprintSha256"), "fallback plan digest"),
		digest(json::member(fallback, "nativeEffectFingerprintSha256"), "fallback effect digest"),
	};
	if (freshness != fallback_freshness) throw json::parse_error("Visual fallback freshness is stale.");
	std::string canonical{"[\"soundscaper.video-freeze.freshness/v1\""};
	for (const auto& item : freshness) { canonical += ','; append_json_string(canonical, item); }
	canonical += ']';
	if (sha256_bytes(reinterpret_cast<const std::uint8_t*>(canonical.data()), canonical.size())
		!= digest(json::member(fallback, "freshnessSha256"), "visual fallback freshness")) {
		throw json::parse_error("Visual fallback freshness digest is invalid.");
	}
}

} // namespace framescaper::media::unified
