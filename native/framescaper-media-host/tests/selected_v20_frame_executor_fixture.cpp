/* SPDX-License-Identifier: AGPL-3.0-only */

#include "selected_v20_frame_executor.hpp"
#include "selected_v20_frame_pack.hpp"
#include "selected_v20_plan_capture.hpp"

#include <array>
#include <cassert>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <span>
#include <string>
#include <type_traits>
#include <vector>

using namespace framescaper::media;
using soundscaper::framescaper::ExactRational;
using soundscaper::framescaper::cpp_int;

namespace {

[[nodiscard]] selected_v20_execution_plan keyed_plan();
[[nodiscard]] selected_v20_rgba_frame solid(std::uint8_t red, std::uint8_t green, std::uint8_t blue);

template<typename Integer>
void write_little(std::ofstream& output, const Integer value) {
	using Unsigned = std::make_unsigned_t<Integer>;
	const auto bits = static_cast<Unsigned>(value);
	for (std::size_t index = 0; index < sizeof(Integer); ++index) {
		output.put(static_cast<char>((bits >> (index * 8U)) & 0xffU));
	}
}

void authenticated_frame_pack_binds_exact_cadence() {
	const auto path = std::filesystem::temp_directory_path() / "framescaper-selected-v20-frame-pack.fixture";
	{
		std::ofstream output(path, std::ios::binary | std::ios::trunc);
		output << "framescaper-rgba-frame-pack-v1\n";
		write_little<std::uint32_t>(output, 1);
		write_little<std::uint32_t>(output, 2);
		write_little<std::uint32_t>(output, 2);
		write_little<std::uint64_t>(output, 3);
		write_little<std::uint32_t>(output, 1'001);
		write_little<std::uint32_t>(output, 30'000);
		for (std::uint64_t ordinal = 0; ordinal < 3; ++ordinal) {
			write_little<std::uint64_t>(output, ordinal);
			write_little<std::int64_t>(output, static_cast<std::int64_t>(ordinal));
			write_little<std::int64_t>(output, 1);
			write_little<std::uint64_t>(output, 16);
			const auto frame = solid(static_cast<std::uint8_t>(ordinal + 10), 20, 30);
			output.write(reinterpret_cast<const char*>(frame.rgba.data()), 16);
		}
	}
	try {
		selected_v20_frame_pack pack(path, std::filesystem::file_size(path));
		auto plan = keyed_plan();
		pack.require_output_cadence(plan);
		assert(pack.frame_count() == 3);
		assert(pack.frame(2).rgba.front() == 12);
		plan.output_rate = ExactRational(24);
		try { pack.require_output_cadence(plan); assert(false); }
		catch (const selected_v20_execution_error& error) {
			assert(error.code() == selected_v20_execution_error_code::frame_contract);
		}
	} catch (...) {
		std::filesystem::remove(path);
		throw;
	}
	std::filesystem::remove(path);
}

[[nodiscard]] selected_v20_execution_plan keyed_plan() {
	selected_v20_execution_plan plan;
	plan.family = selected_v20_family::keyed_evaluated_rgba_v7;
	plan.width = 2;
	plan.height = 2;
	plan.output_frame_count = 3;
	plan.output_rate = ExactRational(cpp_int(30'000), cpp_int(1'001));
	plan.sample_start = 100;
	plan.sample_rate = 48'000;
	return plan;
}

[[nodiscard]] selected_v20_rgba_frame solid(
	const std::uint8_t red,
	const std::uint8_t green,
	const std::uint8_t blue
) {
	selected_v20_rgba_frame frame{2, 2, std::vector<std::uint8_t>(16)};
	for (std::size_t offset = 0; offset < frame.rgba.size(); offset += 4) {
		frame.rgba[offset] = red;
		frame.rgba[offset + 1] = green;
		frame.rgba[offset + 2] = blue;
		frame.rgba[offset + 3] = 255;
	}
	return frame;
}

void keyed_executor_uses_exact_on_demand_cadence() {
	auto plan = keyed_plan();
	std::vector<std::uint64_t> requested;
	std::vector<std::uint64_t> samples;
	bool source_active = false;
	selected_v20_executor_ports ports;
	ports.keyed_frame = [&](const selected_v20_keyed_frame_request& request) {
		assert(!source_active);
		source_active = true;
		requested.push_back(request.output_ordinal);
		samples.push_back(request.output_sample);
		source_active = false;
		return solid(static_cast<std::uint8_t>(request.output_ordinal), 0, 0);
	};
	ports.write_frame = [&](const selected_v20_output_frame& frame) {
		assert(!source_active);
		assert(frame.rgba.size() == 16);
		assert(frame.rgba.front() == frame.output_ordinal);
	};
	const auto report = execute_selected_v20_frames(plan, ports);
	assert((requested == std::vector<std::uint64_t>{0, 1, 2}));
	assert((samples == std::vector<std::uint64_t>{100, 1'701, 3'303}));
	assert(report.frames_written == 3);
	assert(report.maximum_in_flight_frames == 1);
}

void cancellation_is_checked_at_each_frame_boundary() {
	auto plan = keyed_plan();
	bool cancelled = false;
	std::size_t writes = 0;
	selected_v20_executor_ports ports;
	ports.cancelled = [&] { return cancelled; };
	ports.keyed_frame = [&](const selected_v20_keyed_frame_request&) {
		cancelled = true;
		return solid(1, 2, 3);
	};
	ports.write_frame = [&](const selected_v20_output_frame&) { ++writes; };
	try {
		static_cast<void>(execute_selected_v20_frames(plan, ports));
		assert(false);
	} catch (const selected_v20_execution_error& error) {
		assert(error.code() == selected_v20_execution_error_code::cancelled);
	}
	assert(writes == 0);
}

void malformed_evaluated_frames_fail_closed() {
	auto plan = keyed_plan();
	selected_v20_executor_ports ports;
	ports.keyed_frame = [](const selected_v20_keyed_frame_request&) {
		return selected_v20_rgba_frame{2, 2, std::vector<std::uint8_t>(15)};
	};
	ports.write_frame = [](const selected_v20_output_frame&) {};
	try {
		static_cast<void>(execute_selected_v20_frames(plan, ports));
		assert(false);
	} catch (const selected_v20_execution_error& error) {
		assert(error.code() == selected_v20_execution_error_code::frame_contract);
	}
}

[[nodiscard]] selected_v20_execution_plan static_plan() {
	selected_v20_execution_plan plan;
	plan.family = selected_v20_family::static_composition_v8;
	plan.width = 2;
	plan.height = 2;
	plan.output_frame_count = 2;
	plan.output_rate = ExactRational(2);
	plan.background_rgba = {0, 0, 0, 255};
	selected_v20_interval interval;
	interval.start_time = ExactRational(0);
	interval.duration = ExactRational(1);
	selected_v20_layer layer;
	layer.blend_mode = selected_v20_blend_mode::normal;
	layer.clips.push_back(selected_v20_clip{
		"outgoing", 0, ExactRational(0), ExactRational(1),
		ExactRational(1), ExactRational(0),
	});
	layer.clips.push_back(selected_v20_clip{
		"incoming", 1, ExactRational(0), ExactRational(1),
		ExactRational(0), ExactRational(1),
	});
	interval.layers.push_back(std::move(layer));
	plan.intervals.push_back(std::move(interval));
	return plan;
}

void static_composition_resolves_vfr_ordinals_and_blends_deterministically() {
	auto plan = static_plan();
	const std::array<std::vector<ExactRational>, 2> boundaries{{
		{ExactRational(0), ExactRational(cpp_int(1), cpp_int(4)), ExactRational(cpp_int(3), cpp_int(4)), ExactRational(1)},
		{ExactRational(0), ExactRational(cpp_int(1), cpp_int(2)), ExactRational(1)},
	}};
	std::vector<std::uint64_t> ordinals;
	std::vector<std::array<std::uint8_t, 4>> pixels;
	selected_v20_executor_ports ports;
	ports.source_timing = [&](const std::size_t index) {
		return std::span<const ExactRational>{boundaries.at(index)};
	};
	ports.static_frame = [&](const selected_v20_static_frame_request& request) {
		ordinals.push_back(request.picture_ordinal);
		return request.input_index == 0 ? solid(255, 0, 0) : solid(0, 0, 255);
	};
	ports.write_frame = [&](const selected_v20_output_frame& frame) {
		pixels.push_back({frame.rgba[0], frame.rgba[1], frame.rgba[2], frame.rgba[3]});
	};
	const auto report = execute_selected_v20_frames(plan, ports);
	assert(report.frames_written == 2);
	assert((ordinals == std::vector<std::uint64_t>{0, 0, 1, 1}));
	assert((pixels == std::vector<std::array<std::uint8_t, 4>>{
		{255, 0, 0, 255}, {128, 0, 128, 255},
	}));
}

void core_self_test_is_operation_specific_and_truthful() {
	const auto result = self_test_selected_v20_frame_executor();
	assert(result.operation == "media-render");
	assert(result.profile == "selected-v20-v7-v8");
	assert(result.exact_picture_ordinals);
	assert(result.keyed_evaluated_rgba);
	assert(result.static_composition);
	assert(result.maximum_in_flight_frames == 1);
}

void authenticated_snapshot_capture_retains_exact_v7_authority() {
	const auto captured = capture_selected_v20_execution_plan(7,
		R"({"version":7,"outputFrameCount":3,"range":{"startFrame":100},"sampleRate":48000,"quality":"balanced","canvas":{"width":2,"height":2,"frameRate":{"num":30000,"den":1001},"backgroundColor":"#01020380"},"inputs":[{"kind":"video-source"},{"kind":"staged-audio-mix","sampleRate":48000,"durationFrames":4800,"channelLayout":"stereo"}]})"
	);
	assert(captured.family == selected_v20_family::keyed_evaluated_rgba_v7);
	assert(captured.output_frame_count == 3);
	assert(captured.sample_start == 100);
	assert(captured.sample_rate == 48'000);
	assert(captured.output_rate.numerator() == 30'000);
	assert(captured.output_rate.denominator() == 1'001);
	assert((captured.background_rgba == std::array<std::uint8_t, 4>{1, 2, 3, 128}));
	assert(captured.includes_staged_audio);
	assert(captured.audio_sample_count == 4'800);
	assert(captured.audio_layout == selected_v20_audio_layout::stereo);
}

} // namespace

int main() {
	authenticated_frame_pack_binds_exact_cadence();
	keyed_executor_uses_exact_on_demand_cadence();
	cancellation_is_checked_at_each_frame_boundary();
	malformed_evaluated_frames_fail_closed();
	static_composition_resolves_vfr_ordinals_and_blends_deterministically();
	core_self_test_is_operation_specific_and_truthful();
	authenticated_snapshot_capture_retains_exact_v7_authority();
}
