/* SPDX-License-Identifier: AGPL-3.0-only */

#include "host_runtime.hpp"
#include "gpu_runtime.hpp"
#include "isolation_contract.hpp"
#include "interact_v1_invocation.hpp"
#include "v12_cancellation_channel.hpp"
#include "v12_host_invocation.hpp"
#include "v12_output_file.hpp"
#include "../../framescaper-media-host/src/sha256.hpp"

#include <array>
#include <charconv>
#include <cmath>
#include <filesystem>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

namespace {

int self_test() {
	using namespace framescaper::openfx;
	const bool ok = kContexts.size() == 6 && kActions.size() == 21
		&& parse_backend("cpu") == Backend::cpu && !parse_backend("vulkan").has_value();
	std::cout << "{\"contractVersion\":1,\"mode\":\"per-binary-fingerprint-runtime\","
		<< "\"openfx\":\"" << kOpenFxVersion << "\",\"commit\":\"" << kOpenFxCommit << "\","
		<< denied_authorities_json() << ",\"contractFixture\":"
		<< (conformance_fixture_execution() ? "true" : "false")
		<< ",\"thirdPartyExecutionEnabled\":"
		<< (conformance_fixture_execution() ? "true" : "false") << ','
		<< "\"interactSuiteVersions\":[1],\"interactSuiteV2\":"
		<< json_string(kInteractSuiteV2Status) << ','
		<< "\"overlayInteractVersions\":[2],"
		<< "\"cpuRenderingRequired\":true,"
		<< "\"gpuFailureFallsBackToCpu\":true,\"offscreenUiAvailable\":true,"
		<< "\"offscreenUiStatus\":\"overlay-interact-v2-draw-suite-v1-cpu\","
		<< "\"abortPollingRequired\":true,\"ok\":" << (ok ? "true" : "false") << "}\n";
	return ok ? 0 : 70;
}

int plugin_index(const std::string_view value) {
	int output = -1;
	const auto [end, error] = std::from_chars(value.data(), value.data() + value.size(), output);
	if (error != std::errc{} || end != value.data() + value.size() || output < 0 || output > 255) {
		throw std::invalid_argument("The OpenFX plug-in index is not a bounded canonical integer.");
	}
	return output;
}

int invoke(const char* const argv[], bool cancelled) {
	using namespace framescaper::openfx;
	const auto context = parse_context(argv[8]);
	const auto backend = parse_backend(argv[12]);
	if (!context.has_value() || !backend.has_value() || !member_of(argv[10], kActions)) {
		throw std::invalid_argument("The OpenFX invocation context, action, or backend is unsupported.");
	}
	if (cancelled) {
		std::cout << "{\"accepted\":false,\"cancellationObserved\":true}\n";
		return 75;
	}
	HostRuntime host{conformance_fixture_execution()
		? std::vector<Backend>{Backend::cpu, Backend::opengl, Backend::opencl, Backend::cuda, Backend::metal}
		: std::vector<Backend>{Backend::cpu}};
	LoadedPluginBinary binary{std::filesystem::path{argv[2]}, argv[4]};
	binary.bind_host(host.host());
	auto& plugin = binary.plugin(plugin_index(argv[6]));
	const auto standard_value = *context == Context::retimer || *context == Context::transition
		? std::optional<double>{0.5} : std::nullopt;
	const auto result = host.invoke(
		plugin, *context, argv[10], *backend, false, {}, {}, {}, {}, false, 0,
		standard_value
	);
	std::cout << "{\"contractVersion\":1,\"mode\":\"per-binary-fingerprint-runtime\","
		<< denied_authorities_json() << ",\"contractFixture\":true,"
		<< "\"oneFingerprintPerProcess\":true,"
		<< "\"offscreenUiAvailable\":" << (result.offscreen_ui_rendered ? "true" : "false")
		<< ",\"offscreenUiStatus\":" << json_string(result.offscreen_ui_rendered
			? "overlay-interact-v2-draw-suite-v1-cpu" : "not-declared-by-plugin")
		<< ",\"overlayInteractVersion\":" << result.overlay_interact_version
		<< ",\"offscreenDrawCalls\":" << result.offscreen_draw_calls
		<< ",\"offscreenPixelsTouched\":" << result.offscreen_pixels_touched
		<< ",\"context\":" << json_string(argv[8])
		<< ",\"action\":" << json_string(argv[10])
		<< ",\"requestedBackend\":" << json_string(result.requested_backend)
		<< ",\"backend\":" << json_string(result.backend)
		<< ",\"retriedOnCpu\":" << (result.retried_on_cpu ? "true" : "false")
		<< ",\"reportsDegradation\":" << (result.reports_degradation ? "true" : "false")
		<< ",\"suitesDispatched\":" << (result.suites_dispatched ? "true" : "false")
		<< ",\"cpuRendered\":" << (result.cpu_rendered ? "true" : "false")
		<< ",\"gpuContextSetup\":" << (result.gpu_context_setup ? "true" : "false")
		<< ",\"gpuContextReleased\":" << (result.gpu_context_released ? "true" : "false") << "}\n";
	return 0;
}

int invoke_v12(const char* const argv[]) {
	using namespace framescaper::openfx;
	auto grant = authenticate_v12_host_invocation(
		std::filesystem::path{argv[2]}, argv[4]
	);
	HostRuntime host{grant.qualified_backends};
	LoadedPluginBinary binary{grant.plugin_binary, grant.plugin_binary_sha256};
	binary.bind_host(host.host());
	auto& plugin = binary.plugin(grant.plugin_index);
	if (std::string_view{plugin.pluginIdentifier} != grant.plugin_id) {
		throw v12_invocation_error{
			"identity-mismatch", "The authenticated plug-in entry does not match the V12 invocation."
		};
	}
	V12CancellationChannel cancellation{grant.invocation_id, grant.abort_signal_id};
	std::vector<InvocationFrame> inputs;
	inputs.reserve(grant.inputs.size());
	for (auto& input : grant.inputs) inputs.push_back({input.name, std::move(input.frame)});
	const auto result = host.invoke(
		plugin, grant.context, "render", grant.requested_backend, false,
		std::move(inputs), grant.parameters, [&cancellation] { return cancellation.cancelled(); },
		grant.output_layout, true, static_cast<OfxTime>(grant.output_ordinal),
		grant.host_standard_parameter_value
	);
	if (cancellation.protocol_fault()) {
		throw v12_invocation_error{
			"cancellation-protocol", "The V12 cancellation channel received a malformed or mismatched frame."
		};
	}
	if (result.cancellation_observed) {
		std::cout << "{\"accepted\":false,\"cancellationObserved\":true,\"cooperative\":true,"
			<< "\"abortSignalId\":" << json_string(grant.abort_signal_id) << "}\n";
		return 75;
	}
	const auto output_sha256 = framescaper::media::sha256_bytes(
		result.output_frame.rgba.data(), result.output_frame.rgba.size()
	);
	if (result.output_frame.layout.width != grant.output_layout.width
		|| result.output_frame.layout.height != grant.output_layout.height
		|| result.output_frame.layout.row_bytes != grant.output_layout.row_bytes
		|| result.output_frame.rgba.size() != grant.output_layout.byte_length) {
		throw v12_invocation_error{
			"output-mismatch", "The CPU frame does not match its exact output geometry."
		};
	}
	publish_v12_output_file(grant.output_path, result.output_frame.rgba, output_sha256);
	std::cout << "{\"accepted\":true,\"contractVersion\":1,\"planVersion\":" << grant.plan_version << ','
		<< "\"nodeId\":" << json_string(grant.node_id)
		<< ",\"instanceId\":" << json_string(grant.instance_id)
		<< ",\"pluginId\":" << json_string(grant.plugin_id)
		<< ",\"inputNames\":[";
	for (std::size_t index = 0; index < grant.inputs.size(); ++index) {
		if (index != 0) std::cout << ',';
		std::cout << json_string(grant.inputs[index].name);
	}
	std::cout << "],\"outputStreamId\":" << json_string(grant.output_stream_id)
		<< ",\"outputByteLength\":" << grant.output_layout.byte_length
		<< ",\"outputSha256\":" << json_string(output_sha256)
		<< ",\"outputWidth\":" << grant.output_layout.width
		<< ",\"outputHeight\":" << grant.output_layout.height
		<< ",\"outputRowBytes\":" << grant.output_layout.row_bytes
		<< ",\"outputOrdinal\":" << grant.output_ordinal
			<< ",\"sourceTimeVerified\":" << (grant.source_time_verified ? "true" : "false")
			<< ",\"sourceTimeImageEnforced\":" << (result.retimer_source_time_enforced ? "true" : "false")
		<< ",\"transitionValueVerified\":" << (grant.transition_value_verified ? "true" : "false")
		<< ",\"hostStandardParameter\":" << (result.host_standard_parameter_bound
			? json_string(result.host_standard_parameter) : "null")
		<< ",\"hydratedParameterCount\":" << result.hydrated_parameter_count
		<< ",\"hydratedKeyframeCount\":" << result.hydrated_keyframe_count
		<< ",\"requestedBackend\":" << json_string(result.requested_backend)
		<< ",\"backend\":" << json_string(result.backend)
			<< ",\"retriedOnCpu\":" << (result.retried_on_cpu ? "true" : "false")
			<< ",\"reportsDegradation\":" << (result.reports_degradation ? "true" : "false")
			<< ",\"offscreenUiRendered\":" << (result.offscreen_ui_rendered ? "true" : "false")
			<< ",\"overlayInteractVersion\":" << result.overlay_interact_version
			<< ",\"offscreenDrawCalls\":" << result.offscreen_draw_calls
			<< ",\"offscreenPixelsTouched\":" << result.offscreen_pixels_touched
		<< ",\"cpuRendered\":" << (result.cpu_rendered ? "true" : "false")
		<< ",\"gpuContextSetup\":" << (result.gpu_context_setup ? "true" : "false")
		<< ",\"gpuContextReleased\":" << (result.gpu_context_released ? "true" : "false")
		<< ",\"contractFixture\":true," << denied_authorities_json() << "}\n";
	return 0;
}

char hex_digit(const unsigned char value) {
	return value < 10 ? static_cast<char>('0' + value) : static_cast<char>('a' + value - 10);
}

std::string hex_bytes(const std::array<unsigned char, 64U * 64U * 4U>& bytes) {
	std::string output(bytes.size() * 2U, '0');
	for (std::size_t index = 0; index < bytes.size(); ++index) {
		output[index * 2U] = hex_digit(static_cast<unsigned char>(bytes[index] >> 4U));
		output[index * 2U + 1U] = hex_digit(static_cast<unsigned char>(bytes[index] & 0x0fU));
	}
	return output;
}

std::string json_number(const double value) {
	if (!std::isfinite(value)) throw std::runtime_error("An OpenFX Interact mutation is not finite.");
	if (value == 0) return "0";
	std::array<char, 64> buffer{};
	const auto [end, error] = std::to_chars(
		buffer.data(), buffer.data() + buffer.size(), value,
		std::chars_format::general, std::numeric_limits<double>::max_digits10
	);
	if (error != std::errc{}) throw std::runtime_error("An OpenFX Interact mutation is not serializable.");
	return std::string{buffer.data(), end};
}

template <typename Value, typename Encode>
std::string json_list(const std::vector<Value>& values, Encode encode) {
	std::string output{"["};
	for (std::size_t index = 0; index < values.size(); ++index) {
		if (index != 0) output += ',';
		output += encode(values[index]);
	}
	return output + ']';
}

std::string interact_current_value(const framescaper::openfx::HydratedParameterState& parameter) {
	using namespace framescaper::openfx;
	const auto& values = parameter.values;
	const auto type = std::string_view{parameter.wire_type};
	if (type == "boolean") {
		const auto& current = std::get<std::vector<int>>(values.current);
		if (current.size() != 1 || (current[0] != 0 && current[0] != 1)) {
			throw std::runtime_error("An OpenFX boolean Interact mutation is outside its ABI domain.");
		}
		return current[0] == 1 ? "true" : "false";
	}
	if (type == "integer" || type == "choice") {
		const auto& current = std::get<std::vector<int>>(values.current);
		if (current.size() != 1) throw std::runtime_error("An OpenFX integer Interact mutation is malformed.");
		return std::to_string(current[0]);
	}
	if (type == "integer2d" || type == "integer3d") {
		const auto& current = std::get<std::vector<int>>(values.current);
		return json_list(current, [](const int item) { return std::to_string(item); });
	}
	if (type == "double" || type == "double2d" || type == "double3d"
		|| type == "rgb" || type == "rgba") {
		const auto& current = std::get<std::vector<double>>(values.current);
		return json_list(current, [](const double item) { return json_number(item); });
	}
	if (type == "string" || type == "custom") {
		const auto& current = std::get<std::string>(values.current);
		if (current.size() > (type == "custom" ? 65'536U : 4'096U)) {
			throw std::runtime_error("An OpenFX string Interact mutation exceeds its wire ceiling.");
		}
		return json_string(current);
	}
	if (type == "parametric") {
		if (values.curves.empty()) return "[]";
		const auto curve = values.curves.find(0);
		if (values.curves.size() != 1 || curve == values.curves.end()
			|| curve->second.size() != 1 || !curve->second.contains(0)) {
			throw std::runtime_error("An OpenFX parametric Interact mutation exceeds the persisted wire.");
		}
		const auto& points = curve->second.at(0);
		if (points.size() > 8'192U) throw std::runtime_error("An OpenFX parametric mutation is oversized.");
		return json_list(points, [](const ParametricPoint& point) {
			return '[' + json_number(point.key) + ',' + json_number(point.value) + ']';
		});
	}
	if (type == "group" || type == "page" || type == "pushbutton") return "null";
	throw std::runtime_error("An OpenFX Interact mutation has an unknown parameter type.");
}

std::string interact_keyframes(const framescaper::openfx::HydratedParameterState& parameter) {
	using namespace framescaper::openfx;
	const auto& keys = parameter.values.keys;
	if (keys.size() > 8'192U) throw std::runtime_error("An OpenFX Interact mutation has too many keyframes.");
	if (!keys.empty() && parameter.wire_type != "integer" && parameter.wire_type != "choice"
		&& parameter.wire_type != "boolean" && parameter.wire_type != "double") {
		throw std::runtime_error("An OpenFX Interact mutation cannot persist these keyframes.");
	}
	std::string output{"["};
	std::size_t index = 0;
	for (const auto& [time, snapshot] : keys) {
		if (!std::isfinite(time) || time < 0 || std::floor(time) != time
			|| time > 9'007'199'254'740'991.0) {
			throw std::runtime_error("An OpenFX Interact keyframe time exceeds the persisted wire.");
		}
		if (index++ != 0) output += ',';
		output += "{\"frame\":" + json_number(time) + ",\"value\":";
		if (parameter.wire_type == "double") {
			const auto& value = std::get<std::vector<double>>(snapshot);
			if (value.size() != 1) throw std::runtime_error("An OpenFX real keyframe mutation is malformed.");
			output += json_number(value[0]);
		} else {
			const auto& value = std::get<std::vector<int>>(snapshot);
			if (value.size() != 1 || (parameter.wire_type == "boolean"
				&& value[0] != 0 && value[0] != 1)) {
				throw std::runtime_error("An OpenFX integer keyframe mutation is malformed.");
			}
			output += std::to_string(value[0]);
		}
		output += '}';
	}
	return output + ']';
}

std::string interact_parameter_mutation(
	const framescaper::openfx::HydratedParameterState& parameter
) {
	return "{\"parameter\":{\"name\":" + framescaper::openfx::json_string(parameter.name)
		+ ",\"type\":" + framescaper::openfx::json_string(parameter.wire_type)
		+ ",\"value\":" + interact_current_value(parameter)
		+ ",\"keyframes\":" + interact_keyframes(parameter) + "}}";
}

int invoke_interact(const char* const argv[]) {
	using namespace framescaper::openfx;
	auto grant = authenticate_interact_v1_invocation(
		std::filesystem::path{argv[2]}, argv[4]
	);
	HostRuntime host;
	LoadedPluginBinary binary{grant.plugin_binary, grant.plugin_binary_sha256};
	binary.bind_host(host.host());
	auto& plugin = binary.plugin(grant.plugin_index);
	if (plugin.pluginIdentifier == nullptr || std::string_view{plugin.pluginIdentifier} != grant.plugin_id) {
		throw interact_invocation_error{
			"identity-mismatch", "The authenticated plug-in entry does not match the Interact grant."
		};
	}
	const auto result = host.run_interact(plugin, grant.context, grant.request);
	std::cout << "{\"accepted\":true,\"protocolVersion\":1,\"project\":{\"id\":"
		<< json_string(result.project_id) << ",\"revision\":" << result.project_revision
		<< "},\"instanceId\":" << json_string(result.instance_id)
		<< ",\"effectStateSha256\":" << json_string(result.effect_state_sha256)
		<< ",\"width\":64,\"height\":64,"
		<< "\"rowBytes\":256,\"target\":" << json_string(result.target)
		<< ",\"parameterName\":" << (result.parameter_name.empty()
			? "null" : json_string(result.parameter_name))
		<< ",\"acceptedSequences\":[";
	for (std::size_t index = 0; index < result.accepted_sequences.size(); ++index) {
		if (index != 0) std::cout << ',';
		std::cout << result.accepted_sequences[index];
	}
	std::cout << "],\"redrawRequested\":" << (result.redraw_requested ? "true" : "false")
		<< ",\"surfaceDisposition\":" << json_string(result.surface_disposition)
		<< ",\"parameterMutations\":[";
	for (std::size_t index = 0; index < result.parameter_mutations.size(); ++index) {
		if (index != 0) std::cout << ',';
		std::cout << interact_parameter_mutation(result.parameter_mutations[index]);
	}
	std::cout << ']'
		<< ",\"drawCalls\":" << result.draw_calls
		<< ",\"pixelsTouched\":" << result.pixels_touched
		<< ",\"rgbaHex\":" << json_string(hex_bytes(result.rgba))
		<< ",\"vendorTopLevelWindowCreated\":false}\n";
	return 0;
}

} // namespace

int main(const int argc, const char* const argv[]) {
	try {
		if (argc == 2 && std::string_view{argv[1]} == "--self-test") return self_test();
		if (argc == 3 && std::string_view{argv[1]} == "--fingerprint") {
			if (!framescaper::openfx::valid_fingerprint(argv[2])) {
				std::cerr << "The OpenFX runtime requires one canonical plug-in fingerprint.\n";
				return 65;
			}
			std::cout << "{\"accepted\":true,\"oneFingerprintPerProcess\":true}\n";
			return 0;
		}
			if (argc == 5 && std::string_view{argv[1]} == "--invoke-v12-grant"
			&& std::string_view{argv[3]} == "--grant-sha256") {
				return invoke_v12(argv);
			}
			if (argc == 5 && std::string_view{argv[1]} == "--interact-v1-grant"
				&& std::string_view{argv[3]} == "--grant-sha256") {
				return invoke_interact(argv);
			}
		const bool base = (argc == 13 || argc == 14)
			&& std::string_view{argv[1]} == "--invoke"
			&& std::string_view{argv[3]} == "--sha256"
			&& std::string_view{argv[5]} == "--plugin"
			&& std::string_view{argv[7]} == "--context"
			&& std::string_view{argv[9]} == "--action"
			&& std::string_view{argv[11]} == "--backend";
		const bool cancelled = argc == 14 && std::string_view{argv[13]} == "--cancelled";
		if (base && (argc == 13 || cancelled)) return invoke(argv, cancelled);
		std::cerr << "The OpenFX runtime admits only one exact authenticated invocation grant.\n";
		return 64;
		} catch (const framescaper::openfx::interact_invocation_error& error) {
			std::cerr << "{\"error\":" << framescaper::openfx::json_string(error.code())
				<< ",\"message\":" << framescaper::openfx::json_string(error.what()) << "}\n";
			return 65;
		} catch (const framescaper::openfx::v12_invocation_error& error) {
		std::cerr << "{\"error\":" << framescaper::openfx::json_string(error.code())
			<< ",\"message\":" << framescaper::openfx::json_string(error.what()) << "}\n";
		return (error.code() == "exact-retime-oracle-unavailable"
			|| error.code() == "exact-transition-oracle-unavailable") ? 76 : 65;
	} catch (const framescaper::openfx::gpu_runtime_error& error) {
		std::cerr << "{\"error\":" << framescaper::openfx::json_string(error.code())
			<< ",\"message\":" << framescaper::openfx::json_string(error.what()) << "}\n";
		return error.code() == "unsupported-backend" ? 65 : 75;
	} catch (const framescaper::openfx::isolation_unavailable& error) {
		std::cerr << "{\"error\":\"isolation-unavailable\",\"message\":"
			<< framescaper::openfx::json_string(error.what()) << "}\n";
		return 78;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 70;
	}
}
