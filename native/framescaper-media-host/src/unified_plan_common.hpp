/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "sha256.hpp"
#include "strict_json.hpp"

#if __has_include(<boost/multiprecision/cpp_int.hpp>)
#include "exact_retime_ordinal.hpp"
#define FRAMESCAPER_HAS_EXACT_RETIME_MULTIPRECISION 1
#endif

#include <algorithm>
#include <cctype>
#include <charconv>
#include <cmath>
#include <cstdint>
#include <initializer_list>
#include <limits>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace framescaper::media::unified {

constexpr std::int64_t maximum_safe_integer = 9'007'199'254'740'991;

inline void exact(const json::value& value, const std::initializer_list<std::string_view> keys) {
	json::require_exact_keys(value, std::vector<std::string_view>{keys});
}

[[nodiscard]] inline std::int64_t safe_integer(
	const json::value& value,
	const std::string_view label,
	const std::int64_t minimum = 0
) {
	const auto result = json::integer(value, label);
	if (result < minimum || result > maximum_safe_integer) {
		throw json::parse_error(std::string{label} + " is outside its safe integer domain.");
	}
	return result;
}

[[nodiscard]] inline std::string text(const json::value& value, const std::string_view label) {
	const auto result = json::string(value, label);
	if (result.empty() || result.size() > 4'096 || result.find('\0') != std::string_view::npos) {
		throw json::parse_error(std::string{label} + " is not bounded nonempty text.");
	}
	return std::string{result};
}

[[nodiscard]] inline std::string stable_id(const json::value& value, const std::string_view label) {
	const auto result = text(value, label);
	const auto permitted = [](const unsigned char byte) {
		return std::isalnum(byte) != 0 || byte == '.' || byte == '_' || byte == ':'
			|| byte == '/' || byte == '-';
	};
	if (std::isalnum(static_cast<unsigned char>(result.front())) == 0
		|| !std::all_of(result.begin() + 1, result.end(), permitted)) {
		throw json::parse_error(std::string{label} + " is not a canonical stable ID.");
	}
	return result;
}

[[nodiscard]] inline std::string digest(const json::value& value, const std::string_view label) {
	const auto result = json::string(value, label);
	if (result.size() != 64 || !std::all_of(result.begin(), result.end(), [](const unsigned char byte) {
		return std::isdigit(byte) != 0 || (byte >= 'a' && byte <= 'f');
	})) throw json::parse_error(std::string{label} + " is not lowercase SHA-256.");
	return std::string{result};
}

inline void literal(
	const json::value& value,
	const std::string_view expected,
	const std::string_view label
) {
	if (json::string(value, label) != expected) {
		throw json::parse_error(std::string{label} + " is unsupported.");
	}
}

inline void literal(
	const json::value& value,
	const std::int64_t expected,
	const std::string_view label
) {
	if (json::integer(value, label) != expected) {
		throw json::parse_error(std::string{label} + " is unsupported.");
	}
}

[[nodiscard]] inline std::pair<std::int64_t, std::int64_t> rational(
	const json::value& value,
	const std::string_view label,
	const bool positive_numerator = false
) {
	exact(value, {"num", "den"});
	auto left = json::integer(json::member(value, "num"), label);
	if (left < (positive_numerator ? 1 : -maximum_safe_integer) || left > maximum_safe_integer) {
		throw json::parse_error(std::string{label} + " numerator is outside its domain.");
	}
	auto right = safe_integer(json::member(value, "den"), label, 1);
	const auto result = std::pair{left, right};
	left = left < 0 ? -left : left;
	while (right != 0) { const auto remainder = left % right; left = right; right = remainder; }
	if (left != 1) throw json::parse_error(std::string{label} + " is not reduced.");
	return result;
}

[[nodiscard]] inline std::pair<std::int64_t, std::int64_t> rate(
	const json::value& value,
	const std::string_view label
) { return rational(value, label, true); }

inline void unique(std::set<std::string>& values, const std::string& value, const std::string_view label) {
	if (!values.insert(value).second) throw json::parse_error(std::string{label} + " is duplicated.");
}

