/* SPDX-License-Identifier: AGPL-3.0-only */

#include "legacy_plan_v8_filter_semantics.hpp"
#include "legacy_plan_values.hpp"

#include <algorithm>
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <string_view>

namespace framescaper::media::legacy {
namespace {

constexpr std::size_t maximum_burn_in_cues = 2'000;
constexpr std::size_t maximum_burn_in_text = 500;

void same_member(
	const json::value& left,
	const json::value& right,
	const std::string_view key,
	const std::string_view label
) { require_same(json::member(left, key), json::member(right, key), label); }

void integer_literal(const json::value& value, const std::int64_t expected, const std::string_view label) {
	if (json::integer(value, label) != expected) throw json::parse_error(std::string{label} + " is not canonical.");
}

struct utf8_measurement final { std::size_t scalars{}; std::size_t utf16_units{}; };

[[nodiscard]] std::optional<utf8_measurement> measure_utf8(const std::string_view text) {
	utf8_measurement result;
	for (std::size_t offset = 0; offset < text.size();) {
		const auto lead = static_cast<unsigned char>(text[offset]);
		const auto length = lead < 0x80 ? 1U : (lead & 0xe0U) == 0xc0U ? 2U
			: (lead & 0xf0U) == 0xe0U ? 3U : (lead & 0xf8U) == 0xf0U ? 4U : 0U;
		if (length == 0 || offset + length > text.size()) return std::nullopt;
		std::uint32_t codepoint = lead & (length == 1 ? 0x7fU : length == 2 ? 0x1fU : length == 3 ? 0x0fU : 0x07U);
		for (std::size_t index = 1; index < length; ++index) {
			const auto continuation = static_cast<unsigned char>(text[offset + index]);
			if ((continuation & 0xc0U) != 0x80U) return std::nullopt;
			codepoint = (codepoint << 6U) | (continuation & 0x3fU);
		}
		if ((length == 2 && codepoint < 0x80) || (length == 3 && codepoint < 0x800)
			|| (length == 4 && codepoint < 0x10000) || codepoint > 0x10ffff
			|| (codepoint >= 0xd800 && codepoint <= 0xdfff) || codepoint == 0) return std::nullopt;
		++result.scalars;
		result.utf16_units += codepoint > 0xffff ? 2U : 1U;
		offset += length;
	}
	return result;
}

void validate_burn_in(const json::value& root, const json::value& value) {
	const auto& captions = json::member(root, "captions");
	const bool wanted = !is_null(captions)
		&& json::boolean(json::member(captions, "burnIn"), "V8 caption burn-in flag");
	if (is_null(value)) return;
	if (!wanted) throw json::parse_error("V8 filter plan burns captions the plan did not request.");
	exact(value, {"fontSizePx", "bottomMarginPx", "boxBorderPx", "lineSpacingPx", "cues"});
	const auto font_size = safe_integer(json::member(value, "fontSizePx"), "V8 burn-in font size", 1);
	const auto margin = safe_integer(json::member(value, "bottomMarginPx"), "V8 burn-in bottom margin");
	const auto border = safe_integer(json::member(value, "boxBorderPx"), "V8 burn-in box border", 1);
	const auto spacing = safe_integer(json::member(value, "lineSpacingPx"), "V8 burn-in line spacing");
	if (font_size > 16'384 || margin > 16'384 || border > 16'384 || spacing > 16'384) {
		throw json::parse_error("V8 burn-in geometry exceeds its canvas-relative ceiling.");
	}
	const auto& cues = json::array(json::member(value, "cues"), "V8 burn-in cues");
	const auto caption_count = safe_integer(json::member(captions, "cueCount"), "V8 caption cue count", 1);
	if (cues.empty() || cues.size() > maximum_burn_in_cues
		|| cues.size() > static_cast<std::size_t>(caption_count)) {
		throw json::parse_error("V8 burn-in cues exceed their caption-bound ceiling.");
	}
	const auto duration = finite_number(json::member(root, "durationSeconds"), "V8 duration seconds");
	for (std::size_t index = 0; index < cues.size(); ++index) {
		const auto& cue = cues[index];
		exact(cue, {"index", "startSeconds", "endSeconds", "text", "fontSubset", "undrawable"});
		if (safe_integer(json::member(cue, "index"), "V8 burn-in cue index") != static_cast<std::int64_t>(index)) {
			throw json::parse_error("V8 burn-in cue indices must equal their positions.");
		}
		const auto start = bounded_number(json::member(cue, "startSeconds"), "V8 burn-in cue start", 0, duration);
		const auto end = bounded_number(json::member(cue, "endSeconds"), "V8 burn-in cue end", 0, duration);
		if (end < start) throw json::parse_error("A V8 burn-in cue ends before it starts.");
		const auto cue_text = text(json::member(cue, "text"), "V8 burn-in cue text", maximum_burn_in_text * 4);
		const auto cue_measurement = measure_utf8(cue_text);
		if (!cue_measurement || cue_measurement->utf16_units > maximum_burn_in_text) {
			throw json::parse_error("V8 burn-in cue text exceeds its 500 UTF-16-unit ceiling.");
		}
		if (!one_of(json::member(cue, "fontSubset"), {
			"latin", "latin-ext", "cyrillic", "cyrillic-ext", "greek", "greek-ext", "vietnamese",
		}, "V8 burn-in font subset")) throw json::parse_error("The V8 burn-in font subset is unsupported.");
		const auto& undrawable = json::array(json::member(cue, "undrawable"), "V8 burn-in undrawable characters");
		if (undrawable.size() > maximum_burn_in_text) throw json::parse_error("V8 burn-in undrawable characters exceed their ceiling.");
		for (const auto& character : undrawable) {
			const auto measurement = measure_utf8(text(character, "V8 undrawable character", 4));
			if (!measurement || measurement->scalars != 1) {
				throw json::parse_error("A V8 burn-in undrawable entry is not one Unicode scalar.");
			}
		}
	}
}

void validate_clip_operations(
	const json::value& operations_value,
	const json::value& clip,
	const json::value& canvas
) {
	const auto& operations = json::array(operations_value, "V8 filter clip operations");
	const auto fit = text(json::member(canvas, "fit"), "V8 canvas fit", 16);
	if (operations.size() != (fit == "stretch" ? 7U : 8U)) {
		throw json::parse_error("V8 filter clip operations do not match the closed canvas-fit pipeline.");
	}
	const auto& trim = operations[0];
	exact(trim, {"name", "startSeconds", "endSeconds"});
	literal(json::member(trim, "name"), "trim", "V8 trim operation");
	require_same(json::member(trim, "startSeconds"), json::member(clip, "sourceStartTimeSeconds"), "V8 trim start");
	require_same(json::member(trim, "endSeconds"), json::member(clip, "sourceEndTimeSeconds"), "V8 trim end");
	const auto& setpts = operations[1];
	exact(setpts, {"name", "origin", "playbackRate", "multiplier"});
	literal(json::member(setpts, "name"), "setpts", "V8 setpts operation");
	literal(json::member(setpts, "origin"), "PTS-STARTPTS", "V8 setpts origin");
	require_same(json::member(setpts, "playbackRate"), json::member(clip, "playbackRate"), "V8 setpts playback rate");
	const auto playback_rate = finite_number(json::member(clip, "playbackRate"), "V8 playback rate");
	if (!approximately_equal(finite_number(json::member(setpts, "multiplier"), "V8 setpts multiplier"), 1 / playback_rate)) {
		throw json::parse_error("The V8 setpts multiplier is not the playback-rate reciprocal.");
	}
	const auto& scale = operations[2];
	if (fit == "stretch") exact(scale, {"name", "width", "height"});
	else exact(scale, {"name", "width", "height", "forceOriginalAspectRatio"});
	literal(json::member(scale, "name"), "scale", "V8 scale operation");
	same_member(scale, canvas, "width", "V8 scale width");
	same_member(scale, canvas, "height", "V8 scale height");
	if (fit != "stretch") literal(
		json::member(scale, "forceOriginalAspectRatio"), fit == "cover" ? "increase" : "decrease",
		"V8 scale aspect mode"
	);
	const auto& format = operations[3];
	exact(format, {"name", "pixelFormat"});
	literal(json::member(format, "name"), "format", "V8 format operation");
	literal(json::member(format, "pixelFormat"), "rgba", "V8 intermediate pixel format");
	const auto& fps = operations[4];
	exact(fps, {"name", "frameRate"});
	literal(json::member(fps, "name"), "fps", "V8 fps operation");
	same_member(fps, canvas, "frameRate", "V8 filter frame rate");
	std::size_t tail = 5;
	if (fit == "contain") {
		const auto& pad = operations[tail++];
		exact(pad, {"name", "width", "height", "x", "y", "color"});
		literal(json::member(pad, "name"), "pad", "V8 pad operation");
		same_member(pad, canvas, "width", "V8 pad width");
		same_member(pad, canvas, "height", "V8 pad height");
		literal(json::member(pad, "x"), "(ow-iw)/2", "V8 pad x");
		literal(json::member(pad, "y"), "(oh-ih)/2", "V8 pad y");
		literal(json::member(pad, "color"), "black@0", "V8 pad color");
	} else if (fit == "cover") {
		const auto& crop = operations[tail++];
		exact(crop, {"name", "width", "height", "x", "y", "exact"});
		literal(json::member(crop, "name"), "crop", "V8 placement crop");
		same_member(crop, canvas, "width", "V8 placement crop width");
		same_member(crop, canvas, "height", "V8 placement crop height");
		literal(json::member(crop, "x"), "(iw-ow)/2", "V8 placement crop x");
		literal(json::member(crop, "y"), "(ih-oh)/2", "V8 placement crop y");
		if (!json::boolean(json::member(crop, "exact"), "V8 exact crop flag")) {
			throw json::parse_error("The V8 placement crop must be exact.");
		}
	}
	const auto& premultiply = operations[tail++];
	exact(premultiply, {"name", "inplace"});
	literal(json::member(premultiply, "name"), "premultiply", "V8 premultiply operation");
	if (!json::boolean(json::member(premultiply, "inplace"), "V8 premultiply in-place flag")) {
		throw json::parse_error("The V8 premultiply operation must be in-place.");
	}
	const auto& setsar = operations[tail];
	exact(setsar, {"name", "value"});
	literal(json::member(setsar, "name"), "setsar", "V8 setsar operation");
	integer_literal(json::member(setsar, "value"), 1, "V8 setsar value");
}

void validate_filter_clip(
	const json::value& filter_clip,
	const json::value& clip,
	const json::value& canvas,
	const std::string& expected_label
) {
	exact(filter_clip, {"clipId", "sourceId", "inputIndex", "role", "opacityStart", "opacityEnd", "renderDescription", "outputLabel", "operations"});
	for (const auto key : {"clipId", "sourceId", "inputIndex", "role", "opacityStart", "opacityEnd", "renderDescription"}) {
		same_member(filter_clip, clip, key, "V8 filter clip authority");
	}
	literal(json::member(filter_clip, "outputLabel"), expected_label, "V8 filter clip output label");
	validate_clip_operations(json::member(filter_clip, "operations"), clip, canvas);
}

void validate_filter_layer(
	const json::value& filter_layer,
	const json::value& layer,
	const json::value& canvas,
	const std::size_t interval_index,
	const std::size_t layer_index
) {
	exact(filter_layer, {"trackId", "trackIndex", "outputLabel", "clips", "blend"});
	same_member(filter_layer, layer, "trackId", "V8 filter layer track ID");
	same_member(filter_layer, layer, "trackIndex", "V8 filter layer track index");
	const auto prefix = "video_interval_" + std::to_string(interval_index) + "_track_" + std::to_string(layer_index);
	literal(json::member(filter_layer, "outputLabel"), prefix, "V8 filter layer output label");
	const auto& clips = json::array(json::member(layer, "clips"), "V8 authoritative clips");
	const auto& filter_clips = json::array(json::member(filter_layer, "clips"), "V8 filter clips");
	if (filter_clips.size() != clips.size()) throw json::parse_error("V8 filter clip count disagrees with its layer.");
	for (std::size_t index = 0; index < clips.size(); ++index) {
		validate_filter_clip(filter_clips[index], clips[index], canvas, prefix + "_clip_" + std::to_string(index));
	}
	const auto& blend = json::member(filter_layer, "blend");
	if (clips.size() == 1) {
		if (!is_null(blend)) throw json::parse_error("A one-clip V8 layer cannot carry a blend stage.");
		return;
	}
	exact(blend, {"name", "opacityStart", "opacityEnd"});
	literal(json::member(blend, "name"), "blend", "V8 blend operation");
	const auto& starts = json::array(json::member(blend, "opacityStart"), "V8 blend starting opacities");
	const auto& ends = json::array(json::member(blend, "opacityEnd"), "V8 blend ending opacities");
	if (starts.size() != clips.size() || ends.size() != clips.size()) throw json::parse_error("V8 blend opacity counts disagree.");
	for (std::size_t index = 0; index < clips.size(); ++index) {
		require_same(starts[index], json::member(clips[index], "opacityStart"), "V8 blend starting opacity");
		require_same(ends[index], json::member(clips[index], "opacityEnd"), "V8 blend ending opacity");
	}
}

void validate_filter_interval(
	const json::value& filter,
	const json::value& interval,
	const json::value& canvas,
	const std::size_t interval_index
) {
	exact(filter, {"kind", "intervalIndex", "outputLabel", "durationSeconds", "base", "layers", "overlays"});
	same_member(filter, interval, "kind", "V8 filter interval kind");
	integer_literal(json::member(filter, "intervalIndex"), static_cast<std::int64_t>(interval_index), "V8 filter interval index");
	const auto label = "video_interval_" + std::to_string(interval_index);
	literal(json::member(filter, "outputLabel"), label, "V8 filter interval output label");
	same_member(filter, interval, "durationSeconds", "V8 filter interval duration");
	const auto& base = json::member(filter, "base");
	exact(base, {"name", "color", "width", "height", "frameRate", "pixelFormat"});
	literal(json::member(base, "name"), "color", "V8 interval base operation");
	const auto* interval_color = json::optional_member(interval, "color");
	require_same(json::member(base, "color"), interval_color ? *interval_color : json::member(canvas, "backgroundColor"), "V8 interval base color");
	same_member(base, canvas, "width", "V8 interval base width");
	same_member(base, canvas, "height", "V8 interval base height");
	same_member(base, canvas, "frameRate", "V8 interval base frame rate");
	literal(json::member(base, "pixelFormat"), "rgba", "V8 interval base pixel format");
	const auto& layers = json::array(json::member(interval, "layers"), "V8 authoritative layers");
	const auto& filter_layers = json::array(json::member(filter, "layers"), "V8 filter layers");
	const auto& overlays = json::array(json::member(filter, "overlays"), "V8 overlays");
	if (filter_layers.size() != layers.size() || overlays.size() != layers.size()) {
		throw json::parse_error("V8 filter layers and overlays disagree with the authoritative interval.");
	}
	for (std::size_t index = 0; index < layers.size(); ++index) {
		validate_filter_layer(filter_layers[index], layers[index], canvas, interval_index, index);
		const auto& overlay = overlays[index];
		exact(overlay, {"name", "trackId", "alpha"});
		literal(json::member(overlay, "name"), "overlay", "V8 overlay operation");
		same_member(overlay, layers[index], "trackId", "V8 overlay track ID");
		literal(json::member(overlay, "alpha"), "premultiplied", "V8 overlay alpha mode");
	}
}

void validate_concat(const json::value& value, const std::size_t interval_count) {
	exact(value, {"name", "inputLabels", "videoStreams", "audioStreams", "outputLabel"});
	literal(json::member(value, "name"), "concat", "V8 concat operation");
	const auto& labels = json::array(json::member(value, "inputLabels"), "V8 concat inputs");
	if (labels.size() != interval_count) throw json::parse_error("V8 concat input count disagrees with its intervals.");
	for (std::size_t index = 0; index < labels.size(); ++index) {
		literal(labels[index], "video_interval_" + std::to_string(index), "V8 concat input label");
	}
	integer_literal(json::member(value, "videoStreams"), 1, "V8 concat video stream count");
	integer_literal(json::member(value, "audioStreams"), 0, "V8 concat audio stream count");
	literal(json::member(value, "outputLabel"), "video_out", "V8 concat output label");
}

void validate_audio(const json::value& root, const json::value& value) {
	const auto& inputs = json::array(json::member(root, "inputs"), "V8 inputs");
	const json::value* audio = nullptr;
	for (const auto& input : inputs) {
		if (json::string(json::member(input, "kind"), "V8 input kind") == "staged-audio-mix") audio = &input;
	}
	if (!audio) {
		exact(value, {"strategy"});
		literal(json::member(value, "strategy"), "none", "V8 audio filter strategy");
		return;
	}
	exact(value, {"strategy", "inputIndex", "startFrame", "durationFrames", "sampleRate", "codec"});
	literal(json::member(value, "strategy"), "staged-mix", "V8 audio filter strategy");
	for (const auto key : {"inputIndex", "startFrame", "durationFrames", "sampleRate"}) {
		same_member(value, *audio, key, "V8 audio filter authority");
	}
	require_same(json::member(value, "codec"), json::member(json::member(root, "codecs"), "audio"), "V8 audio filter codec");
}

void validate_output(const json::value& root, const json::value& value) {
	exact(value, {"videoLabel", "videoCodec", "audioCodec", "pixelFormat"});
	literal(json::member(value, "videoLabel"), "video_out", "V8 filter output label");
	const auto& codecs = json::member(root, "codecs");
	require_same(json::member(value, "videoCodec"), json::member(codecs, "videoEncoder"), "V8 filter video codec");
	require_same(json::member(value, "audioCodec"), json::member(codecs, "audioEncoder"), "V8 filter audio codec");
	require_same(json::member(value, "pixelFormat"), json::member(codecs, "pixelFormat"), "V8 filter pixel format");
}

} // namespace

void validate_v8_filter_plan(const json::value& root) {
	const auto& filter = json::member(root, "filterPlan");
	exact(filter, {"strategy", "backgroundColor", "intervals", "concat", "audio", "burnIn", "output"});
	literal(json::member(filter, "strategy"), "layered-composition", "V8 filter strategy");
	const auto& canvas = json::member(root, "canvas");
	require_same(json::member(filter, "backgroundColor"), json::member(canvas, "backgroundColor"), "V8 filter background");
	const auto& intervals = json::array(json::member(root, "intervals"), "V8 authoritative intervals");
	const auto& filter_intervals = json::array(json::member(filter, "intervals"), "V8 filter intervals");
	if (filter_intervals.size() != intervals.size()) throw json::parse_error("V8 filter interval count disagrees with its authority.");
	for (std::size_t index = 0; index < intervals.size(); ++index) {
		validate_filter_interval(filter_intervals[index], intervals[index], canvas, index);
	}
	validate_concat(json::member(filter, "concat"), intervals.size());
	validate_audio(root, json::member(filter, "audio"));
	validate_burn_in(root, json::member(filter, "burnIn"));
	validate_output(root, json::member(filter, "output"));
}

} // namespace framescaper::media::legacy
