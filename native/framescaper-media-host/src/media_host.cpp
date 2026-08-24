// SPDX-License-Identifier: AGPL-3.0-only

#include "ffmpeg_media_engine.hpp"
#include "ffmpeg_selected_v20_render.hpp"
#include "media_file_grants.hpp"
#include "media_host_arguments.hpp"
#include "media_host_contract.hpp"
#include "video_timing_asset.hpp"

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#if defined(_WIN32)
#include <fcntl.h>
#include <io.h>
#endif

namespace framescaper::media {
namespace {

[[nodiscard]] std::string json_escape(const std::string_view value) {
	std::string escaped;
	escaped.reserve(value.size());
	for (const char character : value) {
		switch (character) {
		case '\\': escaped += "\\\\"; break;
		case '"': escaped += "\\\""; break;
		case '\n': escaped += "\\n"; break;
		case '\r': escaped += "\\r"; break;
		case '\t': escaped += "\\t"; break;
		default:
			if (static_cast<unsigned char>(character) < 0x20U) {
				throw admission_error("A host argument contains a control character.");
			}
			escaped += character;
		}
	}
	return escaped;
}

void require_source_authentication(
	invocation& job,
	const parsed_arguments& parsed,
	const bool native_job
) {
	if (parsed.sources.empty() || parsed.sources.size() != parsed.source_sha256.size()
		|| parsed.sources.size() != parsed.source_stream_fds.size()) {
		throw admission_error("A media job requires one exact file or live source grant per input.");
	}
	if (native_job && (parsed.sources.size() != parsed.source_byte_lengths.size()
		|| parsed.sources.size() != parsed.source_roles.size())) {
		throw admission_error("Every native source requires its exact byte length and per-input role.");
	}
	job.sources.reserve(parsed.sources.size());
	for (std::size_t index = 0; index < parsed.sources.size(); ++index) {
		if (parsed.source_stream_fds[index] >= 0) {
			if (!native_job || !parsed.sources[index].empty() || !parsed.source_sha256[index].empty()) {
				throw admission_error("Only a native media job may consume a pathless live source.");
			}
			job.sources.emplace_back();
			continue;
		}
		if (parsed.source_sha256[index].empty()) {
			throw admission_error("A file source requires its exact SHA-256 grant.");
		}
		const auto admitted = authenticate_regular_file(
			parsed.sources[index], parsed.source_sha256[index], "source", maximum_native_file_bytes
		);
		if (native_job && std::filesystem::file_size(admitted) != parsed.source_byte_lengths[index]) {
			throw authentication_error("A source length does not authenticate its exact helper grant.");
		}
		job.sources.push_back(admitted);
	}
	job.source_sha256 = parsed.source_sha256;
	job.source_byte_lengths = parsed.source_byte_lengths;
	job.source_roles = parsed.source_roles;
	job.source_stream_fds = parsed.source_stream_fds;
}

[[nodiscard]] std::vector<video_timing_asset_grant> video_timing_grants(
	const parsed_arguments& parsed
) {
	if (parsed.video_timing_assets.size() != parsed.video_timing_sha256.size()
		|| parsed.video_timing_assets.size() != parsed.video_timing_byte_lengths.size()) {
		throw admission_error("Every video timing asset requires its exact digest and byte length grant.");
	}
	std::vector<video_timing_asset_grant> grants;
	grants.reserve(parsed.video_timing_assets.size());
	for (std::size_t index = 0; index < parsed.video_timing_assets.size(); ++index) {
		grants.push_back({
			parsed.video_timing_assets[index], parsed.video_timing_sha256[index],
			parsed.video_timing_byte_lengths[index],
		});
	}
	return grants;
}

void require_plan_sources_match(const invocation& job, const std::vector<std::size_t>& source_indices) {
	if (job.admitted_plan.source_sha256.size() != source_indices.size()) {
		throw authentication_error("The source grants do not authenticate the plan's exact source list.");
	}
	for (std::size_t index = 0; index < source_indices.size(); ++index) {
		const auto& planned = job.admitted_plan.source_sha256[index];
		if (!planned.empty() && planned != job.source_sha256[source_indices[index]]) {
			throw authentication_error("A source digest does not authenticate its canonical plan input.");
		}
	}
}

void require_proxy_source_matches_plan(const invocation& job) {
	if (job.sources.size() != 1 || job.source_sha256.size() != 1
		|| job.source_roles.size() != 1 || job.source_roles.front() != "original") {
		throw admission_error("Proxy generation requires one exact original source grant.");
	}
	const auto matches = std::count(
		job.admitted_plan.source_sha256.begin(), job.admitted_plan.source_sha256.end(),
		job.source_sha256.front()
	);
	if (matches == 0) {
		throw authentication_error("The proxy source digest is absent from its canonical V14 plan.");
	}
}

[[nodiscard]] std::vector<std::size_t> original_source_indices(const invocation& job) {
	std::vector<std::size_t> result;
	for (std::size_t index = 0; index < job.source_roles.size(); ++index) {
		if (job.source_roles[index] == "original") result.push_back(index);
	}
	return result;
}

void require_exact_render_source_roles(const invocation& job) {
	const auto originals = original_source_indices(job);
	std::size_t carriers = 0;
	std::size_t audio = 0;
	bool extras_started = false;
	for (const auto& role : job.source_roles) {
		if (role == "original") {
			if (extras_started) throw admission_error("Exact render originals must precede derived inputs.");
			continue;
		}
		extras_started = true;
		if (role == "evaluated-rgba-frame-pack") {
			if (audio != 0 || ++carriers > 1) {
				throw admission_error("An exact render admits one evaluated RGBA carrier before staged audio.");
			}
		} else if (role == "staged-audio-mix") {
			if (++audio > 1) throw admission_error("An exact render admits one staged audio mix.");
		} else throw admission_error("An exact render carries an unrelated source role.");
	}
	if (!originals.empty() || carriers == 0) require_plan_sources_match(job, originals);
	if (job.admitted_plan.version >= 9) {
			if (job.admitted_plan.version == 14) {
			if (carriers > 1 || (carriers == 0 && audio != 0)
				|| (carriers == 1 && audio != static_cast<std::size_t>(job.admitted_plan.includes_audio))) {
				throw admission_error("A selected V14 carrier must exactly match its RGBA and staged-audio authority.");
			}
			if (carriers == 1) {
				const auto carrier = std::find(job.source_roles.begin(), job.source_roles.end(), "evaluated-rgba-frame-pack");
				const auto carrier_index = static_cast<std::size_t>(carrier - job.source_roles.begin());
				if (job.source_stream_fds[carrier_index] != 0) {
					throw admission_error("The live V14 RGBA carrier requires its stdin grant.");
				}
				if (audio == 1) {
					const auto staged = std::find(job.source_roles.begin(), job.source_roles.end(), "staged-audio-mix");
					const auto audio_index = static_cast<std::size_t>(staged - job.source_roles.begin());
					if (job.source_stream_fds[audio_index] != 3) {
						throw admission_error("The live V14 audio carrier requires its fd 3 grant.");
					}
				}
			}
		} else if (carriers != 0 || audio != 0) {
			throw admission_error("A dormant unified render cannot acquire derived media authority.");
		}
		return;
	}
	const auto expected_carriers = job.admitted_plan.requires_evaluated_rgba_carrier ? 1U : 0U;
	if (carriers != expected_carriers) {
		throw admission_error(expected_carriers == 0
			? "A static V8 render cannot acquire an evaluated RGBA carrier."
			: "An evaluated exact render requires one authenticated RGBA frame pack.");
	}
	if (audio != static_cast<std::size_t>(job.admitted_plan.includes_audio)) {
		throw admission_error("Exact staged audio does not match its canonical plan.");
	}
}

[[nodiscard]] invocation admit_invocation(const parsed_arguments& parsed) {
	if (!parsed.kind || parsed.self_test || parsed.capabilities || parsed.self_test_operation) {
		throw admission_error("A media job must name exactly one operation mode.");
	}
	invocation job;
	job.kind = *parsed.kind;
	require_source_authentication(job, parsed, job.kind != operation::probe_video_source);
	if (job.kind == operation::probe_video_source) {
		if (job.sources.size() != 1 || parsed.plan || parsed.plan_sha256 || parsed.temporary_output
			|| parsed.decode_output || parsed.destination_root || parsed.scratch_root || parsed.backend
			|| !parsed.source_roles.empty() || !parsed.source_byte_lengths.empty()
			|| parsed.proxy_recipe || parsed.proxy_width || parsed.proxy_height
			|| parsed.maximum_output_bytes || parsed.sequence_profile
			|| parsed.sequence_rate_num || parsed.sequence_rate_den
			|| !parsed.video_timing_assets.empty() || !parsed.video_timing_sha256.empty()
			|| !parsed.video_timing_byte_lengths.empty()) {
			throw admission_error("A probe job carries exactly one authenticated source and no render authority.");
		}
		return job;
	}
	if (!parsed.plan || !parsed.plan_sha256) {
		throw admission_error("A native media job requires its canonical plan and SHA-256 identity.");
	}
	if (!parsed.backend || !parsed.maximum_output_bytes || !parsed.scratch_root) {
		throw admission_error("A native media job requires backend, output ceiling, and scratch grants.");
	}
	job.plan = *parsed.plan;
	job.plan_sha256 = *parsed.plan_sha256;
	job.admitted_plan = authenticate_media_plan(
		job.plan, job.plan_sha256, video_timing_grants(parsed)
	);
	job.backend = *parsed.backend;
	job.maximum_output_bytes = *parsed.maximum_output_bytes;
	job.scratch_root = authenticate_directory(*parsed.scratch_root, "scratch root");
	const bool has_sequence = parsed.sequence_profile || parsed.sequence_rate_num || parsed.sequence_rate_den;
	if (has_sequence) {
		if (job.kind != operation::media_decode || !parsed.sequence_profile
			|| !parsed.sequence_rate_num || !parsed.sequence_rate_den || job.sources.size() != 2) {
			throw admission_error("Image-sequence flags form one complete media-decode grant only.");
		}
		std::optional<std::size_t> pack_index;
		std::optional<std::size_t> inventory_index;
		for (std::size_t index = 0; index < job.source_roles.size(); ++index) {
			if (job.source_roles[index] == "image-sequence-pack" && !pack_index) pack_index = index;
			else if (job.source_roles[index] == "image-sequence-inventory" && !inventory_index) inventory_index = index;
			else throw admission_error("Image-sequence decode requires exactly one pack and one inventory role.");
		}
		if (!pack_index || !inventory_index
			|| job.admitted_plan.image_sequence_inventory_sha256.size() != 1
			|| job.admitted_plan.image_sequence_frame_count.size() != 1
			|| job.admitted_plan.image_sequence_frame_rate_num.size() != 1
			|| job.admitted_plan.image_sequence_frame_rate_den.size() != 1
			|| job.admitted_plan.image_sequence_inventory_sha256.front() != job.source_sha256[*inventory_index]
			|| job.admitted_plan.image_sequence_frame_rate_num.front() != *parsed.sequence_rate_num
			|| job.admitted_plan.image_sequence_frame_rate_den.front() != *parsed.sequence_rate_den) {
			throw authentication_error("The image-sequence inventory does not authenticate its canonical plan node.");
		}
		require_plan_sources_match(job, {*pack_index});
		job.image_sequence = authenticate_image_sequence_pack(
			parse_image_sequence_profile(*parsed.sequence_profile),
			job.sources[*pack_index], job.source_sha256[*pack_index], job.source_byte_lengths[*pack_index],
			job.sources[*inventory_index], job.source_sha256[*inventory_index],
			job.source_byte_lengths[*inventory_index],
			static_cast<std::uint32_t>(*parsed.sequence_rate_num),
			static_cast<std::uint32_t>(*parsed.sequence_rate_den)
		);
		if (job.image_sequence->frames.size()
			!= job.admitted_plan.image_sequence_frame_count.front()) {
			throw authentication_error("The image-sequence pack frame count does not authenticate its canonical plan node.");
		}
	} else {
		if (job.kind == operation::media_render || job.kind == operation::media_encode) {
			require_exact_render_source_roles(job);
		} else if (job.kind == operation::media_proxy) {
			if (!job.admitted_plan.image_sequence_inventory_sha256.empty()) {
				throw admission_error("Ordinary proxy generation cannot consume an image-sequence pack.");
			}
			require_proxy_source_matches_plan(job);
		} else {
			if (!job.admitted_plan.image_sequence_inventory_sha256.empty()) {
				throw admission_error("Ordinary media jobs require no image-sequence inventory.");
			}
			if (std::any_of(job.source_roles.begin(), job.source_roles.end(), [](const std::string& role) {
				return role != "original";
			})) throw admission_error("This native media operation admits only original inputs.");
			require_plan_sources_match(job, original_source_indices(job));
		}
	}
	if (job.kind == operation::media_decode) {
		if (!parsed.decode_output || parsed.temporary_output || parsed.destination_root
			|| parsed.proxy_recipe || parsed.proxy_width || parsed.proxy_height) {
			throw admission_error("Decode requires only its dedicated scratch decode output and no destination authority.");
		}
		job.decode_output = authenticate_new_direct_child(*parsed.decode_output, job.scratch_root, "decode output");
		return job;
	}
	if (!parsed.temporary_output || !parsed.destination_root || parsed.decode_output) {
		throw admission_error("Encode, render, and proxy require exact destination and temporary-output grants.");
	}
	job.destination_root = authenticate_directory(*parsed.destination_root, "destination root");
	job.temporary_output = authenticate_new_direct_child(
		*parsed.temporary_output, job.destination_root, "temporary output"
	);
	if (job.kind == operation::media_proxy) {
		if (job.image_sequence || job.sources.size() != 1 || parsed.proxy_recipe != "framescaper-native-prores-proxy-mov-v1"
			|| !parsed.proxy_width || !parsed.proxy_height
			|| (*parsed.proxy_width % 2) != 0 || (*parsed.proxy_height % 2) != 0) {
			throw admission_error("Proxy requires one original and the exact even ProRes Proxy/MOV geometry recipe at most 1280 by 720.");
		}
		job.proxy_recipe = *parsed.proxy_recipe;
		job.proxy_width = static_cast<std::uint32_t>(*parsed.proxy_width);
		job.proxy_height = static_cast<std::uint32_t>(*parsed.proxy_height);
	} else if (parsed.proxy_recipe || parsed.proxy_width || parsed.proxy_height) {
		throw admission_error("Only proxy generation admits a proxy recipe or geometry.");
	}
	return job;
}

void write_capabilities() {
	std::cout << "{\"contractVersion\":" << helper_contract_version << ",\"operations\":[";
	for (std::size_t index = 0; index < operation_names.size(); ++index) {
		if (index > 0) std::cout << ',';
		std::cout << '"' << json_escape(operation_names[index]) << '"';
	}
	std::cout << "],\"rawFfmpegArguments\":false,\"network\":false}\n";
}

} // namespace
} // namespace framescaper::media

