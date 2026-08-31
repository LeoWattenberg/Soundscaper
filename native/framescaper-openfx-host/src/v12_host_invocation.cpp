/* SPDX-License-Identifier: AGPL-3.0-only */

#include "v12_host_invocation.hpp"

#include "media_file_grants.hpp"
#include "media_plan.hpp"
#include "sha256.hpp"
#include "strict_json.hpp"
#include "unified_plan_common.hpp"
#include "v12_retime_authority.hpp"
#include "v12_transition_authority.hpp"
#include "v12_video_timing_grants.hpp"
#include "v12_gpu_support.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <charconv>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <limits>
#include <set>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

namespace framescaper::openfx {
namespace {
namespace json = framescaper::media::json;
constexpr std::uintmax_t kMaximumControlBytes = 64U * 1024U;
constexpr std::uintmax_t kMaximumPlanBytes = 16U * 1024U * 1024U;
constexpr std::int64_t kMaximumSafeInteger = 9'007'199'254'740'991LL;

[[noreturn]] void fail(std::string code, std::string message) {
	throw v12_invocation_error{std::move(code), std::move(message)};
}

[[nodiscard]] std::string read_stable_file(
	const std::filesystem::path& path,
	const std::string& sha256,
	const std::string_view label,
	const std::uintmax_t maximum_bytes
) {
	const auto canonical = framescaper::media::authenticate_regular_file(path, sha256, label, maximum_bytes);
	const auto before_size = std::filesystem::file_size(canonical);
	const auto before_write = std::filesystem::last_write_time(canonical);
	std::ifstream input(canonical, std::ios::binary);
	std::ostringstream bytes;
	bytes << input.rdbuf();
	if (!input.eof() && input.fail()) fail("authentication", std::string{label} + " could not be read.");
	if (std::filesystem::file_size(canonical) != before_size
		|| std::filesystem::last_write_time(canonical) != before_write
		|| framescaper::media::sha256_file(canonical) != sha256) {
		fail("authentication", std::string{label} + " changed across its authenticated read.");
	}
	return bytes.str();
}

void exact(const json::value& value, const std::initializer_list<std::string_view> keys) {
	json::require_exact_keys(value, std::vector<std::string_view>{keys});
}

[[nodiscard]] std::string text(
	const json::value& value,
	const std::string_view label,
	const std::size_t maximum = 4'096
) {
	const auto result = json::string(value, label);
	if (result.empty() || result.size() > maximum || result.find('\0') != std::string_view::npos) {
		fail("admission", std::string{label} + " is not bounded nonempty text.");
	}
	return std::string{result};
}

[[nodiscard]] std::string digest(const json::value& value, const std::string_view label) {
	const auto result = text(value, label, 64);
	if (!valid_digest(result)) fail("admission", std::string{label} + " is not lowercase SHA-256.");
	return result;
}

[[nodiscard]] std::int64_t safe_integer(
	const json::value& value,
	const std::string_view label,
	const std::int64_t minimum = 0
) {
	const auto result = json::integer(value, label);
	if (result < minimum || result > kMaximumSafeInteger) {
		fail("admission", std::string{label} + " is outside its safe integer domain.");
	}
	return result;
}

[[nodiscard]] bool valid_graph_id(const std::string_view value) {
	return !value.empty() && value.size() <= 4'096 && std::all_of(value.begin(), value.end(), [](const unsigned char byte) {
		return std::isalnum(byte) != 0 || byte == ' ' || byte == '.' || byte == '_'
			|| byte == ':' || byte == '/' || byte == '-';
	});
}

