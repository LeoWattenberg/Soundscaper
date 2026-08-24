/* SPDX-License-Identifier: AGPL-3.0-only */

#include "interact_v1_invocation.hpp"
#include "sha256.hpp"

#include "../../framescaper-media-host/src/media_file_grants.hpp"
#include "../../framescaper-media-host/src/strict_json.hpp"

#include <algorithm>
#include <charconv>
#include <cctype>
#include <cmath>
#include <fstream>
#include <limits>
#include <set>
#include <sstream>
#include <string_view>

namespace framescaper::openfx {
namespace {
namespace json = framescaper::media::json;
constexpr std::uintmax_t kMaximumGrantBytes = 16U * 1024U * 1024U;
constexpr std::int64_t kMaximumSafeInteger = 9'007'199'254'740'991LL;

[[noreturn]] void fail(std::string code, std::string message) {
	throw interact_invocation_error{std::move(code), std::move(message)};
}

void exact(const json::value& value, const std::initializer_list<std::string_view> keys) {
	json::require_exact_keys(value, std::vector<std::string_view>{keys});
}

[[nodiscard]] std::string text(
	const json::value& value,
	const std::string_view label,
	const std::size_t maximum
) {
	const auto output = json::string(value, label);
	if (output.empty() || output.size() > maximum || output.find('\0') != std::string_view::npos) {
		fail("admission", std::string{label} + " is not bounded nonempty text.");
	}
	return std::string{output};
}

[[nodiscard]] std::int64_t safe_integer(const json::value& value, const std::string_view label) {
	const auto output = json::integer(value, label);
	if (output < 0 || output > kMaximumSafeInteger) {
		fail("admission", std::string{label} + " is outside its safe integer domain.");
	}
	return output;
}

[[nodiscard]] double normalized(const json::value& value, const std::string_view label) {
	if (value.kind != json::type::number) fail("admission", std::string{label} + " must be numeric.");
	double output = 0;
	try { output = std::stod(value.text); }
	catch (...) { fail("admission", std::string{label} + " must be representable."); }
	if (!std::isfinite(output) || output < 0 || output > 1) {
		fail("admission", std::string{label} + " must be normalized.");
	}
	return output;
}

[[nodiscard]] std::string digest(const json::value& value, const std::string_view label) {
	const auto output = text(value, label, 64);
	if (output.size() != 64 || !std::all_of(output.begin(), output.end(), [](const unsigned char byte) {
		return std::isdigit(byte) != 0 || (byte >= 'a' && byte <= 'f');
	})) fail("admission", std::string{label} + " is not lowercase SHA-256.");
	return output;
}

[[nodiscard]] double finite_number(const json::value& value, const std::string_view label) {
	if (value.kind != json::type::number) fail("admission", std::string{label} + " must be numeric.");
	double output = 0;
	const auto [end, error] = std::from_chars(
		value.text.data(), value.text.data() + value.text.size(), output
	);
	if (error != std::errc{} || end != value.text.data() + value.text.size()
		|| !std::isfinite(output)) {
		fail("admission", std::string{label} + " must be one finite OFX number.");
	}
	return output;
}

[[nodiscard]] int native_integer(const json::value& value, const std::string_view label) {
	if (value.kind != json::type::number) fail("admission", std::string{label} + " must be an integer.");
	std::int64_t output = 0;
	const auto [end, error] = std::from_chars(
		value.text.data(), value.text.data() + value.text.size(), output
	);
	if (error != std::errc{} || end != value.text.data() + value.text.size()
		|| output < std::numeric_limits<int>::min() || output > std::numeric_limits<int>::max()) {
		fail("admission", std::string{label} + " exceeds the signed OFX integer domain.");
	}
	return static_cast<int>(output);
}

[[nodiscard]] bool valid_parameter_name(const std::string_view value) {
	return !value.empty() && value.size() <= 64
		&& (std::isalpha(static_cast<unsigned char>(value.front())) != 0 || value.front() == '_')
		&& std::all_of(value.begin() + 1, value.end(), [](const unsigned char byte) {
			return std::isalnum(byte) != 0 || byte == '_';
		});
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
	fail("admission", "The authored OpenFX parameter type is unsupported.");
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
		fail("admission", "Authored state cannot override a host-owned OpenFX standard parameter.");
	}
	output.wire_type = text(json::member(value, "type"), "OpenFX parameter type", 32);
	output.ofx_type = native_parameter_type(output.wire_type);
	if (!initialize_parameter_values(output.values, output.ofx_type)) {
		fail("admission", "The native host cannot initialize the authored OpenFX parameter type.");
	}
	const auto& current = json::member(value, "value");
	const auto type = std::string_view{output.wire_type};
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
			fail("admission", "The authored OFX UTF-8 string exceeds its byte ceiling.");
		}
		output.values.current = current.text;
	} else if (type == "parametric") {
		const auto& points = json::array(current, "OFX parametric points");
		if (points.size() > 8'192U) fail("admission", "The OFX parametric point ceiling is exceeded.");
		std::vector<ParametricPoint> parsed; parsed.reserve(points.size());
		double previous = -std::numeric_limits<double>::infinity();
		for (const auto& point : points) {
			const auto& pair = json::array(point, "OFX parametric point");
			if (pair.size() != 2) fail("admission", "An OFX parametric point is malformed.");
			const auto key = finite_number(pair[0], "OFX parametric key");
			const auto item = finite_number(pair[1], "OFX parametric value");
			if (key <= previous) fail("admission", "OFX parametric keys must be strictly ordered.");
			previous = key; parsed.push_back({key, item});
		}
		output.values.curves[0][0] = std::move(parsed);
	} else if (current.kind != json::type::null_value) {
		fail("admission", "A valueless OFX parameter cannot carry authored state.");
	}
	const auto& keys = json::array(json::member(value, "keyframes"), "OFX parameter keyframes");
	if (keys.size() > 8'192U || total_keys > 65'536U - keys.size()) {
		fail("admission", "The native OFX Interact keyframe ceiling is exceeded.");
	}
	if (!keys.empty() && type != "integer" && type != "choice"
		&& type != "boolean" && type != "double") {
		fail("admission", "The authored OFX keyframe wire represents only scalar values.");
	}
	total_keys += keys.size(); output.keyframe_count = keys.size();
	for (const auto& key : keys) {
		exact(key, {"frame", "value"});
		const auto frame = safe_integer(json::member(key, "frame"), "OFX keyframe frame");
		ParameterSnapshot snapshot;
		if (type == "double") {
			snapshot = std::vector<double>{finite_number(json::member(key, "value"), "OFX keyframe value")};
		} else {
			const auto item = native_integer(json::member(key, "value"), "OFX keyframe value");
			if (type == "boolean" && item != 0 && item != 1) fail("admission", "An OFX boolean keyframe is invalid.");
			snapshot = std::vector<int>{item};
		}
		if (!output.values.keys.emplace(static_cast<double>(frame), std::move(snapshot)).second) {
			fail("admission", "An OFX keyframe time is duplicated.");
		}
	}
	return output;
}

