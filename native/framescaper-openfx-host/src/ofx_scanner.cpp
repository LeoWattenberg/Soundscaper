/* SPDX-License-Identifier: AGPL-3.0-only */

#include "host_runtime.hpp"
#include "isolation_contract.hpp"

#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

int self_test() {
	using namespace framescaper::openfx;
	const bool ok = valid_fingerprint(
		"org.framescaper.fixture@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	) && !valid_fingerprint("org.framescaper.fixture@not-a-digest")
		&& parse_context("retimer") == Context::retimer;
	std::cout << "{\"contractVersion\":1,\"mode\":\"short-lived-scanner\","
		<< "\"openfx\":\"" << kOpenFxVersion << "\",\"commit\":\"" << kOpenFxCommit << "\","
		<< denied_authorities_json() << ",\"contractFixture\":"
		<< (conformance_fixture_execution() ? "true" : "false")
		<< ",\"thirdPartyExecutionEnabled\":"
		<< (conformance_fixture_execution() ? "true" : "false") << ','
		<< "\"interactSuiteVersions\":[1],\"interactSuiteV2\":"
		<< json_string(kInteractSuiteV2Status) << ','
		<< "\"loadsOneBinary\":true,\"exitsAfterScan\":true,"
		<< "\"authenticatedBeforeLoad\":true,\"ok\":" << (ok ? "true" : "false") << "}\n";
	return ok ? 0 : 70;
}

std::string architecture_directory() {
#if defined(_WIN32) && defined(_M_ARM64EC)
	return "Win-arm64ec";
#elif defined(_WIN32) && (defined(_M_X64) || defined(__x86_64__))
	return "Win64";
#elif defined(__APPLE__) && defined(__aarch64__)
	return "MacOS";
#elif defined(__linux__) && defined(__aarch64__)
	return "Linux-aarch64";
#elif defined(__linux__) && defined(__x86_64__)
	return "Linux-x86-64";
#else
	throw std::runtime_error("This OpenFX scanner architecture is outside the five-target contract.");
#endif
}

void write_strings(const std::vector<std::string>& values) {
	std::cout << '[';
	for (std::size_t index = 0; index < values.size(); ++index) {
		if (index != 0) std::cout << ',';
		std::cout << framescaper::openfx::json_string(values[index]);
	}
	std::cout << ']';
}

int scan(const std::filesystem::path& path, const std::string& sha256) {
	using namespace framescaper::openfx;
	HostRuntime host;
	LoadedPluginBinary binary{path, sha256};
	binary.bind_host(host.host());
	if (binary.plugin_count() != 1) {
		throw std::runtime_error("The selected binary must expose exactly one OpenFX plug-in entry.");
	}
	auto& plugin = binary.plugin(0);
	const auto inspected = host.inspect(plugin);
	if (!inspected.has_value()) {
		throw std::runtime_error("The OpenFX plug-in failed isolated closed description.");
	}
	// OpenFX 1.5.1 reports no vendor identity; never infer one from the plug-in id.
	std::cout << "{\"pluginId\":" << json_string(plugin.pluginIdentifier)
		<< ",\"vendor\":null"
		<< ",\"version\":{\"major\":" << plugin.pluginVersionMajor
		<< ",\"minor\":" << plugin.pluginVersionMinor << "}"
		<< ",\"bundleIdentity\":" << json_string("single-file-sha256:" + binary.sha256())
		<< ",\"binarySha256\":" << json_string(binary.sha256())
		<< ",\"architectureDirectory\":" << json_string(architecture_directory())
		<< ",\"supportedContexts\":";
	write_strings(inspected->contexts);
	std::cout << ",\"parameters\":[";
	for (std::size_t index = 0; index < inspected->parameters.size(); ++index) {
		if (index != 0) std::cout << ',';
		const auto& parameter = inspected->parameters[index];
		std::cout << "{\"name\":" << json_string(parameter.name)
			<< ",\"type\":" << json_string(parameter.type)
			<< ",\"animates\":" << (parameter.animates ? "true" : "false") << '}';
	}
	std::cout << "],\"components\":";
	write_strings(inspected->components);
	std::cout << ",\"pixelDepths\":";
	write_strings(inspected->pixel_depths);
	std::cout << ",\"threading\":" << json_string(inspected->threading)
		<< ",\"renderBackends\":";
	write_strings(inspected->render_backends);
	std::cout
		<< ",\"requestedSuites\":";
	write_strings(inspected->requested_suites);
	std::cout << "}\n";
	return 0;
}

} // namespace

int main(const int argc, const char* const argv[]) {
	try {
		if (argc == 2 && std::string_view{argv[1]} == "--self-test") return self_test();
		if (argc == 5 && std::string_view{argv[1]} == "--scan"
			&& std::string_view{argv[3]} == "--sha256") {
			return scan(argv[2], argv[4]);
		}
		std::cerr << "The OpenFX scanner admits only one exact --scan PATH --sha256 DIGEST grant.\n";
		return 64;
	} catch (const framescaper::openfx::isolation_unavailable& error) {
		std::cerr << "{\"error\":\"isolation-unavailable\",\"message\":"
			<< framescaper::openfx::json_string(error.what()) << "}\n";
		return 78;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 70;
	}
}
