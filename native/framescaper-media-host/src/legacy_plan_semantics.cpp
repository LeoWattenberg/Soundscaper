/* SPDX-License-Identifier: AGPL-3.0-only */

#include "legacy_plan_semantics.hpp"
#include "legacy_plan_v8_filter_semantics.hpp"
#include "legacy_plan_values.hpp"

#include <algorithm>
#include <cstdint>
#include <limits>
#include <numeric>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace framescaper::media::legacy {
namespace {

constexpr std::size_t maximum_sources = 4'096;
constexpr std::size_t maximum_clips = 100'000;
constexpr std::size_t maximum_intervals = 100'000;
constexpr std::size_t maximum_layers = 4'096;
constexpr std::int64_t maximum_frame_count = 2'000'000;
constexpr std::int64_t maximum_canvas_extent = 16'384;
constexpr std::int64_t maximum_caption_cues = 100'000;

struct format_descriptor final {
	std::string id;
	std::string mime;
	std::string video;
	std::string video_encoder;
	std::string audio;
	std::string audio_encoder;
	std::string subtitle;
};

[[nodiscard]] format_descriptor format(const json::value& value, const std::string_view label) {
	const auto id_value = text(value, label, 16);
	if (id_value == "mp4") return {"mp4", "video/mp4", "h264", "libx264", "aac", "aac", "mov_text"};
	if (id_value == "webm") return {"webm", "video/webm", "vp9", "libvpx-vp9", "opus", "libopus", "webvtt"};
	throw json::parse_error(std::string{label} + " is unsupported.");
}

void validate_format_metadata(const json::value& root, const format_descriptor& descriptor) {
	literal(json::member(root, "container"), descriptor.id, "container");
	literal(json::member(root, "extension"), descriptor.id, "extension");
	literal(json::member(root, "mimeType"), descriptor.mime, "MIME type");
}

[[nodiscard]] std::pair<std::int64_t, std::int64_t> rational(
	const json::value& value,
	const std::string_view label
) {
	exact(value, {"num", "den"});
	const auto numerator = safe_integer(json::member(value, "num"), label, 1);
	const auto denominator = safe_integer(json::member(value, "den"), label, 1);
	if (std::gcd(numerator, denominator) != 1) {
		throw json::parse_error(std::string{label} + " is not reduced.");
	}
	return {numerator, denominator};
}

[[nodiscard]] std::vector<std::string> id_array(
	const json::value& value,
	const std::string_view label,
	const std::size_t maximum
) {
	const auto& values = json::array(value, label);
	if (values.empty() || values.size() > maximum) {
		throw json::parse_error(std::string{label} + " exceeds its nonempty ceiling.");
	}
	std::set<std::string> seen;
	std::vector<std::string> result;
	result.reserve(values.size());
	for (const auto& entry : values) {
		auto captured = id(entry, label);
		unique(seen, captured, label);
		result.push_back(std::move(captured));
	}
	return result;
}

[[nodiscard]] bool contains(const std::vector<std::string>& values, const std::string& wanted) {
	return std::find(values.begin(), values.end(), wanted) != values.end();
}

void validate_v7_codecs(
	const json::value& value,
	const format_descriptor& descriptor,
	const bool includes_audio
) {
	exact(value, {"video", "videoEncoder", "audio", "audioEncoder", "pixelFormat"});
	literal(json::member(value, "video"), descriptor.video, "V7 video codec");
	literal(json::member(value, "videoEncoder"), descriptor.video_encoder, "V7 video encoder");
	literal(json::member(value, "pixelFormat"), "yuv420p", "V7 codec pixel format");
	const auto& audio = json::member(value, "audio");
	const auto& encoder = json::member(value, "audioEncoder");
	if (includes_audio) {
		literal(audio, descriptor.audio, "V7 audio codec");
		literal(encoder, descriptor.audio_encoder, "V7 audio encoder");
	} else if (!is_null(audio) || !is_null(encoder)) {
		throw json::parse_error("A silent V7 plan cannot carry audio codec metadata.");
	}
}

void validate_v7(const json::value& root, admitted_media_plan& result) {
	exact(root, {"version", "strategy", "format", "container", "extension", "mimeType", "sampleRate", "duration", "range", "outputFrameCount", "canvas", "codecs", "quality", "activeClipIds", "activeSourceIds", "inputs"});
	literal(json::member(root, "strategy"), "framescaper-keyframed-rgba-v1", "V7 strategy");
	const auto descriptor = format(json::member(root, "format"), "V7 format");
	validate_format_metadata(root, descriptor);
	const auto sample_rate = safe_integer(json::member(root, "sampleRate"), "V7 sample rate", 8'000);
	if (sample_rate > 768'000) throw json::parse_error("V7 sample rate exceeds its ceiling.");
	const auto& range = json::member(root, "range");
	exact(range, {"startFrame", "endFrame", "durationFrames"});
	const auto range_start = safe_integer(json::member(range, "startFrame"), "V7 range start");
	const auto range_end = safe_integer(json::member(range, "endFrame"), "V7 range end", 1);
	const auto range_duration = safe_integer(json::member(range, "durationFrames"), "V7 range duration", 1);
	if (range_end - range_start != range_duration) throw json::parse_error("The V7 range is inconsistent.");
	const auto [duration_num, duration_den] = rational(json::member(root, "duration"), "V7 duration");
	const auto duration_factor = std::gcd(range_duration, sample_rate);
	if (duration_num != range_duration / duration_factor || duration_den != sample_rate / duration_factor) {
		throw json::parse_error("The V7 duration is not its exact sample fraction.");
	}
	const auto active_clips = id_array(json::member(root, "activeClipIds"), "V7 active clip IDs", maximum_clips);
	const auto active_sources = id_array(json::member(root, "activeSourceIds"), "V7 active source IDs", maximum_sources);
	const auto& canvas = json::member(root, "canvas");
	exact(canvas, {"width", "height", "frameRate", "fit", "pixelFormat", "backgroundColor", "referenceClipId", "referenceSourceId"});
	const auto width = safe_integer(json::member(canvas, "width"), "V7 canvas width", 1);
	const auto height = safe_integer(json::member(canvas, "height"), "V7 canvas height", 1);
	if (width > maximum_canvas_extent || height > maximum_canvas_extent || width % 2 != 0 || height % 2 != 0
		|| compare_decimal(decimal_product({
			static_cast<std::uint64_t>(width), static_cast<std::uint64_t>(height), 4,
		}), std::to_string(8 * 1024 * 1024)) > 0) {
		throw json::parse_error("The V7 canvas exceeds its even 8 MiB RGBA geometry domain.");
	}
	const auto [rate_num, rate_den] = rational(json::member(canvas, "frameRate"), "V7 frame rate");
	if (rate_num < rate_den || compare_decimal(
		std::to_string(rate_num), decimal_product({static_cast<std::uint64_t>(rate_den), 30})
	) > 0) {
		throw json::parse_error("The V7 frame rate must be from 1 through 30.");
	}
	if (!one_of(json::member(canvas, "fit"), {"contain", "cover", "stretch"}, "V7 canvas fit")) {
		throw json::parse_error("The V7 canvas fit is unsupported.");
	}
	literal(json::member(canvas, "pixelFormat"), "yuv420p", "V7 canvas pixel format");
	if (!hex_color(text(json::member(canvas, "backgroundColor"), "V7 background color", 10))) {
		throw json::parse_error("The V7 background is not a canonical hexadecimal color.");
	}
	const auto reference_clip = nullable_id(json::member(canvas, "referenceClipId"), "V7 reference clip ID");
	const auto reference_source = nullable_id(json::member(canvas, "referenceSourceId"), "V7 reference source ID");
	if (reference_clip.empty() != reference_source.empty()
		|| (!reference_clip.empty() && !contains(active_clips, reference_clip))
		|| (!reference_source.empty() && !contains(active_sources, reference_source))) {
		throw json::parse_error("The V7 canvas reference is outside its active identities.");
	}
	const auto output_count = safe_integer(json::member(root, "outputFrameCount"), "V7 output frame count", 1);
	const auto numerator = decimal_product({
		static_cast<std::uint64_t>(range_duration), static_cast<std::uint64_t>(rate_num),
	});
	const auto lower = decimal_product({
		static_cast<std::uint64_t>(output_count - 1), static_cast<std::uint64_t>(sample_rate),
		static_cast<std::uint64_t>(rate_den),
	});
	const auto upper = decimal_product({
		static_cast<std::uint64_t>(output_count), static_cast<std::uint64_t>(sample_rate),
		static_cast<std::uint64_t>(rate_den),
	});
	if (output_count > maximum_frame_count || compare_decimal(lower, numerator) >= 0
		|| compare_decimal(numerator, upper) > 0 || compare_decimal(decimal_product({
			static_cast<std::uint64_t>(width), static_cast<std::uint64_t>(height), 4,
			static_cast<std::uint64_t>(output_count),
		}), decimal_product({1024, 1024, 1024, 1024})) > 0) {
		throw json::parse_error("The V7 output frame count exceeds or disagrees with its exact workload.");
	}
	if (!one_of(json::member(root, "quality"), {"draft", "balanced", "high"}, "V7 quality")) {
		throw json::parse_error("The V7 quality tier is unsupported.");
	}
	const auto& inputs = json::array(json::member(root, "inputs"), "V7 inputs");
	if (inputs.size() != active_sources.size() && inputs.size() != active_sources.size() + 1) {
		throw json::parse_error("V7 inputs do not exactly match active sources and optional audio.");
	}
	result.source_sha256.clear();
	for (std::size_t index = 0; index < active_sources.size(); ++index) {
		const auto& input = inputs[index];
		exact(input, {"kind", "inputIndex", "sourceId", "storageKey", "mimeType", "contentSha256"});
		literal(json::member(input, "kind"), "video-source", "V7 input kind");
		if (safe_integer(json::member(input, "inputIndex"), "V7 input index") != static_cast<std::int64_t>(index)
			|| id(json::member(input, "sourceId"), "V7 input source ID") != active_sources[index]) {
			throw json::parse_error("V7 source input order or identity is not canonical.");
		}
		static_cast<void>(text(json::member(input, "storageKey"), "V7 source storage key", 1'024));
		if (!video_mime(text(json::member(input, "mimeType"), "V7 source MIME", 128))) {
			throw json::parse_error("A V7 source MIME type is not canonical.");
		}
		result.source_sha256.push_back(digest(json::member(input, "contentSha256"), "V7 source digest"));
	}
	const bool includes_audio = inputs.size() == active_sources.size() + 1;
	if (includes_audio) {
		const auto& audio = inputs.back();
		exact(audio, {"kind", "inputIndex", "fileName", "sampleRate", "startFrame", "durationFrames", "channelLayout"});
		literal(json::member(audio, "kind"), "staged-audio-mix", "V7 audio input kind");
		local_file_name(json::member(audio, "fileName"), ".wav", "V7 audio file name");
		if (safe_integer(json::member(audio, "inputIndex"), "V7 audio input index") != static_cast<std::int64_t>(active_sources.size())
			|| safe_integer(json::member(audio, "sampleRate"), "V7 audio sample rate", 1) != sample_rate
			|| safe_integer(json::member(audio, "startFrame"), "V7 audio start") != range_start
			|| safe_integer(json::member(audio, "durationFrames"), "V7 audio duration", 1) != range_duration
			|| !one_of(json::member(audio, "channelLayout"), {"preserve", "mono", "stereo"}, "V7 audio layout")) {
			throw json::parse_error("The V7 staged audio input is not range-exact and canonical.");
		}
	}
	validate_v7_codecs(json::member(root, "codecs"), descriptor, includes_audio);
	result.strategy = "framescaper-keyframed-rgba-v1";
	result.container = descriptor.id;
	result.video_codec = descriptor.video;
	result.video_encoder = descriptor.video_encoder;
	result.pixel_format = "yuv420p";
	result.width = static_cast<std::uint32_t>(width);
	result.height = static_cast<std::uint32_t>(height);
	result.output_frame_count = static_cast<std::uint64_t>(output_count);
	if (rate_num <= std::numeric_limits<std::uint32_t>::max() && rate_den <= std::numeric_limits<std::uint32_t>::max()) {
		result.frame_rate_num = static_cast<std::uint32_t>(rate_num);
		result.frame_rate_den = static_cast<std::uint32_t>(rate_den);
	}
	result.includes_audio = includes_audio;
	result.unsupported_render_family = "keyed-rgba-data-plane";
}

struct v8_input_state final {
	std::vector<std::string> video_source_by_index;
	std::optional<std::size_t> audio_index;
	std::optional<std::size_t> caption_index;
	std::int64_t audio_sample_rate{};
};

struct v8_caption_state final {
	bool present{};
	bool mux{};
	bool burn_in{};
	std::int64_t cue_count{};
};

[[nodiscard]] v8_caption_state validate_v8_captions(
	const json::value& value,
	const format_descriptor& descriptor
) {
	if (is_null(value)) return {};
	exact(value, {"trackId", "cueCount", "mux", "burnIn", "subtitleCodec", "sidecarFormat"});
	static_cast<void>(id(json::member(value, "trackId"), "V8 caption track ID"));
	const auto cue_count = safe_integer(json::member(value, "cueCount"), "V8 caption cue count", 1);
	if (cue_count > maximum_caption_cues) throw json::parse_error("The V8 caption count exceeds its ceiling.");
	const auto mux = json::boolean(json::member(value, "mux"), "V8 caption mux flag");
	const auto burn_in = json::boolean(json::member(value, "burnIn"), "V8 caption burn-in flag");
	const auto& subtitle = json::member(value, "subtitleCodec");
	if (mux) literal(subtitle, descriptor.subtitle, "V8 subtitle codec");
	else if (!is_null(subtitle)) throw json::parse_error("V8 captions state an unused subtitle codec.");
	const auto& sidecar = json::member(value, "sidecarFormat");
	const auto has_sidecar = !is_null(sidecar);
	if (has_sidecar && !one_of(sidecar, {"srt", "vtt"}, "V8 caption sidecar")) {
		throw json::parse_error("The V8 caption sidecar format is unsupported.");
	}
	if (!mux && !burn_in && !has_sidecar) throw json::parse_error("The V8 caption decision delivers nowhere.");
	return {true, mux, burn_in, cue_count};
}

[[nodiscard]] v8_input_state validate_v8_inputs(
	const json::value& value,
	const std::int64_t range_start,
	const std::int64_t range_duration,
	const v8_caption_state captions,
	admitted_media_plan& result
) {
	const auto& inputs = json::array(value, "V8 inputs");
	if (inputs.empty() || inputs.size() > maximum_sources) throw json::parse_error("V8 inputs exceed their nonempty ceiling.");
	v8_input_state state;
	state.video_source_by_index.resize(inputs.size());
	std::set<std::string> source_ids;
	for (std::size_t index = 0; index < inputs.size(); ++index) {
		const auto& input = inputs[index];
		const auto kind = text(json::member(input, "kind"), "V8 input kind", 32);
		if (kind == "video-source") {
			exact(input, {"kind", "inputIndex", "sourceId", "storageKey", "mimeType", "presentation"});
			auto source_id = id(json::member(input, "sourceId"), "V8 source ID");
			unique(source_ids, source_id, "V8 source ID");
			state.video_source_by_index[index] = source_id;
			static_cast<void>(text(json::member(input, "storageKey"), "V8 source storage key", 1'024));
			if (!video_mime(text(json::member(input, "mimeType"), "V8 source MIME", 128))) {
				throw json::parse_error("A V8 source MIME type is not canonical.");
			}
			if (!is_null(json::member(input, "presentation"))) {
				throw json::parse_error("unsupported-v8-source-presentation: this native host cannot interpret it.");
			}
			result.source_sha256.emplace_back();
		} else if (kind == "staged-audio-mix") {
			exact(input, {"kind", "inputIndex", "fileName", "sampleRate", "startFrame", "durationFrames", "channelLayout"});
			if (state.audio_index) throw json::parse_error("V8 carries more than one staged audio mix.");
			state.audio_index = index;
			local_file_name(json::member(input, "fileName"), ".wav", "V8 audio file name");
			state.audio_sample_rate = safe_integer(json::member(input, "sampleRate"), "V8 audio sample rate", 8'000);
			if (state.audio_sample_rate > 768'000
				|| safe_integer(json::member(input, "startFrame"), "V8 audio start") != range_start
				|| safe_integer(json::member(input, "durationFrames"), "V8 audio duration", 1) != range_duration
				|| !one_of(json::member(input, "channelLayout"), {"preserve", "mono", "stereo"}, "V8 audio layout")) {
				throw json::parse_error("The V8 staged audio input is not range-exact and canonical.");
			}
		} else if (kind == "staged-captions") {
			exact(input, {"kind", "inputIndex", "fileName", "format"});
			if (state.caption_index) throw json::parse_error("V8 carries more than one staged caption document.");
			state.caption_index = index;
			local_file_name(json::member(input, "fileName"), ".srt", "V8 caption file name");
			literal(json::member(input, "format"), "srt", "V8 caption input format");
		} else throw json::parse_error("The V8 input kind is unsupported.");
		if (safe_integer(json::member(input, "inputIndex"), "V8 input index") != static_cast<std::int64_t>(index)) {
			throw json::parse_error("V8 input indices must equal their positions.");
		}
	}
	if (captions.mux != state.caption_index.has_value()) {
		throw json::parse_error("The V8 muxed-caption decision and staged input disagree.");
	}
	return state;
}

void validate_render_description(const json::value& value, const json::value& clip) {
	exact(value, {"crop", "sourceDisplayToCanvas", "opacityStart", "opacityEnd", "blendMode", "compositingOrder"});
	const auto& crop = json::member(value, "crop");
	exact(crop, {"normalized", "sourcePixels"});
	const auto& normalized = json::member(crop, "normalized");
	exact(normalized, {"left", "top", "right", "bottom"});
	const auto left = bounded_number(json::member(normalized, "left"), "V8 crop left", 0, 1);
	const auto top = bounded_number(json::member(normalized, "top"), "V8 crop top", 0, 1);
	const auto right = bounded_number(json::member(normalized, "right"), "V8 crop right", 0, 1);
	const auto bottom = bounded_number(json::member(normalized, "bottom"), "V8 crop bottom", 0, 1);
	if (left + right >= 1 || top + bottom >= 1) throw json::parse_error("The V8 normalized crop is empty.");
	const auto& pixels = json::member(crop, "sourcePixels");
	exact(pixels, {"x", "y", "width", "height"});
	static_cast<void>(bounded_number(json::member(pixels, "x"), "V8 crop x", 0, 1e9));
	static_cast<void>(bounded_number(json::member(pixels, "y"), "V8 crop y", 0, 1e9));
	static_cast<void>(bounded_number(json::member(pixels, "width"), "V8 crop width", std::numeric_limits<double>::min(), 1e9));
	static_cast<void>(bounded_number(json::member(pixels, "height"), "V8 crop height", std::numeric_limits<double>::min(), 1e9));
	const auto& matrix = json::array(json::member(value, "sourceDisplayToCanvas"), "V8 display matrix");
	if (matrix.size() != 6) throw json::parse_error("The V8 display matrix must have six coefficients.");
	for (const auto& coefficient : matrix) static_cast<void>(bounded_number(coefficient, "V8 display matrix coefficient", -1e9, 1e9));
	require_same(json::member(value, "opacityStart"), json::member(clip, "opacityStart"), "V8 render opacity start");
	require_same(json::member(value, "opacityEnd"), json::member(clip, "opacityEnd"), "V8 render opacity end");
	if (!one_of(json::member(value, "blendMode"), {"normal", "multiply", "screen", "overlay", "darken", "lighten", "difference", "exclusion"}, "V8 blend mode")) {
		throw json::parse_error("The V8 blend mode is unsupported.");
	}
	const auto order = json::integer(json::member(value, "compositingOrder"), "V8 compositing order");
	if (order < -32'768 || order > 32'767) throw json::parse_error("The V8 compositing order exceeds its bounds.");
}

void validate_v8_intervals(
	const json::value& value,
	const std::int64_t range_start,
	const std::int64_t range_end,
	const double duration_seconds,
	const v8_input_state& inputs,
	std::set<std::string>& clip_ids
) {
	const auto& intervals = json::array(value, "V8 intervals");
	if (intervals.empty() || intervals.size() > maximum_intervals) throw json::parse_error("V8 intervals exceed their nonempty ceiling.");
	auto covered = range_start;
	std::size_t clip_count = 0;
	for (std::size_t interval_index = 0; interval_index < intervals.size(); ++interval_index) {
		const auto& interval = intervals[interval_index];
		exact_optional(interval, {"index", "kind", "timelineStartFrame", "timelineEndFrame", "outputStartFrame", "durationFrames", "durationSeconds", "color", "layers"}, "color");
		if (safe_integer(json::member(interval, "index"), "V8 interval index") != static_cast<std::int64_t>(interval_index)) {
			throw json::parse_error("V8 interval indices must equal their positions.");
		}
		const auto kind = text(json::member(interval, "kind"), "V8 interval kind", 32);
		if (kind != "black" && kind != "composition") throw json::parse_error("The V8 interval kind is unsupported.");
		const auto start = safe_integer(json::member(interval, "timelineStartFrame"), "V8 interval start");
		const auto end = safe_integer(json::member(interval, "timelineEndFrame"), "V8 interval end", 1);
		const auto frames = safe_integer(json::member(interval, "durationFrames"), "V8 interval duration", 1);
		if (start != covered || end - start != frames || start < range_start || end > range_end
			|| safe_integer(json::member(interval, "outputStartFrame"), "V8 interval output start") != start - range_start) {
			throw json::parse_error("V8 intervals do not exactly tile their export range.");
		}
		const auto seconds = finite_number(json::member(interval, "durationSeconds"), "V8 interval duration seconds");
		const auto expected_seconds = duration_seconds * static_cast<double>(frames)
			/ static_cast<double>(range_end - range_start);
		if (seconds <= 0 || !approximately_equal(seconds, expected_seconds)) {
			throw json::parse_error("A V8 interval duration disagrees with the export timebase.");
		}
		const auto& color = json::optional_member(interval, "color");
		const auto& layers = json::array(json::member(interval, "layers"), "V8 interval layers");
		if (kind == "black") {
			if (!color || !delivery_color(text(*color, "V8 black color", 128)) || !layers.empty()) {
				throw json::parse_error("A V8 black interval has non-canonical color or layers.");
			}
		} else if (color || layers.empty() || layers.size() > maximum_layers) {
			throw json::parse_error("A V8 composition interval has non-canonical color or layers.");
		}
		std::set<std::string> tracks;
		std::set<std::int64_t> track_indices;
		std::set<std::string> interval_clip_ids;
		for (const auto& layer : layers) {
			exact(layer, {"trackId", "trackIndex", "clips"});
			unique(tracks, id(json::member(layer, "trackId"), "V8 layer track ID"), "V8 layer track ID");
			const auto track_index = safe_integer(json::member(layer, "trackIndex"), "V8 layer track index");
			if (!track_indices.insert(track_index).second) throw json::parse_error("A V8 layer track index is duplicated.");
			const auto& clips = json::array(json::member(layer, "clips"), "V8 layer clips");
			if (clips.empty() || clips.size() > 2 || clip_count + clips.size() > maximum_clips) {
				throw json::parse_error("V8 layer clips exceed the closed transition overlap domain.");
			}
			for (std::size_t clip_index = 0; clip_index < clips.size(); ++clip_index) {
				const auto& clip = clips[clip_index];
				exact(clip, {"role", "clipId", "sourceId", "inputIndex", "sourceStartFrame", "sourceEndFrame", "sourceDurationFrames", "sourceStartTimeSeconds", "sourceEndTimeSeconds", "playbackRate", "opacityStart", "opacityEnd", "renderDescription", "videoEffects"});
				const auto role = text(json::member(clip, "role"), "V8 clip role", 16);
				const auto expected_role = clips.size() == 1 ? "single" : clip_index == 0 ? "outgoing" : "incoming";
				if (role != expected_role) throw json::parse_error("The V8 clip overlap roles are not canonical.");
				const auto clip_id = id(json::member(clip, "clipId"), "V8 clip ID");
				unique(interval_clip_ids, clip_id, "V8 interval clip ID");
				clip_ids.insert(clip_id);
				const auto source_id = id(json::member(clip, "sourceId"), "V8 clip source ID");
				const auto input_index = safe_integer(json::member(clip, "inputIndex"), "V8 clip input index");
				if (input_index >= static_cast<std::int64_t>(inputs.video_source_by_index.size())
					|| inputs.video_source_by_index[static_cast<std::size_t>(input_index)] != source_id) {
					throw json::parse_error("A V8 clip does not bind its exact video input identity.");
				}
				const auto source_start = safe_integer(json::member(clip, "sourceStartFrame"), "V8 source start");
				const auto source_end = safe_integer(json::member(clip, "sourceEndFrame"), "V8 source end", 1);
				const auto source_duration = safe_integer(json::member(clip, "sourceDurationFrames"), "V8 source duration", 1);
				if (source_end - source_start != source_duration) throw json::parse_error("The V8 clip source span is inconsistent.");
				const auto source_start_seconds = finite_number(json::member(clip, "sourceStartTimeSeconds"), "V8 source start seconds");
				const auto source_end_seconds = finite_number(json::member(clip, "sourceEndTimeSeconds"), "V8 source end seconds");
				const auto playback_rate = finite_number(json::member(clip, "playbackRate"), "V8 playback rate");
				if (source_start_seconds < 0 || source_end_seconds <= source_start_seconds || playback_rate <= 0
					|| !approximately_equal((source_end_seconds - source_start_seconds) / playback_rate, seconds)) {
					throw json::parse_error("The V8 clip source-time interval is invalid.");
				}
				static_cast<void>(bounded_number(json::member(clip, "opacityStart"), "V8 opacity start", 0, 1));
				static_cast<void>(bounded_number(json::member(clip, "opacityEnd"), "V8 opacity end", 0, 1));
				validate_render_description(json::member(clip, "renderDescription"), clip);
				if (!json::array(json::member(clip, "videoEffects"), "V8 video effects").empty()) {
					throw json::parse_error("unsupported-v8-video-effects: this native host cannot interpret them.");
				}
				++clip_count;
			}
		}
		covered = end;
	}
	if (covered != range_end) throw json::parse_error("V8 intervals do not finish their export range.");
}

void validate_v8_codecs(
	const json::value& value,
	const format_descriptor& descriptor,
	const bool includes_audio
) {
	exact(value, {"video", "videoEncoder", "audio", "audioEncoder", "pixelFormat"});
	literal(json::member(value, "video"), descriptor.video, "V8 video codec");
	literal(json::member(value, "videoEncoder"), descriptor.video_encoder, "V8 video encoder");
	literal(json::member(value, "pixelFormat"), "yuv420p", "V8 codec pixel format");
	const auto& audio = json::member(value, "audio");
	const auto& encoder = json::member(value, "audioEncoder");
	if (includes_audio) {
		literal(audio, descriptor.audio, "V8 audio codec");
		literal(encoder, descriptor.audio_encoder, "V8 audio encoder");
	} else if (!is_null(audio) || !is_null(encoder)) {
		throw json::parse_error("A silent V8 plan cannot carry audio codec metadata.");
	}
}

void validate_v8(const json::value& root, admitted_media_plan& result) {
	exact(root, {"version", "format", "container", "extension", "mimeType", "codecs", "quality", "captions", "range", "durationSeconds", "outputFrameCount", "canvas", "inputs", "intervals", "filterPlan"});
	const auto descriptor = format(json::member(root, "format"), "V8 format");
	validate_format_metadata(root, descriptor);
	if (!one_of(json::member(root, "quality"), {"draft", "balanced", "high"}, "V8 quality")) {
		throw json::parse_error("The V8 quality tier is unsupported.");
	}
	const auto captions = validate_v8_captions(json::member(root, "captions"), descriptor);
	const auto& range = json::member(root, "range");
	exact(range, {"startFrame", "endFrame", "durationFrames"});
	const auto range_start = safe_integer(json::member(range, "startFrame"), "V8 range start");
	const auto range_end = safe_integer(json::member(range, "endFrame"), "V8 range end", 1);
	const auto range_duration = safe_integer(json::member(range, "durationFrames"), "V8 range duration", 1);
	if (range_end - range_start != range_duration) throw json::parse_error("The V8 range is inconsistent.");
	const auto duration_seconds = finite_number(json::member(root, "durationSeconds"), "V8 duration seconds");
	if (duration_seconds <= 0) throw json::parse_error("The V8 duration must be positive.");
	const auto& canvas = json::member(root, "canvas");
	exact(canvas, {"width", "height", "frameRate", "fit", "pixelFormat", "backgroundColor", "maximumWidth", "maximumHeight", "maximumFrameRate", "referenceClipId", "referenceSourceId"});
	const auto width = safe_integer(json::member(canvas, "width"), "V8 canvas width", 1);
	const auto height = safe_integer(json::member(canvas, "height"), "V8 canvas height", 1);
	const auto maximum_width = safe_integer(json::member(canvas, "maximumWidth"), "V8 maximum width", 1);
	const auto maximum_height = safe_integer(json::member(canvas, "maximumHeight"), "V8 maximum height", 1);
	if (width % 2 != 0 || height % 2 != 0 || maximum_width % 2 != 0 || maximum_height % 2 != 0
		|| width > maximum_width || height > maximum_height
		|| maximum_width > maximum_canvas_extent || maximum_height > maximum_canvas_extent) {
		throw json::parse_error("The V8 canvas exceeds its exact even geometry bounds.");
	}
	const auto frame_rate = bounded_number(json::member(canvas, "frameRate"), "V8 frame rate", std::numeric_limits<double>::min(), 1'000);
	const auto maximum_frame_rate = bounded_number(json::member(canvas, "maximumFrameRate"), "V8 maximum frame rate", std::numeric_limits<double>::min(), 1'000);
	if (frame_rate > maximum_frame_rate) throw json::parse_error("The V8 frame rate exceeds its declared maximum.");
	if (!one_of(json::member(canvas, "fit"), {"contain", "cover", "stretch"}, "V8 canvas fit")) {
		throw json::parse_error("The V8 canvas fit is unsupported.");
	}
	literal(json::member(canvas, "pixelFormat"), "yuv420p", "V8 canvas pixel format");
	if (!delivery_color(text(json::member(canvas, "backgroundColor"), "V8 background color", 128))) {
		throw json::parse_error("The V8 background color is unsupported.");
	}
	const auto reference_clip = nullable_id(json::member(canvas, "referenceClipId"), "V8 reference clip ID");
	const auto reference_source = nullable_id(json::member(canvas, "referenceSourceId"), "V8 reference source ID");
	if (reference_clip.empty() != reference_source.empty()) throw json::parse_error("The V8 canvas reference is incomplete.");
	const auto inputs = validate_v8_inputs(json::member(root, "inputs"), range_start, range_duration, captions, result);
	validate_v8_codecs(json::member(root, "codecs"), descriptor, inputs.audio_index.has_value());
	if (inputs.audio_index && !approximately_equal(
		duration_seconds, static_cast<double>(range_duration) / static_cast<double>(inputs.audio_sample_rate)
	)) throw json::parse_error("The V8 duration disagrees with staged audio's exact sample rate.");
	const auto output_count = safe_integer(json::member(root, "outputFrameCount"), "V8 output frame count", 1);
	if (output_count > maximum_frame_count
		|| static_cast<double>(output_count) != std::ceil(duration_seconds * frame_rate)) {
		throw json::parse_error("The V8 output frame count is not exact or exceeds its ceiling.");
	}
	std::set<std::string> clip_ids;
	validate_v8_intervals(json::member(root, "intervals"), range_start, range_end, duration_seconds, inputs, clip_ids);
	if (!reference_clip.empty() && !clip_ids.contains(reference_clip)) {
		throw json::parse_error("The V8 reference clip is outside the rendered intervals.");
	}
	if (!reference_source.empty() && std::find(inputs.video_source_by_index.begin(), inputs.video_source_by_index.end(), reference_source)
		== inputs.video_source_by_index.end()) throw json::parse_error("The V8 reference source is outside its exact inputs.");
	validate_v8_filter_plan(root);
	result.strategy = "layered-composition";
	result.container = descriptor.id;
	result.video_codec = descriptor.video;
	result.video_encoder = descriptor.video_encoder;
	result.pixel_format = "yuv420p";
	result.width = static_cast<std::uint32_t>(width);
	result.height = static_cast<std::uint32_t>(height);
	result.output_frame_count = static_cast<std::uint64_t>(output_count);
	result.includes_audio = inputs.audio_index.has_value();
	result.unsupported_render_family = "static-composition-graph";
}

} // namespace

void validate_legacy_plan(const json::value& root, admitted_media_plan& result) {
	if (result.version == 7) validate_v7(root, result);
	else if (result.version == 8) validate_v8(root, result);
	else throw json::parse_error("The legacy plan generation is unsupported.");
}

} // namespace framescaper::media::legacy
