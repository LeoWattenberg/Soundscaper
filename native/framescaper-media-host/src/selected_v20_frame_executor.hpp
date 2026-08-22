/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "exact_retime_ordinal.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace framescaper::media {

using soundscaper::framescaper::ExactRational;

inline constexpr std::uint64_t selected_v20_maximum_frame_bytes = 8U * 1024U * 1024U;
inline constexpr std::uint64_t selected_v20_maximum_output_frames = 2'000'000;

enum class selected_v20_family {
	keyed_evaluated_rgba_v7,
	static_composition_v8,
};

enum class selected_v20_audio_layout { preserve, mono, stereo };

enum class selected_v20_blend_mode {
	normal, multiply, screen, overlay, darken, lighten, difference, exclusion,
};

struct selected_v20_clip final {
	std::string clip_id;
	std::size_t input_index{};
	ExactRational source_start{0};
	ExactRational source_end{1};
	ExactRational opacity_start{1};
	ExactRational opacity_end{1};
};

struct selected_v20_layer final {
	selected_v20_blend_mode blend_mode{selected_v20_blend_mode::normal};
	std::vector<selected_v20_clip> clips;
};

struct selected_v20_interval final {
	ExactRational start_time{0};
	ExactRational duration{1};
	std::array<std::uint8_t, 4> background_rgba{0, 0, 0, 255};
	std::vector<selected_v20_layer> layers;
};

/** Closed execution authority captured from an already authenticated V7/V8 plan. */
struct selected_v20_execution_plan final {
	selected_v20_family family{selected_v20_family::keyed_evaluated_rgba_v7};
	std::uint32_t width{};
	std::uint32_t height{};
	std::uint64_t output_frame_count{};
	ExactRational output_rate{1};
	std::uint64_t sample_start{};
	std::uint64_t sample_rate{};
	std::uint64_t audio_sample_count{};
	selected_v20_audio_layout audio_layout{selected_v20_audio_layout::preserve};
	std::string quality{"balanced"};
	std::array<std::uint8_t, 4> background_rgba{0, 0, 0, 255};
	bool includes_staged_audio{};
	std::vector<selected_v20_interval> intervals;
};

struct selected_v20_rgba_frame final {
	std::uint32_t width{};
	std::uint32_t height{};
	std::vector<std::uint8_t> rgba;
};

struct selected_v20_keyed_frame_request final {
	std::uint64_t output_ordinal{};
	std::uint64_t output_sample{};
	ExactRational output_time{0};
};

struct selected_v20_static_frame_request final {
	std::uint64_t output_ordinal{};
	std::size_t input_index{};
	std::string_view clip_id;
	std::uint64_t picture_ordinal{};
	ExactRational output_time{0};
	ExactRational source_time{0};
};

struct selected_v20_output_frame final {
	std::uint64_t output_ordinal{};
	std::uint64_t output_sample{};
	std::span<const std::uint8_t> rgba;
};

struct selected_v20_executor_ports final {
	std::function<bool()> cancelled;
	std::function<selected_v20_rgba_frame(const selected_v20_keyed_frame_request&)> keyed_frame;
	std::function<std::span<const ExactRational>(std::size_t)> source_timing;
	std::function<selected_v20_rgba_frame(const selected_v20_static_frame_request&)> static_frame;
	std::function<void(const selected_v20_output_frame&)> write_frame;
};

enum class selected_v20_execution_error_code {
	cancelled,
	plan_contract,
	port_contract,
	frame_contract,
	timing_contract,
};

class selected_v20_execution_error final : public std::runtime_error {
public:
	selected_v20_execution_error(selected_v20_execution_error_code code, std::string message)
		: std::runtime_error(std::move(message)), code_{code} {}
	[[nodiscard]] selected_v20_execution_error_code code() const noexcept { return code_; }
private:
	selected_v20_execution_error_code code_;
};

struct selected_v20_execution_report final {
	std::uint64_t frames_written{};
	std::uint32_t maximum_in_flight_frames{};
};

struct selected_v20_frame_executor_self_test final {
	std::string_view operation;
	std::string_view profile;
	bool exact_picture_ordinals{};
	bool keyed_evaluated_rgba{};
	bool static_composition{};
	std::uint32_t maximum_in_flight_frames{};
};

/** Execute sequentially: no float repair, output-sized schedule, or queued frame backlog. */
[[nodiscard]] selected_v20_execution_report execute_selected_v20_frames(
	const selected_v20_execution_plan& plan,
	const selected_v20_executor_ports& ports
);

/** Exercise the exact selected-V20 frame core without implying codec/audio readiness. */
[[nodiscard]] selected_v20_frame_executor_self_test self_test_selected_v20_frame_executor() noexcept;

} // namespace framescaper::media
