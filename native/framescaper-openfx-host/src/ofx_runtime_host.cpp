/* SPDX-License-Identifier: AGPL-3.0-only */

#include "host_runtime.hpp"
#include "isolation_contract.hpp"
#include "v12_cancellation_channel.hpp"
#include "v12_host_invocation.hpp"
#include "v12_output_file.hpp"
#include "../../framescaper-media-host/src/sha256.hpp"

#include <array>
#include <charconv>
#include <filesystem>
#include <iostream>
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
	HostRuntime host;
	LoadedPluginBinary binary{std::filesystem::path{argv[2]}, argv[4]};
	binary.bind_host(host.host());
	auto& plugin = binary.plugin(plugin_index(argv[6]));
	const auto result = host.invoke(plugin, *context, argv[10], *backend, false);
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
		<< ",\"cpuRendered\":" << (result.cpu_rendered ? "true" : "false") << "}\n";
	return 0;
}

int invoke_v12(const char* const argv[]) {
	using namespace framescaper::openfx;
	auto grant = authenticate_v12_host_invocation(
		std::filesystem::path{argv[2]}, argv[4]
	);
	if (grant.requested_backend != Backend::cpu) {
		throw v12_invocation_error{
			"unsupported-backend", "The exact V12 host has no authenticated GPU backend."
		};
	}
	HostRuntime host;
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
		grant.output_layout, true, static_cast<OfxTime>(grant.output_ordinal)
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
	std::cout << "{\"accepted\":true,\"contractVersion\":1,\"planVersion\":12,"
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
		<< ",\"contractFixture\":true," << denied_authorities_json() << "}\n";
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
	} catch (const framescaper::openfx::v12_invocation_error& error) {
		std::cerr << "{\"error\":" << framescaper::openfx::json_string(error.code())
			<< ",\"message\":" << framescaper::openfx::json_string(error.what()) << "}\n";
		return error.code() == "exact-retime-oracle-unavailable" ? 76 : 65;
	} catch (const framescaper::openfx::isolation_unavailable& error) {
		std::cerr << "{\"error\":\"isolation-unavailable\",\"message\":"
			<< framescaper::openfx::json_string(error.what()) << "}\n";
		return 78;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 70;
	}
}
