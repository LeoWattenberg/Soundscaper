/* SPDX-License-Identifier: AGPL-3.0-only */

#include "../../native/framescaper-openfx-host/src/host_parameter_wire_hydration.hpp"

#include "../../native/framescaper-openfx-host/src/interact_v1_invocation.hpp"
#include "../../native/framescaper-openfx-host/src/v12_host_invocation.hpp"

#include <array>
#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

namespace json = framescaper::media::json;
using namespace framescaper::openfx;

int main() {
	std::size_t authored_keys = 0;
	const auto authored = hydrate_parameter_wire_state(json::parse(
		R"({"name":"gain","type":"double","value":[-0],"keyframes":[{"frame":3,"value":1.5}]})"),
		Context::filter, authored_keys, ParameterWireOrigin::authored_interact);
	if (authored.ofx_type != kOfxParamTypeDouble || authored_keys != 1
		|| authored.values.keys.size() != 1 || authored.values.kind != ParameterValueKind::real
		|| !std::signbit(std::get<std::vector<double>>(authored.values.current)[0])) return 1;
	std::size_t persisted_keys = 0;
	try {
		(void)hydrate_parameter_wire_state(json::parse(
			R"({"name":"gain","type":"double","value":[-0],"keyframes":[]})"),
			Context::filter, persisted_keys, ParameterWireOrigin::persisted_v12);
		return 2;
	} catch (const v12_invocation_error& error) {
		if (error.code() != "admission" || std::string{error.what()}.find("canonical") == std::string::npos) return 3;
	}
	try {
		(void)hydrate_parameter_wire_state(json::parse(
			R"({"name":"Gain","type":"unknown","value":null,"keyframes":[]})"),
			Context::filter, authored_keys, ParameterWireOrigin::authored_interact);
		return 4;
	} catch (const interact_invocation_error& error) {
		if (error.code() != "admission" || std::string{error.what()} != "The authored OpenFX parameter type is unsupported.") return 5;
	}
	const auto vector = hydrate_parameter_wire_state(json::parse(
		R"({"name":"two","type":"integer2d","value":[4,5],"keyframes":[]})"),
		Context::filter, persisted_keys, ParameterWireOrigin::persisted_v12);
	if (vector.ofx_type != kOfxParamTypeInteger2D
		|| std::get<std::vector<int>>(vector.values.current) != std::vector<int>{4, 5}) return 6;
	struct WireType { const char* wire; const char* abi; const char* value; };
	for (const auto& item : std::array<WireType, 16> {{
		{"integer", kOfxParamTypeInteger, "1"}, {"integer2d", kOfxParamTypeInteger2D, "[1,2]"},
		{"integer3d", kOfxParamTypeInteger3D, "[1,2,3]"},
		{"double", kOfxParamTypeDouble, "[0.5]"}, {"double2d", kOfxParamTypeDouble2D, "[0.5,1]"},
		{"double3d", kOfxParamTypeDouble3D, "[0.5,1,2]"}, {"rgb", kOfxParamTypeRGB, "[0,0.5,1]"},
		{"rgba", kOfxParamTypeRGBA, "[0,0.5,1,1]"}, {"boolean", kOfxParamTypeBoolean, "true"},
		{"choice", kOfxParamTypeChoice, "0"}, {"string", kOfxParamTypeString, R"("hello")"},
		{"custom", kOfxParamTypeCustom, R"("bytes")"}, {"parametric", kOfxParamTypeParametric, "[]"},
		{"group", kOfxParamTypeGroup, "null"}, {"page", kOfxParamTypePage, "null"},
		{"pushbutton", kOfxParamTypePushButton, "null"},
	}}) {
		const auto wire = json::parse(std::string{R"({"name":"sample","type":")"} + item.wire
			+ R"(","value":)" + item.value + R"(,"keyframes":[]})");
		for (const auto origin : {ParameterWireOrigin::authored_interact, ParameterWireOrigin::persisted_v12}) {
			std::size_t no_keys = 0;
			const auto parsed = hydrate_parameter_wire_state(wire, Context::filter, no_keys, origin);
			if (parsed.ofx_type != item.abi || parsed.keyframe_count != 0 || no_keys != 0) return 11;
		}
	}
	for (const auto origin : {ParameterWireOrigin::authored_interact, ParameterWireOrigin::persisted_v12}) {
		std::size_t exhausted = 65'536;
		try {
			(void)hydrate_parameter_wire_state(json::parse(
				R"({"name":"threshold","type":"boolean","value":false,"keyframes":[{"frame":1,"value":1}]})"),
				Context::filter, exhausted, origin);
			return 12;
		} catch (const interact_invocation_error& error) {
			if (origin != ParameterWireOrigin::authored_interact || error.code() != "admission"
				|| std::string{error.what()}.find("Interact keyframe ceiling") == std::string::npos) return 13;
		} catch (const v12_invocation_error& error) {
			if (origin != ParameterWireOrigin::persisted_v12 || error.code() != "admission"
				|| std::string{error.what()}.find("instance keyframe ceiling") == std::string::npos) return 14;
		}
	}
	try {
		(void)hydrate_parameter_wire_state(json::parse(
			R"({"name":"Transition","type":"double","value":[0.5],"keyframes":[]})"),
			Context::transition, persisted_keys, ParameterWireOrigin::persisted_v12);
		return 7;
	} catch (const v12_invocation_error& error) {
		if (error.code() != "admission" || std::string{error.what()}.find("Persisted state") == std::string::npos) return 8;
	}
	std::string points = "[";
	for (int index = 0; index < 8'193; ++index) {
		if (index != 0) points += ',';
		points += "[" + std::to_string(index) + ",1]";
	}
	points += ']';
	const auto parametric = json::parse(
		R"({"name":"curve","type":"parametric","value":)" + points + R"(,"keyframes":[]})");
	try {
		(void)hydrate_parameter_wire_state(parametric, Context::filter, authored_keys,
			ParameterWireOrigin::authored_interact);
		return 9;
	} catch (const interact_invocation_error& error) {
		if (error.code() != "admission" || std::string{error.what()}.find("point ceiling") == std::string::npos) return 10;
	}
	return 0;
}
