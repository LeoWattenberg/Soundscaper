/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "strict_json.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace framescaper::media::legacy {

/** Exact residual decode presentation carried by one V8 source input. */
struct v8_source_presentation final {
	std::uint64_t decoded_width{};
	std::uint64_t decoded_height{};
	std::uint64_t sample_aspect_num{};
	std::uint64_t sample_aspect_den{};
	std::uint64_t scaled_width{};
	std::uint64_t scaled_height{};
};

struct v8_visual_source final {
	std::size_t input_index{};
	std::string source_id;
	std::string storage_key;
	std::string mime_type;
	std::optional<v8_source_presentation> presentation;
};

/** A normalized effect parameter, including registry defaults omitted by the plan. */
struct v8_visual_effect_parameter final {
	std::string name;
	std::string number;
};

struct v8_visual_effect final {
	std::string id;
	std::string type;
	bool enabled{};
	std::vector<v8_visual_effect_parameter> parameters;
};

/** Closed renderer-neutral geometry plus its validated FFmpeg decomposition. */
struct v8_visual_render_description final {
	std::array<std::string, 4> normalized_crop;
	std::array<std::string, 4> source_pixel_crop;
	std::array<std::string, 6> source_display_to_canvas;
	std::uint64_t source_width{};
	std::uint64_t source_height{};
	std::uint64_t fitted_width{};
	std::uint64_t fitted_height{};
	std::int64_t fitted_x{};
	std::int64_t fitted_y{};
	double scale_x{};
	double scale_y{};
	bool flip_horizontal{};
	bool flip_vertical{};
	double rotation_radians{};
	double output_center_x{};
	double output_center_y{};
	std::string opacity_start;
	std::string opacity_end;
	std::string blend_mode;
	std::int64_t compositing_order{};
};

struct v8_visual_clip final {
	std::string role;
	std::string clip_id;
	std::string source_id;
	std::size_t input_index{};
	std::int64_t source_start_frame{};
	std::int64_t source_end_frame{};
	std::int64_t source_duration_frames{};
	std::string source_start_seconds;
	std::string source_end_seconds;
	std::string playback_rate;
	std::string opacity_start;
	std::string opacity_end;
	v8_visual_render_description render;
	std::vector<v8_visual_effect> effects;
};

struct v8_visual_layer final {
	std::string track_id;
	std::int64_t track_index{};
	std::vector<v8_visual_clip> clips;
};

struct v8_visual_interval final {
	std::size_t index{};
	std::string kind;
	std::int64_t timeline_start_frame{};
	std::int64_t timeline_end_frame{};
	std::int64_t output_start_frame{};
	std::int64_t duration_frames{};
	std::string duration_seconds;
	std::string background_color;
	std::vector<v8_visual_layer> layers;
};

struct v8_visual_canvas final {
	std::uint64_t width{};
	std::uint64_t height{};
	std::string fit;
	std::string background_color;
};

/** Detached static visual authority from immutable, authenticated V8 plan bytes. */
struct v8_static_visual_semantics final {
	v8_visual_canvas canvas;
	std::vector<v8_visual_source> sources;
	std::vector<v8_visual_interval> intervals;
};

/** Validate and detach every V8 source-presentation/composition semantic. */
[[nodiscard]] static inline v8_static_visual_semantics capture_v8_static_visual_semantics(
	const json::value& root
);

} // namespace framescaper::media::legacy

#include "legacy_plan_v8_visual_semantics_impl.hpp"
