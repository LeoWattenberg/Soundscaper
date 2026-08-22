/* SPDX-License-Identifier: AGPL-3.0-only */

#include "legacy_plan_v8_filter_semantics.hpp"
#include "legacy_plan_v8_visual_semantics.hpp"
#include "strict_json.hpp"

#include <cassert>
#include <string>
#include <string_view>

using namespace framescaper::media;

namespace {

[[nodiscard]] std::string clip(
	const std::string_view role = "single",
	const std::string_view id = "clip-1",
	const std::string_view opacity_start = "0.75",
	const std::string_view opacity_end = "0.75",
	const std::string_view blend = "normal",
	const int order = 0
) {
	return std::string{R"({"role":")"} + std::string{role} + R"(","clipId":")" + std::string{id}
		+ R"(","sourceId":"source-1","inputIndex":0,"sourceStartFrame":0,"sourceEndFrame":100,)"
		+ R"("sourceDurationFrames":100,"sourceStartTimeSeconds":0,"sourceEndTimeSeconds":1,)"
		+ R"("playbackRate":1,"opacityStart":)" + std::string{opacity_start} + R"(,"opacityEnd":)"
		+ std::string{opacity_end}
		+ R"(,"renderDescription":{"crop":{"normalized":{"left":0.1,"top":0.1,"right":0.1,"bottom":0.1},)"
		+ R"("sourcePixels":{"x":10,"y":5,"width":80,"height":40}},"sourceDisplayToCanvas":[1,0,0,1,0,0],)"
		+ R"("opacityStart":)" + std::string{opacity_start} + R"(,"opacityEnd":)" + std::string{opacity_end}
		+ R"(,"blendMode":")" + std::string{blend} + R"(","compositingOrder":)" + std::to_string(order)
		+ R"(},"videoEffects":[{"id":"pixels","type":"pixelate","enabled":true,"params":{"blockSize":12}}]})";
}

[[nodiscard]] std::string layer(
	const std::string_view track,
	const int track_index,
	const std::string& clips
) {
	return R"({"trackId":")" + std::string{track} + R"(","trackIndex":)"
		+ std::to_string(track_index) + R"(,"clips":[)" + clips + "]}";
}

[[nodiscard]] std::string semantic_plan(const std::string& layers = layer("track-1", 0, clip())) {
	return R"({"range":{"startFrame":0,"endFrame":100,"durationFrames":100},"durationSeconds":1,)"
		R"("canvas":{"width":100,"height":50,"frameRate":25,"fit":"contain","backgroundColor":"lavender@0.5"},)"
		R"("inputs":[{"kind":"video-source","inputIndex":0,"sourceId":"source-1","storageKey":"media/source-1",)"
		R"("mimeType":"video/mp4","presentation":{"autorotate":true,"decodedWidth":50,"decodedHeight":50,)"
		R"("sampleAspect":{"num":2,"den":1},"scaledWidth":100,"scaledHeight":50}}],)"
		R"("intervals":[{"index":0,"kind":"composition","timelineStartFrame":0,"timelineEndFrame":100,)"
		R"("outputStartFrame":0,"durationFrames":100,"durationSeconds":1,"layers":[)" + layers + "]}]}";
}

[[nodiscard]] std::string replace_once(
	std::string source,
	const std::string_view from,
	const std::string_view to
) {
	const auto offset = source.find(from);
	assert(offset != std::string::npos);
	source.replace(offset, from.size(), to);
	return source;
}

void expect_rejected(const std::string& source) {
	try {
		static_cast<void>(legacy::capture_v8_static_visual_semantics(json::parse(source)));
		assert(false);
	} catch (const json::parse_error&) {}
}

void expect_filter_rejected(const std::string& source) {
	try {
		legacy::validate_v8_filter_plan(json::parse(source));
		assert(false);
	} catch (const json::parse_error&) {}
}

void captures_the_closed_static_visual_authority() {
	const auto semantics = legacy::capture_v8_static_visual_semantics(json::parse(semantic_plan()));
	assert(semantics.canvas.width == 100);
	assert(semantics.canvas.background_color == "lavender@0.5");
	assert(semantics.sources.size() == 1);
	assert(semantics.sources[0].presentation.has_value());
	assert(semantics.sources[0].presentation->scaled_width == 100);
	assert(semantics.intervals.size() == 1);
	const auto& captured_clip = semantics.intervals[0].layers[0].clips[0];
	assert(captured_clip.render.source_width == 100);
	assert(captured_clip.render.source_height == 50);
	assert(captured_clip.render.scale_x == 1);
	assert(captured_clip.render.scale_y == 1);
	assert(captured_clip.effects.size() == 1);
	assert(captured_clip.effects[0].type == "pixelate");
	assert(captured_clip.effects[0].parameters[0].name == "blockSize");
	assert(captured_clip.effects[0].parameters[0].number == "12");
	const auto without_presentation = legacy::capture_v8_static_visual_semantics(json::parse(replace_once(
		semantic_plan(),
		R"({"autorotate":true,"decodedWidth":50,"decodedHeight":50,"sampleAspect":{"num":2,"den":1},"scaledWidth":100,"scaledHeight":50})",
		"null"
	)));
	assert(!without_presentation.sources[0].presentation.has_value());
}

