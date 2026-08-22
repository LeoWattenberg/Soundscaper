/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "unified_plan_common.hpp"

#include <array>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace framescaper::media::unified {

struct crop_curve_segment final {
	std::string kind;
	std::pair<std::int64_t, std::int64_t> control1_position{};
	std::pair<std::int64_t, std::int64_t> control2_position{};
	double control1_value{};
	double control2_value{};
};

struct crop_curve_authority final {
	std::vector<std::pair<std::int64_t, std::int64_t>> positions;
	std::vector<double> values;
	std::vector<crop_curve_segment> segments;
};

[[nodiscard]] inline crop_curve_authority parse_crop_curve(const json::value& value) {
	crop_curve_authority result;
	const auto& anchors = json::array(json::member(value, "anchors"), "crop keyframe anchors");
	const auto& segments = json::array(json::member(value, "segments"), "crop keyframe segments");
	for (const auto& anchor : anchors) {
		result.positions.push_back(rational(json::member(anchor, "position"), "crop anchor position"));
		result.values.push_back(bounded_number(json::member(anchor, "value"), "crop anchor value", 0, 1));
	}
	for (const auto& segment : segments) {
		crop_curve_segment parsed;
		parsed.kind = text(json::member(segment, "kind"), "crop segment kind");
		if (parsed.kind == "bezier") {
			const auto& first = json::member(segment, "control1");
			const auto& second = json::member(segment, "control2");
			parsed.control1_position = rational(json::member(first, "position"), "crop first control position");
			parsed.control2_position = rational(json::member(second, "position"), "crop second control position");
			parsed.control1_value = bounded_number(json::member(first, "value"), "crop first control value", 0, 1);
			parsed.control2_value = bounded_number(json::member(second, "value"), "crop second control value", 0, 1);
		}
		result.segments.push_back(std::move(parsed));
	}
	return result;
}

inline void require_crop_aperture(const double first, const double second) {
	if (1 - (first + second) < 1e-9) {
		throw json::parse_error("Paired crop keyframes do not retain their minimum aperture.");
	}
}

inline void validate_crop_pair(
	const crop_curve_authority* first,
	const crop_curve_authority* second,
	const double first_constant,
	const double second_constant
) {
	if (first == nullptr && second == nullptr) return;
	if (first == nullptr || second == nullptr) {
		const auto& curve = first == nullptr ? *second : *first;
		const auto constant = first == nullptr ? first_constant : second_constant;
		for (const auto value : curve.values) require_crop_aperture(value, constant);
		for (const auto& segment : curve.segments) if (segment.kind == "bezier") {
			require_crop_aperture(segment.control1_value, constant);
			require_crop_aperture(segment.control2_value, constant);
		}
		return;
	}
	if (first->positions != second->positions || first->segments.size() != second->segments.size()) {
		throw json::parse_error("Paired crop curves have different anchor or segment geometry.");
	}
	for (std::size_t index = 0; index < first->segments.size(); ++index) {
		const auto& left = first->segments[index];
		const auto& right = second->segments[index];
		if (left.kind != right.kind || (left.kind == "bezier"
			&& (left.control1_position != right.control1_position
				|| left.control2_position != right.control2_position))) {
			throw json::parse_error("Paired crop curves have different segment geometry.");
		}
	}
	for (std::size_t index = 0; index < first->values.size(); ++index) {
		require_crop_aperture(first->values[index], second->values[index]);
	}
	for (std::size_t index = 0; index < first->segments.size(); ++index) {
		const auto& left = first->segments[index];
		const auto& right = second->segments[index];
		if (left.kind == "bezier") {
			require_crop_aperture(left.control1_value, right.control1_value);
			require_crop_aperture(left.control2_value, right.control2_value);
		}
	}
}

inline void validate_picture_crop_keyframe_closure(const json::value& picture_state) {
	const auto& crop = json::member(json::member(picture_state, "composition"), "crop");
	const std::array<double, 4> constants{
		bounded_number(json::member(crop, "left"), "crop left", 0, 1),
		bounded_number(json::member(crop, "top"), "crop top", 0, 1),
		bounded_number(json::member(crop, "right"), "crop right", 0, 1),
		bounded_number(json::member(crop, "bottom"), "crop bottom", 0, 1),
	};
	std::map<std::string, crop_curve_authority> curves;
	const auto& keyframes = json::member(picture_state, "videoKeyframes");
	for (const auto& row : json::array(json::member(keyframes, "curves"), "picture keyframe curves")) {
		const auto& target = json::member(row, "target");
		if (json::string(json::member(target, "kind"), "keyframe target kind") != "composition") continue;
		const auto id = json::string(json::member(target, "parameterId"), "keyframe parameter ID");
		if (id == "crop.left" || id == "crop.top" || id == "crop.right" || id == "crop.bottom") {
			curves.emplace(std::string{id}, parse_crop_curve(json::member(row, "curve")));
		}
	}
	const auto find = [&](const std::string& id) -> const crop_curve_authority* {
		const auto found = curves.find(id);
		return found == curves.end() ? nullptr : &found->second;
	};
	validate_crop_pair(find("crop.left"), find("crop.right"), constants[0], constants[2]);
	validate_crop_pair(find("crop.top"), find("crop.bottom"), constants[1], constants[3]);
}

} // namespace framescaper::media::unified
