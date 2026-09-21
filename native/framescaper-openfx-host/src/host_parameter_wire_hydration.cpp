/* SPDX-License-Identifier: AGPL-3.0-only */

#include "host_parameter_wire_hydration.hpp"

#include "interact_v1_invocation.hpp"
#include "v12_host_invocation.hpp"

#include <algorithm>
#include <cctype>
#include <charconv>
#include <cmath>
#include <cstdint>
#include <limits>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace framescaper::openfx {
namespace {
namespace json = framescaper::media::json;

[[noreturn]] void admission(const ParameterWireOrigin origin, std::string message) {
	if (origin == ParameterWireOrigin::authored_interact) {
		throw interact_invocation_error{"admission", std::move(message)};
	}
	throw v12_invocation_error{"admission", std::move(message)};
}

[[nodiscard]] bool authored(const ParameterWireOrigin origin) {
	return origin == ParameterWireOrigin::authored_interact;
}

[[nodiscard]] std::string bounded_text(
	const json::value& value,
	const std::string_view label,
	const std::size_t maximum,
	const ParameterWireOrigin origin
) {
	const auto output = json::string(value, label);
	if (output.empty() || output.size() > maximum || output.find('\0') != std::string_view::npos) {
		admission(origin, std::string{label} + " is not bounded nonempty text.");
	}
	return std::string{output};
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
	return nullptr;
}

[[nodiscard]] std::size_t component_count(const std::string_view type) {
	if (type == "double" || type == "integer" || type == "boolean" || type == "choice") return 1;
	if (type == "integer2d" || type == "double2d") return 2;
	if (type == "integer3d" || type == "double3d" || type == "rgb") return 3;
	if (type == "rgba") return 4;
	return 0;
}

[[nodiscard]] double finite_number(
	const json::value& value,
	const std::string_view label,
	const ParameterWireOrigin origin
) {
	if (authored(origin)) {
		if (value.kind != json::type::number) admission(origin, std::string{label} + " must be numeric.");
	} else if (value.kind != json::type::number || value.text == "-0") {
		admission(origin, std::string{label} + " is not a canonical finite number.");
	}
	double output = 0;
	const auto [end, error] = std::from_chars(
		value.text.data(), value.text.data() + value.text.size(), output
	);
	if (error != std::errc{} || end != value.text.data() + value.text.size() || !std::isfinite(output)) {
		admission(origin, std::string{label} + (authored(origin)
			? " must be one finite OFX number." : " is not a representable finite OFX value."));
	}
	return output;
}

[[nodiscard]] int native_integer(
	const json::value& value,
	const std::string_view label,
	const ParameterWireOrigin origin
) {
	if (value.kind != json::type::number) admission(origin, std::string{label}
		+ (authored(origin) ? " must be an integer." : " is not an integer component."));
	std::int64_t output = 0;
	const auto [end, error] = std::from_chars(
		value.text.data(), value.text.data() + value.text.size(), output
	);
	if (error != std::errc{} || end != value.text.data() + value.text.size()
		|| output < std::numeric_limits<int>::min() || output > std::numeric_limits<int>::max()) {
		admission(origin, std::string{label} + (authored(origin)
			? " exceeds the signed OFX integer domain." : " is not a representable signed OFX integer component."));
	}
	return static_cast<int>(output);
}

[[nodiscard]] std::int64_t safe_frame(const json::value& value, const ParameterWireOrigin origin) {
	constexpr std::int64_t maximum = 9'007'199'254'740'991LL;
	const auto output = json::integer(value, "OFX keyframe frame");
	if (output < 0 || output > maximum) admission(origin, "OFX keyframe frame is outside its safe integer domain.");
	return output;
}

} // namespace