void refuses_hostile_presentation_geometry_effect_and_interval_semantics() {
	const auto base = semantic_plan();
	expect_rejected(replace_once(base, R"("autorotate":true)", R"("autorotate":false)"));
	expect_rejected(replace_once(base, R"("scaledWidth":100)", R"("scaledWidth":50)"));
	expect_rejected(replace_once(base, R"("inputIndex":0)", R"("inputIndex":2)"));
	expect_rejected(replace_once(base, R"("x":10,"y":5)", R"("x":9,"y":5)"));
	expect_rejected(replace_once(base, "[1,0,0,1,0,0]", "[1,0,0.2,1,0,0]"));
	expect_rejected(replace_once(base, R"("opacityEnd":0.75)", R"("opacityEnd":0.5)"));
	expect_rejected(replace_once(base, R"("blockSize":12)", R"("blockSize":129)"));
	expect_rejected(replace_once(base, R"("blockSize":12)", R"("blockSize":12,"expression":1)"));
	expect_rejected(replace_once(base, "lavender@0.5", "lavender@2"));
	expect_rejected(replace_once(base, R"("durationSeconds":1,"layers")", R"("durationSeconds":0.9,"layers")"));
}

void retains_every_admitted_visual_enum_domain() {
	const auto base = semantic_plan();
	for (const auto fit : {"contain", "cover", "stretch"}) {
		static_cast<void>(legacy::capture_v8_static_visual_semantics(json::parse(
			replace_once(base, "\"fit\":\"contain\"", "\"fit\":\"" + std::string{fit} + "\"")
		)));
	}
	for (const auto blend : {
		"normal", "multiply", "screen", "overlay", "darken", "lighten", "difference", "exclusion",
	}) {
		static_cast<void>(legacy::capture_v8_static_visual_semantics(json::parse(
			replace_once(base, "\"blendMode\":\"normal\"", "\"blendMode\":\"" + std::string{blend} + "\"")
		)));
	}
	for (const auto color : {"#12345678", "rebeccapurple", "black@0"}) {
		const auto captured = legacy::capture_v8_static_visual_semantics(json::parse(
			replace_once(base, "lavender@0.5", color)
		));
		assert(captured.canvas.background_color == color);
	}
	const auto all_effects = std::string{
		R"([{"id":"fx-1","type":"color-adjust","enabled":true,"params":{}},)"
		R"({"id":"fx-2","type":"pixelate","enabled":true,"params":{}},)"
		R"({"id":"fx-3","type":"vignette","enabled":true,"params":{}},)"
		R"({"id":"fx-4","type":"gaussian-blur","enabled":true,"params":{}},)"
		R"({"id":"fx-5","type":"sharpen","enabled":true,"params":{}},)"
		R"({"id":"fx-6","type":"rgb-split","enabled":true,"params":{}},)"
		R"({"id":"fx-7","type":"chroma-key","enabled":true,"params":{}},)"
		R"({"id":"fx-8","type":"luma-key","enabled":true,"params":{}},)"
		R"({"id":"fx-9","type":"spill-suppression","enabled":true,"params":{}},)"
		R"({"id":"fx-10","type":"glow","enabled":true,"params":{}},)"
		R"({"id":"fx-11","type":"outline","enabled":true,"params":{}},)"
		R"({"id":"fx-12","type":"drop-shadow","enabled":true,"params":{}}])"
	};
	const auto all = legacy::capture_v8_static_visual_semantics(json::parse(replace_once(
		base,
		R"([{"id":"pixels","type":"pixelate","enabled":true,"params":{"blockSize":12}}])",
		all_effects
	)));
	assert(all.intervals[0].layers[0].clips[0].effects.size() == 12);
}

