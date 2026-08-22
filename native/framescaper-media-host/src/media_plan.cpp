/* SPDX-License-Identifier: AGPL-3.0-only */

#include "media_plan.hpp"
#include "legacy_plan_semantics.hpp"
#include "media_file_grants.hpp"
#include "strict_json.hpp"
#include "unified_plan_semantics.hpp"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <fstream>
#include <limits>
#include <sstream>
#include <string_view>

namespace framescaper::media {
namespace {

constexpr std::uintmax_t maximum_plan_bytes = 16U * 1024U * 1024U;
constexpr std::int64_t maximum_safe_integer = 9'007'199'254'740'991;

[[nodiscard]] std::string multiply_decimal(std::string left, const std::uint64_t right_value) {
	const auto right = std::to_string(right_value);
	std::vector<unsigned> digits(left.size() + right.size(), 0);
	for (std::size_t left_index = left.size(); left_index-- > 0;) {
		for (std::size_t right_index = right.size(); right_index-- > 0;) {
			digits[left_index + right_index + 1] += static_cast<unsigned>(
				(left[left_index] - '0') * (right[right_index] - '0')
			);
		}
	}
	for (std::size_t index = digits.size(); index-- > 1;) {
		digits[index - 1] += digits[index] / 10;
		digits[index] %= 10;
	}
	std::string result;
	bool started = false;
	for (const auto digit : digits) {
		if (digit != 0 || started) { result += static_cast<char>('0' + digit); started = true; }
	}
	return started ? result : "0";
}

[[nodiscard]] std::string decimal_product(const std::initializer_list<std::uint64_t> factors) {
	std::string result{"1"};
	for (const auto factor : factors) result = multiply_decimal(std::move(result), factor);
	return result;
}

[[nodiscard]] int compare_decimal(const std::string& left, const std::string& right) {
	if (left.size() != right.size()) return left.size() < right.size() ? -1 : 1;
	if (left == right) return 0;
	return left < right ? -1 : 1;
}

void exact(const json::value& value, const std::initializer_list<std::string_view> keys) {
	json::require_exact_keys(value, std::vector<std::string_view>{keys});
}

[[nodiscard]] std::int64_t bounded_integer(
	const json::value& value,
	const std::string_view label,
	const bool positive = false
) {
	const auto result = json::integer(value, label);
	if (result < (positive ? 1 : 0) || result > maximum_safe_integer) {
		throw json::parse_error(std::string{label} + " is outside its safe integer domain.");
	}
	return result;
}

[[nodiscard]] std::string bounded_string(const json::value& value, const std::string_view label) {
	const auto text = json::string(value, label);
	if (text.empty() || text.size() > 4'096 || text.find('\0') != std::string_view::npos) {
		throw json::parse_error(std::string{label} + " is not a bounded nonempty string.");
	}
	return std::string{text};
}

[[nodiscard]] std::pair<std::int64_t, std::int64_t> rational(
	const json::value& value,
	const std::string_view label
) {
	exact(value, {"num", "den"});
	const auto num = bounded_integer(json::member(value, "num"), label, true);
	const auto den = bounded_integer(json::member(value, "den"), label, true);
	auto left = num;
	auto right = den;
	while (right != 0) { const auto remainder = left % right; left = right; right = remainder; }
	if (left != 1) throw json::parse_error(std::string{label} + " must be reduced.");
	return {num, den};
}

void validate_unified_header(const json::value& root, admitted_media_plan& result) {
	exact(root, {"version", "strategy", "project", "format", "codecs", "timebase", "output", "tracks", "sources", "nodes"});
	result.strategy = bounded_string(json::member(root, "strategy"), "plan strategy");
	if (result.strategy != "framescaper-unified-exact-v1") throw json::parse_error("The unified strategy is unsupported.");
	const auto& project = json::member(root, "project");
	exact(project, {"id", "revision"});
	static_cast<void>(bounded_string(json::member(project, "id"), "project id"));
	static_cast<void>(bounded_integer(json::member(project, "revision"), "project revision"));
	const auto& format = json::member(root, "format");
	exact(format, {"container", "extension", "mimeType"});
	const auto container = bounded_string(json::member(format, "container"), "container");
	if (container != "mp4" && container != "webm") throw json::parse_error("The plan container is unsupported.");
	result.container = container;
	if (bounded_string(json::member(format, "extension"), "extension") != container
		|| bounded_string(json::member(format, "mimeType"), "MIME type") != "video/" + container) {
		throw json::parse_error("The plan format metadata is not canonical.");
	}
	const auto& codecs = json::member(root, "codecs");
	exact(codecs, {"video", "videoEncoder", "audio", "audioEncoder", "pixelFormat"});
	result.video_codec = bounded_string(json::member(codecs, "video"), "video codec");
	result.video_encoder = bounded_string(json::member(codecs, "videoEncoder"), "video encoder");
	const auto& audio = json::member(codecs, "audio");
	const auto& audio_encoder = json::member(codecs, "audioEncoder");
	if ((audio.kind == json::type::null_value) != (audio_encoder.kind == json::type::null_value)) {
		throw json::parse_error("Audio codec and encoder must both be null or strings.");
	}
	if (audio.kind != json::type::null_value) {
		static_cast<void>(bounded_string(audio, "audio codec"));
		static_cast<void>(bounded_string(audio_encoder, "audio encoder"));
	}
	const auto pixel_format = bounded_string(json::member(codecs, "pixelFormat"), "pixel format");
	result.pixel_format = pixel_format;
	const auto canonical_codec_tuple = pixel_format == "yuv420p" && (
		(container == "mp4" && result.video_codec == "h264" && result.video_encoder == "libx264")
		|| (container == "webm" && result.video_codec == "vp9" && result.video_encoder == "libvpx-vp9")
	);
	if (!canonical_codec_tuple) throw json::parse_error("The unified format/codec tuple is not canonical.");
	const auto& timebase = json::member(root, "timebase");
	exact(timebase, {"sampleStart", "sampleDuration", "sampleRate", "sequenceId", "sequenceRate"});
	const auto sample_start = bounded_integer(json::member(timebase, "sampleStart"), "sample start");
	const auto sample_duration = bounded_integer(json::member(timebase, "sampleDuration"), "sample duration", true);
	const auto sample_rate = bounded_integer(json::member(timebase, "sampleRate"), "sample rate", true);
	if (sample_start > maximum_safe_integer - sample_duration) throw json::parse_error("The sample range overflows.");
	static_cast<void>(bounded_string(json::member(timebase, "sequenceId"), "sequence ID"));
	static_cast<void>(rational(json::member(timebase, "sequenceRate"), "sequence rate"));
	const auto& output = json::member(root, "output");
	exact(output, {"frameRate", "frameCount", "quality", "canvas", "includeAudio", "audioLayout"});
	const auto quality = bounded_string(json::member(output, "quality"), "output quality");
	if (quality != "draft" && quality != "balanced" && quality != "high") {
		throw json::parse_error("The unified output quality is unsupported.");
	}
	const auto [rate_num, rate_den] = rational(json::member(output, "frameRate"), "output frame rate");
	if (rate_num < rate_den || rate_num / rate_den > 30
		|| (rate_num / rate_den == 30 && rate_num % rate_den != 0)) {
		throw json::parse_error("The unified output rate exceeds the closed encoder domain of 1 through 30 fps.");
	}
	if (rate_num <= std::numeric_limits<std::uint32_t>::max()
		&& rate_den <= std::numeric_limits<std::uint32_t>::max()) {
		result.frame_rate_num = static_cast<std::uint32_t>(rate_num);
		result.frame_rate_den = static_cast<std::uint32_t>(rate_den);
	}
	const auto frame_count = bounded_integer(json::member(output, "frameCount"), "output frame count", true);
	if (frame_count > 2'000'000) throw json::parse_error("The unified output frame count exceeds the encoder ceiling.");
	const auto numerator = decimal_product({
		static_cast<std::uint64_t>(sample_duration), static_cast<std::uint64_t>(rate_num),
	});
	const auto lower = decimal_product({
		static_cast<std::uint64_t>(frame_count - 1), static_cast<std::uint64_t>(sample_rate),
		static_cast<std::uint64_t>(rate_den),
	});
	const auto upper = decimal_product({
		static_cast<std::uint64_t>(frame_count), static_cast<std::uint64_t>(sample_rate),
		static_cast<std::uint64_t>(rate_den),
	});
	if (compare_decimal(lower, numerator) >= 0 || compare_decimal(numerator, upper) > 0) {
		throw json::parse_error("The plan output frame count is not exact.");
	}
	result.output_frame_count = static_cast<std::uint64_t>(frame_count);
	const auto& canvas = json::member(output, "canvas");
	exact(canvas, {"width", "height", "fit", "pixelFormat", "backgroundColor"});
	const auto width = bounded_integer(json::member(canvas, "width"), "canvas width", true);
	const auto height = bounded_integer(json::member(canvas, "height"), "canvas height", true);
	if (width > 16'384 || height > 16'384 || width % 2 != 0 || height % 2 != 0
		|| static_cast<std::uint64_t>(width) * static_cast<std::uint64_t>(height) * 4 > 8U * 1024U * 1024U) {
		throw json::parse_error("The unified canvas exceeds its even, extent, or RGBA frame work bound.");
	}
	const auto total_rgba_bytes = static_cast<std::uint64_t>(width)
		* static_cast<std::uint64_t>(height) * 4U * static_cast<std::uint64_t>(frame_count);
	if (total_rgba_bytes > 1024ULL * 1024ULL * 1024ULL * 1024ULL) {
		throw json::parse_error("The unified logical RGBA work exceeds the encoder ceiling.");
	}
	result.width = static_cast<std::uint32_t>(width);
	result.height = static_cast<std::uint32_t>(height);
	if (bounded_string(json::member(canvas, "pixelFormat"), "canvas pixel format") != pixel_format) {
		throw json::parse_error("Canvas and codec pixel formats disagree.");
	}
	const auto fit = bounded_string(json::member(canvas, "fit"), "canvas fit");
	if (fit != "contain" && fit != "cover" && fit != "stretch") {
		throw json::parse_error("The unified canvas fit is unsupported.");
	}
	const auto color = bounded_string(json::member(canvas, "backgroundColor"), "background color");
	if ((color.size() != 7 && color.size() != 9) || color.front() != '#'
		|| !std::all_of(color.begin() + 1, color.end(), [](const unsigned char byte) {
			return std::isxdigit(byte) != 0;
		})) throw json::parse_error("The unified background color is not hexadecimal RGB/RGBA.");
	const auto include_audio = json::boolean(json::member(output, "includeAudio"), "include audio");
	result.includes_audio = include_audio;
	const auto& audio_layout = json::member(output, "audioLayout");
	if (!include_audio && (audio_layout.kind != json::type::null_value || audio.kind != json::type::null_value)) {
		throw json::parse_error("A silent render cannot state audio metadata.");
	}
	if (include_audio && (audio_layout.kind != json::type::string || audio.kind == json::type::null_value)) {
		throw json::parse_error("An audio render requires canonical audio metadata.");
	}
	if (include_audio) {
		throw json::parse_error("Unified plans V9-V12 cannot include audio without an exact audio graph.");
	}
}

} // namespace

admitted_media_plan authenticate_media_plan(
	const std::filesystem::path& path,
	const std::string& expected_sha256
) {
	return authenticate_media_plan(path, expected_sha256, {});
}

admitted_media_plan authenticate_media_plan(
	const std::filesystem::path& path,
	const std::string& expected_sha256,
	const std::vector<video_timing_asset_grant>& timing_grants
) {
	video_timing_asset_registry timing_assets(timing_grants);
	const auto canonical = authenticate_regular_file(path, expected_sha256, "plan", maximum_plan_bytes);
	std::ifstream input(canonical, std::ios::binary);
	std::ostringstream bytes;
	bytes << input.rdbuf();
	if (!input.eof() && input.fail()) throw authentication_error("The authenticated plan could not be read.");
	try {
		const auto authenticated_plan_json = bytes.str();
		const auto root = json::parse(authenticated_plan_json);
		const auto version_value = json::integer(json::member(root, "version"), "plan version");
		if (version_value < 7 || version_value > 12) {
			throw authentication_error("unsupported-plan-version: the native host admits only V7 through V12.");
		}
		admitted_media_plan result;
		result.version = static_cast<int>(version_value);
		if (result.version >= 9) {
			validate_unified_header(root, result);
			unified::validate_unified_semantics(root, result, timing_assets);
			result.requires_evaluated_rgba_carrier = false;
			result.simple_full_frame_clip = false;
			result.unsupported_render_family = "unified-exact-v"
				+ std::to_string(result.version) + "-graph";
		} else {
			legacy::validate_legacy_plan(root, result);
			result.requires_evaluated_rgba_carrier = result.version == 7;
		}
		timing_assets.require_all_used();
		result.authenticated_plan_json = authenticated_plan_json;
		return result;
	} catch (const authentication_error&) {
		throw;
	} catch (const std::exception& error) {
		throw authentication_error(std::string{"The authenticated plan is malformed: "} + error.what());
	}
}

} // namespace framescaper::media
