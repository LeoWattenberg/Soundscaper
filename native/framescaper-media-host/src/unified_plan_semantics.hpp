/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "unified_plan_v11_v12_semantics.hpp"

#include <map>
#include <set>
#include <string>
#include <tuple>
#include <vector>

namespace framescaper::media::unified {

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
	std::vector<visual_authority> visuals;
	std::map<std::string, std::string> generator_sources;
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
			validate_professional(node, sources, result);
			if (!professional_sources.insert(stable_id(
				json::member(node, "sourceNodeId"), "professional source node ID"
			)).second) throw json::parse_error("A source has duplicate professional-media authority.");
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
	// Exact V9+ mappings are never narrowed to the old sequential adapter.
	result.simple_full_frame_clip = false;
}

} // namespace framescaper::media::unified