[[nodiscard]] std::vector<HydratedParameterState> parameter_states(
	const json::value& value,
	const Context context
) {
	const auto& list = json::array(value, "OpenFX Interact parameters");
	if (list.size() > 4'096U) fail("admission", "The OpenFX Interact parameter ceiling is exceeded.");
	std::vector<HydratedParameterState> output; output.reserve(list.size());
	std::set<std::string> names; std::size_t total_keys = 0;
	for (const auto& entry : list) {
		auto parsed = parameter_state(entry, context, total_keys);
		if (!names.insert(parsed.name).second) fail("admission", "An OpenFX Interact parameter is duplicated.");
		output.push_back(std::move(parsed));
	}
	return output;
}

[[nodiscard]] std::filesystem::path absolute_path(
	const json::value& value,
	const std::string_view label
) {
	const std::filesystem::path output{text(value, label, 32'768)};
	if (!output.is_absolute() || output != output.lexically_normal()) {
		fail("admission", std::string{label} + " must be one normalized absolute path.");
	}
	return output;
}

[[nodiscard]] bool inside(const std::filesystem::path& root, const std::filesystem::path& value) {
	const auto relative = value.lexically_relative(root);
	return !relative.empty() && !relative.is_absolute()
		&& relative.native() != "."
		&& *relative.begin() != "..";
}

[[nodiscard]] std::vector<std::string> modifiers(const json::value& value) {
	const auto& list = json::array(value, "Interact modifiers");
	if (list.size() > 4) fail("admission", "The Interact modifier list is oversized.");
	std::vector<std::string> output;
	for (const auto& item : list) {
		auto modifier = text(item, "Interact modifier", 7);
		if (modifier != "alt" && modifier != "control" && modifier != "meta" && modifier != "shift") {
			fail("admission", "An Interact modifier is unsupported.");
		}
		if (!output.empty() && output.back() >= modifier) {
			fail("admission", "Interact modifiers must be sorted and unique.");
		}
		output.push_back(std::move(modifier));
	}
	return output;
}

[[nodiscard]] InteractEvent event(const json::value& value) {
	const auto kind = text(json::member(value, "kind"), "Interact event kind", 8);
	InteractEvent output;
	output.kind = kind;
	output.sequence = static_cast<std::uint64_t>(safe_integer(
		json::member(value, "sequence"), "Interact event sequence"
	));
	if (kind == "pointer") {
		exact(value, {"kind", "phase", "sequence", "x", "y", "button", "modifiers"});
		output.phase = text(json::member(value, "phase"), "pointer phase", 6);
		if (output.phase != "motion" && output.phase != "down" && output.phase != "up") {
			fail("admission", "An Interact pointer phase is unsupported.");
		}
		output.x = normalized(json::member(value, "x"), "pointer x");
		output.y = normalized(json::member(value, "y"), "pointer y");
		output.button = static_cast<int>(safe_integer(json::member(value, "button"), "pointer button"));
		if (output.button > 7) fail("admission", "An Interact pointer button is unsupported.");
		output.modifiers = modifiers(json::member(value, "modifiers"));
	} else if (kind == "keyboard") {
		exact(value, {"kind", "phase", "sequence", "key", "code", "modifiers"});
		output.phase = text(json::member(value, "phase"), "keyboard phase", 4);
		if (output.phase != "down" && output.phase != "up") {
			fail("admission", "An Interact keyboard phase is unsupported.");
		}
		output.key = text(json::member(value, "key"), "keyboard key", 64);
		output.code = text(json::member(value, "code"), "keyboard code", 64);
		output.modifiers = modifiers(json::member(value, "modifiers"));
	} else if (kind == "focus") {
		exact(value, {"kind", "sequence", "focused"});
		output.focused = json::boolean(json::member(value, "focused"), "Interact focus");
	} else fail("admission", "An Interact event kind is unsupported.");
	return output;
}

[[nodiscard]] std::string stable_file(
	const std::filesystem::path& path,
	const std::string& sha256
) {
	const auto canonical = framescaper::media::authenticate_regular_file(
		path, sha256, "OpenFX Interact grant", kMaximumGrantBytes
	);
	const auto before_size = std::filesystem::file_size(canonical);
	const auto before_write = std::filesystem::last_write_time(canonical);
	std::ifstream stream{canonical, std::ios::binary};
	std::ostringstream bytes;
	bytes << stream.rdbuf();
	if ((!stream.eof() && stream.fail()) || std::filesystem::file_size(canonical) != before_size
		|| std::filesystem::last_write_time(canonical) != before_write
		|| sha256_file(canonical) != sha256) {
		fail("authentication", "The OpenFX Interact grant changed across its authenticated read.");
	}
	return bytes.str();
}
} // namespace

InteractHostInvocation authenticate_interact_v1_invocation(
	const std::filesystem::path& grant_path,
	const std::string& grant_sha256
) {
	try {
		const auto normalized_grant = grant_path.lexically_normal();
		const auto grant = json::parse(stable_file(normalized_grant, grant_sha256));
		exact(grant, {
			"schemaVersion", "pluginBinary", "project", "instanceId", "effectStateSha256",
			"context", "target", "parameterName", "parameters", "events",
		});
		if (safe_integer(json::member(grant, "schemaVersion"), "Interact grant schema") != 1) {
			fail("admission", "The OpenFX Interact grant schema is unsupported.");
		}
		const auto& binary = json::member(grant, "pluginBinary");
		exact(binary, {"path", "sha256", "pluginIndex", "pluginId"});
		InteractHostInvocation output;
		output.plugin_binary = absolute_path(json::member(binary, "path"), "plug-in path");
		if (!inside(normalized_grant.parent_path(), output.plugin_binary)) {
			fail("identity-mismatch", "The OpenFX Interact plug-in escaped its scratch reservation.");
		}
		output.plugin_binary_sha256 = digest(json::member(binary, "sha256"), "plug-in digest");
		output.plugin_index = static_cast<int>(safe_integer(json::member(binary, "pluginIndex"), "plug-in index"));
		if (output.plugin_index > 255) fail("admission", "The plug-in index exceeds its ceiling.");
		output.plugin_id = text(json::member(binary, "pluginId"), "plug-in ID", 128);
		if (!valid_plugin_id(output.plugin_id)) fail("admission", "The plug-in ID is not canonical.");
		const auto& project = json::member(grant, "project");
		exact(project, {"id", "revision"});
		output.request.project_id = text(json::member(project, "id"), "project ID", 128);
		if (!valid_plugin_id(output.request.project_id)) fail("admission", "The project ID is not canonical.");
		output.request.project_revision = static_cast<std::uint64_t>(safe_integer(
			json::member(project, "revision"), "project revision"
		));
		output.request.instance_id = text(json::member(grant, "instanceId"), "effect instance ID", 128);
		if (!valid_plugin_id(output.request.instance_id)) fail("admission", "The effect instance ID is not canonical.");
		output.request.effect_state_sha256 = digest(
			json::member(grant, "effectStateSha256"), "effect state digest"
		);
		const auto parsed_context = parse_context(json::string(json::member(grant, "context"), "Interact context"));
		if (!parsed_context.has_value()) fail("admission", "The OpenFX Interact context is unsupported.");
		output.context = *parsed_context;
		output.request.target = text(json::member(grant, "target"), "Interact target", 16);
		if (output.request.target != "overlay" && output.request.target != "custom-parameter") {
			fail("admission", "The OpenFX Interact target is unsupported.");
		}
		const auto& parameter_name = json::member(grant, "parameterName");
		if (output.request.target == "overlay") {
			if (parameter_name.kind != json::type::null_value) {
				fail("admission", "An overlay Interact cannot name a parameter.");
			}
		} else {
			output.request.parameter_name = text(parameter_name, "custom parameter", 64);
			if (!valid_plugin_id(output.request.parameter_name)) {
				fail("admission", "The custom Interact parameter name is not canonical.");
			}
		}
		output.request.parameters = parameter_states(
			json::member(grant, "parameters"), output.context
		);
		const auto& events = json::array(json::member(grant, "events"), "Interact events");
		if (events.size() > 256) fail("admission", "The OpenFX Interact event batch is oversized.");
		std::uint64_t previous = 0;
		bool first = true;
		for (const auto& value : events) {
			auto parsed = event(value);
			if (!first && parsed.sequence <= previous) {
				fail("admission", "OpenFX Interact sequences must be strictly increasing.");
			}
			first = false;
			previous = parsed.sequence;
			output.request.events.push_back(std::move(parsed));
		}
		return output;
	} catch (const interact_invocation_error&) {
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