inline void decimal_rational(
	const json::value& value,
	const std::string_view label
) {
	exact(value, {"numerator", "denominator"});
	const auto numerator = json::string(json::member(value, "numerator"), label);
	const auto denominator = json::string(json::member(value, "denominator"), label);
	const auto canonical_numerator = [](const std::string_view token) {
		if (token == "0") return true;
		std::size_t offset = token.starts_with('-') ? 1U : 0U;
		return offset < token.size() && token[offset] >= '1' && token[offset] <= '9'
			&& std::all_of(token.begin() + static_cast<std::ptrdiff_t>(offset + 1), token.end(), [](const unsigned char byte) {
				return std::isdigit(byte) != 0;
			});
	};
	if (!canonical_numerator(numerator) || denominator.empty() || denominator.front() < '1'
		|| denominator.front() > '9' || !std::all_of(denominator.begin() + 1, denominator.end(), [](const unsigned char byte) {
			return std::isdigit(byte) != 0;
		}) || numerator.size() > 1'235 || denominator.size() > 1'234) {
		throw json::parse_error(std::string{label} + " is not a bounded decimal rational.");
	}
	#if defined(FRAMESCAPER_HAS_EXACT_RETIME_MULTIPRECISION)
	using soundscaper::framescaper::cpp_int;
	using soundscaper::framescaper::exact_wire_rational;
	const cpp_int raw_numerator{std::string{numerator}};
	const cpp_int raw_denominator{std::string{denominator}};
	const auto normalized = exact_wire_rational(raw_numerator, raw_denominator);
	if (normalized.numerator() != raw_numerator || normalized.denominator() != raw_denominator) {
		throw json::parse_error(std::string{label} + " is not canonically reduced.");
	}
	#endif
}

inline void finite_number(const json::value& value, const std::string_view label) {
	double parsed{};
	const auto converted = std::from_chars(
		value.text.data(), value.text.data() + value.text.size(), parsed, std::chars_format::general
	);
	if (value.kind != json::type::number || value.text.empty() || value.text.size() > 64
		|| value.text == "-0" || converted.ec != std::errc{}
		|| converted.ptr != value.text.data() + value.text.size() || !std::isfinite(parsed)) {
		throw json::parse_error(std::string{label} + " is not a canonical finite number.");
	}
}

[[nodiscard]] inline double bounded_number(
	const json::value& value,
	const std::string_view label,
	const double minimum,
	const double maximum
) {
	finite_number(value, label);
	double result{};
	static_cast<void>(std::from_chars(
		value.text.data(), value.text.data() + value.text.size(), result, std::chars_format::general
	));
	if (result < minimum || result > maximum) {
		throw json::parse_error(std::string{label} + " is outside its closed numeric domain.");
	}
	return result;
}

inline void nullable_digest(const json::value& value, const std::string_view label) {
	if (value.kind != json::type::null_value) static_cast<void>(digest(value, label));
}

inline void append_json_string(std::string& output, const std::string_view value) {
	static constexpr char hex[] = "0123456789abcdef";
	output += '"';
	for (const unsigned char byte : value) {
		if (byte == '"' || byte == '\\') { output += '\\'; output += static_cast<char>(byte); }
		else if (byte == '\b') output += "\\b";
		else if (byte == '\f') output += "\\f";
		else if (byte == '\n') output += "\\n";
		else if (byte == '\r') output += "\\r";
		else if (byte == '\t') output += "\\t";
		else if (byte < 0x20U) {
			output += "\\u00";
			output += hex[byte >> 4U];
			output += hex[byte & 0x0fU];
		} else output += static_cast<char>(byte);
	}
	output += '"';
}

inline void append_canonical_json(std::string& output, const json::value& value) {
	switch (value.kind) {
	case json::type::null_value: output += "null"; return;
	case json::type::boolean: output += value.boolean ? "true" : "false"; return;
	case json::type::number: output += value.text; return;
	case json::type::string: append_json_string(output, value.text); return;
	case json::type::array:
		output += '[';
		for (std::size_t index = 0; index < value.items.size(); ++index) {
			if (index != 0) output += ',';
			append_canonical_json(output, value.items[index]);
		}
		output += ']';
		return;
	case json::type::object:
		output += '{';
		for (std::size_t index = 0; index < value.members.size(); ++index) {
			if (index != 0) output += ',';
			append_json_string(output, value.members[index].first);
			output += ':';
			append_canonical_json(output, value.members[index].second);
		}
		output += '}';
	}
}

