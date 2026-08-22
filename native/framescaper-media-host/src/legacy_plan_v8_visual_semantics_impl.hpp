/* SPDX-License-Identifier: AGPL-3.0-only */

#include "legacy_plan_v8_visual_semantics.hpp"
#include "legacy_plan_values.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <numeric>
#include <numbers>
#include <set>
#include <span>
#include <string_view>

namespace framescaper::media::legacy {
namespace {
namespace v8_visual_detail {

constexpr std::size_t maximum_clips = 100'000;
constexpr std::size_t maximum_effects_per_clip = 4'096;
constexpr std::size_t maximum_intervals = 100'000;
constexpr std::size_t maximum_layers = 4'096;
constexpr std::array<std::string_view, 8> blend_modes = {
	"normal", "multiply", "screen", "overlay", "darken", "lighten", "difference", "exclusion",
};

struct parameter_rule final {
	std::string_view name;
	double minimum;
	double maximum;
	bool integer;
	std::string_view default_number;
};

struct effect_rule final {
	std::string_view type;
	std::span<const parameter_rule> parameters;
};

constexpr parameter_rule color_adjust[] = {
	{"brightness", -1, 1, false, "0"}, {"contrast", 0, 2, false, "1"},
	{"saturation", 0, 3, false, "1"}, {"gamma", 0.25, 4, false, "1"},
	{"hueDegrees", -180, 180, false, "0"},
};
constexpr parameter_rule pixelate[] = {{"blockSize", 2, 128, true, "16"}};
constexpr parameter_rule vignette[] = {{"amount", 0, 1, false, "0.5"}};
constexpr parameter_rule gaussian_blur[] = {{"sigma", 0, 20, false, "4"}};
constexpr parameter_rule sharpen[] = {{"amount", 0, 2, false, "0.5"}};
constexpr parameter_rule rgb_split[] = {
	{"offsetX", -64, 64, true, "6"}, {"offsetY", -64, 64, true, "0"},
};
constexpr parameter_rule chroma_key[] = {
	{"keyColor", 0, 0xffffff, true, "65280"}, {"similarity", 0.01, 1, false, "0.1"},
	{"softness", 0, 1, false, "0.1"},
};
constexpr parameter_rule luma_key[] = {
	{"mode", 0, 1, true, "0"}, {"cutoff", 0, 1, false, "0.2"},
	{"softness", 0, 1, false, "0.1"},
};
constexpr parameter_rule spill_suppression[] = {
	{"screen", 0, 1, true, "0"}, {"strength", 0, 1, false, "0.5"},
};
constexpr parameter_rule glow[] = {
	{"threshold", 0, 1, false, "0.7"}, {"sigma", 0, 20, false, "8"},
	{"intensity", 0, 1, false, "0.5"},
};
constexpr parameter_rule outline[] = {
	{"width", 0, 16, true, "4"}, {"color", 0, 0xffffff, true, "16777215"},
	{"opacity", 0, 1, false, "1"},
};
constexpr parameter_rule drop_shadow[] = {
	{"offsetX", -64, 64, true, "8"}, {"offsetY", -64, 64, true, "8"},
	{"sigma", 0, 20, false, "6"}, {"opacity", 0, 1, false, "0.6"},
	{"color", 0, 0xffffff, true, "0"},
};
constexpr effect_rule effect_rules[] = {
	{"color-adjust", color_adjust}, {"pixelate", pixelate}, {"vignette", vignette},
	{"gaussian-blur", gaussian_blur}, {"sharpen", sharpen}, {"rgb-split", rgb_split},
	{"chroma-key", chroma_key}, {"luma-key", luma_key}, {"spill-suppression", spill_suppression},
	{"glow", glow}, {"outline", outline}, {"drop-shadow", drop_shadow},
};

[[nodiscard]] const effect_rule& rule_for(const std::string_view type) {
	const auto found = std::find_if(std::begin(effect_rules), std::end(effect_rules), [&](const auto& rule) {
		return rule.type == type;
	});
	if (found == std::end(effect_rules)) throw json::parse_error("A V8 video effect type is unsupported.");
	return *found;
}

[[nodiscard]] bool nearly_equal(const double left, const double right) noexcept {
	const auto scale = std::max({1.0, std::abs(left), std::abs(right)});
	return std::abs(left - right) <= scale * 1e-9;
}

[[nodiscard]] std::uint64_t near_positive_integer(const double value, const std::string_view label) {
	const auto rounded = std::floor(value + 0.5);
	if (rounded < 1 || rounded > static_cast<double>(maximum_safe_integer) || !nearly_equal(value, rounded)) {
		throw json::parse_error(std::string{label} + " does not resolve to a positive safe integer.");
	}
	return static_cast<std::uint64_t>(rounded);
}

[[nodiscard]] std::int64_t javascript_round(const double value) {
	return static_cast<std::int64_t>(std::floor(value + 0.5));
}

[[nodiscard]] std::string number_token(const json::value& value, const std::string_view label) {
	static_cast<void>(finite_number(value, label));
	return value.text;
}

[[nodiscard]] v8_source_presentation presentation(const json::value& value) {
	exact(value, {"autorotate", "decodedWidth", "decodedHeight", "sampleAspect", "scaledWidth", "scaledHeight"});
	if (!json::boolean(json::member(value, "autorotate"), "V8 source autorotate")) {
		throw json::parse_error("V8 source presentation must apply container autorotation exactly once.");
	}
	const auto decoded_width = safe_integer(json::member(value, "decodedWidth"), "V8 decoded width", 1);
	const auto decoded_height = safe_integer(json::member(value, "decodedHeight"), "V8 decoded height", 1);
	const auto& aspect = json::member(value, "sampleAspect");
	exact(aspect, {"num", "den"});
	const auto aspect_num = safe_integer(json::member(aspect, "num"), "V8 sample aspect numerator", 1);
	const auto aspect_den = safe_integer(json::member(aspect, "den"), "V8 sample aspect denominator", 1);
	const auto scaled_width = safe_integer(json::member(value, "scaledWidth"), "V8 scaled width", 1);
	const auto scaled_height = safe_integer(json::member(value, "scaledHeight"), "V8 scaled height", 1);
	if (scaled_width == decoded_width && scaled_height == decoded_height) {
		throw json::parse_error("V8 source presentation must state a residual stretch.");
	}
	return {
		static_cast<std::uint64_t>(decoded_width), static_cast<std::uint64_t>(decoded_height),
		static_cast<std::uint64_t>(aspect_num), static_cast<std::uint64_t>(aspect_den),
		static_cast<std::uint64_t>(scaled_width), static_cast<std::uint64_t>(scaled_height),
	};
}

[[nodiscard]] std::vector<v8_visual_source> sources(const json::value& root) {
	std::vector<v8_visual_source> result;
	std::set<std::string> source_ids;
	const auto& inputs = json::array(json::member(root, "inputs"), "V8 visual inputs");
	for (std::size_t index = 0; index < inputs.size(); ++index) {
		const auto& input = inputs[index];
		if (json::string(json::member(input, "kind"), "V8 visual input kind") != "video-source") continue;
		v8_visual_source source;
		source.input_index = static_cast<std::size_t>(safe_integer(json::member(input, "inputIndex"), "V8 source index"));
		if (source.input_index != index) throw json::parse_error("V8 source input indices must equal their positions.");
		source.source_id = id(json::member(input, "sourceId"), "V8 source ID");
		unique(source_ids, source.source_id, "V8 source ID");
		source.storage_key = text(json::member(input, "storageKey"), "V8 source storage key", 1'024);
		source.mime_type = text(json::member(input, "mimeType"), "V8 source MIME", 128);
		if (!video_mime(source.mime_type)) throw json::parse_error("A V8 source MIME type is not canonical.");
		const auto& source_presentation = json::member(input, "presentation");
		if (!is_null(source_presentation)) source.presentation = presentation(source_presentation);
		result.push_back(std::move(source));
	}
	return result;
}

[[nodiscard]] std::vector<v8_visual_effect> effects(const json::value& value) {
	const auto& values = json::array(value, "V8 video effects");
	if (values.size() > maximum_effects_per_clip) throw json::parse_error("A V8 effect stack exceeds its ceiling.");
	std::set<std::string> ids;
	std::vector<v8_visual_effect> result;
	result.reserve(values.size());
	for (const auto& value_effect : values) {
		exact(value_effect, {"id", "type", "enabled", "params"});
		v8_visual_effect effect;
		effect.id = id(json::member(value_effect, "id"), "V8 effect ID");
		unique(ids, effect.id, "V8 effect ID");
		effect.type = text(json::member(value_effect, "type"), "V8 effect type", 64);
		effect.enabled = json::boolean(json::member(value_effect, "enabled"), "V8 effect enabled flag");
		const auto& rule = rule_for(effect.type);
		const auto& params = json::member(value_effect, "params");
		if (params.kind != json::type::object) throw json::parse_error("V8 effect params must be an object.");
		std::size_t member_index = 0;
		for (const auto& parameter : rule.parameters) {
			std::string captured{parameter.default_number};
			if (member_index < params.members.size() && params.members[member_index].first == parameter.name) {
				const auto& value_number = params.members[member_index++].second;
				const auto number = bounded_number(value_number, "V8 effect parameter", parameter.minimum, parameter.maximum);
				if (parameter.integer && (!nearly_equal(number, std::trunc(number))
					|| std::abs(number) > static_cast<double>(maximum_safe_integer))) {
					throw json::parse_error("A V8 effect integer parameter is not a safe integer.");
				}
				captured = value_number.text;
			}
			effect.parameters.push_back({std::string{parameter.name}, std::move(captured)});
		}
		if (member_index != params.members.size()) {
			throw json::parse_error("V8 effect params contain an unknown or reordered member.");
		}
		result.push_back(std::move(effect));
	}
	return result;
}

struct placement final {
	std::uint64_t width{};
	std::uint64_t height{};
	std::int64_t x{};
	std::int64_t y{};
};

[[nodiscard]] placement canvas_placement(
	const v8_visual_canvas& canvas,
	const std::uint64_t source_width,
	const std::uint64_t source_height
) {
	const auto width_ratio = static_cast<double>(canvas.width) / static_cast<double>(source_width);
	const auto height_ratio = static_cast<double>(canvas.height) / static_cast<double>(source_height);
	const auto scale_x = canvas.fit == "stretch" ? width_ratio : canvas.fit == "cover"
		? std::max(width_ratio, height_ratio) : std::min(width_ratio, height_ratio);
	const auto scale_y = canvas.fit == "stretch" ? height_ratio : scale_x;
	const auto width = std::max<std::int64_t>(1, javascript_round(static_cast<double>(source_width) * scale_x));
	const auto height = std::max<std::int64_t>(1, javascript_round(static_cast<double>(source_height) * scale_y));
	return {
		static_cast<std::uint64_t>(width), static_cast<std::uint64_t>(height),
		javascript_round((static_cast<double>(canvas.width) - static_cast<double>(width)) / 2),
		javascript_round((static_cast<double>(canvas.height) - static_cast<double>(height)) / 2),
	};
}

struct decomposition final { double signed_scale_x{}; double signed_scale_y{}; double rotation{}; };

[[nodiscard]] decomposition decomposed(
	const double a,
	const double b,
	const double signed_scale_y,
	const bool negative_x
) {
	auto angle = std::atan2(b, a);
	while (angle >= std::numbers::pi) angle -= std::numbers::pi * 2;
	while (angle < -std::numbers::pi) angle += std::numbers::pi * 2;
	return {negative_x ? -std::hypot(a, b) : std::hypot(a, b), signed_scale_y, angle == -0.0 ? 0 : angle};
}

[[nodiscard]] v8_visual_render_description render_description(
	const json::value& value,
	const json::value& clip,
	const v8_visual_canvas& canvas
) {
	exact(value, {"crop", "sourceDisplayToCanvas", "opacityStart", "opacityEnd", "blendMode", "compositingOrder"});
	v8_visual_render_description result;
	const auto& crop = json::member(value, "crop");
	exact(crop, {"normalized", "sourcePixels"});
	const auto& normalized = json::member(crop, "normalized");
	exact(normalized, {"left", "top", "right", "bottom"});
	std::array<double, 4> normalized_numbers{};
	for (std::size_t index = 0; index < normalized_numbers.size(); ++index) {
		const auto& member = json::member(normalized, std::array{"left", "top", "right", "bottom"}[index]);
		normalized_numbers[index] = bounded_number(member, "V8 normalized crop", 0, 1);
		result.normalized_crop[index] = member.text;
	}
	if (normalized_numbers[0] + normalized_numbers[2] >= 1
		|| normalized_numbers[1] + normalized_numbers[3] >= 1) {
		throw json::parse_error("The V8 normalized crop is empty.");
	}
	const auto& pixels = json::member(crop, "sourcePixels");
	exact(pixels, {"x", "y", "width", "height"});
	std::array<double, 4> pixel_numbers{};
	for (std::size_t index = 0; index < pixel_numbers.size(); ++index) {
		const auto& member = json::member(pixels, std::array{"x", "y", "width", "height"}[index]);
		pixel_numbers[index] = bounded_number(member, "V8 source-pixel crop", index < 2 ? 0 : std::numeric_limits<double>::min(), 1e9);
		result.source_pixel_crop[index] = member.text;
	}
	result.source_width = near_positive_integer(
		pixel_numbers[2] / (1 - normalized_numbers[0] - normalized_numbers[2]), "V8 crop source width"
	);
	result.source_height = near_positive_integer(
		pixel_numbers[3] / (1 - normalized_numbers[1] - normalized_numbers[3]), "V8 crop source height"
	);
	if (!nearly_equal(pixel_numbers[0], normalized_numbers[0] * static_cast<double>(result.source_width))
		|| !nearly_equal(pixel_numbers[1], normalized_numbers[1] * static_cast<double>(result.source_height))) {
		throw json::parse_error("The V8 source-pixel crop disagrees with its normalized aperture.");
	}
	const auto fitted = canvas_placement(canvas, result.source_width, result.source_height);
	result.fitted_width = fitted.width;
	result.fitted_height = fitted.height;
	result.fitted_x = fitted.x;
	result.fitted_y = fitted.y;
	const auto& matrix = json::array(json::member(value, "sourceDisplayToCanvas"), "V8 display matrix");
	if (matrix.size() != 6) throw json::parse_error("The V8 display matrix must have six coefficients.");
	std::array<double, 6> affine{};
	for (std::size_t index = 0; index < affine.size(); ++index) {
		affine[index] = bounded_number(matrix[index], "V8 display matrix coefficient", -1e9, 1e9);
		result.source_display_to_canvas[index] = matrix[index].text;
	}
	const auto base_scale_x = static_cast<double>(fitted.width) / static_cast<double>(result.source_width);
	const auto base_scale_y = static_cast<double>(fitted.height) / static_cast<double>(result.source_height);
	const auto linear_a = affine[0] / base_scale_x;
	const auto linear_b = affine[1] / base_scale_x;
	const auto linear_c = affine[2] / base_scale_y;
	const auto linear_d = affine[3] / base_scale_y;
	const auto column_x = std::hypot(linear_a, linear_b);
	const auto column_y = std::hypot(linear_c, linear_d);
	if ((column_x < 0.01 && !nearly_equal(column_x, 0.01))
		|| (column_y < 0.01 && !nearly_equal(column_y, 0.01))
		|| (column_x > 100 && !nearly_equal(column_x, 100))
		|| (column_y > 100 && !nearly_equal(column_y, 100))) {
		throw json::parse_error("The V8 display matrix has an unsupported authored scale.");
	}
	if (!nearly_equal(linear_a * linear_c + linear_b * linear_d, 0)) {
		throw json::parse_error("The V8 display matrix contains unsupported shear.");
	}
	const auto determinant = linear_a * linear_d - linear_b * linear_c;
	if (!std::isfinite(determinant) || std::abs(determinant) < std::numeric_limits<double>::epsilon()) {
		throw json::parse_error("The V8 display matrix is not invertible.");
	}
	const auto primary = decomposed(linear_a, linear_b, determinant / column_x, false);
	const auto alternate = decomposed(-linear_a, -linear_b, -determinant / column_x, true);
	const auto resolved = std::abs(alternate.rotation) < std::abs(primary.rotation) ? alternate : primary;
	result.scale_x = std::abs(resolved.signed_scale_x);
	result.scale_y = std::abs(resolved.signed_scale_y);
	result.flip_horizontal = resolved.signed_scale_x < 0;
	result.flip_vertical = resolved.signed_scale_y < 0;
	result.rotation_radians = resolved.rotation;
	const std::array<std::array<double, 2>, 4> corners = {{
		{pixel_numbers[0], pixel_numbers[1]}, {pixel_numbers[0] + pixel_numbers[2], pixel_numbers[1]},
		{pixel_numbers[0], pixel_numbers[1] + pixel_numbers[3]},
		{pixel_numbers[0] + pixel_numbers[2], pixel_numbers[1] + pixel_numbers[3]},
	}};
	std::array<double, 4> mapped_x{};
	std::array<double, 4> mapped_y{};
	for (std::size_t index = 0; index < corners.size(); ++index) {
		mapped_x[index] = affine[0] * corners[index][0] + affine[2] * corners[index][1] + affine[4];
		mapped_y[index] = affine[1] * corners[index][0] + affine[3] * corners[index][1] + affine[5];
		if (!std::isfinite(mapped_x[index]) || !std::isfinite(mapped_y[index])) {
			throw json::parse_error("The V8 display matrix maps outside finite output.");
		}
	}
	result.output_center_x = (*std::min_element(mapped_x.begin(), mapped_x.end())
		+ *std::max_element(mapped_x.begin(), mapped_x.end())) / 2;
	result.output_center_y = (*std::min_element(mapped_y.begin(), mapped_y.end())
		+ *std::max_element(mapped_y.begin(), mapped_y.end())) / 2;
	require_same(json::member(value, "opacityStart"), json::member(clip, "opacityStart"), "V8 render opacity start");
	require_same(json::member(value, "opacityEnd"), json::member(clip, "opacityEnd"), "V8 render opacity end");
	result.opacity_start = number_token(json::member(value, "opacityStart"), "V8 render opacity start");
	result.opacity_end = number_token(json::member(value, "opacityEnd"), "V8 render opacity end");
	result.blend_mode = text(json::member(value, "blendMode"), "V8 blend mode", 16);
	if (std::find(blend_modes.begin(), blend_modes.end(), result.blend_mode) == blend_modes.end()) {
		throw json::parse_error("The V8 blend mode is unsupported.");
	}
	result.compositing_order = json::integer(json::member(value, "compositingOrder"), "V8 compositing order");
	if (result.compositing_order < -32'768 || result.compositing_order > 32'767) {
		throw json::parse_error("The V8 compositing order exceeds its bounds.");
	}
	return result;
}

[[nodiscard]] v8_visual_clip visual_clip(
	const json::value& value,
	const std::string_view expected_role,
	const std::vector<std::string>& source_by_index,
	const double interval_seconds,
	const v8_visual_canvas& canvas
) {
	exact(value, {"role", "clipId", "sourceId", "inputIndex", "sourceStartFrame", "sourceEndFrame", "sourceDurationFrames", "sourceStartTimeSeconds", "sourceEndTimeSeconds", "playbackRate", "opacityStart", "opacityEnd", "renderDescription", "videoEffects"});
	v8_visual_clip result;
	result.role = text(json::member(value, "role"), "V8 clip role", 16);
	if (result.role != expected_role) throw json::parse_error("The V8 clip overlap roles are not canonical.");
	result.clip_id = id(json::member(value, "clipId"), "V8 clip ID");
	result.source_id = id(json::member(value, "sourceId"), "V8 clip source ID");
	result.input_index = static_cast<std::size_t>(safe_integer(json::member(value, "inputIndex"), "V8 clip input index"));
	if (result.input_index >= source_by_index.size() || source_by_index[result.input_index] != result.source_id) {
		throw json::parse_error("A V8 clip does not bind its exact video input identity.");
	}
	result.source_start_frame = safe_integer(json::member(value, "sourceStartFrame"), "V8 source start");
	result.source_end_frame = safe_integer(json::member(value, "sourceEndFrame"), "V8 source end", 1);
	result.source_duration_frames = safe_integer(json::member(value, "sourceDurationFrames"), "V8 source duration", 1);
	if (result.source_end_frame - result.source_start_frame != result.source_duration_frames) {
		throw json::parse_error("The V8 clip source span is inconsistent.");
	}
	const auto source_start = finite_number(json::member(value, "sourceStartTimeSeconds"), "V8 source start seconds");
	const auto source_end = finite_number(json::member(value, "sourceEndTimeSeconds"), "V8 source end seconds");
	const auto rate = finite_number(json::member(value, "playbackRate"), "V8 playback rate");
	if (source_start < 0 || source_end <= source_start || rate <= 0
		|| !approximately_equal((source_end - source_start) / rate, interval_seconds)) {
		throw json::parse_error("The V8 clip source-time interval is invalid.");
	}
	result.source_start_seconds = json::member(value, "sourceStartTimeSeconds").text;
	result.source_end_seconds = json::member(value, "sourceEndTimeSeconds").text;
	result.playback_rate = json::member(value, "playbackRate").text;
	static_cast<void>(bounded_number(json::member(value, "opacityStart"), "V8 opacity start", 0, 1));
	static_cast<void>(bounded_number(json::member(value, "opacityEnd"), "V8 opacity end", 0, 1));
	result.opacity_start = json::member(value, "opacityStart").text;
	result.opacity_end = json::member(value, "opacityEnd").text;
	result.render = render_description(json::member(value, "renderDescription"), value, canvas);
	result.effects = effects(json::member(value, "videoEffects"));
	return result;
}

} // namespace v8_visual_detail
} // namespace

static inline v8_static_visual_semantics capture_v8_static_visual_semantics(const json::value& root) {
	using namespace v8_visual_detail;
	v8_static_visual_semantics result;
	const auto& canvas = json::member(root, "canvas");
	result.canvas.width = static_cast<std::uint64_t>(safe_integer(json::member(canvas, "width"), "V8 visual canvas width", 1));
	result.canvas.height = static_cast<std::uint64_t>(safe_integer(json::member(canvas, "height"), "V8 visual canvas height", 1));
	result.canvas.fit = text(json::member(canvas, "fit"), "V8 visual canvas fit", 16);
	if (result.canvas.fit != "contain" && result.canvas.fit != "cover" && result.canvas.fit != "stretch") {
		throw json::parse_error("The V8 visual canvas fit is unsupported.");
	}
	result.canvas.background_color = text(json::member(canvas, "backgroundColor"), "V8 visual background", 128);
	if (!delivery_color(result.canvas.background_color)) throw json::parse_error("The V8 visual background is unsupported.");
	result.sources = sources(root);
	const auto& all_inputs = json::array(json::member(root, "inputs"), "V8 visual inputs");
	std::vector<std::string> source_by_index(all_inputs.size());
	for (const auto& source : result.sources) source_by_index[source.input_index] = source.source_id;
	const auto& range = json::member(root, "range");
	const auto range_start = safe_integer(json::member(range, "startFrame"), "V8 visual range start");
	const auto range_end = safe_integer(json::member(range, "endFrame"), "V8 visual range end", 1);
	const auto duration = finite_number(json::member(root, "durationSeconds"), "V8 visual duration");
	if (range_end <= range_start || duration <= 0) throw json::parse_error("The V8 visual range and duration must be positive.");
	const auto& intervals = json::array(json::member(root, "intervals"), "V8 visual intervals");
	if (intervals.empty() || intervals.size() > maximum_intervals) throw json::parse_error("V8 intervals exceed their nonempty ceiling.");
	auto covered = range_start;
	std::size_t clip_count = 0;
	for (std::size_t interval_index = 0; interval_index < intervals.size(); ++interval_index) {
		const auto& value_interval = intervals[interval_index];
		exact_optional(value_interval, {"index", "kind", "timelineStartFrame", "timelineEndFrame", "outputStartFrame", "durationFrames", "durationSeconds", "color", "layers"}, "color");
		v8_visual_interval interval;
		interval.index = static_cast<std::size_t>(safe_integer(json::member(value_interval, "index"), "V8 interval index"));
		if (interval.index != interval_index) throw json::parse_error("V8 interval indices must equal their positions.");
		interval.kind = text(json::member(value_interval, "kind"), "V8 interval kind", 32);
		interval.timeline_start_frame = safe_integer(json::member(value_interval, "timelineStartFrame"), "V8 interval start");
		interval.timeline_end_frame = safe_integer(json::member(value_interval, "timelineEndFrame"), "V8 interval end", 1);
		interval.duration_frames = safe_integer(json::member(value_interval, "durationFrames"), "V8 interval frames", 1);
		interval.output_start_frame = safe_integer(json::member(value_interval, "outputStartFrame"), "V8 interval output start");
		if (interval.timeline_start_frame != covered
			|| interval.timeline_end_frame - interval.timeline_start_frame != interval.duration_frames
			|| interval.timeline_start_frame < range_start || interval.timeline_end_frame > range_end
			|| interval.output_start_frame != interval.timeline_start_frame - range_start) {
			throw json::parse_error("V8 intervals do not exactly tile their export range.");
		}
		const auto interval_seconds = finite_number(json::member(value_interval, "durationSeconds"), "V8 interval seconds");
		const auto expected_seconds = duration * static_cast<double>(interval.duration_frames)
			/ static_cast<double>(range_end - range_start);
		if (interval_seconds <= 0 || !approximately_equal(interval_seconds, expected_seconds)) {
			throw json::parse_error("A V8 interval duration disagrees with the export timebase.");
		}
		interval.duration_seconds = json::member(value_interval, "durationSeconds").text;
		const auto* color = json::optional_member(value_interval, "color");
		const auto& layers = json::array(json::member(value_interval, "layers"), "V8 interval layers");
		if (interval.kind == "black") {
			if (!color || !delivery_color(text(*color, "V8 interval color", 128)) || !layers.empty()) {
				throw json::parse_error("A V8 black interval has non-canonical color or layers.");
			}
			interval.background_color = text(*color, "V8 interval color", 128);
		} else if (interval.kind != "composition" || color || layers.empty() || layers.size() > maximum_layers) {
			throw json::parse_error("A V8 composition interval has non-canonical color or layers.");
		} else interval.background_color = result.canvas.background_color;
		std::set<std::string> tracks;
		std::set<std::int64_t> track_indices;
		std::set<std::string> interval_clips;
		for (const auto& value_layer : layers) {
			exact(value_layer, {"trackId", "trackIndex", "clips"});
			v8_visual_layer layer;
			layer.track_id = id(json::member(value_layer, "trackId"), "V8 layer track ID");
			unique(tracks, layer.track_id, "V8 layer track ID");
			layer.track_index = safe_integer(json::member(value_layer, "trackIndex"), "V8 layer track index");
			if (!track_indices.insert(layer.track_index).second) throw json::parse_error("A V8 layer track index is duplicated.");
			const auto& clips = json::array(json::member(value_layer, "clips"), "V8 layer clips");
			if (clips.empty() || clips.size() > 2 || clip_count + clips.size() > maximum_clips) {
				throw json::parse_error("V8 layer clips exceed the closed transition overlap domain.");
			}
			for (std::size_t clip_index = 0; clip_index < clips.size(); ++clip_index) {
				const auto role = clips.size() == 1 ? "single" : clip_index == 0 ? "outgoing" : "incoming";
				auto captured = visual_clip(clips[clip_index], role, source_by_index, interval_seconds, result.canvas);
				unique(interval_clips, captured.clip_id, "V8 interval clip ID");
				layer.clips.push_back(std::move(captured));
				++clip_count;
			}
			if (layer.clips.size() == 1 && layer.clips[0].opacity_start != layer.clips[0].opacity_end) {
				throw json::parse_error("A single V8 clip must carry static opacity.");
			}
			if (layer.clips.size() == 2 && (
				layer.clips[0].render.blend_mode != layer.clips[1].render.blend_mode
				|| layer.clips[0].render.compositing_order != layer.clips[1].render.compositing_order
			)) throw json::parse_error("V8 transition render descriptions must share blend and order.");
			interval.layers.push_back(std::move(layer));
		}
		for (std::size_t layer_index = 1; layer_index < interval.layers.size(); ++layer_index) {
			const auto& previous = interval.layers[layer_index - 1];
			const auto& current = interval.layers[layer_index];
			const auto previous_order = previous.clips[0].render.compositing_order;
			const auto current_order = current.clips[0].render.compositing_order;
			if (previous_order > current_order
				|| (previous_order == current_order && previous.track_index <= current.track_index)) {
				throw json::parse_error("V8 layers are not in ascending order with descending track-index ties.");
			}
		}
		result.intervals.push_back(std::move(interval));
		covered = result.intervals.back().timeline_end_frame;
	}
	if (covered != range_end) throw json::parse_error("V8 intervals do not finish their export range.");
	return result;
}

} // namespace framescaper::media::legacy
