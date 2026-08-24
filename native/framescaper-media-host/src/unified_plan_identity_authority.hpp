/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "strict_json.hpp"

#include <initializer_list>
#include <map>
#include <string>
#include <string_view>

namespace framescaper::media::unified {

enum class graph_identity_kind {
	project,
	sequence,
	track,
	source_node,
	source,
	clip_node,
	clip,
	video_effect,
	transition_node,
	transition,
	visual_node,
	visual_model,
	generator_source,
	professional_media_node,
	finishing_node,
	openfx_node,
	openfx_instance,
};

struct graph_identity_claim final {
	graph_identity_kind kind{};
	std::string role;
};

using graph_identity_index = std::map<std::string, graph_identity_claim>;

inline void claim_graph_identity(
	graph_identity_index& identities,
	const std::string& identity,
	const graph_identity_kind kind,
	std::string role = {}
) {
	if (!identities.emplace(identity, graph_identity_claim{kind, std::move(role)}).second) {
		throw json::parse_error("A unified graph identity is ambiguous between multiple owners.");
	}
}

[[nodiscard]] inline const graph_identity_claim& require_graph_identity(
	const graph_identity_index& identities,
	const std::string& identity,
	const std::initializer_list<graph_identity_kind> allowed,
	const std::string_view label
) {
	const auto found = identities.find(identity);
	if (found == identities.end()) {
		throw json::parse_error(std::string{label} + " is unresolved.");
	}
	for (const auto kind : allowed) {
		if (found->second.kind == kind) return found->second;
	}
	throw json::parse_error(std::string{label} + " targets a forbidden identity family.");
}

[[nodiscard]] inline const graph_identity_claim& require_renderable_identity(
	const graph_identity_index& identities,
	const std::string& identity,
	const std::string_view label
) {
	return require_graph_identity(identities, identity, {
		graph_identity_kind::source,
		graph_identity_kind::generator_source,
		graph_identity_kind::clip,
		graph_identity_kind::transition,
		graph_identity_kind::visual_model,
	}, label);
}

} // namespace framescaper::media::unified
