/* SPDX-License-Identifier: AGPL-3.0-only */

#include "ffmpeg_selected_v20_render.hpp"
#include "ffmpeg_hardware_encode.hpp"
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

[[nodiscard]] bool legacy_delivery_codec_set_available() {
	return avcodec_find_encoder_by_name("libx264") != nullptr
		&& avcodec_find_encoder_by_name("libvpx-vp9") != nullptr
		&& avcodec_find_encoder_by_name("aac") != nullptr
		&& avcodec_find_encoder_by_name("libopus") != nullptr;
}

[[nodiscard]] bool v14_delivery_codec_set_available() {
	if (!ffmpeg_professional_cpu_encoder_set_available()) return false;
	for (const auto* name : {"aac", "libopus", "pcm_s16le", "flac"}) {
		if (avcodec_find_encoder_by_name(name) == nullptr) return false;
	}
	return true;
}

struct readiness_receipt final {
	bool ready{};
	std::string control_json;
};

[[nodiscard]] readiness_receipt selected_v20_readiness(const bool delivery_codecs_available) {
	const auto core = self_test_selected_v20_frame_executor();
	const bool keyed_adapter = self_test_selected_v20_keyed_adapter();
	const bool frame_core = core.exact_picture_ordinals
		&& core.keyed_evaluated_rgba && core.static_composition
		&& core.maximum_in_flight_frames == 1;
	const bool evaluated_rgba_input_bound = keyed_adapter;
	const bool static_geometry_adapter_bound = false;
	const bool caption_delivery_adapter_bound = false;
	const bool staged_audio_input_bound = keyed_adapter;
	const bool ready = frame_core && evaluated_rgba_input_bound
		&& static_geometry_adapter_bound && caption_delivery_adapter_bound
		&& staged_audio_input_bound && delivery_codecs_available;
	std::ostringstream result;
	result << "{\"contractVersion\":1,\"operation\":\"media-render\","
		<< "\"profile\":\"selected-v20-v7-v8\",\"planVersions\":[7,8],"
		<< "\"exactPictureOrdinals\":" << (core.exact_picture_ordinals ? "true" : "false") << ','
		<< "\"keyedEvaluatedRgbaExecutor\":" << (core.keyed_evaluated_rgba ? "true" : "false") << ','
		<< "\"staticCompositionExecutor\":" << (core.static_composition ? "true" : "false") << ','
		<< "\"maximumInFlightFrames\":" << core.maximum_in_flight_frames << ','
		<< "\"evaluatedRgbaInputBound\":" << (evaluated_rgba_input_bound ? "true" : "false") << ','
		<< "\"staticGeometryAdapterBound\":"
		<< (static_geometry_adapter_bound ? "true" : "false") << ','
		<< "\"captionDeliveryAdapterBound\":"
		<< (caption_delivery_adapter_bound ? "true" : "false") << ','
		<< "\"stagedAudioInputBound\":" << (staged_audio_input_bound ? "true" : "false") << ','
		<< "\"deliveryCodecSetAvailable\":"
		<< (delivery_codecs_available ? "true" : "false") << ','
		<< "\"frameCoreReady\":" << (frame_core ? "true" : "false") << ",\"ready\":"
		<< (ready ? "true" : "false") << '}';
	return {ready, result.str()};
}

[[nodiscard]] readiness_receipt selected_v28_v14_readiness(const bool delivery_codecs_available) {
	const auto core = self_test_selected_v20_frame_executor();
	const bool evaluated_rgba_executor = self_test_selected_v20_keyed_adapter();
	const bool staged_audio_input_bound = evaluated_rgba_executor;
	const bool ready = core.exact_picture_ordinals && evaluated_rgba_executor
		&& core.maximum_in_flight_frames == 1 && staged_audio_input_bound
		&& delivery_codecs_available;
	std::ostringstream result;
	result << "{\"contractVersion\":1,\"operation\":\"media-render\","
		<< "\"profile\":\"selected-v28-v14-carrier\",\"planVersion\":14,"
		<< "\"rgbaFramePackVersion\":1,\"exactPictureOrdinals\":"
		<< (core.exact_picture_ordinals ? "true" : "false") << ','
		<< "\"evaluatedRgbaExecutor\":" << (evaluated_rgba_executor ? "true" : "false") << ','
		<< "\"maximumInFlightFrames\":" << core.maximum_in_flight_frames << ','
		<< "\"stagedAudioInputBound\":" << (staged_audio_input_bound ? "true" : "false") << ','
		<< "\"deliveryCodecSetAvailable\":"
		<< (delivery_codecs_available ? "true" : "false") << ",\"ready\":"
		<< (ready ? "true" : "false") << '}';
	return {ready, result.str()};
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
	const auto receipt = selected_v20_readiness(legacy_delivery_codec_set_available());
	return {receipt.ready ? 0 : 78, receipt.control_json};
}