[[nodiscard]] inline std::string semantic_sha256(const json::value& value) {
	std::string canonical;
	append_canonical_json(canonical, value);
	return sha256_bytes(reinterpret_cast<const std::uint8_t*>(canonical.data()), canonical.size());
}

struct picture_parameter final {
	double minimum{};
	double maximum{};
	bool integer{};
};

using picture_parameter_index = std::map<std::string, picture_parameter>;
using picture_effect_index = std::map<std::string, picture_parameter_index>;

[[nodiscard]] inline picture_parameter_index composition_parameters() {
	return {
		{"crop.left", {0, 1, false}}, {"crop.top", {0, 1, false}},
		{"crop.right", {0, 1, false}}, {"crop.bottom", {0, 1, false}},
		{"transform.anchorX", {0, 1, false}}, {"transform.anchorY", {0, 1, false}},
		{"transform.positionX", {-8, 8, false}}, {"transform.positionY", {-8, 8, false}},
		{"transform.scaleX", {0.01, 100, false}}, {"transform.scaleY", {0.01, 100, false}},
		{"transform.rotationDegrees", {-36'000, 36'000, false}}, {"opacity", {0, 1, false}},
	};
}

[[nodiscard]] inline const picture_parameter_index& effect_parameters(const std::string& type) {
	static const std::map<std::string, picture_parameter_index> definitions{
		{"color-adjust", {{"brightness", {-1, 1, false}}, {"contrast", {0, 2, false}},
			{"saturation", {0, 3, false}}, {"gamma", {0.25, 4, false}}, {"hueDegrees", {-180, 180, false}}}},
		{"pixelate", {{"blockSize", {2, 128, true}}}}, {"vignette", {{"amount", {0, 1, false}}}},
		{"gaussian-blur", {{"sigma", {0, 20, false}}}}, {"sharpen", {{"amount", {0, 2, false}}}},
		{"rgb-split", {{"offsetX", {-64, 64, true}}, {"offsetY", {-64, 64, true}}}},
		{"chroma-key", {{"keyColor", {0, 16'777'215, true}}, {"similarity", {0.01, 1, false}}, {"softness", {0, 1, false}}}},
		{"luma-key", {{"mode", {0, 1, true}}, {"cutoff", {0, 1, false}}, {"softness", {0, 1, false}}}},
		{"spill-suppression", {{"screen", {0, 1, true}}, {"strength", {0, 1, false}}}},
		{"glow", {{"threshold", {0, 1, false}}, {"sigma", {0, 20, false}}, {"intensity", {0, 1, false}}}},
		{"outline", {{"width", {0, 16, true}}, {"color", {0, 16'777'215, true}}, {"opacity", {0, 1, false}}}},
		{"drop-shadow", {{"offsetX", {-64, 64, true}}, {"offsetY", {-64, 64, true}},
			{"sigma", {0, 20, false}}, {"opacity", {0, 1, false}}, {"color", {0, 16'777'215, true}}}},
	};
	const auto found = definitions.find(type);
	if (found == definitions.end()) throw json::parse_error("Unified picture effect type is unsupported.");
	return found->second;
}

[[nodiscard]] inline std::vector<std::string_view> effect_parameter_order(const std::string& type) {
	if (type == "color-adjust") return {"brightness", "contrast", "saturation", "gamma", "hueDegrees"};
	if (type == "pixelate") return {"blockSize"};
	if (type == "vignette" || type == "sharpen") return {"amount"};
	if (type == "gaussian-blur") return {"sigma"};
	if (type == "rgb-split") return {"offsetX", "offsetY"};
	if (type == "chroma-key") return {"keyColor", "similarity", "softness"};
	if (type == "luma-key") return {"mode", "cutoff", "softness"};
	if (type == "spill-suppression") return {"screen", "strength"};
	if (type == "glow") return {"threshold", "sigma", "intensity"};
	if (type == "outline") return {"width", "color", "opacity"};
	if (type == "drop-shadow") return {"offsetX", "offsetY", "sigma", "opacity", "color"};
	throw json::parse_error("Unified picture effect type is unsupported.");
}

