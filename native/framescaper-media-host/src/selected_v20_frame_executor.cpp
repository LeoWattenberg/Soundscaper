/* SPDX-License-Identifier: AGPL-3.0-only */

#include "selected_v20_frame_executor.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <limits>
#include <span>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace framescaper::media {
namespace {

using soundscaper::framescaper::compare;
using soundscaper::framescaper::cpp_int;
using soundscaper::framescaper::exact_output_sample;

constexpr std::size_t cancellation_pixel_stride = 16'384;

[[nodiscard]] bool evaluated_rgba(const selected_v20_family family) noexcept {
	return family == selected_v20_family::keyed_evaluated_rgba_v7
		|| family == selected_v20_family::evaluated_rgba_v8;
}

struct timing_identity final {
	const ExactRational* data{};
	std::size_t size{};
};

[[noreturn]] void fail(
	const selected_v20_execution_error_code code,
	const std::string& message
) { throw selected_v20_execution_error(code, message); }

void not_cancelled(const selected_v20_executor_ports& ports) {
	if (ports.cancelled && ports.cancelled()) {
		fail(selected_v20_execution_error_code::cancelled, "The selected-V20 frame execution was cancelled.");
	}
}

[[nodiscard]] std::uint64_t frame_bytes(const selected_v20_execution_plan& plan) {
	const auto pixels = static_cast<std::uint64_t>(plan.width) * plan.height;
	if (plan.width == 0 || plan.height == 0
		|| pixels > selected_v20_maximum_frame_bytes / 4) {
		fail(selected_v20_execution_error_code::plan_contract, "The selected-V20 frame geometry exceeds 8 MiB RGBA.");
	}
	return pixels * 4;
}

[[nodiscard]] bool positive(const ExactRational& value) {
	return compare(value, ExactRational(0)) > 0;
}

[[nodiscard]] bool unit(const ExactRational& value) {
	return compare(value, ExactRational(0)) >= 0 && compare(value, ExactRational(1)) <= 0;
}

void validate_plan(const selected_v20_execution_plan& plan) {
	static_cast<void>(frame_bytes(plan));
	if (plan.output_frame_count == 0
		|| plan.output_frame_count > selected_v20_maximum_output_frames
		|| !positive(plan.output_rate)
		|| plan.output_rate.numerator() > std::numeric_limits<std::uint64_t>::max()
		|| plan.output_rate.denominator() > std::numeric_limits<std::uint64_t>::max()) {
		fail(selected_v20_execution_error_code::plan_contract, "The selected-V20 output cadence is invalid.");
	}
	if (evaluated_rgba(plan.family)) {
		if (plan.sample_rate == 0 || !plan.intervals.empty()) {
			fail(selected_v20_execution_error_code::plan_contract, "The evaluated RGBA cadence authority is incomplete.");
		}
		return;
	}
	if (plan.intervals.empty() || plan.intervals.size() > 100'000) {
		fail(selected_v20_execution_error_code::plan_contract, "The V8 interval authority is empty or oversized.");
	}
	ExactRational covered(0);
	std::size_t layer_count = 0;
	for (const auto& interval : plan.intervals) {
		if (compare(interval.start_time, covered) != 0 || !positive(interval.duration)) {
			fail(selected_v20_execution_error_code::plan_contract, "The V8 intervals do not exactly tile time.");
		}
		covered = covered + interval.duration;
		layer_count += interval.layers.size();
		if (layer_count > 100'000) {
			fail(selected_v20_execution_error_code::plan_contract, "The V8 layer workload is oversized.");
		}
		for (const auto& layer : interval.layers) {
			if (layer.clips.empty() || layer.clips.size() > 2) {
				fail(selected_v20_execution_error_code::plan_contract, "A V8 layer has an invalid clip count.");
			}
			for (const auto& clip : layer.clips) {
				if (clip.clip_id.empty() || compare(clip.source_end, clip.source_start) <= 0
					|| !unit(clip.opacity_start) || !unit(clip.opacity_end)) {
					fail(selected_v20_execution_error_code::plan_contract, "A V8 clip execution authority is invalid.");
				}
			}
		}
	}
	const ExactRational last_time(
		cpp_int(plan.output_frame_count - 1) * plan.output_rate.denominator(),
		plan.output_rate.numerator()
	);
	if (compare(last_time, covered) >= 0) {
		fail(selected_v20_execution_error_code::plan_contract, "The V8 cadence extends beyond its intervals.");
	}
}

void validate_frame(
	const selected_v20_execution_plan& plan,
	const selected_v20_rgba_frame& frame
) {
	if (frame.width != plan.width || frame.height != plan.height
		|| frame.rgba.size() != frame_bytes(plan)) {
		fail(selected_v20_execution_error_code::frame_contract, "An evaluated RGBA frame does not match its exact canvas.");
	}
}

[[nodiscard]] ExactRational output_time(
	const selected_v20_execution_plan& plan,
	const std::uint64_t ordinal
) {
	return ExactRational(cpp_int(ordinal), cpp_int(1)) / plan.output_rate;
}

[[nodiscard]] ExactRational interpolate(
	const ExactRational& start,
	const ExactRational& end,
	const ExactRational& progress
) { return start + (end - start) * progress; }

[[nodiscard]] std::uint16_t unit_u16(const ExactRational& value) {
	if (!unit(value)) fail(selected_v20_execution_error_code::plan_contract, "An opacity escaped the unit interval.");
	const cpp_int scaled = value.numerator() * 65'535;
	const cpp_int rounded = (scaled * 2 + value.denominator()) / (value.denominator() * 2);
	return rounded.convert_to<std::uint16_t>();
}

[[nodiscard]] std::uint8_t rounded_divide(const std::uint64_t numerator, const std::uint64_t denominator) {
	if (denominator == 0) return 0;
	return static_cast<std::uint8_t>(std::min<std::uint64_t>(255, (numerator + denominator / 2) / denominator));
}

[[nodiscard]] std::uint8_t blend_channel(
	const selected_v20_blend_mode mode,
	const std::uint8_t backdrop,
	const std::uint8_t source
) {
	switch (mode) {
	case selected_v20_blend_mode::normal: return source;
	case selected_v20_blend_mode::multiply:
		return rounded_divide(static_cast<std::uint64_t>(backdrop) * source, 255);
	case selected_v20_blend_mode::screen:
		return static_cast<std::uint8_t>(255 - rounded_divide(
			static_cast<std::uint64_t>(255 - backdrop) * (255 - source), 255
		));
	case selected_v20_blend_mode::overlay:
		return backdrop <= 127
			? rounded_divide(2ULL * backdrop * source, 255)
			: static_cast<std::uint8_t>(255 - rounded_divide(
				2ULL * (255 - backdrop) * (255 - source), 255
			));
	case selected_v20_blend_mode::darken: return std::min(backdrop, source);
	case selected_v20_blend_mode::lighten: return std::max(backdrop, source);
	case selected_v20_blend_mode::difference:
		return static_cast<std::uint8_t>(backdrop > source ? backdrop - source : source - backdrop);
	case selected_v20_blend_mode::exclusion: {
		const auto twice = rounded_divide(2ULL * backdrop * source, 255);
		return static_cast<std::uint8_t>(std::clamp<int>(backdrop + source - twice, 0, 255));
	}
	}
	return source;
}

void composite_pixel(
	std::uint8_t* backdrop,
	const std::uint8_t* source,
	const selected_v20_blend_mode mode
) {
	const std::uint64_t source_alpha = source[3];
	const std::uint64_t backdrop_alpha = backdrop[3];
	const std::uint64_t alpha_numerator = source_alpha * 255 + backdrop_alpha * 255
		- source_alpha * backdrop_alpha;
	if (alpha_numerator == 0) {
		std::fill(backdrop, backdrop + 4, 0);
		return;
	}
	for (std::size_t channel = 0; channel < 3; ++channel) {
		const auto blended = blend_channel(mode, backdrop[channel], source[channel]);
		const std::uint64_t numerator =
			static_cast<std::uint64_t>(source[channel]) * source_alpha * (255 - backdrop_alpha)
			+ static_cast<std::uint64_t>(backdrop[channel]) * backdrop_alpha * (255 - source_alpha)
			+ static_cast<std::uint64_t>(blended) * source_alpha * backdrop_alpha;
		backdrop[channel] = rounded_divide(numerator, alpha_numerator);
	}
	backdrop[3] = rounded_divide(alpha_numerator, 255);
}

[[nodiscard]] std::uint64_t picture_ordinal(
	const std::span<const ExactRational> boundaries,
	const ExactRational& source_time
) {
	if (boundaries.size() < 2 || boundaries.size() > selected_v20_maximum_output_frames + 1
		|| compare(source_time, boundaries.front()) < 0
		|| compare(source_time, boundaries.back()) >= 0) {
		fail(selected_v20_execution_error_code::timing_contract, "A V8 source time is outside exact picture boundaries.");
	}
	std::size_t lower = 0;
	std::size_t upper = boundaries.size() - 1;
	while (lower + 1 < upper) {
		const auto middle = lower + (upper - lower) / 2;
		if (compare(boundaries[middle], source_time) <= 0) lower = middle;
		else upper = middle;
	}
	return static_cast<std::uint64_t>(lower);
}

[[nodiscard]] std::span<const ExactRational> authenticated_timing(
	const selected_v20_executor_ports& ports,
	const std::size_t input_index,
	std::unordered_map<std::size_t, timing_identity>& identities
) {
	const auto boundaries = ports.source_timing(input_index);
	const auto existing = identities.find(input_index);
	if (existing != identities.end()) {
		if (existing->second.data != boundaries.data() || existing->second.size != boundaries.size()) {
			fail(selected_v20_execution_error_code::timing_contract, "A V8 source changed timing identity during execution.");
		}
		return boundaries;
	}
	if (boundaries.size() < 2 || boundaries.size() > selected_v20_maximum_output_frames + 1) {
		fail(selected_v20_execution_error_code::timing_contract, "A V8 source timing table is empty or oversized.");
	}
	for (std::size_t index = 1; index < boundaries.size(); ++index) {
		if (compare(boundaries[index - 1], boundaries[index]) >= 0) {
			fail(selected_v20_execution_error_code::timing_contract, "V8 picture boundaries are not strictly increasing.");
		}
	}
	identities.emplace(input_index, timing_identity{boundaries.data(), boundaries.size()});
	return boundaries;
}

[[nodiscard]] std::vector<std::uint8_t> evaluated_layer(
	const selected_v20_execution_plan& plan,
	const selected_v20_interval& interval,
	const selected_v20_layer& layer,
	const ExactRational& time,
	const std::uint64_t output_ordinal,
	const selected_v20_executor_ports& ports,
	std::unordered_map<std::size_t, timing_identity>& timing_identities
) {
	const auto progress = (time - interval.start_time) / interval.duration;
	std::vector<selected_v20_rgba_frame> frames;
	std::vector<std::uint16_t> weights;
	frames.reserve(layer.clips.size());
	weights.reserve(layer.clips.size());
	for (const auto& clip : layer.clips) {
		const auto source_time = interpolate(clip.source_start, clip.source_end, progress);
		const auto timing = authenticated_timing(ports, clip.input_index, timing_identities);
		const auto ordinal = picture_ordinal(timing, source_time);
		not_cancelled(ports);
		auto frame = ports.static_frame(selected_v20_static_frame_request{
			output_ordinal, clip.input_index, clip.clip_id, ordinal, time, source_time,
		});
		not_cancelled(ports);
		validate_frame(plan, frame);
		frames.push_back(std::move(frame));
		weights.push_back(unit_u16(interpolate(clip.opacity_start, clip.opacity_end, progress)));
	}
	std::vector<std::uint8_t> result(static_cast<std::size_t>(frame_bytes(plan)), 0);
	for (std::size_t offset = 0; offset < result.size(); offset += 4) {
		if ((offset / 4) % cancellation_pixel_stride == 0) not_cancelled(ports);
		if (frames.size() == 1) {
			result[offset] = frames[0].rgba[offset];
			result[offset + 1] = frames[0].rgba[offset + 1];
			result[offset + 2] = frames[0].rgba[offset + 2];
			result[offset + 3] = rounded_divide(
				static_cast<std::uint64_t>(frames[0].rgba[offset + 3]) * weights[0], 65'535
			);
			continue;
		}
		std::array<std::uint64_t, 4> premultiplied{};
		for (std::size_t input = 0; input < 2; ++input) {
			const auto alpha = frames[input].rgba[offset + 3];
			for (std::size_t channel = 0; channel < 3; ++channel) {
				const auto premul = rounded_divide(
					static_cast<std::uint64_t>(frames[input].rgba[offset + channel]) * alpha, 255
				);
				premultiplied[channel] += static_cast<std::uint64_t>(premul) * weights[input];
			}
			premultiplied[3] += static_cast<std::uint64_t>(alpha) * weights[input];
		}
		const auto alpha = rounded_divide(premultiplied[3], 65'535);
		result[offset + 3] = alpha;
		for (std::size_t channel = 0; channel < 3; ++channel) {
			const auto premul = rounded_divide(premultiplied[channel], 65'535);
			result[offset + channel] = alpha == 0 ? 0 : rounded_divide(
				static_cast<std::uint64_t>(premul) * 255, alpha
			);
		}
	}
	return result;
}

[[nodiscard]] std::vector<std::uint8_t> static_frame(
	const selected_v20_execution_plan& plan,
	const selected_v20_interval& interval,
	const ExactRational& time,
	const std::uint64_t ordinal,
	const selected_v20_executor_ports& ports,
	std::unordered_map<std::size_t, timing_identity>& timing_identities
) {
	std::vector<std::uint8_t> canvas(static_cast<std::size_t>(frame_bytes(plan)));
	for (std::size_t offset = 0; offset < canvas.size(); offset += 4) {
		std::copy(interval.background_rgba.begin(), interval.background_rgba.end(), canvas.begin() + offset);
	}
	for (const auto& layer : interval.layers) {
		auto source = evaluated_layer(plan, interval, layer, time, ordinal, ports, timing_identities);
		for (std::size_t offset = 0; offset < canvas.size(); offset += 4) {
			if ((offset / 4) % cancellation_pixel_stride == 0) not_cancelled(ports);
			composite_pixel(canvas.data() + offset, source.data() + offset, layer.blend_mode);
		}
	}
	return canvas;
}

} // namespace

selected_v20_execution_report execute_selected_v20_frames(
	const selected_v20_execution_plan& plan,
	const selected_v20_executor_ports& ports
) {
	validate_plan(plan);
	if (!ports.write_frame) fail(selected_v20_execution_error_code::port_contract, "The frame sink is absent.");
	if (evaluated_rgba(plan.family) && !ports.keyed_frame) {
		fail(selected_v20_execution_error_code::port_contract, "The evaluated keyed-RGBA source is absent.");
	}
	if (plan.family == selected_v20_family::static_composition_v8
		&& (!ports.source_timing || !ports.static_frame)) {
		fail(selected_v20_execution_error_code::port_contract, "The static source timing/frame ports are absent.");
	}
	std::size_t interval_index = 0;
	std::unordered_map<std::size_t, timing_identity> timing_identities;
	for (std::uint64_t ordinal = 0; ordinal < plan.output_frame_count; ++ordinal) {
		not_cancelled(ports);
		const auto time = output_time(plan, ordinal);
		std::uint64_t sample = 0;
		std::vector<std::uint8_t> rendered;
		if (evaluated_rgba(plan.family)) {
			sample = exact_output_sample(
				ordinal, plan.sample_start, plan.sample_rate,
				plan.output_rate.numerator().convert_to<std::uint64_t>(),
				plan.output_rate.denominator().convert_to<std::uint64_t>()
			);
			auto frame = ports.keyed_frame(selected_v20_keyed_frame_request{ordinal, sample, time});
			not_cancelled(ports);
			validate_frame(plan, frame);
			rendered = std::move(frame.rgba);
		} else {
			while (interval_index < plan.intervals.size()
				&& compare(time, plan.intervals[interval_index].start_time
					+ plan.intervals[interval_index].duration) >= 0) ++interval_index;
			if (interval_index >= plan.intervals.size()
				|| compare(time, plan.intervals[interval_index].start_time) < 0) {
				fail(selected_v20_execution_error_code::timing_contract, "An output frame has no V8 interval.");
			}
			rendered = static_frame(
				plan, plan.intervals[interval_index], time, ordinal, ports, timing_identities
			);
		}
		not_cancelled(ports);
		ports.write_frame(selected_v20_output_frame{ordinal, sample, rendered});
		not_cancelled(ports);
	}
	return {plan.output_frame_count, 1};
}

selected_v20_frame_executor_self_test self_test_selected_v20_frame_executor() noexcept {
	bool exact = false;
	bool keyed = false;
	bool composition = false;
	try {
		exact = exact_output_sample(2, 100, 48'000, 30'000, 1'001) == 3'303;
	} catch (...) {}
	try {
		selected_v20_execution_plan plan;
		plan.width = 1;
		plan.height = 1;
		plan.output_frame_count = 1;
		plan.output_rate = ExactRational(24);
		plan.sample_rate = 48'000;
		std::size_t writes = 0;
		selected_v20_executor_ports ports;
		ports.keyed_frame = [](const selected_v20_keyed_frame_request&) {
			return selected_v20_rgba_frame{1, 1, {1, 2, 3, 255}};
		};
		ports.write_frame = [&](const selected_v20_output_frame& frame) {
			if (frame.rgba.size() == 4 && frame.rgba[0] == 1) ++writes;
		};
		keyed = execute_selected_v20_frames(plan, ports).maximum_in_flight_frames == 1 && writes == 1;
	} catch (...) {}
	try {
		selected_v20_execution_plan plan;
		plan.width = 1;
		plan.height = 1;
		plan.output_frame_count = 1;
		plan.output_rate = ExactRational(24);
		plan.family = selected_v20_family::static_composition_v8;
		selected_v20_interval interval;
		selected_v20_layer layer;
		layer.clips.push_back(selected_v20_clip{"clip", 0});
		interval.layers.push_back(std::move(layer));
		plan.intervals.push_back(std::move(interval));
		const std::array<ExactRational, 2> timing{ExactRational(0), ExactRational(1)};
		std::size_t writes = 0;
		selected_v20_executor_ports ports;
		ports.source_timing = [&](std::size_t) { return std::span<const ExactRational>{timing}; };
		ports.static_frame = [](const selected_v20_static_frame_request& request) {
			return selected_v20_rgba_frame{1, 1, {
				static_cast<std::uint8_t>(request.picture_ordinal + 7), 8, 9, 255,
			}};
		};
		ports.write_frame = [&](const selected_v20_output_frame& frame) {
			if (frame.rgba.size() == 4 && frame.rgba[0] == 7) ++writes;
		};
		composition = execute_selected_v20_frames(plan, ports).frames_written == 1 && writes == 1;
	} catch (...) {}
	return {
		"media-render", "selected-v20-v7-v8", exact, keyed, composition, 1,
	};
}

} // namespace framescaper::media