HydratedParameterState hydrate_parameter_wire_state(
	const json::value& value,
	const Context context,
	std::size_t& total_keys,
	const ParameterWireOrigin origin
) {
	json::require_exact_keys(value, {"name", "type", "value", "keyframes"});
	HydratedParameterState output;
	output.name = bounded_text(json::member(value, "name"), "OpenFX parameter name", 64, origin);
	if (!valid_parameter_name(output.name)) admission(origin, "The OpenFX parameter name is not canonical.");
	if ((context == Context::retimer && output.name == "SourceTime")
		|| (context == Context::transition && output.name == "Transition")) {
		admission(origin, authored(origin)
			? "Authored state cannot override a host-owned OpenFX standard parameter."
			: "Persisted state cannot override a host-owned OpenFX standard parameter.");
	}
	output.wire_type = bounded_text(json::member(value, "type"), "OpenFX parameter type", 32, origin);
	const auto type = std::string_view{output.wire_type};
	const auto* ofx_type = native_parameter_type(type);
	if (ofx_type == nullptr) admission(origin, authored(origin)
		? "The authored OpenFX parameter type is unsupported."
		: "The persisted OpenFX parameter type is unsupported by the pinned ABI.");
	output.ofx_type = ofx_type;
	if (!initialize_parameter_values(output.values, output.ofx_type)) {
		admission(origin, authored(origin)
			? "The native host cannot initialize the authored OpenFX parameter type."
			: "The native host cannot initialize the persisted OpenFX parameter type.");
	}
	const auto& current = json::member(value, "value");
	if (type == "boolean") {
		output.values.current = std::vector<int>{json::boolean(current, "OFX boolean value") ? 1 : 0};
	} else if (type == "integer" || type == "choice") {
		output.values.current = std::vector<int>{native_integer(current, "OFX integer value", origin)};
	} else if (type == "integer2d" || type == "integer3d") {
		const auto& components = json::array(current, "OFX integer components");
		if (components.size() != component_count(type)) admission(origin, "The OFX integer component count is inexact.");
		std::vector<int> parsed; parsed.reserve(components.size());
		for (const auto& component : components) parsed.push_back(native_integer(component, "OFX integer component", origin));
		output.values.current = std::move(parsed);
	} else if (type == "double" || type == "double2d" || type == "double3d"
		|| type == "rgb" || type == "rgba") {
		const auto& components = json::array(current, "OFX real components");
		if (components.size() != component_count(type)) admission(origin, "The OFX real component count is inexact.");
		std::vector<double> parsed; parsed.reserve(components.size());
		for (const auto& component : components) parsed.push_back(finite_number(component, "OFX real component", origin));
		output.values.current = std::move(parsed);
	} else if (type == "string" || type == "custom") {
		if (current.kind != json::type::string
			|| current.text.size() > (type == "custom" ? 65'536U : 4'096U)) {
			admission(origin, authored(origin)
				? "The authored OFX UTF-8 string exceeds its byte ceiling."
				: "The persisted OFX UTF-8 string exceeds its native byte ceiling.");
		}
		output.values.current = current.text;
	} else if (type == "parametric") {
		const auto& points = json::array(current, "OFX parametric points");
		if (authored(origin) && points.size() > 8'192U) admission(origin, "The OFX parametric point ceiling is exceeded.");
		std::vector<ParametricPoint> parsed; parsed.reserve(points.size());
		double previous = -std::numeric_limits<double>::infinity();
		for (const auto& point : points) {
			const auto& pair = json::array(point, "OFX parametric point");
			if (pair.size() != 2) admission(origin, "An OFX parametric point is malformed.");
			const auto key = finite_number(pair[0], "OFX parametric key", origin);
			const auto item = finite_number(pair[1], "OFX parametric value", origin);
			if (key <= previous) admission(origin, authored(origin)
				? "OFX parametric keys must be strictly ordered."
				: "OFX parametric keys must be strictly ordered and unique.");
			previous = key; parsed.push_back({key, item});
		}
		output.values.curves[0][0] = std::move(parsed);
	} else if (current.kind != json::type::null_value) {
		admission(origin, authored(origin)
			? "A valueless OFX parameter cannot carry authored state."
			: "A valueless OFX parameter cannot be hydrated from state.");
	}
	const auto& keys = json::array(json::member(value, "keyframes"), "OFX parameter keyframes");
	if (authored(origin) && (keys.size() > 8'192U || total_keys > 65'536U - keys.size())) {
		admission(origin, "The native OFX Interact keyframe ceiling is exceeded.");
	}
	if (!keys.empty() && type != "integer" && type != "choice"
		&& type != "boolean" && type != "double") {
		admission(origin, authored(origin)
			? "The authored OFX keyframe wire represents only scalar values."
			: "The persisted OFX keyframe wire represents only scalar parameter values.");
	}
	if (!authored(origin) && total_keys > 65'536U - keys.size()) {
		admission(origin, "The native OFX instance keyframe ceiling is exceeded.");
	}
	total_keys += keys.size(); output.keyframe_count = keys.size();
	for (const auto& key : keys) {
		json::require_exact_keys(key, {"frame", "value"});
		const auto frame = safe_frame(json::member(key, "frame"), origin);
		ParameterSnapshot snapshot;
		if (type == "double") {
			snapshot = std::vector<double>{finite_number(json::member(key, "value"), "OFX keyframe value", origin)};
		} else {
			const auto item = native_integer(json::member(key, "value"), "OFX keyframe value", origin);
			if (type == "boolean" && item != 0 && item != 1) admission(origin, authored(origin)
				? "An OFX boolean keyframe is invalid."
				: "An OFX boolean keyframe is outside its ABI domain.");
			snapshot = std::vector<int>{item};
		}
		if (!output.values.keys.emplace(static_cast<double>(frame), std::move(snapshot)).second) {
			admission(origin, "An OFX keyframe time is duplicated.");
		}
	}
	return output;
}

} // namespace framescaper::openfx