inline void validate_parameter_value(
	const json::value& value, const picture_parameter& parameter, const std::string_view label
) {
	const auto number = bounded_number(value, label, parameter.minimum, parameter.maximum);
	if (parameter.integer && number != static_cast<double>(json::integer(value, label))) {
		throw json::parse_error(std::string{label} + " must be an integer.");
	}
}

inline void validate_track_state(const json::value& value) {
	exact(value, {"sequenceOrder", "mute", "solo", "hidden"});
	static_cast<void>(safe_integer(json::member(value, "sequenceOrder"), "clip track sequence order"));
	for (const auto key : {"mute", "solo", "hidden"}) static_cast<void>(json::boolean(json::member(value, key), key));
}

inline void validate_composition(const json::value& value) {
	exact(value, {"schemaVersion", "crop", "transform", "opacity", "blendMode", "compositingOrder"});
	literal(json::member(value, "schemaVersion"), 1, "picture composition schema");
	const auto& crop = json::member(value, "crop");
	exact(crop, {"left", "top", "right", "bottom"});
	const auto left = bounded_number(json::member(crop, "left"), "crop left", 0, 1);
	const auto top = bounded_number(json::member(crop, "top"), "crop top", 0, 1);
	const auto right = bounded_number(json::member(crop, "right"), "crop right", 0, 1);
	const auto bottom = bounded_number(json::member(crop, "bottom"), "crop bottom", 0, 1);
	if (left + right > 1 - 1e-9 || top + bottom > 1 - 1e-9) {
		throw json::parse_error("Unified picture crop has no visible aperture.");
	}
	const auto& transform = json::member(value, "transform");
	exact(transform, {"anchorX", "anchorY", "positionX", "positionY", "scaleX", "scaleY", "rotationDegrees", "flipHorizontal", "flipVertical"});
	for (const auto& [key, bounds] : std::map<std::string_view, std::pair<double, double>>{
		{"anchorX", {0, 1}}, {"anchorY", {0, 1}}, {"positionX", {-8, 8}}, {"positionY", {-8, 8}},
		{"scaleX", {0.01, 100}}, {"scaleY", {0.01, 100}}, {"rotationDegrees", {-36'000, 36'000}},
	}) static_cast<void>(bounded_number(json::member(transform, key), key, bounds.first, bounds.second));
	for (const auto key : {"flipHorizontal", "flipVertical"}) {
		static_cast<void>(json::boolean(json::member(transform, key), key));
	}
	static_cast<void>(bounded_number(json::member(value, "opacity"), "picture opacity", 0, 1));
	const auto blend = text(json::member(value, "blendMode"), "picture blend mode");
	if (!std::set<std::string>{"normal", "multiply", "screen", "overlay", "darken", "lighten", "difference", "exclusion"}.contains(blend)) {
		throw json::parse_error("Unified picture blend mode is unsupported.");
	}
	const auto order = json::integer(json::member(value, "compositingOrder"), "picture compositing order");
	if (order < -32'768 || order > 32'767) throw json::parse_error("Picture compositing order is outside its domain.");
}