#if defined(FRAMESCAPER_MEDIA_HOST_CONTRACT_ONLY)
namespace framescaper::media {
namespace {
[[nodiscard]] std::string_view image_sequence_policy_row(const image_sequence_profile profile) {
	if (profile == image_sequence_profile::png) return "codec-decode-png-image-sequence";
	if (profile == image_sequence_profile::tiff) return "codec-decode-tiff-image-sequence";
	return "codec-decode-openexr-image-sequence";
}
} // namespace

engine_result self_test_ffmpeg() {
	return {0, "{\"contractVersion\":1,\"mode\":\"contract-fixture\",\"ok\":true}"};
}
engine_result self_test_selected_v20_render() {
	return {78,
		"{\"contractVersion\":1,\"operation\":\"media-render\","
		"\"profile\":\"selected-v20-v7-v8\",\"planVersions\":[7,8],"
		"\"exactPictureOrdinals\":false,\"keyedEvaluatedRgbaExecutor\":false,"
		"\"staticCompositionExecutor\":false,\"maximumInFlightFrames\":0,"
		"\"evaluatedRgbaInputBound\":false,\"staticGeometryAdapterBound\":false,"
		"\"captionDeliveryAdapterBound\":false,\"stagedAudioInputBound\":false,"
		"\"deliveryCodecSetAvailable\":false,"
		"\"frameCoreReady\":false,\"ready\":false}"};
}
engine_result self_test_selected_v28_v14_render() {
	return {78,
		"{\"contractVersion\":1,\"operation\":\"media-render\","
		"\"profile\":\"selected-v28-v14-carrier\",\"planVersion\":14,"
		"\"rgbaFramePackVersion\":1,\"exactPictureOrdinals\":false,"
		"\"evaluatedRgbaExecutor\":false,\"maximumInFlightFrames\":0,"
		"\"stagedAudioInputBound\":false,\"deliveryCodecSetAvailable\":false,"
		"\"ready\":false}"};
}
engine_result execute_ffmpeg_job(const invocation& job) {
	const auto operation_text = std::string{operation_name(job.kind)};
	if (job.image_sequence) return {
		78, "{\"error\":\"image-sequence-licensing-unavailable\",\"operation\":\"media-decode\","
			"\"policyRow\":\"" + std::string{image_sequence_policy_row(job.image_sequence->profile)} + "\"}",
	};
	if ((job.kind == operation::media_render || job.kind == operation::media_encode)
		&& job.admitted_plan.version == 8
		&& (job.admitted_plan.caption_mux || job.admitted_plan.caption_burn_in
			|| job.admitted_plan.caption_sidecar)) return {
		78, "{\"error\":\"unsupported-caption-adapter\",\"operation\":\"" + operation_text
			+ "\",\"planVersion\":8,\"captionDelivery\":{\"mux\":"
			+ (job.admitted_plan.caption_mux ? "true" : "false") + ",\"burnIn\":"
			+ (job.admitted_plan.caption_burn_in ? "true" : "false") + ",\"sidecar\":"
			+ (job.admitted_plan.caption_sidecar ? "true" : "false") + "}}",
	};
	if ((job.kind == operation::media_render || job.kind == operation::media_encode)
		&& job.admitted_plan.version == 8) return {
		78, "{\"error\":\"unsupported-selected-v20-static-adapter\",\"operation\":\""
			+ operation_text
			+ "\",\"planVersion\":8,\"missing\":\"static-geometry-frame-adapter\"}",
	};
	if ((job.kind == operation::media_render || job.kind == operation::media_encode)
		&& job.admitted_plan.requires_evaluated_rgba_carrier) return {
		78, "{\"error\":\"contract-build-has-no-ffmpeg\",\"operation\":\"" + operation_text
			+ "\",\"subset\":\"evaluated-rgba-frame-pack-v1\",\"planVersion\":"
			+ std::to_string(job.admitted_plan.version) + "}",
	};
	if (job.kind == operation::media_render || job.kind == operation::media_encode) return {
		78, "{\"error\":\"unsupported-render-subset\",\"operation\":\"" + operation_text
			+ "\",\"planVersion\":"
			+ std::to_string(job.admitted_plan.version) + ",\"family\":\""
			+ job.admitted_plan.unsupported_render_family + "\"}",
	};
	if (job.kind == operation::media_proxy) return {
		78, "{\"error\":\"contract-build-has-no-ffmpeg\",\"operation\":\"media-proxy\","
			"\"container\":\"mov\",\"codec\":\"prores_ks\",\"width\":"
			+ std::to_string(job.proxy_width) + ",\"height\":" + std::to_string(job.proxy_height)
			+ ",\"exportAuthority\":\"original\"}",
	};
	return {78, "{\"error\":\"contract-build-has-no-ffmpeg\",\"operation\":\"" + operation_text + "\"}"};
}
} // namespace framescaper::media
#endif

