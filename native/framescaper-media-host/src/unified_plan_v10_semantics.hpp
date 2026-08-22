/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "unified_plan_identity_authority.hpp"
#include "unified_plan_v9_semantics.hpp"

#include <array>
#include <map>
#include <set>
#include <string>

namespace framescaper::media::unified {

using freshness_identity = std::array<std::string, 4>;

struct visual_authority final {
	std::string node_id;
	std::string model_id;
	std::string generator_source_id;
	std::string generator_source_fingerprint;
	std::vector<std::string> binding_references;
	std::vector<std::string> renderable_references;
	std::vector<std::string> adjustment_effect_references;
	std::vector<std::string> generator_dependencies;
	std::vector<std::string> track_references;
};

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

inline void validate_generator_document(
	const json::value& value,
	std::vector<std::string>& bindings,
	std::vector<std::string>& renderable_inputs,
	std::vector<std::string>& dependencies
) {
	const auto kind = text(json::member(value, "kind"), "generator kind");
	if (kind == "title" || kind == "text") {
		exact(value, {"kind", "text", "fontFamily", "fontSize", "color", "horizontalAlign", "verticalAlign"});
		static_cast<void>(text(json::member(value, "text"), "generator text"));
		static_cast<void>(text(json::member(value, "fontFamily"), "generator font"));
		finite_number(json::member(value, "fontSize"), "generator font size");
		static_cast<void>(text(json::member(value, "color"), "generator color"));
		const auto horizontal = text(json::member(value, "horizontalAlign"), "generator horizontal alignment");
		if (horizontal != "start" && horizontal != "center" && horizontal != "end") {
			throw json::parse_error("Generator horizontal alignment is unsupported.");
		}
		const auto vertical = text(json::member(value, "verticalAlign"), "generator vertical alignment");
		if (vertical != "start" && vertical != "middle" && vertical != "end") {
			throw json::parse_error("Generator vertical alignment is unsupported.");
		}
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
		bindings.push_back(stable_id(json::member(value, "bindingId"), "generator binding ID"));
		const auto& inputs = json::array(json::member(value, "inputs"), "generator inputs");
		if (inputs.size() > 64) throw json::parse_error("External generator input ceiling is exceeded.");
		std::string previous;
		for (const auto& input : inputs) {
			exact(input, {"name", "sourceRef"});
			const auto name = text(json::member(input, "name"), "generator input name");
			if (!previous.empty() && name <= previous) throw json::parse_error("External generator inputs are not canonical order.");
			previous = name;
			const auto reference = stable_id(json::member(input, "sourceRef"), "generator input source");
			renderable_inputs.push_back(reference);
			dependencies.push_back(reference);
		}
	} else throw json::parse_error("Visual generator kind is unsupported.");
}

[[nodiscard]] inline const source_authority& source_by_id(
	const source_index& sources,
	const std::string& id,
	const std::string_view label
) {
	for (const auto& [node, source] : sources) {
		static_cast<void>(node);
		if (source.source_id == id) return source;
	}
	throw json::parse_error(std::string{label} + " references an unknown external media source.");
}

inline void validate_source_clip_authored(
	const json::value& value,
	const std::string& model_kind,
	const std::string& model_id,
	const std::string& sequence_id,
	const source_index& sources,
	visual_authority& authority
) {
	exact(value, {"source", "clip"});
	const auto& source = json::member(value, "source");
	const auto& clip = json::member(value, "clip");
	if (model_kind == "still") {
		exact(source, {"schemaVersion", "kind", "id", "name", "mimeType", "storageKey", "contentSha256", "width", "height", "hasAlpha"});
		exact(clip, {"schemaVersion", "kind", "id", "sourceId", "sequenceId", "sequenceStartFrame", "sequenceFrameCount"});
		literal(json::member(source, "kind"), "still", "still source kind");
		literal(json::member(clip, "kind"), "still", "still clip kind");
		const auto source_id = stable_id(json::member(source, "id"), "still source ID");
		const auto mime_type = text(json::member(source, "mimeType"), "still MIME type");
		const auto storage_key = text(json::member(source, "storageKey"), "still storage key");
		const auto source_sha = digest(json::member(source, "contentSha256"), "still digest");
		const auto& external = source_by_id(sources, source_id, "Still authored state");
		if (!mime_type.starts_with("image/") || external.storage_key != storage_key
			|| external.mime_type != mime_type || external.sha256 != source_sha) {
			throw json::parse_error("Still authored state does not bind its exact external plan source.");
		}
		static_cast<void>(json::boolean(json::member(source, "hasAlpha"), "still alpha"));
	} else {
		exact(source, {"schemaVersion", "kind", "id", "name", "width", "height", "frameRate", "frameCount", "generator"});
		exact(clip, {"schemaVersion", "kind", "id", "sourceId", "sequenceId", "sequenceStartFrame", "sequenceFrameCount", "sourceInFrame", "sourceFrameCount"});
		literal(json::member(source, "kind"), "generator", "generator source kind");
		literal(json::member(clip, "kind"), "generator", "generator clip kind");
		static_cast<void>(rate(json::member(source, "frameRate"), "generator frame rate"));
		const auto& generator = json::member(source, "generator");
		validate_generator_document(
			generator,
			authority.binding_references,
			authority.renderable_references,
			authority.generator_dependencies
		);
		if (text(json::member(generator, "kind"), "generator document kind") != model_kind) {
			throw json::parse_error("Visual generator model kind is inconsistent.");
		}
		const auto frame_count = safe_integer(json::member(source, "frameCount"), "generator frame count", 1);
		const auto source_in = safe_integer(json::member(clip, "sourceInFrame"), "generator source in");
		const auto source_count = safe_integer(json::member(clip, "sourceFrameCount"), "generator source count", 1);
		if (source_in > maximum_safe_integer - source_count || source_in + source_count > frame_count) {
			throw json::parse_error("Generator clip escapes its source range.");
		}
	}
	literal(json::member(source, "schemaVersion"), 1, "visual source schema");
	literal(json::member(clip, "schemaVersion"), 1, "visual clip schema");
	const auto source_id = stable_id(json::member(source, "id"), "visual source ID");
	if (stable_id(json::member(clip, "id"), "visual clip ID") != model_id
		|| stable_id(json::member(clip, "sourceId"), "visual clip source ID") != source_id
		|| stable_id(json::member(clip, "sequenceId"), "visual clip sequence ID") != sequence_id) {
		throw json::parse_error("Visual source/clip identities are inconsistent.");
	}
	if (model_kind != "still") {
		authority.generator_source_id = source_id;
		authority.generator_source_fingerprint = semantic_sha256(source);
	}
	static_cast<void>(text(json::member(source, "name"), "visual source name"));
	for (const auto key : {"width", "height"}) {
		const auto dimension = safe_integer(json::member(source, key), key, 1);
		if (dimension > 65'536) throw json::parse_error("Visual source dimension exceeds its ceiling.");
	}
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

inline void validate_mask_graph(
	const json::value& value,
	const std::string& model_id,
	visual_authority& authority
) {
	exact(value, {"schemaVersion", "id", "kind", "inputs", "nodes", "outputNodeId"});
	literal(json::member(value, "schemaVersion"), 1, "mask graph schema");
	if (text(json::member(value, "id"), "mask graph ID") != model_id) throw json::parse_error("Mask graph identity is inconsistent.");
	const auto graph_kind = text(json::member(value, "kind"), "mask graph kind");
	if (graph_kind != "mask" && graph_kind != "matte") throw json::parse_error("Mask graph kind is unsupported.");
	const auto& inputs = json::array(json::member(value, "inputs"), "mask graph inputs");
	if (inputs.size() > 256) throw json::parse_error("Mask input ceiling is exceeded.");
	std::map<std::string, std::string> input_names;
	std::string previous_input;
	for (const auto& input : inputs) {
		exact(input, {"name", "sourceRef", "kind"});
		const auto name = text(json::member(input, "name"), "mask input name");
		if (!previous_input.empty() && name <= previous_input) throw json::parse_error("Mask inputs are not canonical order.");
		previous_input = name;
		authority.renderable_references.push_back(
			stable_id(json::member(input, "sourceRef"), "mask input source")
		);
		const auto kind = text(json::member(input, "kind"), "mask input kind");
		if (kind != "raster" && kind != "alpha") throw json::parse_error("Mask input kind is unsupported.");
		input_names.emplace(name, kind);
	}
	const auto& nodes = json::array(json::member(value, "nodes"), "mask graph nodes");
	if (nodes.empty() || nodes.size() > 4'096) throw json::parse_error("Mask node count is outside its bounds.");
	std::map<std::string, std::vector<std::string>> dependencies;
	std::set<std::string> path_ids;
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
			const auto input = text(json::member(node, "inputName"), "raster input name");
			if (!input_names.contains(input) || input_names.at(input) != "raster") throw json::parse_error("Raster mask input is missing or has the wrong kind.");
			const auto channel = text(json::member(node, "channel"), "raster channel");
			if (channel != "luma" && channel != "red" && channel != "green"
				&& channel != "blue" && channel != "alpha") throw json::parse_error("Raster mask channel is unsupported.");
		} else if (kind == "alpha") {
			exact(node, {"id", "kind", "inputName"});
			const auto input = text(json::member(node, "inputName"), "alpha input name");
			if (!input_names.contains(input) || input_names.at(input) != "alpha") throw json::parse_error("Alpha mask input is missing or has the wrong kind.");
		} else if (kind == "feather" || kind == "invert") {
			if (kind == "feather") {
				exact(node, {"id", "kind", "inputNodeId", "radius"});
				finite_number(json::member(node, "radius"), "mask feather radius");
			} else exact(node, {"id", "kind", "inputNodeId"});
			refs.push_back(text(json::member(node, "inputNodeId"), "mask input node ID"));
		} else if (kind == "boolean") {
			exact(node, {"id", "kind", "operation", "inputNodeIds"});
			const auto operation = text(json::member(node, "operation"), "mask boolean operation");
			if (operation != "union" && operation != "intersect" && operation != "subtract"
				&& operation != "xor") throw json::parse_error("Mask boolean operation is unsupported.");
			const auto& values = json::array(json::member(node, "inputNodeIds"), "mask boolean inputs");
			if (values.size() < 2 || values.size() > 64) throw json::parse_error("Mask boolean inputs are outside their bounds.");
			std::set<std::string> seen;
			for (const auto& ref : values) {
				const auto reference = stable_id(ref, "mask boolean input ID");
				if (!seen.insert(reference).second) throw json::parse_error("Mask boolean input is duplicated.");
				refs.push_back(reference);
			}
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
	for (const auto& [id, references] : dependencies) {
		static_cast<void>(references);
		static_cast<void>(depth(depth, id));
	}
}

inline void validate_visual_authored(
	const json::value& value,
	const std::string& kind,
	const std::string& model_id,
	const std::string& sequence_id,
	const source_index& sources,
	visual_authority& authority
) {
	if (kind == "still" || kind == "title" || kind == "text" || kind == "shape"
		|| kind == "solid" || kind == "external-generator") {
		validate_source_clip_authored(value, kind, model_id, sequence_id, sources, authority);
	} else if (kind == "adjustment-layer") {
		exact(value, {"schemaVersion", "kind", "id", "sequenceId", "sequenceStartFrame", "sequenceFrameCount", "targetTrackIds", "effectIds"});
		literal(json::member(value, "schemaVersion"), 1, "adjustment schema");
		literal(json::member(value, "kind"), "adjustment-layer", "adjustment kind");
		if (text(json::member(value, "id"), "adjustment ID") != model_id
			|| text(json::member(value, "sequenceId"), "adjustment sequence ID") != sequence_id) throw json::parse_error("Adjustment identity is inconsistent.");
		static_cast<void>(safe_integer(json::member(value, "sequenceStartFrame"), "adjustment start"));
		static_cast<void>(safe_integer(json::member(value, "sequenceFrameCount"), "adjustment count", 1));
		validate_string_array(json::member(value, "targetTrackIds"), "adjustment target tracks", 256, 1);
		for (const auto& track : json::array(json::member(value, "targetTrackIds"), "adjustment target tracks")) {
			authority.track_references.push_back(stable_id(track, "adjustment target track"));
		}
		validate_string_array(json::member(value, "effectIds"), "adjustment effects", 4'096);
		for (const auto& effect : json::array(json::member(value, "effectIds"), "adjustment effects")) {
			authority.adjustment_effect_references.push_back(stable_id(effect, "adjustment effect"));
		}
	} else if (kind == "preset") {
		exact(value, {"schemaVersion", "kind", "id", "name", "modelKind", "authoredStateSha256"});
		literal(json::member(value, "schemaVersion"), 1, "preset schema");
		literal(json::member(value, "kind"), "video-preset", "preset kind");
		if (text(json::member(value, "id"), "preset ID") != model_id) throw json::parse_error("Preset identity is inconsistent.");
		static_cast<void>(text(json::member(value, "name"), "preset name"));
		static_cast<void>(text(json::member(value, "modelKind"), "preset model kind"));
		static_cast<void>(digest(json::member(value, "authoredStateSha256"), "preset state digest"));
	} else if (kind == "mask-matte") validate_mask_graph(value, model_id, authority);
	else if (kind == "video-freeze") {
		exact(value, {"schemaVersion", "kind", "renderedSourceId"});
		literal(json::member(value, "schemaVersion"), 1, "video freeze schema");
		literal(json::member(value, "kind"), "video-freeze", "video freeze kind");
		const auto rendered_source = stable_id(json::member(value, "renderedSourceId"), "video freeze source ID");
		if (model_id != "video-freeze:" + rendered_source) {
			throw json::parse_error("Video freeze identity is inconsistent.");
		}
		static_cast<void>(source_by_id(sources, rendered_source, "Video freeze"));
	} else throw json::parse_error("Visual model kind is unsupported.");
}

[[nodiscard]] inline std::string source_sha_by_id(const source_index& sources, const std::string& id) {
	return source_by_id(sources, id, "External fallback").sha256;
}

[[nodiscard]] inline visual_authority validate_visual(
	const json::value& node,
	const temporal_authority& clock,
	const source_index& sources,
	const track_index& tracks
) {
	exact(node, {"kind", "nodeId", "modelId", "modelKind", "authoredState", "placement", "freshness", "authoredFallback", "fallbackDisposition", "frozenFallback"});
	visual_authority authority;
	authority.node_id = stable_id(json::member(node, "nodeId"), "visual node ID");
	const auto model_id = stable_id(json::member(node, "modelId"), "visual model ID");
	authority.model_id = model_id;
	const auto model_kind = text(json::member(node, "modelKind"), "visual model kind");
	const auto& authored = json::member(node, "authoredState");
	validate_visual_authored(authored, model_kind, model_id, clock.sequence_id, sources, authority);
	const bool placed = model_kind == "still" || model_kind == "title" || model_kind == "text"
		|| model_kind == "shape" || model_kind == "solid" || model_kind == "external-generator";
	const auto& placement = json::member(node, "placement");
	if (placed) {
		exact(placement, {"trackId"});
		const auto track_id = stable_id(json::member(placement, "trackId"), "visual placement track ID");
		if (!tracks.contains(track_id)) throw json::parse_error("A visual references an unknown video track.");
	} else if (placement.kind != json::type::null_value) {
		throw json::parse_error("A non-placement visual model cannot claim track placement.");
	}
	const auto& freshness_value = json::member(node, "freshness");
	const bool has_freshness = freshness_value.kind != json::type::null_value;
	freshness_identity freshness{};
	if (has_freshness) {
		freshness = validate_freshness(freshness_value);
		if (semantic_sha256(authored) != freshness[0]) {
			throw json::parse_error("Visual freshness does not bind complete authored state.");
		}
	}
	const auto& fallback = json::member(node, "authoredFallback");
	const auto& disposition = json::member(node, "fallbackDisposition");
	const auto& playable = json::member(node, "frozenFallback");
	if (fallback.kind == json::type::null_value) {
		if (disposition.kind != json::type::null_value
			|| playable.kind != json::type::null_value) {
			throw json::parse_error("A visual without authored fallback cannot claim fallback state.");
		}
		return authority;
	}
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
	std::string canonical{"[\"soundscaper.video-freeze.freshness/v1\""};
	for (const auto& item : fallback_freshness) { canonical += ','; append_json_string(canonical, item); }
	canonical += ']';
	if (sha256_bytes(reinterpret_cast<const std::uint8_t*>(canonical.data()), canonical.size())
		!= digest(json::member(fallback, "freshnessSha256"), "visual fallback freshness")) {
		throw json::parse_error("Visual fallback freshness digest is invalid.");
	}
	std::vector<std::string> changed;
	if (has_freshness) {
		static constexpr std::array<std::string_view, 4> names{
			"authored-state", "input-identities", "render-plan", "native-effect",
		};
		for (std::size_t index = 0; index < names.size(); ++index) {
			if (freshness[index] != fallback_freshness[index]) changed.emplace_back(names[index]);
		}
	}
	const auto status = !has_freshness ? std::string{"unverifiable"}
		: changed.empty() ? std::string{"fresh"} : std::string{"stale"};
	const auto mode = status == "fresh" ? std::string{"frozen"} : std::string{"bypass"};
	exact(disposition, {"status", "mode", "changedComponents", "authoredStatePreserved", "reportsDegradation"});
	if (text(json::member(disposition, "status"), "visual fallback status") != status
		|| text(json::member(disposition, "mode"), "visual fallback mode") != mode
		|| !json::boolean(json::member(disposition, "authoredStatePreserved"), "authored-state preservation")
		|| json::boolean(json::member(disposition, "reportsDegradation"), "fallback degradation")
			!= (mode == "bypass")) {
		throw json::parse_error("Visual fallback disposition is inconsistent.");
	}
	const auto& declared_changed = json::array(
		json::member(disposition, "changedComponents"), "visual fallback changed components"
	);
	if (declared_changed.size() != changed.size()) {
		throw json::parse_error("Visual fallback changed-component authority is inconsistent.");
	}
	for (std::size_t index = 0; index < changed.size(); ++index) {
		if (text(declared_changed[index], "visual fallback changed component") != changed[index]) {
			throw json::parse_error("Visual fallback changed-component authority is inconsistent.");
		}
	}
	if (mode == "frozen") {
		if (playable.kind == json::type::null_value
			|| semantic_sha256(playable) != semantic_sha256(fallback)) {
			throw json::parse_error("A fresh visual fallback must be its exact playable fallback.");
		}
	} else if (playable.kind != json::type::null_value) {
		throw json::parse_error("A stale or unverifiable visual fallback can only bypass.");
	}
	return authority;
}

inline void resolve_visual_references(
	const std::vector<visual_authority>& visuals,
	const graph_identity_index& identities,
	const track_index& tracks
) {
	std::set<std::string> generator_sources;
	for (const auto& visual : visuals) {
		if (!visual.generator_source_id.empty()) generator_sources.insert(visual.generator_source_id);
	}
	std::map<std::string, std::set<std::string>> dependencies;
	for (const auto& generator : generator_sources) dependencies.emplace(generator, std::set<std::string>{});
	for (const auto& visual : visuals) {
		for (const auto& reference : visual.binding_references) {
			const auto& claim = require_graph_identity(identities, reference, {
				graph_identity_kind::source,
				graph_identity_kind::generator_source,
				graph_identity_kind::openfx_instance,
			}, "An external-generator binding");
			if (claim.kind == graph_identity_kind::openfx_instance && claim.role != "generator") {
				throw json::parse_error("An external-generator binding targets a non-generator OpenFX instance.");
			}
		}
		for (const auto& reference : visual.renderable_references) {
			static_cast<void>(require_renderable_identity(
				identities, reference, "A visual renderable input"
			));
		}
		for (const auto& reference : visual.adjustment_effect_references) {
			static_cast<void>(require_graph_identity(identities, reference, {
				graph_identity_kind::video_effect,
			}, "An adjustment-layer effect"));
		}
		for (const auto& track : visual.track_references) {
			if (!tracks.contains(track)) throw json::parse_error("An adjustment layer references an unknown track.");
		}
		if (visual.generator_source_id.empty()) continue;
		for (const auto& reference : visual.generator_dependencies) {
			if (generator_sources.contains(reference)) {
				dependencies.at(visual.generator_source_id).insert(reference);
			}
		}
	}
	std::map<std::string, std::size_t> incoming;
	std::map<std::string, std::set<std::string>> dependents;
	std::vector<std::string> ready;
	for (const auto& [owner, values] : dependencies) {
		incoming.emplace(owner, values.size());
		dependents.emplace(owner, std::set<std::string>{});
		if (values.empty()) ready.push_back(owner);
	}
	for (const auto& [owner, values] : dependencies) {
		for (const auto& dependency : values) dependents.at(dependency).insert(owner);
	}
	std::size_t resolved{};
	while (!ready.empty()) {
		const auto current = std::move(ready.back());
		ready.pop_back();
		++resolved;
		for (const auto& dependent : dependents.at(current)) {
			auto& count = incoming.at(dependent);
			if (--count == 0) ready.push_back(dependent);
		}
	}
	if (resolved != dependencies.size()) {
		throw json::parse_error("External-generator dependencies contain a render cycle.");
	}
}

} // namespace framescaper::media::unified
