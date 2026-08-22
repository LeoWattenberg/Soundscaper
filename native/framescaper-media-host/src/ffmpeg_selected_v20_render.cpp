/* SPDX-License-Identifier: AGPL-3.0-only */

#include "ffmpeg_selected_v20_render.hpp"
#include "ffmpeg_selected_v20_adapter.hpp"
#include "selected_v20_frame_executor.hpp"
#include "selected_v20_plan_capture.hpp"

extern "C" {
#include <libavcodec/avcodec.h>
}

#include <sstream>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>

namespace framescaper::media {
namespace {

[[nodiscard]] bool closed_delivery_codec_set_available() {
	return avcodec_find_encoder_by_name("libx264") != nullptr
		&& avcodec_find_encoder_by_name("libvpx-vp9") != nullptr
		&& avcodec_find_encoder_by_name("aac") != nullptr
		&& avcodec_find_encoder_by_name("libopus") != nullptr;
}

[[nodiscard]] std::string readiness_json(const bool delivery_codecs_available) {
	const auto core = self_test_selected_v20_frame_executor();
	const bool keyed_adapter = self_test_selected_v20_keyed_adapter();
	const bool frame_core = core.exact_picture_ordinals
		&& core.keyed_evaluated_rgba && core.static_composition
		&& core.maximum_in_flight_frames == 1;
	std::ostringstream result;
	result << "{\"contractVersion\":1,\"operation\":\"media-render\","
		<< "\"profile\":\"selected-v20-v7-v8\",\"planVersions\":[7,8],"
		<< "\"exactPictureOrdinals\":" << (core.exact_picture_ordinals ? "true" : "false") << ','
		<< "\"keyedEvaluatedRgbaExecutor\":" << (core.keyed_evaluated_rgba ? "true" : "false") << ','
		<< "\"staticCompositionExecutor\":" << (core.static_composition ? "true" : "false") << ','
		<< "\"maximumInFlightFrames\":" << core.maximum_in_flight_frames << ','
		<< "\"evaluatedRgbaInputBound\":" << (keyed_adapter ? "true" : "false") << ','
		<< "\"staticGeometryAdapterBound\":false,"
		<< "\"stagedAudioInputBound\":" << (keyed_adapter ? "true" : "false") << ','
		<< "\"deliveryCodecSetAvailable\":"
		<< (delivery_codecs_available ? "true" : "false") << ','
		<< "\"frameCoreReady\":" << (frame_core ? "true" : "false") << ",\"ready\":false}";
	return result.str();
}

[[nodiscard]] std::size_t source_with_role(const invocation& job, const std::string_view role) {
	for (std::size_t index = 0; index < job.source_roles.size(); ++index) {
		if (job.source_roles[index] == role) return index;
	}
	throw std::runtime_error("The selected-V20 derived input role is absent after admission.");
}

[[nodiscard]] std::optional<std::size_t> optional_source_with_role(
	const invocation& job, const std::string_view role
) {
	for (std::size_t index = 0; index < job.source_roles.size(); ++index) {
		if (job.source_roles[index] == role) return index;
	}
	return std::nullopt;
}

[[nodiscard]] std::string escaped(const std::string& value) {
	std::string result;
	for (const auto character : value) {
		if (character == '\\' || character == '"') result += '\\';
		if (character == '\n') result += "\\n";
		else if (character == '\r') result += "\\r";
		else result += character;
	}
	return result;
}

} // namespace

engine_result self_test_selected_v20_render() {
	return {78, readiness_json(closed_delivery_codec_set_available())};
}

engine_result execute_selected_v20_render_job(const invocation& job) {
	try {
		const auto plan = capture_selected_v20_execution_plan(
			job.admitted_plan.version, job.admitted_plan.authenticated_plan_json
		);
		if (plan.width != job.admitted_plan.width || plan.height != job.admitted_plan.height
			|| plan.output_frame_count != job.admitted_plan.output_frame_count
			|| plan.includes_staged_audio != job.admitted_plan.includes_audio) {
			return {65, "{\"error\":\"selected-v20-authority-mismatch\",\"operation\":\"media-render\"}"};
		}
		if (plan.family == selected_v20_family::keyed_evaluated_rgba_v7) {
			return execute_selected_v20_keyed_adapter(
				job, plan, source_with_role(job, "evaluated-rgba-frame-pack"),
				optional_source_with_role(job, "staged-audio-mix")
			);
		}
		std::ostringstream result;
		result << "{\"error\":\"unsupported-selected-v20-static-adapter\",\"operation\":\""
			<< operation_name(job.kind) << "\",\"planVersion\":" << job.admitted_plan.version
			<< ",\"missing\":\"static-geometry-frame-adapter\"}";
		return {78, result.str()};
	} catch (const std::exception& error) {
		return {65, "{\"error\":\"selected-v20-execution-authority\",\"operation\":\""
			+ std::string{operation_name(job.kind)} + "\",\"detail\":\"" + escaped(error.what()) + "\"}"};
	}
}

} // namespace framescaper::media