int main(const int argc, char** argv) {
	using namespace framescaper::media;
	try {
		const auto parsed = parse_arguments(argc, argv);
#if defined(_WIN32)
		if (std::find(parsed.source_stream_fds.begin(), parsed.source_stream_fds.end(), 0)
			!= parsed.source_stream_fds.end() && _setmode(_fileno(stdin), _O_BINARY) == -1) {
			throw admission_error("The stdin live-source grant cannot enter binary mode.");
		}
		if (std::find(parsed.source_stream_fds.begin(), parsed.source_stream_fds.end(), 3)
			!= parsed.source_stream_fds.end() && _setmode(3, _O_BINARY) == -1) {
			throw admission_error("The fd 3 live-source grant cannot enter binary mode.");
		}
#endif
		if (parsed.self_test || parsed.capabilities || parsed.self_test_operation) {
			const auto diagnostic_count = static_cast<unsigned>(parsed.self_test)
				+ static_cast<unsigned>(parsed.capabilities)
				+ static_cast<unsigned>(parsed.self_test_operation.has_value());
			if (diagnostic_count != 1) throw admission_error("Diagnostic modes are mutually exclusive.");
			if (parsed.self_test_operation) {
				if (argc != 3) throw admission_error("An operation-specific self-test admits only its exact selector.");
				const auto result = *parsed.self_test_operation == "selected-v28-v14-render"
					? self_test_selected_v28_v14_render() : self_test_selected_v20_render();
				std::cout << result.control_json << '\n';
				return result.exit_code;
			}
			if (argc != 2) throw admission_error("A diagnostic mode admits no additional arguments.");
			if (parsed.capabilities) { write_capabilities(); return EXIT_SUCCESS; }
			const auto result = self_test_ffmpeg();
			std::cout << result.control_json << '\n';
			return result.exit_code;
		}
		const auto result = execute_ffmpeg_job(admit_invocation(parsed));
		std::cout << result.control_json << '\n';
		return result.exit_code;
	} catch (const authentication_error& error) {
		std::cerr << "{\"error\":\"authentication\",\"message\":\"" << json_escape(error.what()) << "\"}\n";
		return 65;
	} catch (const std::exception& error) {
		std::cerr << "{\"error\":\"admission\",\"message\":\"" << json_escape(error.what()) << "\"}\n";
		return 64;
	}
}
