/* SPDX-License-Identifier: AGPL-3.0-only */

#include "host_runtime.hpp"
#include "isolation_contract.hpp"

#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>

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

int scan(const std::filesystem::path& path, const std::string& sha256) {
	using namespace framescaper::openfx;
	HostRuntime host;
	LoadedPluginBinary binary{path, sha256};
	binary.bind_host(host.host());
	std::cout << "{\"contractVersion\":1,\"mode\":\"short-lived-scanner\","
		<< "\"openfx\":\"" << kOpenFxVersion << "\",\"commit\":\"" << kOpenFxCommit << "\","
		<< denied_authorities_json() << ",\"contractFixture\":true,"
		<< "\"authenticatedBeforeLoad\":true,"
		<< "\"loadsOneBinary\":true,\"exitsAfterScan\":true,\"binarySha256\":"
		<< json_string(binary.sha256()) << ",\"plugins\":[";
	for (int index = 0; index < binary.plugin_count(); ++index) {
		auto& plugin = binary.plugin(index);
		if (!host.inspect(plugin)) throw std::runtime_error("The OpenFX plug-in failed isolated description.");
		if (index != 0) std::cout << ',';
		std::cout << "{\"api\":" << json_string(plugin.pluginApi)
			<< ",\"apiVersion\":" << plugin.apiVersion
			<< ",\"id\":" << json_string(plugin.pluginIdentifier)
			<< ",\"major\":" << plugin.pluginVersionMajor
			<< ",\"minor\":" << plugin.pluginVersionMinor << '}';
	}
	std::cout << "]}\n";
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