[[nodiscard]] std::string id(
	const json::value& value,
	const std::string_view label,
	const bool graph = false
) {
	const auto result = text(value, label, graph ? 4'096 : 128);
	if (!(graph ? valid_graph_id(result) : valid_plugin_id(result))) {
		fail("admission", std::string{label} + " is not a canonical identity.");
	}
	return result;
}

[[nodiscard]] std::filesystem::path absolute_path(
	const json::value& value,
	const std::string_view label
) {
	const std::filesystem::path result{text(value, label, 32'768)};
	if (!result.is_absolute() || result != result.lexically_normal()) {
		fail("admission", std::string{label} + " is not an exact normalized absolute path.");
	}
	return result;
}

[[nodiscard]] bool valid_parameter_name(const std::string_view value) {
	return !value.empty() && value.size() <= 64
		&& (std::isalpha(static_cast<unsigned char>(value.front())) != 0 || value.front() == '_')
		&& std::all_of(value.begin() + 1, value.end(), [](const unsigned char byte) {
			return std::isalnum(byte) != 0 || byte == '_';
		});
}

[[nodiscard]] double finite_number(const json::value& value, const std::string_view label) {
	if (value.kind != json::type::number || value.text == "-0") {
		fail("admission", std::string{label} + " is not a canonical finite number.");
	}
	double output = 0;
	const auto [end, error] = std::from_chars(
		value.text.data(), value.text.data() + value.text.size(), output
	);
	if (error != std::errc{} || end != value.text.data() + value.text.size() || !std::isfinite(output)) {
		fail("admission", std::string{label} + " is not a representable finite OFX value.");
	}
	return output;
}

[[nodiscard]] int native_integer(const json::value& value, const std::string_view label) {
	if (value.kind != json::type::number) {
		fail("admission", std::string{label} + " is not an integer component.");
	}
	std::int64_t output = 0;
	const auto [end, error] = std::from_chars(
		value.text.data(), value.text.data() + value.text.size(), output
	);
	if (error != std::errc{} || end != value.text.data() + value.text.size()
		|| output < std::numeric_limits<int>::min() || output > std::numeric_limits<int>::max()) {
		fail("admission", std::string{label} + " is not a representable signed OFX integer component.");
	}
	return static_cast<int>(output);
}

[[nodiscard]] const char* native_parameter_type(const std::string_view type) {
	if (type == "integer") return kOfxParamTypeInteger;
	if (type == "integer2d") return kOfxParamTypeInteger2D;
	if (type == "integer3d") return kOfxParamTypeInteger3D;
	if (type == "double") return kOfxParamTypeDouble;
	if (type == "double2d") return kOfxParamTypeDouble2D;
	if (type == "double3d") return kOfxParamTypeDouble3D;
	if (type == "rgb") return kOfxParamTypeRGB;
	if (type == "rgba") return kOfxParamTypeRGBA;
	if (type == "boolean") return kOfxParamTypeBoolean;
	if (type == "choice") return kOfxParamTypeChoice;
	if (type == "string") return kOfxParamTypeString;
	if (type == "group") return kOfxParamTypeGroup;
	if (type == "page") return kOfxParamTypePage;
	if (type == "pushbutton") return kOfxParamTypePushButton;
	if (type == "parametric") return kOfxParamTypeParametric;
	if (type == "custom") return kOfxParamTypeCustom;
	fail("admission", "The persisted OpenFX parameter type is unsupported by the pinned ABI.");
}

[[nodiscard]] std::size_t component_count(const std::string_view type) {
	if (type == "double" || type == "integer" || type == "boolean" || type == "choice") return 1;
	if (type == "integer2d" || type == "double2d") return 2;
	if (type == "integer3d" || type == "double3d" || type == "rgb") return 3;
	if (type == "rgba") return 4;
	return 0;
}
[[nodiscard]] HydratedParameterState parameter_state(
	const json::value& value,
	const Context context,
	std::size_t& total_keys
) {
	exact(value, {"name", "type", "value", "keyframes"});
	HydratedParameterState output;
	output.name = text(json::member(value, "name"), "OpenFX parameter name", 64);
	if (!valid_parameter_name(output.name)) fail("admission", "The OpenFX parameter name is not canonical.");
	if ((context == Context::retimer && output.name == "SourceTime")
		|| (context == Context::transition && output.name == "Transition")) {
		fail("admission", "Persisted state cannot override a host-owned OpenFX standard parameter.");
	}
	const auto type = text(json::member(value, "type"), "OpenFX parameter type", 32);
	output.wire_type = type; output.ofx_type = native_parameter_type(type);
	if (!initialize_parameter_values(output.values, output.ofx_type)) {
		fail("admission", "The native host cannot initialize the persisted OpenFX parameter type.");
	}
	const auto& current = json::member(value, "value");
	if (type == "boolean") {
		output.values.current = std::vector<int>{json::boolean(current, "OFX boolean value") ? 1 : 0};
	} else if (type == "integer" || type == "choice") {
		output.values.current = std::vector<int>{native_integer(current, "OFX integer value")};
	} else if (type == "integer2d" || type == "integer3d") {
		const auto& components = json::array(current, "OFX integer components");
		if (components.size() != component_count(type)) fail("admission", "The OFX integer component count is inexact.");
		std::vector<int> parsed; parsed.reserve(components.size());
		for (const auto& component : components) parsed.push_back(native_integer(component, "OFX integer component"));
		output.values.current = std::move(parsed);
	} else if (type == "double" || type == "double2d" || type == "double3d"
		|| type == "rgb" || type == "rgba") {
		const auto& components = json::array(current, "OFX real components");
		if (components.size() != component_count(type)) fail("admission", "The OFX real component count is inexact.");
		std::vector<double> parsed; parsed.reserve(components.size());
		for (const auto& component : components) parsed.push_back(finite_number(component, "OFX real component"));
		output.values.current = std::move(parsed);
	} else if (type == "string" || type == "custom") {
		if (current.kind != json::type::string
			|| current.text.size() > (type == "custom" ? 65'536U : 4'096U)) {
			fail("admission", "The persisted OFX UTF-8 string exceeds its native byte ceiling.");
		}
		output.values.current = current.text;
	} else if (type == "parametric") {
		const auto& points = json::array(current, "OFX parametric points");
		std::vector<ParametricPoint> parsed; parsed.reserve(points.size());
		double previous = -std::numeric_limits<double>::infinity();
		for (const auto& point : points) {
			const auto& pair = json::array(point, "OFX parametric point");
			if (pair.size() != 2) fail("admission", "An OFX parametric point is malformed.");
			const auto key = finite_number(pair[0], "OFX parametric key");
			const auto item = finite_number(pair[1], "OFX parametric value");
			if (key <= previous) fail("admission", "OFX parametric keys must be strictly ordered and unique.");
			previous = key; parsed.push_back({key, item});
		}
		output.values.curves[0][0] = std::move(parsed);
	} else if (current.kind != json::type::null_value) {
		fail("admission", "A valueless OFX parameter cannot be hydrated from state.");
	}
	const auto& keys = json::array(json::member(value, "keyframes"), "OFX parameter keyframes");
	if (!keys.empty() && type != "integer" && type != "choice"
		&& type != "boolean" && type != "double") {
		fail("admission", "The persisted OFX keyframe wire represents only scalar parameter values.");
	}
	if (total_keys > 65'536U - keys.size()) fail("admission", "The native OFX instance keyframe ceiling is exceeded.");
	total_keys += keys.size(); output.keyframe_count = keys.size();
	for (const auto& key : keys) {
		exact(key, {"frame", "value"});
		const auto frame = safe_integer(json::member(key, "frame"), "OFX keyframe frame");
		ParameterSnapshot snapshot;
		if (type == "double") snapshot = std::vector<double>{finite_number(json::member(key, "value"), "OFX keyframe value")};
		else {
			const auto item = native_integer(json::member(key, "value"), "OFX keyframe value");
			if (type == "boolean" && item != 0 && item != 1) fail("admission", "An OFX boolean keyframe is outside its ABI domain.");
			snapshot = std::vector<int>{item};
		}
		if (!output.values.keys.emplace(static_cast<double>(frame), std::move(snapshot)).second) {
			fail("admission", "An OFX keyframe time is duplicated.");
		}
	}
	return output;
}

[[nodiscard]] std::vector<HydratedParameterState> parameter_states(
	const json::value& state,
	const Context context
) {
	const auto& values = json::array(json::member(state, "parameters"), "OpenFX parameters");
	std::vector<HydratedParameterState> output; output.reserve(values.size());
	std::set<std::string> names; std::size_t total_keys = 0;
	for (const auto& value : values) {
		auto parameter = parameter_state(value, context, total_keys);
		if (!names.insert(parameter.name).second) fail("admission", "An OpenFX parameter name is duplicated.");
		output.push_back(std::move(parameter));
	}
	return output;
}

[[nodiscard]] const json::value& selected_effect(
	const json::value& plan,
	const std::string_view node_id
) {
	const json::value* selected = nullptr;
	for (const auto& node : json::array(json::member(plan, "nodes"), "V12 nodes")) {
		if (json::string(json::member(node, "kind"), "node kind") != "openfx") continue;
		if (json::string(json::member(node, "nodeId"), "node ID") != node_id) continue;
		if (selected != nullptr) fail("identity-mismatch", "The V12 invocation node is ambiguous.");
		selected = &node;
	}
	if (selected == nullptr) fail("identity-mismatch", "The V12 invocation node is absent from the plan.");
	return *selected;
}

struct ParsedInvocation final {
	std::string invocation_id;
	std::string plan_sha256;
	int plan_version{};
	std::string node_id;
	std::string instance_id;
	std::string plugin_id;
	std::string binary_sha256;
	std::string state_sha256;
	Context context{};
	Backend backend{};
	std::string abort_signal_id;
	std::vector<std::string> input_stream_ids;
	std::string output_stream_id;
	std::uint64_t output_ordinal{};
	const json::value* source_time{};
};

[[nodiscard]] ParsedInvocation invocation(const json::value& value) {
	exact(value, {
		"schemaVersion", "invocationId", "unifiedPlanVersion", "unifiedPlanSha256",
		"nodeId", "instanceId", "pluginId", "pluginBinarySha256", "pluginFingerprint",
		"context", "action", "stateSha256", "inputFrameStreamIds", "outputFrameStreamId",
		"outputOrdinal", "requestedBackend", "abortSignalId", "retimerSourceTime",
	});
	const auto schema_version = safe_integer(json::member(value, "schemaVersion"), "invocation schema");
	const auto plan_version = safe_integer(json::member(value, "unifiedPlanVersion"), "plan version");
	if (!((schema_version == 1 && plan_version == 12)
		|| (schema_version == 2 && plan_version == 14))) {
		fail("admission", "The OpenFX invocation requires exact V1/V12 or V2/V14 dispatch.");
	}
	ParsedInvocation result;
	result.plan_version = static_cast<int>(plan_version);
	result.invocation_id = id(json::member(value, "invocationId"), "invocation ID");
	result.plan_sha256 = digest(json::member(value, "unifiedPlanSha256"), "plan digest");
	result.node_id = id(json::member(value, "nodeId"), "node ID", true);
	result.instance_id = id(json::member(value, "instanceId"), "instance ID");
	result.plugin_id = id(json::member(value, "pluginId"), "plug-in ID");
	result.binary_sha256 = digest(json::member(value, "pluginBinarySha256"), "plug-in digest");
	if (text(json::member(value, "pluginFingerprint"), "plug-in fingerprint")
		!= result.plugin_id + '@' + result.binary_sha256) {
		fail("identity-mismatch", "The OpenFX fingerprint does not bind its plug-in binary.");
	}
	const auto context = parse_context(json::string(json::member(value, "context"), "OpenFX context"));
	const auto backend = parse_backend(json::string(json::member(value, "requestedBackend"), "render backend"));
	if (!context.has_value() || !backend.has_value()
		|| json::string(json::member(value, "action"), "OpenFX action") != "render") {
		fail("admission", "The native V12 seam admits only a known context and render action.");
	}
	result.context = *context;
	result.backend = *backend;
	result.state_sha256 = digest(json::member(value, "stateSha256"), "state digest");
	const auto& stream_ids = json::array(json::member(value, "inputFrameStreamIds"), "input stream IDs");
	if (stream_ids.size() > 16) fail("admission", "The OpenFX input stream ceiling is exceeded.");
	std::set<std::string> unique;
	for (const auto& stream : stream_ids) {
		auto stream_id = id(stream, "input stream ID");
		if (!unique.insert(stream_id).second) fail("admission", "An OpenFX input stream ID is duplicated.");
		result.input_stream_ids.push_back(std::move(stream_id));
	}
	const auto& output = json::member(value, "outputFrameStreamId");
	if (output.kind != json::type::string) fail("admission", "A render invocation requires one output stream.");
	result.output_stream_id = id(output, "output stream ID");
	if (!unique.insert(result.output_stream_id).second) fail("admission", "The output stream aliases an input.");
	result.output_ordinal = static_cast<std::uint64_t>(safe_integer(
		json::member(value, "outputOrdinal"), "output ordinal"
	));
	result.abort_signal_id = id(json::member(value, "abortSignalId"), "abort signal ID");
	const auto& source_time = json::member(value, "retimerSourceTime");
	result.source_time = source_time.kind == json::type::null_value ? nullptr : &source_time;
	if ((*context == Context::retimer) != (result.source_time != nullptr)) {
		fail("identity-mismatch", "Only a Retimer invocation must carry exact SourceTime.");
	}
	return result;
}

[[nodiscard]] RgbaFrameLayout rgba_layout(
	const json::value& value,
	const std::string_view label
) {
	if (json::string(json::member(value, "pixelFormat"), "RGBA pixel format") != "rgba8") {
		fail("admission", std::string{label} + " pixel format is unsupported.");
	}
	const RgbaFrameLayout layout{
		static_cast<std::size_t>(safe_integer(json::member(value, "width"), "RGBA width", 1)),
		static_cast<std::size_t>(safe_integer(json::member(value, "height"), "RGBA height", 1)),
		static_cast<std::size_t>(safe_integer(json::member(value, "rowBytes"), "RGBA row bytes", 1)),
		static_cast<std::size_t>(safe_integer(json::member(value, "byteLength"), "RGBA byte length", 1)),
	};
	if (!valid_rgba_frame_layout(layout)) {
		fail("admission", std::string{label} + " dimensions, row bytes, or byte length are unsupported.");
	}
	return layout;
}

[[nodiscard]] RgbaFrame authenticated_rgba(
	const json::value& value,
	const std::string& expected_stream_id,
	const std::filesystem::path& expected_directory
) {
	exact(value, {
		"name", "sourceRef", "streamId", "path", "pixelFormat", "width", "height",
		"rowBytes", "byteLength", "sha256",
	});
	if (id(json::member(value, "streamId"), "input stream ID") != expected_stream_id) {
		fail("identity-mismatch", "A named input does not bind its invocation stream.");
	}
	const auto layout = rgba_layout(value, "OpenFX input frame");
	const auto sha256 = digest(json::member(value, "sha256"), "input digest");
	const auto path = absolute_path(json::member(value, "path"), "input path");
	if (path.parent_path() != expected_directory) {
		fail("identity-mismatch", "An OpenFX input frame escaped its authenticated scratch reservation.");
	}
	const auto bytes = read_stable_file(
		path, sha256, "OpenFX input frame", kMaximumRgbaFrameBytes
	);
	if (bytes.size() != layout.byte_length) fail("authentication", "The OpenFX input frame length changed.");
	return {layout, std::vector<unsigned char>{bytes.begin(), bytes.end()}};
}

} // namespace

V12HostInvocation authenticate_v12_host_invocation(
	const std::filesystem::path& grant_path,
	const std::string& grant_sha256
) {
	try {
		const auto grant_directory = grant_path.lexically_normal().parent_path();
		const auto grant_bytes = read_stable_file(
			grant_path, grant_sha256, "OpenFX V12 grant", kMaximumControlBytes
		);
		const auto grant = json::parse(grant_bytes);
		std::string canonical_grant;
		framescaper::media::unified::append_canonical_json(canonical_grant, grant);
		if (canonical_grant != grant_bytes) fail("admission", "The OpenFX V12 grant bytes are not canonical JSON.");
		const auto* timing_value = json::optional_member(grant, "videoTimingAssets");
		exact(grant, timing_value == nullptr
			? std::initializer_list<std::string_view>{"schemaVersion", "supportedBackends", "pluginBinary", "invocation", "plan", "inputs", "output"}
			: std::initializer_list<std::string_view>{"schemaVersion", "supportedBackends", "pluginBinary", "invocation", "plan", "videoTimingAssets", "inputs", "output"});
		if (safe_integer(json::member(grant, "schemaVersion"), "grant schema", 1) != 1) {
			fail("admission", "The OpenFX V12 grant schema is unsupported.");
		}
		const auto& plugin = json::member(grant, "pluginBinary");
		exact(plugin, {"path", "sha256", "pluginIndex"});
		V12HostInvocation result;
		result.supported_backends = authenticate_v12_gpu_support(json::member(grant, "supportedBackends"));
		result.plugin_binary = absolute_path(json::member(plugin, "path"), "plug-in path");
		result.plugin_binary_sha256 = digest(json::member(plugin, "sha256"), "plug-in digest");
		result.plugin_index = static_cast<int>(safe_integer(json::member(plugin, "pluginIndex"), "plug-in index"));
		if (result.plugin_index > 255) fail("admission", "The OpenFX plug-in index exceeds its ceiling.");

		const auto parsed = invocation(json::member(grant, "invocation"));
		result.invocation_id = parsed.invocation_id;
		result.plan_sha256 = parsed.plan_sha256;
		result.plan_version = parsed.plan_version;
		result.node_id = parsed.node_id;
		result.instance_id = parsed.instance_id;
		result.plugin_id = parsed.plugin_id;
		result.state_sha256 = parsed.state_sha256;
		result.context = parsed.context;
		result.requested_backend = parsed.backend;
		result.abort_signal_id = parsed.abort_signal_id;
		result.output_ordinal = parsed.output_ordinal;
		if (result.plugin_binary_sha256 != parsed.binary_sha256) {
			fail("identity-mismatch", "The staged plug-in binary does not match its invocation.");
		}

		const auto& plan_binding = json::member(grant, "plan");
		exact(plan_binding, {"path", "byteLength", "sha256"});
		const auto plan_path = absolute_path(json::member(plan_binding, "path"), "plan path");
		if (plan_path.parent_path() != grant_directory) {
			fail("identity-mismatch", "The OpenFX V12 plan escaped its authenticated scratch reservation.");
		}
		const auto plan_sha256 = digest(json::member(plan_binding, "sha256"), "plan digest");
		const auto plan_length = safe_integer(json::member(plan_binding, "byteLength"), "plan byte length", 1);
		if (plan_sha256 != parsed.plan_sha256) fail("identity-mismatch", "The staged plan does not match its invocation.");
		const auto timing = parse_v12_video_timing_grants(
			timing_value, grant_directory,
			{grant_path.lexically_normal(), result.plugin_binary, plan_path}
		);
		const auto admitted = framescaper::media::authenticate_media_plan(
			plan_path, plan_sha256, timing.grants
		);
		if (admitted.version != parsed.plan_version) fail("admission", "The OpenFX plan version changed after exact invocation dispatch.");
		if (parsed.output_ordinal >= admitted.output_frame_count) {
			fail("admission", "The OpenFX output ordinal is outside the exact V12 output frame range.");
		}
		const auto plan_bytes = read_stable_file(plan_path, plan_sha256, "OpenFX V12 plan", kMaximumPlanBytes);
		if (static_cast<std::int64_t>(plan_bytes.size()) != plan_length) {
			fail("authentication", "The OpenFX V12 plan byte length changed.");
		}
		const auto plan = json::parse(plan_bytes);
		std::string canonical_plan;
		framescaper::media::unified::append_canonical_json(canonical_plan, plan);
		if (canonical_plan != plan_bytes) fail("authentication", "The V12 plan bytes are not canonical.");

		const auto& effect = selected_effect(plan, parsed.node_id);
		const auto& state = json::member(effect, "state");
		if (framescaper::media::unified::semantic_sha256(state) != parsed.state_sha256
			|| json::string(json::member(state, "instanceId"), "state instance ID") != parsed.instance_id
			|| json::string(json::member(state, "pluginId"), "state plug-in ID") != parsed.plugin_id
			|| json::string(json::member(state, "binarySha256"), "state binary digest") != parsed.binary_sha256
			|| parse_context(json::string(json::member(state, "context"), "state context")) != parsed.context) {
			fail("identity-mismatch", "The invocation does not bind its exact V12 OpenFX state.");
		}
		if (!json::boolean(json::member(state, "enabled"), "state enabled")) {
			fail("unsupported-render", "A bypassed OpenFX state cannot execute.");
		}
		result.parameters = parameter_states(state, parsed.context);

		const auto& inputs = json::array(json::member(grant, "inputs"), "named input grants");
		const auto& state_inputs = json::array(json::member(state, "inputs"), "state named inputs");
		if (inputs.size() != state_inputs.size() || inputs.size() != parsed.input_stream_ids.size()) {
			fail("identity-mismatch", "The named input count does not bind the V12 state and invocation.");
		}
		std::set<std::string> input_names;
		std::set<std::filesystem::path> input_paths;
		for (std::size_t index = 0; index < inputs.size(); ++index) {
			const auto name = id(json::member(inputs[index], "name"), "input name");
			const auto source_ref = id(json::member(inputs[index], "sourceRef"), "input source reference", true);
			const auto input_path = absolute_path(json::member(inputs[index], "path"), "input path");
			if (!input_names.insert(name).second
				|| !input_paths.insert(input_path).second
				|| timing.paths.contains(input_path)
				|| name != json::string(json::member(state_inputs[index], "name"), "state input name")
				|| source_ref != json::string(json::member(state_inputs[index], "sourceRef"), "state input reference")) {
				fail("identity-mismatch", "A named input does not bind its V12 state identity.");
			}
			result.inputs.push_back({
				name, source_ref, parsed.input_stream_ids[index],
				authenticated_rgba(inputs[index], parsed.input_stream_ids[index], grant_directory),
			});
		}

		const auto& output = json::member(grant, "output");
		exact(output, {
			"streamId", "path", "pixelFormat", "width", "height", "rowBytes",
			"byteLength",
		});
		result.output_stream_id = id(json::member(output, "streamId"), "output stream ID");
		result.output_path = absolute_path(json::member(output, "path"), "output path");
		if (result.output_path.parent_path() != grant_directory) {
			fail("identity-mismatch", "The OpenFX output frame escaped its authenticated scratch reservation.");
		}
		if (input_paths.contains(result.output_path) || timing.paths.contains(result.output_path)
			|| result.output_path == plan_path
			|| result.output_path == grant_path.lexically_normal()) {
			fail("identity-mismatch", "The OpenFX output frame aliases authenticated input authority.");
		}
		result.output_layout = rgba_layout(output, "OpenFX output frame");
		if (result.output_stream_id != parsed.output_stream_id) {
			fail("identity-mismatch", "The output grant does not bind the invocation stream.");
		}
		std::size_t resident_bytes = result.output_layout.byte_length;
		for (const auto& input : result.inputs) {
			if (input.frame.layout.byte_length > kMaximumRgbaFrameSetBytes - resident_bytes) {
				fail("admission", "The OpenFX invocation exceeds its resident RGBA frame-set bound.");
			}
			resident_bytes += input.frame.layout.byte_length;
		}

		const auto& attachment = json::member(state, "attachment");
		if (parsed.context == Context::retimer) {
			if (safe_integer(json::member(*parsed.source_time, "outputOrdinal"), "SourceTime ordinal")
				!= static_cast<std::int64_t>(parsed.output_ordinal)) {
				fail("source-time-mismatch", "Retimer SourceTime does not bind the invocation output ordinal.");
			}
			if (json::string(json::member(attachment, "targetId"), "Retimer target")
				!= json::string(json::member(*parsed.source_time, "clipId"), "SourceTime clip")) {
				fail("identity-mismatch", "Retimer SourceTime does not bind its attachment clip.");
			}
			result.host_standard_parameter_value = verified_v12_retimer_source_time(
				plan, *parsed.source_time, timing.grants
			);
			result.source_time_verified = true;
		} else if (parsed.context == Context::transition) {
			result.host_standard_parameter_value = verified_v12_transition_value(
				plan,
				json::string(json::member(attachment, "targetId"), "Transition target"),
				parsed.output_ordinal
			);
			result.transition_value_verified = true;
		}
		return result;
	} catch (const v12_invocation_error&) {
		throw;
	} catch (const framescaper::media::authentication_error& error) {
		fail("authentication", error.what());
	} catch (const framescaper::media::grant_error& error) {
		fail("admission", error.what());
	} catch (const json::parse_error& error) {
		fail("admission", error.what());
	} catch (const std::exception& error) {
		fail("admission", error.what());
	}
}

} // namespace framescaper::openfx
