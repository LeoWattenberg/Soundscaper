/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <algorithm>
#include <array>
#include <cctype>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>

namespace framescaper::openfx {

inline constexpr std::string_view kOpenFxVersion = "1.5.1";
inline constexpr std::string_view kOpenFxCommit = "ab77951";
// OpenFX 1.5.1's pinned include/ofxInteract.h defines OfxInteractSuiteV1 only.
inline constexpr int kInteractSuiteMaximumVersion = 1;
inline constexpr std::string_view kInteractSuiteV2Status =
	"unavailable-upstream-openfx-1.5.1-defines-only-v1";
inline constexpr std::array<std::string_view, 6> kContexts{
	"generator", "filter", "transition", "paint", "retimer", "general",
};
inline constexpr std::array<std::string_view, 5> kRenderBackends{
	"cpu", "opengl", "opencl", "cuda", "metal",
};
inline constexpr std::array<std::string_view, 21> kActions{
	"load", "unload", "describe", "describe-in-context",
	"create-instance", "destroy-instance", "begin-instance-changed",
	"instance-changed", "end-instance-changed", "get-region-of-definition",
	"get-regions-of-interest", "frames-needed", "get-frame-varying",
	"get-time-domain", "is-identity", "begin-sequence-render", "render",
	"end-sequence-render", "sync-private-data", "purge-caches", "abort",
};

enum class Context { generator, filter, transition, paint, retimer, general };
enum class Backend { cpu, opengl, opencl, cuda, metal };

inline bool is_lower_hex(const char value) {
	return (value >= '0' && value <= '9') || (value >= 'a' && value <= 'f');
}

inline bool valid_digest(const std::string_view value) {
	return value.size() == 64 && std::all_of(value.begin(), value.end(), is_lower_hex);
}

inline bool valid_plugin_id(const std::string_view value) {
	if (value.empty() || value.size() > 128) return false;
	return std::all_of(value.begin(), value.end(), [](const char character) {
		return std::isalnum(static_cast<unsigned char>(character)) != 0
			|| character == ' ' || character == '.' || character == '_'
			|| character == ':' || character == '-';
	});
}

inline bool valid_fingerprint(const std::string_view value) {
	const auto separator = value.rfind('@');
	return separator != std::string_view::npos
		&& valid_plugin_id(value.substr(0, separator))
		&& valid_digest(value.substr(separator + 1));
}

template <std::size_t Size>
inline bool member_of(
	const std::string_view value,
	const std::array<std::string_view, Size>& values
) {
	return std::find(values.begin(), values.end(), value) != values.end();
}

inline std::optional<Context> parse_context(const std::string_view value) {
	if (value == "generator") return Context::generator;
	if (value == "filter") return Context::filter;
	if (value == "transition") return Context::transition;
	if (value == "paint") return Context::paint;
	if (value == "retimer") return Context::retimer;
	if (value == "general") return Context::general;
	return std::nullopt;
}

inline std::optional<Backend> parse_backend(const std::string_view value) {
	if (value == "cpu") return Backend::cpu;
	if (value == "opengl") return Backend::opengl;
	if (value == "opencl") return Backend::opencl;
	if (value == "cuda") return Backend::cuda;
	if (value == "metal") return Backend::metal;
	return std::nullopt;
}

inline std::string json_string(const std::string_view value) {
	std::string output{"\""};
	for (const auto character : value) {
		switch (character) {
			case '\\': output += "\\\\"; break;
			case '"': output += "\\\""; break;
			case '\b': output += "\\b"; break;
			case '\f': output += "\\f"; break;
			case '\n': output += "\\n"; break;
			case '\r': output += "\\r"; break;
			case '\t': output += "\\t"; break;
			default:
				if (static_cast<unsigned char>(character) < 0x20U) {
					throw std::invalid_argument("Control characters are not admitted in OpenFX JSON identities.");
				}
				output += character;
		}
	}
	return output + '"';
}

inline constexpr std::string_view denied_authorities_json() {
	return "\"networkSuiteExposed\":false,\"arbitraryFilesystemSuiteExposed\":false,"
		"\"vendorTopLevelWindowsExposed\":false";
}

class isolation_unavailable final : public std::runtime_error {
public:
	using std::runtime_error::runtime_error;
};

inline constexpr bool conformance_fixture_execution() {
#if defined(FRAMESCAPER_OPENFX_CONFORMANCE_FIXTURE)
	return true;
#else
	return false;
#endif
}

// Process admission belongs to the outer native-child launcher. It reopens the
// exact host and plug-in bytes, applies the target OS sandbox, and completes an
// enforcement handshake before this executable can load third-party code.
// Distribution metadata is intentionally not an in-process execution oracle.
inline void require_os_isolation_for_plugin_execution() noexcept {}

} // namespace framescaper::openfx
