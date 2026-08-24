/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "unified_plan_v11_v12_semantics.hpp"

#include <algorithm>
#include <map>
#include <set>
#include <string>
#include <tuple>
#include <vector>

namespace framescaper::media::unified {

[[nodiscard]] inline bool identity_picture_state(const json::value& node) {
	const auto& picture = json::member(node, "pictureState");
	const auto& composition = json::member(picture, "composition");
	const auto& crop = json::member(composition, "crop");
	const auto& transform = json::member(composition, "transform");
	const auto number_is = [](const json::value& value, const double expected) {
		return bounded_number(value, "identity picture value", -36'000, 36'000) == expected;
	};
	return number_is(json::member(crop, "left"), 0) && number_is(json::member(crop, "top"), 0)
		&& number_is(json::member(crop, "right"), 0) && number_is(json::member(crop, "bottom"), 0)
		&& number_is(json::member(transform, "anchorX"), 0.5)
		&& number_is(json::member(transform, "anchorY"), 0.5)
		&& number_is(json::member(transform, "positionX"), 0.5)
		&& number_is(json::member(transform, "positionY"), 0.5)
		&& number_is(json::member(transform, "scaleX"), 1)
		&& number_is(json::member(transform, "scaleY"), 1)
		&& number_is(json::member(transform, "rotationDegrees"), 0)
		&& !json::boolean(json::member(transform, "flipHorizontal"), "identity horizontal flip")
		&& !json::boolean(json::member(transform, "flipVertical"), "identity vertical flip")
		&& number_is(json::member(composition, "opacity"), 1)
		&& text(json::member(composition, "blendMode"), "identity blend mode") == "normal"
		&& safe_integer(json::member(composition, "compositingOrder"), "identity compositing order") == 0
		&& json::array(json::member(picture, "videoEffects"), "identity video effects").empty()
		&& json::array(
			json::member(json::member(picture, "videoKeyframes"), "curves"),
			"identity picture curves"
		).empty();
}

[[nodiscard]] inline bool validate_finishing(
	const json::value& node,
	const temporal_authority& clock,
	const source_index& sources
) {
	exact(node, {"kind", "nodeId", "sequenceId", "colorContext", "sourceInterpretations",
		"visualPresentations", "processorStacks", "motionAnalyses", "captionTracks",
		"captionDisposition", "audioContext"});
	literal(json::member(node, "kind"), "finishing", "finishing kind");
	static_cast<void>(stable_id(json::member(node, "nodeId"), "finishing node ID"));
	if (stable_id(json::member(node, "sequenceId"), "finishing sequence ID") != clock.sequence_id) {
		throw json::parse_error("The finishing node does not bind the rendered sequence.");
	}
	const auto& color = json::member(node, "colorContext");
	exact(color, {"schemaVersion", "sequenceId", "workingSpace", "outputSpace", "alphaMode", "toneMapping"});
	literal(json::member(color, "schemaVersion"), 1, "finishing color schema");
	if (stable_id(json::member(color, "sequenceId"), "finishing color sequence") != clock.sequence_id
		|| text(json::member(color, "workingSpace"), "finishing working space") != "linear-rec709-d65"
		|| !std::set<std::string>{"srgb", "rec709"}.contains(text(json::member(color, "outputSpace"), "finishing output space"))
		|| text(json::member(color, "alphaMode"), "finishing alpha mode") != "straight-authored-premultiplied-working"
		|| text(json::member(color, "toneMapping"), "finishing tone mapping") != "none") {
		throw json::parse_error("The finishing color context is unsupported.");
	}
	const auto& interpretations = json::array(
		json::member(node, "sourceInterpretations"), "finishing source interpretations"
	);
	if (interpretations.size() != sources.size()) {
		throw json::parse_error("Finishing must interpret every exact picture source.");
	}
	std::set<std::string> interpreted;
	bool unmanaged = true;
	for (const auto& item : interpretations) {
		exact(item, {"schemaVersion", "sourceId", "sourceKind", "primaries", "transfer", "matrix", "range", "provenance"});
		literal(json::member(item, "schemaVersion"), 1, "source interpretation schema");
		const auto source_id = stable_id(json::member(item, "sourceId"), "interpreted source ID");
		if (!interpreted.insert(source_id).second) throw json::parse_error("A source interpretation is duplicated.");
		unmanaged = unmanaged && text(json::member(item, "provenance"), "source interpretation provenance")
			== "legacy-unmanaged-encoded";
		for (const auto key : {"sourceKind", "primaries", "transfer", "matrix", "range"}) {
			static_cast<void>(text(json::member(item, key), key));
		}
	}
	for (const auto& [node_id, source] : sources) {
		static_cast<void>(node_id);
		if (!interpreted.contains(source.source_id)) throw json::parse_error("A source interpretation is absent.");
	}
	const auto& presentations = json::array(json::member(node, "visualPresentations"), "finishing presentations");
	const auto& processors = json::array(json::member(node, "processorStacks"), "finishing processors");
	const auto& analyses = json::array(json::member(node, "motionAnalyses"), "finishing analyses");
	const auto& captions = json::array(json::member(node, "captionTracks"), "finishing captions");
	if (presentations.size() > 100'000 || processors.size() > 100'000
		|| analyses.size() > 100'000 || captions.size() > 10'000) {
		throw json::parse_error("A finishing collection exceeds its closed bound.");
	}
	if (text(json::member(node, "captionDisposition"), "caption disposition") != "sidecar-only") {
		throw json::parse_error("Only sidecar finishing captions are admitted.");
	}
	const auto& audio = json::member(node, "audioContext");
	exact(audio, {"audioTracks", "masterEffectIds", "masterChannels", "automationLanes", "mixer"});
	const auto& tracks = json::array(json::member(audio, "audioTracks"), "finishing audio tracks");
	const auto& master_effects = json::array(json::member(audio, "masterEffectIds"), "finishing master effects");
	const auto& automation = json::array(json::member(audio, "automationLanes"), "finishing automation");
	if (tracks.size() > 100'000 || master_effects.size() > 100'000 || automation.size() > 4'096
		|| safe_integer(json::member(audio, "masterChannels"), "finishing master channels", 1) > 32
		|| json::member(audio, "mixer").kind != json::type::object) {
		throw json::parse_error("The finishing audio context exceeds its closed domain.");
	}
	return unmanaged && presentations.empty() && processors.empty() && analyses.empty()
		&& captions.empty() && master_effects.empty() && automation.empty();
}

inline void validate_unified_semantics(
	const json::value& root,
	admitted_media_plan& result,
	video_timing_asset_registry& timing_assets
) {
	const auto clock = temporal(root);
	const auto tracks = validate_tracks(root);
	const auto sources = validate_sources(root, result, timing_assets);
	const auto& nodes = json::array(json::member(root, "nodes"), "unified render nodes");
	if (nodes.size() > 100'000) throw json::parse_error("The unified render node ceiling is exceeded.");
	clip_index clips;
	graph_identity_index graph_identities;
	const auto claim = [&](
		const std::string& identity,
		const graph_identity_kind kind,
		std::string role = {}
	) {
		claim_graph_identity(graph_identities, identity, kind, std::move(role));
	};
	const auto& project = json::member(root, "project");
	claim(stable_id(json::member(project, "id"), "render project ID"), graph_identity_kind::project);
	claim(stable_id(
		json::member(json::member(root, "timebase"), "sequenceId"), "render sequence ID"
	), graph_identity_kind::sequence);
	for (const auto& [track_id, track] : tracks) {
		static_cast<void>(track);
		claim(track_id, graph_identity_kind::track);
	}
	for (const auto& [node_id, source] : sources) {
		claim(node_id, graph_identity_kind::source_node);
		claim(source.source_id, graph_identity_kind::source);
	}
	for (const auto& node : nodes) {
		if (json::string(json::member(node, "kind"), "render node kind") != "clip") continue;
		auto clip = validate_clip(node, clock, sources, tracks);
		claim(clip.node_id, graph_identity_kind::clip_node);
		claim(clip.clip_id, graph_identity_kind::clip);
		for (const auto& effect_id : clip.effect_ids) {
			claim(effect_id, graph_identity_kind::video_effect);
		}
		if (!clips.emplace(clip.clip_id, std::move(clip)).second) throw json::parse_error("Clip ID is duplicated.");
	}
	std::vector<transition_order> transition_orders;
	std::map<std::string, std::size_t> transition_counts;
	std::set<std::string> transition_pairs;
	std::set<std::string> professional_sources;
	bool identity_professional = true;
	std::vector<visual_authority> visuals;
	std::map<std::string, std::string> generator_sources;
	std::size_t finishing_count{};
	bool identity_finishing{};
	for (const auto& node : nodes) {
		const auto kind = text(json::member(node, "kind"), "render node kind");
		if (kind == "clip" || kind == "openfx") continue;
		const auto node_id = stable_id(json::member(node, "nodeId"), "render node ID");
		if (kind == "transition") {
			claim(node_id, graph_identity_kind::transition_node);
			auto order = validate_transition(node, clock, clips, sources);
			claim(order.id, graph_identity_kind::transition);
			auto pair = order.track;
			pair.push_back('\0'); pair += order.outgoing;
			pair.push_back('\0'); pair += order.incoming;
			if (!transition_pairs.insert(pair).second) throw json::parse_error("Transition clip-pair identity is duplicated.");
			if (++transition_counts[order.track] > 16'384) throw json::parse_error("A track exceeds 16,384 transitions.");
			transition_orders.push_back(std::move(order));
		} else if (kind == "visual") {
			if (result.version < 10) throw json::parse_error("A visual node requires V10.");
			claim(node_id, graph_identity_kind::visual_node);
			auto visual = validate_visual(node, clock, sources, tracks);
			if (visual.node_id != node_id) throw json::parse_error("Visual node identity is inconsistent.");
			claim(visual.model_id, graph_identity_kind::visual_model);
			if (!visual.generator_source_id.empty()) {
				const auto found = generator_sources.find(visual.generator_source_id);
				if (found == generator_sources.end()) {
					claim(visual.generator_source_id, graph_identity_kind::generator_source);
					generator_sources.emplace(
						visual.generator_source_id, visual.generator_source_fingerprint
					);
				} else if (found->second != visual.generator_source_fingerprint) {
					throw json::parse_error("A repeated generator source has contradictory authority.");
				}
			}
			visuals.push_back(std::move(visual));
		} else if (kind == "professional-media") {
			if (result.version < 11) throw json::parse_error("A professional-media node requires V11.");
			claim(node_id, graph_identity_kind::professional_media_node);
			identity_professional = validate_professional(node, sources, result)
				&& identity_professional;
			if (!professional_sources.insert(stable_id(
				json::member(node, "sourceNodeId"), "professional source node ID"
			)).second) throw json::parse_error("A source has duplicate professional-media authority.");
		} else if (kind == "finishing") {
			if (result.version < 13 || ++finishing_count != 1) {
				throw json::parse_error("A selected plan requires one finishing node.");
			}
			claim(node_id, graph_identity_kind::finishing_node);
			identity_finishing = validate_finishing(node, clock, sources);
		} else throw json::parse_error("The unified render node kind is unsupported.");
	}
	if (transition_orders.size() > 100'000) throw json::parse_error("A project exceeds 100,000 transitions.");
	for (std::size_t index = 1; index < transition_orders.size(); ++index) {
		if (transition_orders[index].tuple() < transition_orders[index - 1].tuple()) {
			throw json::parse_error("Transition nodes are not in deterministic canonical order.");
		}
	}
	const auto pre_openfx_identities = graph_identities;
	std::vector<std::tuple<std::string, std::string, std::string>> openfx_claims;
	for (const auto& node : nodes) {
		if (json::string(json::member(node, "kind"), "render node kind") != "openfx") continue;
		if (result.version < 12) throw json::parse_error("An OpenFX node requires V12.");
		const auto node_id = stable_id(json::member(node, "nodeId"), "OpenFX node ID");
		validate_openfx(node, pre_openfx_identities, sources, clock.output_count);
		const auto& state = json::member(node, "state");
		openfx_claims.emplace_back(
			node_id,
			stable_id(json::member(state, "instanceId"), "OpenFX instance ID"),
			text(json::member(state, "context"), "OpenFX context")
		);
	}
	for (const auto& [node_id, instance_id, context] : openfx_claims) {
		claim(node_id, graph_identity_kind::openfx_node);
		claim(instance_id, graph_identity_kind::openfx_instance, context);
	}
	resolve_visual_references(visuals, graph_identities, tracks);
	if (result.version >= 13 && finishing_count != 1) {
		throw json::parse_error("A selected plan requires one finishing node.");
	}
	result.simple_full_frame_clip = result.version == 14 && identity_finishing
		&& sources.size() == 1 && tracks.size() == 1 && clips.size() == 1
		&& transition_orders.empty() && visuals.empty() && identity_professional
		&& professional_sources.size() == sources.size()
		&& openfx_claims.empty() && !result.includes_audio;
	if (result.simple_full_frame_clip) {
		const auto& track = tracks.begin()->second;
		const auto& clip = clips.begin()->second;
		const auto& source = sources.begin()->second;
		const auto& clip_node = *std::find_if(nodes.begin(), nodes.end(), [&](const json::value& node) {
			return text(json::member(node, "kind"), "simple node kind") == "clip";
		});
		result.simple_full_frame_clip = !track.mute && !track.hidden && !clip.uses_curve
			&& !clip.retime_map.present && clip.effect_ids.empty() && identity_picture_state(clip_node)
			&& clip.source_node_id == source.node_id && clip.sequence_start == 0
			&& clip.sequence_count == clock.output_count && clip.source_count == clock.output_count
			&& source.cfr && source.rate == clock.output_rate && clock.sequence_rate == clock.output_rate;
		if (result.simple_full_frame_clip) {
			result.source_in_frame = static_cast<std::uint64_t>(clip.source_in);
			result.source_frame_count = static_cast<std::uint64_t>(clip.source_count);
		}
	}
}

} // namespace framescaper::media::unified
