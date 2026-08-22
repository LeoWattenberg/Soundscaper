/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "unified_plan_v10_semantics.hpp"

#include <map>
#include <set>
#include <string>

namespace framescaper::media::unified {

inline void nullable_text(const json::value& value, const std::string_view label) {
	if (value.kind != json::type::null_value) static_cast<void>(text(value, label));
}

inline void nullable_integer(const json::value& value, const std::string_view label, const std::int64_t minimum = 0) {
	if (value.kind != json::type::null_value) static_cast<void>(safe_integer(value, label, minimum));
}

inline void validate_professional_characteristics(const json::value& value) {
	exact(value, {"backend", "codedWidth", "codedHeight", "rotationDegrees", "pixelAspectRatio", "fieldOrder", "hasAlpha", "videoCodec", "colour", "audioStreams", "extractedAudioStreamIndex", "startTimecode", "bitDepth", "pixelFormat", "chromaFormat", "alphaMode", "alphaInterpretation"});
	for (const auto key : {"backend", "fieldOrder", "videoCodec", "pixelFormat", "chromaFormat", "alphaMode", "alphaInterpretation"}) {
		nullable_text(json::member(value, key), key);
	}
	for (const auto key : {"codedWidth", "codedHeight", "rotationDegrees", "extractedAudioStreamIndex", "bitDepth"}) {
		nullable_integer(json::member(value, key), key);
	}
	const auto& rotation = json::member(value, "rotationDegrees");
	if (rotation.kind != json::type::null_value) {
		const auto degrees = safe_integer(rotation, "rotationDegrees");
		if (degrees != 0 && degrees != 90 && degrees != 180 && degrees != 270) {
			throw json::parse_error("Professional source rotation is unsupported.");
		}
	}
	const auto& alpha = json::member(value, "hasAlpha");
	if (alpha.kind != json::type::null_value) static_cast<void>(json::boolean(alpha, "source alpha"));
	const auto& aspect = json::member(value, "pixelAspectRatio");
	if (aspect.kind != json::type::null_value) static_cast<void>(rate(aspect, "pixel aspect ratio"));
	const auto& colour = json::member(value, "colour");
	exact(colour, {"primaries", "transfer", "matrix", "range", "masteringDisplay", "contentLight"});
	for (const auto key : {"primaries", "transfer", "matrix", "range"}) nullable_text(json::member(colour, key), key);
	const auto& mastering = json::member(colour, "masteringDisplay");
	if (mastering.kind != json::type::null_value) {
		exact(mastering, {"redPrimary", "greenPrimary", "bluePrimary", "whitePoint", "minimumLuminance", "maximumLuminance"});
		for (const auto key : {"redPrimary", "greenPrimary", "bluePrimary", "whitePoint"}) {
			const auto& point = json::member(mastering, key);
			exact(point, {"x", "y"});
			static_cast<void>(rate(json::member(point, "x"), "chromaticity x"));
			static_cast<void>(rate(json::member(point, "y"), "chromaticity y"));
		}
		static_cast<void>(rate(json::member(mastering, "minimumLuminance"), "minimum luminance"));
		static_cast<void>(rate(json::member(mastering, "maximumLuminance"), "maximum luminance"));
	}
	const auto& light = json::member(colour, "contentLight");
	if (light.kind != json::type::null_value) {
		exact(light, {"maximumContentLightLevel", "maximumFrameAverageLightLevel"});
		const auto maximum = safe_integer(json::member(light, "maximumContentLightLevel"), "maximum content light");
		if (safe_integer(json::member(light, "maximumFrameAverageLightLevel"), "maximum frame-average light") > maximum) {
			throw json::parse_error("Professional content-light metadata is inconsistent.");
		}
	}
	const auto& streams = json::member(value, "audioStreams");
	std::set<std::int64_t> stream_indices;
	if (streams.kind != json::type::null_value) {
		const auto& entries = json::array(streams, "professional audio streams");
		if (entries.size() > 64) throw json::parse_error("Professional audio stream ceiling is exceeded.");
		std::int64_t previous = -1;
		for (const auto& entry : entries) {
			exact(entry, {"index", "codec", "channelCount", "sampleRate", "language"});
			const auto index = safe_integer(json::member(entry, "index"), "audio stream index");
			if (index <= previous) throw json::parse_error("Professional audio streams are not ordered.");
			previous = index;
			stream_indices.insert(index);
			for (const auto key : {"codec", "language"}) nullable_text(json::member(entry, key), key);
			for (const auto key : {"channelCount", "sampleRate"}) nullable_integer(json::member(entry, key), key, 1);
		}
	}
	const auto& extracted = json::member(value, "extractedAudioStreamIndex");
	if (extracted.kind != json::type::null_value
		&& !stream_indices.contains(safe_integer(extracted, "extracted audio stream"))) {
		throw json::parse_error("Extracted audio stream is absent from its inventory.");
	}
	const auto& timecode = json::member(value, "startTimecode");
	if (timecode.kind != json::type::null_value) {
		exact(timecode, {"negative", "hours", "minutes", "seconds", "frames", "dropFrame"});
		static_cast<void>(json::boolean(json::member(timecode, "negative"), "timecode sign"));
		static_cast<void>(json::boolean(json::member(timecode, "dropFrame"), "drop-frame flag"));
		for (const auto key : {"hours", "minutes", "seconds", "frames"}) static_cast<void>(safe_integer(json::member(timecode, key), key));
	}
}

struct image_sequence_identity final {
	std::string inventory_sha;
	std::int64_t frame_count{};
	std::pair<std::int64_t, std::int64_t> frame_rate;
};

[[nodiscard]] inline image_sequence_identity validate_image_sequence(
	const json::value& value,
	const source_authority& source,
	const json::value& characteristics
) {
	exact(value, {"kind", "sourceType", "version", "id", "name", "stem", "extension", "frameNumberWidth", "firstFrameNumber", "lastFrameNumber", "frameCount", "frameRate", "inventory", "sourcePack", "characteristics"});
	literal(json::member(value, "kind"), "video", "image-sequence kind");
	literal(json::member(value, "sourceType"), "image-sequence", "image-sequence source type");
	literal(json::member(value, "version"), 1, "image-sequence version");
	if (text(json::member(value, "id"), "image-sequence ID") != source.source_id) throw json::parse_error("Image-sequence source ID is inconsistent.");
	for (const auto key : {"name", "stem", "extension"}) static_cast<void>(text(json::member(value, key), key));
	static_cast<void>(safe_integer(json::member(value, "frameNumberWidth"), "frame-number width"));
	const auto first = safe_integer(json::member(value, "firstFrameNumber"), "first frame number");
	const auto last = safe_integer(json::member(value, "lastFrameNumber"), "last frame number");
	const auto count = safe_integer(json::member(value, "frameCount"), "image-sequence frame count", 1);
	if (last < first || last - first + 1 != count || count != source.frame_count) throw json::parse_error("Image-sequence frame bounds are inconsistent.");
	const auto frame_rate = rate(json::member(value, "frameRate"), "image-sequence frame rate");
	const auto& inventory = json::member(value, "inventory");
	exact(inventory, {"kind", "version", "storageKey", "sha256", "byteLength", "frameCount", "firstFrameNumber", "lastFrameNumber"});
	literal(json::member(inventory, "kind"), "image-sequence-inventory", "inventory kind");
	literal(json::member(inventory, "version"), 1, "inventory version");
	const auto inventory_sha = digest(json::member(inventory, "sha256"), "inventory digest");
	if (text(json::member(inventory, "storageKey"), "inventory storage key") != "image-sequence-inventory-sha256:" + inventory_sha
		|| safe_integer(json::member(inventory, "frameCount"), "inventory frame count", 1) != count
		|| safe_integer(json::member(inventory, "firstFrameNumber"), "inventory first frame") != first
		|| safe_integer(json::member(inventory, "lastFrameNumber"), "inventory last frame") != last) {
		throw json::parse_error("Image-sequence inventory authority is inconsistent.");
	}
	static_cast<void>(safe_integer(json::member(inventory, "byteLength"), "inventory byte length", 1));
	const auto& pack = json::member(value, "sourcePack");
	exact(pack, {"kind", "storageKey", "sha256", "byteLength"});
	literal(json::member(pack, "kind"), "image-sequence-source-pack", "source-pack kind");
	const auto pack_sha = digest(json::member(pack, "sha256"), "source-pack digest");
	if (text(json::member(pack, "storageKey"), "source-pack storage key") != "image-sequence-pack-sha256:" + pack_sha
		|| source.storage_key != json::string(json::member(pack, "storageKey"), "source-pack storage key")
		|| source.sha256 != pack_sha) throw json::parse_error("Image-sequence pack does not bind the render source.");
	static_cast<void>(safe_integer(json::member(pack, "byteLength"), "source-pack byte length", 1));
	validate_professional_characteristics(json::member(value, "characteristics"));
	if (semantic_sha256(json::member(value, "characteristics")) != semantic_sha256(characteristics)) {
		throw json::parse_error("Image-sequence characteristics disagree with source authority.");
	}
	return {inventory_sha, count, frame_rate};
}

inline void validate_proxy(const json::value& value, const source_authority& source) {
	exact(value, {"kind", "version", "rule", "storageKey", "mimeType", "byteLength", "sha256", "originalSha256", "originalAuthorityKind", "generatorId", "generatorVersion", "recipeId", "recipeVersion", "timingBackendId", "timingRule", "frameCount", "boundaryCount", "timingAsset", "audioPolicy"});
	literal(json::member(value, "kind"), "video-proxy-attachment", "proxy kind");
	literal(json::member(value, "version"), 1, "proxy version");
	literal(json::member(value, "rule"), "exact-original-generation-proxy-content-and-timing-v1", "proxy rule");
	literal(json::member(value, "mimeType"), "video/quicktime", "proxy MIME type");
	literal(json::member(value, "recipeId"), "framescaper-native-prores-proxy-mov-v1", "proxy recipe");
	literal(json::member(value, "recipeVersion"), 1, "proxy recipe version");
	const auto proxy_sha = digest(json::member(value, "sha256"), "proxy digest");
	if (text(json::member(value, "storageKey"), "proxy storage key") != "video-proxy-sha256:" + proxy_sha
		|| digest(json::member(value, "originalSha256"), "proxy original digest") != source.sha256) {
		throw json::parse_error("Proxy does not bind its exact original.");
	}
	for (const auto key : {"generatorId", "timingBackendId", "originalAuthorityKind"}) static_cast<void>(text(json::member(value, key), key));
	for (const auto key : {"byteLength", "generatorVersion", "frameCount", "boundaryCount"}) static_cast<void>(safe_integer(json::member(value, key), key, 1));
	if (safe_integer(json::member(value, "boundaryCount"), "proxy boundary count", 1)
		!= safe_integer(json::member(value, "frameCount"), "proxy frame count", 1) + 1) throw json::parse_error("Proxy boundary count is inconsistent.");
	literal(json::member(value, "timingRule"), "exact-presentation-boundaries-v1", "proxy timing rule");
	literal(json::member(value, "audioPolicy"), "ignore-proxy-container-audio-v1", "proxy audio policy");
	static_cast<void>(validate_video_timing_reference_summary(
		json::member(value, "timingAsset"), proxy_sha
	));
}

inline void validate_professional(
	const json::value& node,
	const source_index& sources,
	admitted_media_plan& result
) {
	exact(node, {"kind", "nodeId", "sourceNodeId", "characteristics", "imageSequence", "proxyAttachment", "exportAuthority"});
	static_cast<void>(text(json::member(node, "nodeId"), "professional node ID"));
	const auto source_node = text(json::member(node, "sourceNodeId"), "professional source node ID");
	const auto found = sources.find(source_node);
	if (found == sources.end()) throw json::parse_error("Professional media references an unknown source.");
	const auto& characteristics = json::member(node, "characteristics");
	validate_professional_characteristics(characteristics);
	const auto& sequence = json::member(node, "imageSequence");
	if (sequence.kind != json::type::null_value) {
		const auto identity = validate_image_sequence(sequence, found->second, characteristics);
		if (identity.frame_count > 2'000'000
			|| identity.frame_rate.first > 1'000'000
			|| identity.frame_rate.second > 1'000'000) {
			throw json::parse_error("Image-sequence count or rate exceeds the native pack domain.");
		}
		result.image_sequence_inventory_sha256.push_back(identity.inventory_sha);
		result.image_sequence_frame_count.push_back(static_cast<std::uint64_t>(identity.frame_count));
		result.image_sequence_frame_rate_num.push_back(static_cast<std::uint32_t>(identity.frame_rate.first));
		result.image_sequence_frame_rate_den.push_back(static_cast<std::uint32_t>(identity.frame_rate.second));
	}
	const auto& proxy = json::member(node, "proxyAttachment");
	if (proxy.kind != json::type::null_value) validate_proxy(proxy, found->second);
	literal(json::member(node, "exportAuthority"), "original", "professional export authority");
}

inline bool known_ofx_context(const std::string& value) {
	return value == "generator" || value == "filter" || value == "transition"
		|| value == "paint" || value == "retimer" || value == "general";
}

inline void validate_openfx_attachment_identity(
	const graph_identity_index& identities,
	const std::string& context,
	const std::string& target
) {
	if (context == "generator") static_cast<void>(require_graph_identity(identities, target, {
		graph_identity_kind::generator_source,
	}, "An OpenFX generator attachment"));
	else if (context == "filter" || context == "paint") {
		static_cast<void>(require_graph_identity(identities, target, {
			graph_identity_kind::clip,
			graph_identity_kind::video_effect,
			graph_identity_kind::visual_model,
		}, "An OpenFX filter/paint attachment"));
	} else if (context == "transition") static_cast<void>(require_graph_identity(identities, target, {
		graph_identity_kind::transition,
	}, "An OpenFX transition attachment"));
	else if (context == "retimer") static_cast<void>(require_graph_identity(identities, target, {
		graph_identity_kind::clip,
	}, "An OpenFX retimer attachment"));
	else static_cast<void>(require_graph_identity(identities, target, {
		graph_identity_kind::source,
		graph_identity_kind::generator_source,
		graph_identity_kind::clip,
		graph_identity_kind::visual_model,
	}, "An OpenFX general attachment"));
}

inline void validate_ofx_value(const json::value& value, const std::string& type) {
	if (type == "group" || type == "page" || type == "pushbutton") {
		if (value.kind != json::type::null_value) throw json::parse_error("A valueless OFX parameter carries state.");
	} else if (type == "boolean") static_cast<void>(json::boolean(value, "OFX boolean value"));
	else if (type == "string" || type == "custom") {
		if (value.kind != json::type::string || value.text.size() > 65'536) throw json::parse_error("OFX string state is oversized.");
	} else if (type == "choice" || type == "integer") static_cast<void>(json::integer(value, "OFX integer value"));
	else {
		const auto& components = json::array(value, "OFX numeric value");
		const std::map<std::string, std::size_t> counts{{"double",1},{"integer2d",2},{"double2d",2},{"integer3d",3},{"double3d",3},{"rgb",3},{"rgba",4}};
		if (type == "parametric") {
			if (components.size() > 8'192) throw json::parse_error("OFX parametric value is oversized.");
			for (const auto& point : components) {
				const auto& pair = json::array(point, "OFX parametric point");
				if (pair.size() != 2) throw json::parse_error("OFX parametric point is malformed.");
				for (const auto& item : pair) finite_number(item, "OFX parametric component");
			}
		} else {
			const auto found = counts.find(type);
			if (found == counts.end() || components.size() != found->second) throw json::parse_error("OFX parameter type or component count is unsupported.");
			for (const auto& item : components) finite_number(item, "OFX numeric component");
		}
	}
}

inline void validate_openfx(
	const json::value& node,
	const graph_identity_index& identities,
	const source_index& sources,
	const std::int64_t output_frame_count
) {
	exact(node, {"kind", "nodeId", "state"});
	static_cast<void>(text(json::member(node, "nodeId"), "OpenFX node ID"));
	const auto& state = json::member(node, "state");
	exact(state, {"schemaVersion", "instanceId", "pluginId", "binarySha256", "context", "attachment", "inputs", "parameters", "customEncodings", "enabled", "freshness", "frozenFallback"});
	literal(json::member(state, "schemaVersion"), 1, "OpenFX state schema");
	static_cast<void>(text(json::member(state, "instanceId"), "OpenFX instance ID"));
	static_cast<void>(text(json::member(state, "pluginId"), "OpenFX plug-in ID"));
	static_cast<void>(digest(json::member(state, "binarySha256"), "OpenFX binary digest"));
	const auto context = text(json::member(state, "context"), "OpenFX context");
	if (!known_ofx_context(context)) throw json::parse_error("OpenFX context is unsupported.");
	const auto& attachment = json::member(state, "attachment");
	exact(attachment, {"kind", "targetId"});
	if (text(json::member(attachment, "kind"), "OpenFX attachment kind") != context) {
		throw json::parse_error("OpenFX attachment does not bind the render graph.");
	}
	validate_openfx_attachment_identity(
		identities, context, stable_id(json::member(attachment, "targetId"), "OpenFX target ID")
	);
	const auto& inputs = json::array(json::member(state, "inputs"), "OpenFX inputs");
	if (inputs.size() > 16) throw json::parse_error("OpenFX input ceiling is exceeded.");
	std::set<std::string> input_names;
	for (const auto& input : inputs) {
		exact(input, {"name", "sourceRef"});
		unique(input_names, text(json::member(input, "name"), "OpenFX input name"), "OpenFX input name");
		static_cast<void>(require_renderable_identity(
			identities,
			stable_id(json::member(input, "sourceRef"), "OpenFX input reference"),
			"An OpenFX named input"
		));
	}
	const auto& parameters = json::array(json::member(state, "parameters"), "OpenFX parameters");
	if (parameters.size() > 4'096) throw json::parse_error("OpenFX parameter ceiling is exceeded.");
	std::map<std::string, std::string> parameter_types;
	for (const auto& parameter : parameters) {
		exact(parameter, {"name", "type", "value", "keyframes"});
		const auto name = text(json::member(parameter, "name"), "OpenFX parameter name");
		const auto type = text(json::member(parameter, "type"), "OpenFX parameter type");
		if (!parameter_types.emplace(name, type).second) throw json::parse_error("OpenFX parameter name is duplicated.");
		validate_ofx_value(json::member(parameter, "value"), type);
		const auto& keyframes = json::array(json::member(parameter, "keyframes"), "OpenFX keyframes");
		if (keyframes.size() > 8'192) throw json::parse_error("OpenFX keyframe ceiling is exceeded.");
		if (!keyframes.empty() && (type == "group" || type == "page" || type == "pushbutton")) {
			throw json::parse_error("A valueless OFX parameter cannot carry keyframes.");
		}
		std::int64_t previous = -1;
		for (const auto& keyframe : keyframes) {
			exact(keyframe, {"frame", "value"});
			const auto frame = safe_integer(json::member(keyframe, "frame"), "OpenFX keyframe frame");
			if (frame <= previous) throw json::parse_error("OpenFX keyframes are not strictly ordered.");
			previous = frame;
			finite_number(json::member(keyframe, "value"), "OpenFX keyframe value");
		}
	}
	const auto& encodings = json::member(state, "customEncodings");
	if (encodings.kind != json::type::object) throw json::parse_error("OpenFX custom encodings must be an object.");
	std::size_t encoding_bytes = 0;
	for (const auto& [name, encoded] : encodings.members) {
		if (parameter_types[name] != "custom" || encoded.kind != json::type::string) throw json::parse_error("OpenFX custom encoding does not name a custom parameter.");
		encoding_bytes += encoded.text.size();
		if (encoding_bytes > 65'536) throw json::parse_error("OpenFX custom encodings exceed their byte ceiling.");
	}
	static_cast<void>(json::boolean(json::member(state, "enabled"), "OpenFX enabled"));
	static_cast<void>(validate_freshness(json::member(state, "freshness")));
	const auto& fallback = json::member(state, "frozenFallback");
	if (fallback.kind == json::type::null_value) return;
	exact(fallback, {"externalMediaSourceId", "renderedAssetSha256", "frameCount", "freshness"});
	const auto source_id = text(json::member(fallback, "externalMediaSourceId"), "OpenFX fallback source ID");
	if (source_sha_by_id(sources, source_id)
		!= digest(json::member(fallback, "renderedAssetSha256"), "OpenFX fallback digest")) {
		throw json::parse_error("OpenFX fallback does not bind exact external media.");
	}
	if (safe_integer(json::member(fallback, "frameCount"), "OpenFX fallback frame count", 1)
		!= output_frame_count) {
		throw json::parse_error("OpenFX fallback does not bind the exact output frame count.");
	}
	static_cast<void>(validate_freshness(json::member(fallback, "freshness")));
}

} // namespace framescaper::media::unified
