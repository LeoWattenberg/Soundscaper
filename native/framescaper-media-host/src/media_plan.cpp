/* SPDX-License-Identifier: AGPL-3.0-only */

#include "media_plan.hpp"
#include "legacy_plan_semantics.hpp"
#include "media_file_grants.hpp"
#include "strict_json.hpp"
#include "unified_plan_semantics.hpp"

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <limits>
#include <numeric>
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
	exact(root, {"version", "strategy", "project", "format", "codecs", "timebase", "output", "sources", "nodes"});
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
	const auto& timebase = json::member(root, "timebase");
	exact(timebase, {"sampleStart", "sampleDuration", "sampleRate", "sequenceId", "sequenceRate"});
	const auto sample_start = bounded_integer(json::member(timebase, "sampleStart"), "sample start");
	const auto sample_duration = bounded_integer(json::member(timebase, "sampleDuration"), "sample duration", true);
	const auto sample_rate = bounded_integer(json::member(timebase, "sampleRate"), "sample rate", true);
	if (sample_start > maximum_safe_integer - sample_duration) throw json::parse_error("The sample range overflows.");
	static_cast<void>(bounded_string(json::member(timebase, "sequenceId"), "sequence ID"));
	static_cast<void>(rational(json::member(timebase, "sequenceRate"), "sequence rate"));
	const auto& output = json::member(root, "output");
	exact(output, {"frameRate", "frameCount", "canvas", "includeAudio", "audioLayout"});
	const auto [rate_num, rate_den] = rational(json::member(output, "frameRate"), "output frame rate");
	if (rate_num <= std::numeric_limits<std::uint32_t>::max()
		&& rate_den <= std::numeric_limits<std::uint32_t>::max()) {
		result.frame_rate_num = static_cast<std::uint32_t>(rate_num);
		result.frame_rate_den = static_cast<std::uint32_t>(rate_den);
	}
	const auto frame_count = bounded_integer(json::member(output, "frameCount"), "output frame count", true);
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
	result.width = static_cast<std::uint32_t>(bounded_integer(json::member(canvas, "width"), "canvas width", true));
	result.height = static_cast<std::uint32_t>(bounded_integer(json::member(canvas, "height"), "canvas height", true));
	if (bounded_string(json::member(canvas, "pixelFormat"), "canvas pixel format") != pixel_format) {
		throw json::parse_error("Canvas and codec pixel formats disagree.");
	}
	static_cast<void>(bounded_string(json::member(canvas, "fit"), "canvas fit"));
	static_cast<void>(bounded_string(json::member(canvas, "backgroundColor"), "background color"));
	const auto include_audio = json::boolean(json::member(output, "includeAudio"), "include audio");
	result.includes_audio = include_audio;
	const auto& audio_layout = json::member(output, "audioLayout");
	if (!include_audio && (audio_layout.kind != json::type::null_value || audio.kind != json::type::null_value)) {
		throw json::parse_error("A silent render cannot state audio metadata.");
	}
	if (include_audio && (audio_layout.kind != json::type::string || audio.kind == json::type::null_value)) {
		throw json::parse_error("An audio render requires canonical audio metadata.");
	}
}

[[nodiscard]] bool decimal_rational_is(
	const json::value& value,
	const std::uint64_t numerator,
	const std::uint64_t denominator
) {
	return json::string(json::member(value, "numerator"), "simple-render rational numerator")
		== std::to_string(numerator)
		&& json::string(json::member(value, "denominator"), "simple-render rational denominator")
		== std::to_string(denominator);
}

