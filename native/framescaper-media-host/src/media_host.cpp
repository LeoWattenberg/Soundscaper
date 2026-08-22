// SPDX-License-Identifier: AGPL-3.0-only

#include "ffmpeg_media_engine.hpp"
#include "ffmpeg_selected_v20_render.hpp"
#include "media_file_grants.hpp"
#include "media_host_contract.hpp"

#include <charconv>
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_set>
#include <vector>

namespace framescaper::media {
namespace {

constexpr std::uint64_t maximum_native_file_bytes = 16ULL * 1024ULL * 1024ULL * 1024ULL * 1024ULL;

class admission_error final : public std::runtime_error {
public:
	using std::runtime_error::runtime_error;
};

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

[[nodiscard]] std::filesystem::path admitted_path(
	const std::string_view value,
	const std::string_view label
) {
	if (value.empty() || value.size() > maximum_path_bytes) {
		throw admission_error(std::string{label} + " path is empty or oversized.");
	}
	const std::filesystem::path path{value};
	if (!path.is_absolute() || path != path.lexically_normal()) {
		throw admission_error(std::string{label} + " path must be an exact normalized absolute grant.");
	}
	return path;
}

[[nodiscard]] std::uint64_t positive_integer(
	const std::string_view value,
	const std::string_view label,
	const std::uint64_t maximum
) {
	if (value.empty() || (value.size() > 1 && value.front() == '0')) {
		throw admission_error(std::string{label} + " is not a canonical positive integer.");
	}
	std::uint64_t result{};
	const auto converted = std::from_chars(value.data(), value.data() + value.size(), result);
	if (converted.ec != std::errc{} || converted.ptr != value.data() + value.size()
		|| result == 0 || result > maximum) {
		throw admission_error(std::string{label} + " is outside its closed numeric domain.");
	}
	return result;
}

struct parsed_arguments final {
	bool self_test{};
	bool capabilities{};
	std::optional<std::string> self_test_operation;
	std::optional<operation> kind;
	std::optional<std::filesystem::path> plan;
	std::optional<std::string> plan_sha256;
	std::vector<std::filesystem::path> sources;
	std::vector<std::string> source_sha256;
	std::vector<std::uint64_t> source_byte_lengths;
	std::vector<std::string> source_roles;
	std::optional<std::filesystem::path> temporary_output;
	std::optional<std::filesystem::path> decode_output;
	std::optional<std::filesystem::path> destination_root;
	std::optional<std::filesystem::path> scratch_root;
	std::optional<std::string> backend;
	std::optional<std::string> proxy_recipe;
	std::optional<std::uint64_t> proxy_width;
	std::optional<std::uint64_t> proxy_height;
	std::optional<std::uint64_t> maximum_output_bytes;
	std::optional<std::string> sequence_profile;
	std::optional<std::uint64_t> sequence_rate_num;
	std::optional<std::uint64_t> sequence_rate_den;
};

void unique_flag(std::unordered_set<std::string>& flags, const std::string& flag) {
	if (!flags.insert(flag).second) throw admission_error("A host flag may not be repeated: " + flag);
}

[[nodiscard]] bool backend_is_known(const std::string_view value) {
	static const std::unordered_set<std::string_view> backends{
		"native-cpu", "d3d11va", "media-foundation", "qsv", "nvdec", "nvenc",
		"amf", "videotoolbox", "vaapi",
	};
	return backends.contains(value);
}

[[nodiscard]] parsed_arguments parse_arguments(const int argc, char** argv) {
	parsed_arguments parsed;
	std::unordered_set<std::string> flags;
	for (int index = 1; index < argc; ++index) {
		const std::string flag{argv[index]};
		if (flag == "--self-test" || flag == "--capabilities") {
			unique_flag(flags, flag);
			parsed.self_test = flag == "--self-test";
			parsed.capabilities = flag == "--capabilities";
			continue;
		}
		if (index + 1 >= argc) throw admission_error("A host flag is missing its value: " + flag);
		const std::string_view value{argv[++index]};
		if (flag == "--self-test-operation") {
			unique_flag(flags, flag);
			if (value != "selected-v20-render") {
				throw admission_error("The operation-specific self-test is outside the closed registry.");
			}
			parsed.self_test_operation = std::string{value};
		} else if (flag == "--operation") {
			unique_flag(flags, flag);
			parsed.kind = parse_operation(value);
			if (!parsed.kind) throw admission_error("The host operation is outside helper contract v1.");
		} else if (flag == "--plan") {
			unique_flag(flags, flag); parsed.plan = admitted_path(value, "plan");
		} else if (flag == "--plan-sha256") {
			unique_flag(flags, flag); parsed.plan_sha256 = std::string{value};
		} else if (flag == "--source") {
			if (parsed.sources.size() >= maximum_sources) throw admission_error("The host source list exceeds its hard ceiling.");
			parsed.sources.push_back(admitted_path(value, "source"));
		} else if (flag == "--source-sha256") {
			if (parsed.source_sha256.size() >= maximum_sources) throw admission_error("The host source digest list exceeds its hard ceiling.");
			parsed.source_sha256.emplace_back(value);
		} else if (flag == "--source-byte-length") {
			if (parsed.source_byte_lengths.size() >= maximum_sources) throw admission_error("The host source length list exceeds its hard ceiling.");
			parsed.source_byte_lengths.push_back(positive_integer(value, "source byte length", maximum_native_file_bytes));
		} else if (flag == "--temporary-output") {
			unique_flag(flags, flag); parsed.temporary_output = admitted_path(value, "temporary output");
		} else if (flag == "--decode-output") {
			unique_flag(flags, flag); parsed.decode_output = admitted_path(value, "decode output");
		} else if (flag == "--destination-root") {
			unique_flag(flags, flag); parsed.destination_root = admitted_path(value, "destination root");
		} else if (flag == "--scratch") {
			unique_flag(flags, flag); parsed.scratch_root = admitted_path(value, "scratch");
		} else if (flag == "--backend") {
			unique_flag(flags, flag);
			if (!backend_is_known(value)) throw admission_error("The host backend is outside the closed build policy.");
			parsed.backend = std::string{value};
		} else if (flag == "--source-role") {
			if (parsed.source_roles.size() >= maximum_sources) throw admission_error("The host source role list exceeds its hard ceiling.");
			if (value != "original" && value != "evaluated-rgba-frame-pack"
				&& value != "staged-audio-mix" && value != "image-sequence-pack"
				&& value != "image-sequence-inventory") {
				throw admission_error("A source role is outside the closed helper authority registry.");
			}
			parsed.source_roles.emplace_back(value);
		} else if (flag == "--proxy-recipe") {
			unique_flag(flags, flag); parsed.proxy_recipe = std::string{value};
		} else if (flag == "--proxy-width") {
			unique_flag(flags, flag); parsed.proxy_width = positive_integer(value, "proxy width (maximum 1280)", 1280);
		} else if (flag == "--proxy-height") {
			unique_flag(flags, flag); parsed.proxy_height = positive_integer(value, "proxy height (maximum 720)", 720);
		} else if (flag == "--maximum-output-bytes") {
			unique_flag(flags, flag);
			parsed.maximum_output_bytes = positive_integer(value, "maximum output bytes", maximum_native_file_bytes);
		} else if (flag == "--sequence-profile") {
			unique_flag(flags, flag); parsed.sequence_profile = std::string{value};
		} else if (flag == "--sequence-rate-num") {
			unique_flag(flags, flag); parsed.sequence_rate_num = positive_integer(value, "sequence rate numerator", 1'000'000);
		} else if (flag == "--sequence-rate-den") {
			unique_flag(flags, flag); parsed.sequence_rate_den = positive_integer(value, "sequence rate denominator", 1'000'000);
		} else throw admission_error("The host does not admit raw FFmpeg or unknown arguments: " + flag);
	}
	return parsed;
}

void require_source_authentication(
	invocation& job,
	const parsed_arguments& parsed,
	const bool native_job
) {
	if (parsed.sources.empty() || parsed.sources.size() != parsed.source_sha256.size()) {
		throw admission_error("A media job requires paired exact source and source-sha256 grants.");
	}
	if (native_job && (parsed.sources.size() != parsed.source_byte_lengths.size()
		|| parsed.sources.size() != parsed.source_roles.size())) {
		throw admission_error("Every native source requires its exact byte length and per-input role.");
	}
	job.sources.reserve(parsed.sources.size());
	for (std::size_t index = 0; index < parsed.sources.size(); ++index) {
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

[[nodiscard]] std::vector<std::size_t> original_source_indices(const invocation& job) {
	std::vector<std::size_t> result;
	for (std::size_t index = 0; index < job.source_roles.size(); ++index) {
		if (job.source_roles[index] == "original") result.push_back(index);
	}
	return result;
}

void require_selected_v20_source_roles(const invocation& job) {
	const auto originals = original_source_indices(job);
	require_plan_sources_match(job, originals);
	std::size_t carriers = 0;
	std::size_t audio = 0;
	bool extras_started = false;
	for (const auto& role : job.source_roles) {
		if (role == "original") {
			if (extras_started) throw admission_error("Selected V20 originals must precede derived inputs.");
			continue;
		}
		extras_started = true;
		if (role == "evaluated-rgba-frame-pack") {
			if (audio != 0 || ++carriers > 1) {
				throw admission_error("Selected V20 admits one evaluated RGBA carrier before staged audio.");
			}
		} else if (role == "staged-audio-mix") {
			if (++audio > 1) throw admission_error("Selected V20 admits one staged audio mix.");
		} else throw admission_error("A selected V20 render carries an unrelated source role.");
	}
	if (job.admitted_plan.version == 7 && carriers != 1) {
		throw admission_error("Selected V20 V7 requires one authenticated evaluated RGBA frame pack.");
	}
	if (job.admitted_plan.version == 8 && carriers != 0) {
		throw admission_error("Selected V20 V8 evaluates only its authenticated original sources.");
	}
	if (audio != static_cast<std::size_t>(job.admitted_plan.includes_audio)) {
		throw admission_error("Selected V20 staged audio does not match its canonical plan.");
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
			|| parsed.sequence_rate_num || parsed.sequence_rate_den) {
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
	job.admitted_plan = authenticate_media_plan(job.plan, job.plan_sha256);
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
		if (!job.admitted_plan.image_sequence_inventory_sha256.empty()) {
			throw admission_error("Ordinary media jobs require only original roles and no image-sequence inventory.");
		}
		if ((job.kind == operation::media_render || job.kind == operation::media_encode)
			&& (job.admitted_plan.version == 7 || job.admitted_plan.version == 8)) {
			require_selected_v20_source_roles(job);
		} else {
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
		"\"stagedAudioInputBound\":false,\"deliveryCodecSetAvailable\":false,"
		"\"frameCoreReady\":false,\"ready\":false}"};
}
engine_result execute_ffmpeg_job(const invocation& job) {
	const auto operation_text = std::string{operation_name(job.kind)};
	if (job.image_sequence) return {
		78, "{\"error\":\"image-sequence-licensing-unavailable\",\"operation\":\"media-decode\","
			"\"policyRow\":\"codec-image-sequence-still-formats\"}",
	};
	if ((job.kind == operation::media_render || job.kind == operation::media_encode)
		&& job.admitted_plan.simple_full_frame_clip) return {
		78, "{\"error\":\"contract-build-has-no-ffmpeg\",\"operation\":\"" + operation_text
			+ "\",\"subset\":\"single-full-frame-clip-v1\"}",
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
		if (parsed.self_test || parsed.capabilities || parsed.self_test_operation) {
			const auto diagnostic_count = static_cast<unsigned>(parsed.self_test)
				+ static_cast<unsigned>(parsed.capabilities)
				+ static_cast<unsigned>(parsed.self_test_operation.has_value());
			if (diagnostic_count != 1) throw admission_error("Diagnostic modes are mutually exclusive.");
			if (parsed.self_test_operation) {
				if (argc != 3) throw admission_error("An operation-specific self-test admits only its exact selector.");
				const auto result = self_test_selected_v20_render();
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