[[nodiscard]] inline picture_effect_index validate_effects(const json::value& value) {
	const auto& effects = json::array(value, "unified picture effects");
	if (effects.size() > 4'096) throw json::parse_error("Unified picture effect ceiling is exceeded.");
	picture_effect_index by_id;
	for (const auto& effect : effects) {
		exact(effect, {"id", "type", "enabled", "params"});
		const auto id = stable_id(json::member(effect, "id"), "picture effect ID");
		const auto type = text(json::member(effect, "type"), "picture effect type");
		static_cast<void>(json::boolean(json::member(effect, "enabled"), "picture effect enabled"));
		const auto& definitions = effect_parameters(type);
		const auto& params = json::member(effect, "params");
		const auto keys = effect_parameter_order(type);
		for (const auto name : keys) validate_parameter_value(json::member(params, name), definitions.at(std::string{name}), name);
		json::require_exact_keys(params, keys);
		if (!by_id.emplace(id, definitions).second) throw json::parse_error("Unified picture effect ID is duplicated.");
	}
	return by_id;
}

[[nodiscard]] inline int compare_rationals(
	const std::pair<std::int64_t, std::int64_t>& left,
	const std::pair<std::int64_t, std::int64_t>& right
) {
	if (left.first < 0 && right.first >= 0) return -1;
	if (left.first >= 0 && right.first < 0) return 1;
	const bool negative = left.first < 0;
	auto left_num = static_cast<std::uint64_t>(negative ? -left.first : left.first);
	auto right_num = static_cast<std::uint64_t>(negative ? -right.first : right.first);
	auto left_den = static_cast<std::uint64_t>(left.second);
	auto right_den = static_cast<std::uint64_t>(right.second);
	bool inverse = false;
	for (;;) {
		const auto left_whole = left_num / left_den;
		const auto right_whole = right_num / right_den;
		if (left_whole != right_whole) {
			const auto result = left_whole < right_whole ? -1 : 1;
			return (inverse ? -result : result) * (negative ? -1 : 1);
		}
		const auto left_remainder = left_num % left_den;
		const auto right_remainder = right_num % right_den;
		if (left_remainder == 0 || right_remainder == 0) {
			if (left_remainder == right_remainder) return 0;
			const auto result = left_remainder == 0 ? -1 : 1;
			return (inverse ? -result : result) * (negative ? -1 : 1);
		}
		left_num = left_den; left_den = left_remainder;
		right_num = right_den; right_den = right_remainder;
		inverse = !inverse;
	}
}

[[nodiscard]] inline std::pair<std::int64_t, std::int64_t> validate_curve_anchor(
	const json::value& value,
	const picture_parameter& parameter,
	const std::pair<std::int64_t, std::int64_t>& authored_duration,
	std::pair<std::int64_t, std::int64_t>* previous = nullptr
) {
	exact(value, {"position", "value"});
	const auto position = rational(json::member(value, "position"), "picture keyframe position");
	if (position.first < 0 || compare_rationals(position, authored_duration) > 0
		|| (previous != nullptr && compare_rationals(*previous, position) >= 0)) {
		throw json::parse_error("Picture keyframe positions are outside canonical authored order.");
	}
	validate_parameter_value(json::member(value, "value"), parameter, "picture keyframe value");
	if (previous != nullptr) *previous = position;
	return position;
}

inline void validate_picture_keyframes(
	const json::value& value,
	const std::int64_t clip_duration,
	const picture_effect_index& effects
) {
	exact(value, {"schemaVersion", "timeDomain", "curves"});
	literal(json::member(value, "schemaVersion"), 1, "picture keyframe schema");
	const auto& domain = json::member(value, "timeDomain");
	exact(domain, {"authoredDuration", "viewStart", "viewDuration"});
	const auto authored = rational(json::member(domain, "authoredDuration"), "keyframe authored duration", true);
	const auto view_start = rational(json::member(domain, "viewStart"), "keyframe view start");
	const auto view_duration = rational(json::member(domain, "viewDuration"), "keyframe view duration", true);
	if (view_start.first < 0 || compare_rationals(view_start, authored) > 0
		|| compare_rationals(view_duration, authored) > 0) {
		throw json::parse_error("Picture keyframe view escapes its authored domain.");
	}
#if defined(FRAMESCAPER_HAS_EXACT_RETIME_MULTIPRECISION)
	using soundscaper::framescaper::ExactRational;
	if (soundscaper::framescaper::compare(
		ExactRational(view_start.first, view_start.second) + ExactRational(view_duration.first, view_duration.second),
		ExactRational(authored.first, authored.second)
	) > 0) throw json::parse_error("Picture keyframe view escapes its authored domain.");
#endif
	static_cast<void>(clip_duration);
	const auto& curves = json::array(json::member(value, "curves"), "picture keyframe curves");
	if (curves.size() > 256) throw json::parse_error("Picture keyframe curve ceiling is exceeded.");
	const auto composition = composition_parameters();
	std::set<std::string> targets;
	std::string previous_target;
	for (const auto& curve_row : curves) {
		exact(curve_row, {"target", "curve"});
		const auto& target = json::member(curve_row, "target");
		const auto kind = text(json::member(target, "kind"), "picture keyframe target kind");
		picture_parameter parameter;
		std::string identity;
		if (kind == "composition") {
			exact(target, {"kind", "parameterId"});
			const auto parameter_id = text(json::member(target, "parameterId"), "composition parameter ID");
			const auto found = composition.find(parameter_id);
			if (found == composition.end()) throw json::parse_error("Picture composition keyframe target is unsupported.");
			parameter = found->second;
			identity = kind; identity += '\0'; identity += parameter_id;
		} else if (kind == "video-effect") {
			exact(target, {"kind", "effectId", "parameterId"});
			const auto effect_id = text(json::member(target, "effectId"), "keyframe effect ID");
			const auto parameter_id = text(json::member(target, "parameterId"), "effect parameter ID");
			const auto effect = effects.find(effect_id);
			if (effect == effects.end() || !effect->second.contains(parameter_id)) {
				throw json::parse_error("Picture effect keyframe target is unsupported.");
			}
			parameter = effect->second.at(parameter_id);
			identity = kind; identity += '\0'; identity += effect_id; identity += '\0'; identity += parameter_id;
		} else throw json::parse_error("Picture keyframe target kind is unsupported.");
		if ((!previous_target.empty() && identity <= previous_target)
			|| !targets.insert(identity).second) {
			throw json::parse_error("Picture keyframe targets are not unique canonical order.");
		}
		previous_target = identity;
		const auto& curve = json::member(curve_row, "curve");
		exact(curve, {"anchors", "segments"});
		const auto& anchors = json::array(json::member(curve, "anchors"), "picture keyframe anchors");
		const auto& segments = json::array(json::member(curve, "segments"), "picture keyframe segments");
		if (anchors.size() < 2 || anchors.size() > 4'096 || anchors.size() != segments.size() + 1) {
			throw json::parse_error("Picture keyframe curve geometry is invalid.");
		}
		std::pair<std::int64_t, std::int64_t> previous{-1, 1};
		std::vector<std::pair<std::int64_t, std::int64_t>> positions;
		for (const auto& anchor : anchors) positions.push_back(
			validate_curve_anchor(anchor, parameter, authored, &previous)
		);
		for (std::size_t index = 0; index < segments.size(); ++index) {
			const auto& segment = segments[index];
			const auto segment_kind = text(json::member(segment, "kind"), "picture keyframe segment kind");
			// Checked before the kind dispatch: a Bezier between two integral
			// anchors still evaluates to fractional values across the span, which
			// is exactly what this rule keeps away from an integer-only parameter.
			if (parameter.integer && segment_kind != "hold") {
				throw json::parse_error("An integer picture keyframe target requires hold segments.");
			}
			if (segment_kind == "bezier") {
				exact(segment, {"kind", "control1", "control2"});
				const auto control1 = validate_curve_anchor(json::member(segment, "control1"), parameter, authored);
				const auto control2 = validate_curve_anchor(json::member(segment, "control2"), parameter, authored);
				if (compare_rationals(positions[index], control1) > 0
					|| compare_rationals(control1, control2) > 0
					|| compare_rationals(control2, positions[index + 1]) > 0) {
					throw json::parse_error("Picture Bezier controls escape their owning segment span.");
				}
			} else {
				exact(segment, {"kind"});
				if (segment_kind != "hold" && segment_kind != "linear" && segment_kind != "eased") {
					throw json::parse_error("Picture keyframe segment kind is unsupported.");
				}
			}
		}
	}
}

[[nodiscard]] inline picture_effect_index validate_picture_state(
	const json::value& value,
	const std::int64_t clip_duration
) {
	exact(value, {"composition", "videoEffects", "videoKeyframes"});
	validate_composition(json::member(value, "composition"));
	const auto effects = validate_effects(json::member(value, "videoEffects"));
	validate_picture_keyframes(json::member(value, "videoKeyframes"), clip_duration, effects);
	return effects;
}

} // namespace framescaper::media::unified