engine_result self_test_selected_v28_v14_render() {
	const auto receipt = selected_v28_v14_readiness(v14_delivery_codec_set_available());
	return {receipt.ready ? 0 : 78, receipt.control_json};
}

engine_result execute_selected_v20_render_job(const invocation& job) {
	try {
		const auto captured = capture_selected_v20_execution_plan(
			job.admitted_plan.version, job.admitted_plan.authenticated_plan_json
		);
		if (captured.caption_delivery.any()) {
			std::ostringstream result;
			result << "{\"error\":\"unsupported-caption-adapter\",\"operation\":\""
				<< operation_name(job.kind) << "\",\"planVersion\":"
				<< job.admitted_plan.version << ",\"captionDelivery\":{\"mux\":"
				<< (captured.caption_delivery.mux ? "true" : "false")
				<< ",\"burnIn\":" << (captured.caption_delivery.burn_in ? "true" : "false")
				<< ",\"sidecar\":" << (captured.caption_delivery.sidecar ? "true" : "false")
				<< "}}";
			return {78, result.str()};
		}
		const auto& plan = captured.execution;
		if (plan.width != job.admitted_plan.width || plan.height != job.admitted_plan.height
			|| plan.output_frame_count != job.admitted_plan.output_frame_count
			|| plan.includes_staged_audio != job.admitted_plan.includes_audio) {
			return {65, "{\"error\":\"selected-v20-authority-mismatch\",\"operation\":\"media-render\"}"};
		}
		if (plan.family == selected_v20_family::static_composition_v8) {
			std::ostringstream result;
			result << "{\"error\":\"unsupported-selected-v20-static-adapter\",\"operation\":\""
				<< operation_name(job.kind) << "\",\"planVersion\":" << job.admitted_plan.version
				<< ",\"missing\":\"static-geometry-frame-adapter\"}";
			return {78, result.str()};
		}
		if (plan.family == selected_v20_family::keyed_evaluated_rgba_v7) {
			return execute_selected_v20_keyed_adapter(
				job, plan, source_with_role(job, "evaluated-rgba-frame-pack"),
				optional_source_with_role(job, "staged-audio-mix")
			);
		}
		return {65, "{\"error\":\"selected-v20-family-mismatch\",\"operation\":\"media-render\"}"};
	} catch (const std::exception& error) {
		return {65, "{\"error\":\"selected-v20-execution-authority\",\"operation\":\""
			+ std::string{operation_name(job.kind)} + "\",\"detail\":\"" + escaped(error.what()) + "\"}"};
	}
}

engine_result execute_v14_evaluated_rgba_render_job(const invocation& job) {
	try {
		if (job.admitted_plan.version != 14) {
			return {65, "{\"error\":\"v14-carrier-plan-version\",\"operation\":\"media-render\"}"};
		}
		selected_v20_execution_plan plan;
		plan.family = selected_v20_family::keyed_evaluated_rgba_v7;
		plan.width = job.admitted_plan.width;
		plan.height = job.admitted_plan.height;
		plan.output_frame_count = job.admitted_plan.output_frame_count;
		plan.output_rate = ExactRational(
			job.admitted_plan.frame_rate_num, job.admitted_plan.frame_rate_den
		);
		plan.sample_start = job.admitted_plan.sample_start;
		plan.sample_rate = job.admitted_plan.sample_rate;
		plan.audio_sample_count = job.admitted_plan.audio_sample_count;
		plan.quality = job.admitted_plan.quality;
		plan.includes_staged_audio = job.admitted_plan.includes_audio;
		if (job.admitted_plan.audio_layout == "mono") {
			plan.audio_layout = selected_v20_audio_layout::mono;
		} else if (job.admitted_plan.audio_layout == "stereo") {
			plan.audio_layout = selected_v20_audio_layout::stereo;
		} else plan.audio_layout = selected_v20_audio_layout::preserve;
		return execute_selected_v20_keyed_adapter(
			job, plan, source_with_role(job, "evaluated-rgba-frame-pack"),
			optional_source_with_role(job, "staged-audio-mix")
		);
	} catch (const std::exception& error) {
		return {65, "{\"error\":\"v14-carrier-authority\",\"operation\":\"media-render\",\"detail\":\""
			+ escaped(error.what()) + "\"}"};
	}
}

} // namespace framescaper::media
