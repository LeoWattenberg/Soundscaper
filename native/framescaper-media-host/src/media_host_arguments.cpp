// SPDX-License-Identifier: AGPL-3.0-only

#include "media_host_arguments.hpp"
#include "video_timing_asset.hpp"

#include <algorithm>
#include <charconv>
#include <string_view>
#include <unordered_set>

namespace framescaper::media {
namespace {

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

} // namespace

parsed_arguments parse_arguments(const int argc, char** argv) {
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
			if (value != "selected-v20-render" && value != "selected-v28-v14-render") {
				throw admission_error("The operation-specific self-test is outside the closed registry.");
			}
			parsed.self_test_operation = std::string{value};
		} else if (flag == "--operation") {
			unique_flag(flags, flag); parsed.kind = parse_operation(value);
			if (!parsed.kind) throw admission_error("The host operation is outside helper contract v1.");
		} else if (flag == "--plan") {
			unique_flag(flags, flag); parsed.plan = admitted_path(value, "plan");
		} else if (flag == "--plan-sha256") {
			unique_flag(flags, flag); parsed.plan_sha256 = std::string{value};
		} else if (flag == "--source") {
			if (parsed.sources.size() >= maximum_sources) throw admission_error("The host source list exceeds its hard ceiling.");
			parsed.sources.push_back(admitted_path(value, "source"));
			parsed.source_sha256.emplace_back(); parsed.source_stream_fds.push_back(-1);
		} else if (flag == "--source-stream" || flag == "--source-stream-fd") {
			if (parsed.sources.size() >= 2) throw admission_error("The host live source list exceeds its hard ceiling.");
			const auto fd = flag == "--source-stream"
				? (value == "stdin" ? 0 : -1)
				: static_cast<int>(positive_integer(value, "source stream fd", 3));
			if (fd < 0 || (flag == "--source-stream-fd" && fd != 3)
				|| std::find(parsed.source_stream_fds.begin(), parsed.source_stream_fds.end(), fd)
					!= parsed.source_stream_fds.end()) {
				throw admission_error("A live source must use the unique stdin or fd 3 grant.");
			}
			parsed.sources.emplace_back(); parsed.source_sha256.emplace_back();
			parsed.source_stream_fds.push_back(fd);
		} else if (flag == "--source-sha256") {
			if (parsed.sources.empty() || parsed.source_stream_fds.back() >= 0
				|| !parsed.source_sha256.back().empty()) {
				throw admission_error("A source digest must immediately authenticate one file source.");
			}
			parsed.source_sha256.back() = value;
		} else if (flag == "--source-byte-length") {
			if (parsed.source_byte_lengths.size() >= maximum_sources) throw admission_error("The host source length list exceeds its hard ceiling.");
			parsed.source_byte_lengths.push_back(positive_integer(value, "source byte length", maximum_native_file_bytes));
		} else if (flag == "--video-timing-asset") {
			if (parsed.video_timing_assets.size() >= video_timing_asset_maximum_grants) {
				throw admission_error("The host timing-asset list exceeds its hard ceiling.");
			}
			parsed.video_timing_assets.push_back(admitted_path(value, "video timing asset"));
		} else if (flag == "--video-timing-sha256") {
			if (parsed.video_timing_sha256.size() >= video_timing_asset_maximum_grants) {
				throw admission_error("The host timing-digest list exceeds its hard ceiling.");
			}
			parsed.video_timing_sha256.emplace_back(value);
		} else if (flag == "--video-timing-byte-length") {
			if (parsed.video_timing_byte_lengths.size() >= video_timing_asset_maximum_grants) {
				throw admission_error("The host timing-length list exceeds its hard ceiling.");
			}
			parsed.video_timing_byte_lengths.push_back(positive_integer(
				value, "video timing asset byte length", video_timing_asset_maximum_bytes
			));
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

} // namespace framescaper::media
