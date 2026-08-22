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
	admitted_media_plan& result
) {
	const auto clock = temporal(root);
	const auto sources = validate_sources(root, result);
	const auto& nodes = json::array(json::member(root, "nodes"), "unified render nodes");
	if (nodes.size() > 100'000) throw json::parse_error("The unified render node ceiling is exceeded.");
	clip_index clips;
	std::set<std::string> node_ids;
	std::set<std::string> feature_ids;
	std::set<std::string> graph_identities;
	const auto& project = json::member(root, "project");
	graph_identities.insert(text(json::member(project, "id"), "render project ID"));
	for (const auto& [node_id, source] : sources) {
		node_ids.insert(node_id);
		graph_identities.insert(node_id);
		graph_identities.insert(source.source_id);
	}
	for (const auto& node : nodes) {
		if (json::string(json::member(node, "kind"), "render node kind") != "clip") continue;
		auto clip = validate_clip(node, clock, sources);
		unique(node_ids, clip.node_id, "render node ID");
		unique(feature_ids, clip.clip_id, "render feature ID");
		graph_identities.insert(clip.node_id);
		graph_identities.insert(clip.clip_id);
		if (!clips.emplace(clip.clip_id, std::move(clip)).second) throw json::parse_error("Clip ID is duplicated.");
	}
	std::vector<transition_order> transition_orders;
	std::map<std::string, std::size_t> transition_counts;
	std::set<std::string> transition_pairs;
	for (const auto& node : nodes) {
		const auto kind = text(json::member(node, "kind"), "render node kind");
		if (kind == "clip" || kind == "openfx") continue;
		const auto node_id = text(json::member(node, "nodeId"), "render node ID");
		unique(node_ids, node_id, "render node ID");
		graph_identities.insert(node_id);
		if (kind == "transition") {
			auto order = validate_transition(node, clock, clips, sources);
			unique(feature_ids, order.id, "render feature ID");
			graph_identities.insert(order.id);
			const auto pair = order.track + "\0" + order.outgoing + "\0" + order.incoming;
			if (!transition_pairs.insert(pair).second) throw json::parse_error("Transition clip-pair identity is duplicated.");
			if (++transition_counts[order.track] > 16'384) throw json::parse_error("A track exceeds 16,384 transitions.");
			transition_orders.push_back(std::move(order));
			result.unsupported_render_family = "video-transition";
		} else if (kind == "visual") {
			if (result.version < 10) throw json::parse_error("A visual node requires V10.");
			validate_visual(node, clock, sources);
			const auto model_id = text(json::member(node, "modelId"), "visual model ID");
			unique(feature_ids, model_id, "render feature ID");
			graph_identities.insert(model_id);
			result.unsupported_render_family = "visual-model";
		} else if (kind == "professional-media") {
			if (result.version < 11) throw json::parse_error("A professional-media node requires V11.");
			validate_professional(node, sources, result);
			unique(feature_ids, text(json::member(node, "sourceNodeId"), "professional source node ID"), "render feature ID");
			result.unsupported_render_family = "professional-media";
		} else throw json::parse_error("The unified render node kind is unsupported.");
	}
	if (transition_orders.size() > 100'000) throw json::parse_error("A project exceeds 100,000 transitions.");
	for (std::size_t index = 1; index < transition_orders.size(); ++index) {
		if (transition_orders[index].tuple() < transition_orders[index - 1].tuple()) {
			throw json::parse_error("Transition nodes are not in deterministic canonical order.");
		}
	}
	for (const auto& node : nodes) {
		if (json::string(json::member(node, "kind"), "render node kind") != "openfx") continue;
		if (result.version < 12) throw json::parse_error("An OpenFX node requires V12.");
		const auto node_id = text(json::member(node, "nodeId"), "OpenFX node ID");
		unique(node_ids, node_id, "render node ID");
		validate_openfx(node, graph_identities, sources);
		const auto& state = json::member(node, "state");
		unique(feature_ids, text(json::member(state, "instanceId"), "OpenFX instance ID"), "render feature ID");
		result.unsupported_render_family = "openfx";
	}
	if (result.unsupported_render_family.empty() && !clips.empty()) {
		result.unsupported_render_family = "exact-source-time-compositor";
	}
	// Exact V9+ mappings are never narrowed to the old sequential adapter.
	result.simple_full_frame_clip = false;
}

} // namespace framescaper::media::unified