void classify_simple_full_frame_clip(const json::value& root, admitted_media_plan& result) {
	result.simple_full_frame_clip = false;
	if (result.source_sha256.size() != 1 || result.includes_audio
		|| !result.image_sequence_inventory_sha256.empty() || result.frame_rate_den != 1
		|| result.frame_rate_num == 0 || result.output_frame_count == 0) return;
	const auto& sources = json::array(json::member(root, "sources"), "simple-render sources");
	const auto& nodes = json::array(json::member(root, "nodes"), "simple-render nodes");
	if (sources.size() != 1 || nodes.size() != 1
		|| json::string(json::member(nodes.front(), "kind"), "simple-render node kind") != "clip") return;
	const auto& source_timing = json::member(sources.front(), "timing");
	if (json::string(json::member(source_timing, "kind"), "simple-render source timing") != "cfr"
		|| rational(json::member(source_timing, "rate"), "simple-render source rate")
			!= std::pair<std::int64_t, std::int64_t>{result.frame_rate_num, 1}) return;
	const auto& timebase = json::member(root, "timebase");
	if (bounded_integer(json::member(timebase, "sampleStart"), "simple-render sample start") != 0
		|| bounded_integer(json::member(timebase, "sampleRate"), "simple-render sample rate", true)
			!= result.frame_rate_num
		|| bounded_integer(json::member(timebase, "sampleDuration"), "simple-render sample duration", true)
			!= static_cast<std::int64_t>(result.output_frame_count)
		|| rational(json::member(timebase, "sequenceRate"), "simple-render sequence rate")
			!= std::pair<std::int64_t, std::int64_t>{result.frame_rate_num, 1}) return;
	const auto& node = nodes.front();
	if (bounded_integer(json::member(node, "sequenceStartFrame"), "simple-render sequence start") != 0
		|| bounded_integer(json::member(node, "sequenceFrameCount"), "simple-render sequence count", true)
			!= static_cast<std::int64_t>(result.output_frame_count)
		|| bounded_integer(json::member(node, "sourceInFrame"), "simple-render source in") != 0
		|| bounded_integer(json::member(node, "sourceFrameCount"), "simple-render source count", true)
			!= static_cast<std::int64_t>(result.output_frame_count)) return;
	const auto& mapping = json::member(node, "sourceTimeMapping");
	const auto& intent = json::member(mapping, "intent");
	const auto& rows = json::array(json::member(intent, "intersections"), "simple-render intersections");
	if (rows.size() != 1) return;
	const auto& row = rows.front();
	const auto count = result.output_frame_count;
	if (json::string(json::member(row, "mapping"), "simple-render mapping") != "uniform-wall-clock"
		|| bounded_integer(json::member(row, "startSample"), "simple-render start sample") != 0
		|| bounded_integer(json::member(row, "endSample"), "simple-render end sample", true)
			!= static_cast<std::int64_t>(count)
		|| bounded_integer(json::member(row, "startOutputFrame"), "simple-render start output") != 0
		|| bounded_integer(json::member(row, "endOutputFrame"), "simple-render end output", true)
			!= static_cast<std::int64_t>(count)
		|| bounded_integer(json::member(row, "clipStartSample"), "simple-render clip start") != 0
		|| bounded_integer(json::member(row, "clipEndSample"), "simple-render clip end", true)
			!= static_cast<std::int64_t>(count)) return;
	const auto divisor = std::gcd(count, static_cast<std::uint64_t>(result.frame_rate_num));
	const auto end_numerator = count / divisor;
	const auto end_denominator = static_cast<std::uint64_t>(result.frame_rate_num) / divisor;
	if (!decimal_rational_is(json::member(row, "sourceStartTime"), 0, 1)
		|| !decimal_rational_is(json::member(row, "clippedSourceStartTime"), 0, 1)
		|| !decimal_rational_is(json::member(row, "sourceEndTime"), end_numerator, end_denominator)
		|| !decimal_rational_is(json::member(row, "clippedSourceEndTime"), end_numerator, end_denominator)) return;
	result.source_in_frame = 0;
	result.source_frame_count = count;
	result.simple_full_frame_clip = true;
	result.unsupported_render_family.clear();
}

} // namespace

admitted_media_plan authenticate_media_plan(
	const std::filesystem::path& path,
	const std::string& expected_sha256
) {
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
			unified::validate_unified_semantics(root, result);
			classify_simple_full_frame_clip(root, result);
		} else legacy::validate_legacy_plan(root, result);
		result.authenticated_plan_json = authenticated_plan_json;
		return result;
	} catch (const authentication_error&) {
		throw;
	} catch (const std::exception& error) {
		throw authentication_error(std::string{"The authenticated plan is malformed: "} + error.what());
	}
}

} // namespace framescaper::media