void closes_layer_order_and_transition_render_authority_without_reinterpreting_weights() {
	const auto lower = layer("lower", 5, clip("single", "lower-clip", "1", "1", "normal", 0));
	const auto upper = layer("upper", 4, clip("single", "upper-clip", "1", "1", "normal", 1));
	static_cast<void>(legacy::capture_v8_static_visual_semantics(json::parse(semantic_plan(lower + "," + upper))));
	expect_rejected(semantic_plan(upper + "," + lower));

	const auto outgoing = clip("outgoing", "outgoing", "0.6", "0.2", "screen", 3);
	const auto incoming = clip("incoming", "incoming", "0.1", "0.7", "screen", 3);
	const auto transition = semantic_plan(layer("transition", 2, outgoing + "," + incoming));
	const auto captured = legacy::capture_v8_static_visual_semantics(json::parse(transition));
	assert(captured.intervals[0].layers[0].clips[0].opacity_start == "0.6");
	assert(captured.intervals[0].layers[0].clips[1].opacity_end == "0.7");
	expect_rejected(replace_once(
		transition,
		"\"blendMode\":\"screen\",\"compositingOrder\":3}",
		"\"blendMode\":\"multiply\",\"compositingOrder\":3}"
	));
}

[[nodiscard]] std::string filter_plan() {
	auto result = semantic_plan();
	result.pop_back();
	return result
		+ R"(,"captions":null,"codecs":{"videoEncoder":"libx264","audioEncoder":null,"pixelFormat":"yuv420p"},)"
		+ R"("filterPlan":{"strategy":"layered-composition","backgroundColor":"lavender@0.5","intervals":[{)"
		+ R"("kind":"composition","intervalIndex":0,"outputLabel":"video_interval_0","durationSeconds":1,)"
		+ R"("base":{"name":"color","color":"lavender@0.5","width":100,"height":50,"frameRate":25,"pixelFormat":"rgba"},)"
		+ R"("layers":[{"trackId":"track-1","trackIndex":0,"outputLabel":"video_interval_0_track_0","clips":[{)"
		+ R"("clipId":"clip-1","sourceId":"source-1","inputIndex":0,"role":"single","opacityStart":0.75,"opacityEnd":0.75,)"
		+ R"("renderDescription":{"crop":{"normalized":{"left":0.1,"top":0.1,"right":0.1,"bottom":0.1},)"
		+ R"("sourcePixels":{"x":10,"y":5,"width":80,"height":40}},"sourceDisplayToCanvas":[1,0,0,1,0,0],)"
		+ R"("opacityStart":0.75,"opacityEnd":0.75,"blendMode":"normal","compositingOrder":0},)"
		+ R"("outputLabel":"video_interval_0_track_0_clip_0","operations":[)"
		+ R"({"name":"trim","startSeconds":0,"endSeconds":1},{"name":"setpts","origin":"PTS-STARTPTS","playbackRate":1,"multiplier":1},)"
		+ R"({"name":"scale","width":100,"height":50,"forceOriginalAspectRatio":"decrease"},{"name":"format","pixelFormat":"rgba"},)"
		+ R"({"name":"fps","frameRate":25},{"name":"video-effect","effect":{"id":"pixels","type":"pixelate","enabled":true,"params":{"blockSize":12}}},)"
		+ R"({"name":"pad","width":100,"height":50,"x":"(ow-iw)/2","y":"(oh-ih)/2","color":"black@0"},)"
		+ R"({"name":"premultiply","inplace":true},{"name":"setsar","value":1}]}],"blend":null}],)"
		+ R"("overlays":[{"name":"overlay","trackId":"track-1","alpha":"premultiplied"}]}],)"
		+ R"("concat":{"name":"concat","inputLabels":["video_interval_0"],"videoStreams":1,"audioStreams":0,"outputLabel":"video_out"},)"
		+ R"("audio":{"strategy":"none"},"burnIn":null,"output":{"videoLabel":"video_out","videoCodec":"libx264","audioCodec":null,"pixelFormat":"yuv420p"}}})";
}

void filter_plan_redundancy_binds_each_enabled_effect_exactly_once() {
	const auto plan = filter_plan();
	legacy::validate_v8_filter_plan(json::parse(plan));
	const auto effect_operation = std::string_view{
		R"({"name":"video-effect","effect":{"id":"pixels","type":"pixelate","enabled":true,"params":{"blockSize":12}}},)"
	};
	expect_filter_rejected(replace_once(plan, R"("blockSize":12)", R"("blockSize":13)"));
	expect_filter_rejected(replace_once(plan, effect_operation, ""));
	auto disabled = replace_once(plan, effect_operation, "");
	disabled = replace_once(disabled, R"("enabled":true)", R"("enabled":false)");
	legacy::validate_v8_filter_plan(json::parse(disabled));
}

} // namespace

int main() {
	captures_the_closed_static_visual_authority();
	refuses_hostile_presentation_geometry_effect_and_interval_semantics();
	retains_every_admitted_visual_enum_domain();
	closes_layer_order_and_transition_render_authority_without_reinterpreting_weights();
	filter_plan_redundancy_binds_each_enabled_effect_exactly_once();
}
