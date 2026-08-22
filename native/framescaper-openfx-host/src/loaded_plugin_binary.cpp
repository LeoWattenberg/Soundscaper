/* SPDX-License-Identifier: AGPL-3.0-only */

#include "host_runtime.hpp"

#include <stdexcept>

namespace framescaper::openfx {
namespace {

bool accepted_entry_status(const OfxStatus status) {
	return status == kOfxStatOK || status == kOfxStatReplyDefault;
}

} // namespace

LoadedPluginBinary::LoadedPluginBinary(
	const std::filesystem::path& binary,
	const std::string& sha256
) : library_(binary, sha256) {
	number_ = reinterpret_cast<NumberFunction>(library_.required_symbol("OfxGetNumberOfPlugins"));
	plugin_ = reinterpret_cast<PluginFunction>(library_.required_symbol("OfxGetPlugin"));
	set_host_ = reinterpret_cast<SetHostFunction>(library_.optional_symbol("OfxSetHost"));
}

LoadedPluginBinary::~LoadedPluginBinary() = default;

void LoadedPluginBinary::bind_host(OfxHost* host) {
	if (host == nullptr || count_ != -1) {
		throw std::logic_error("An OpenFX binary receives exactly one host connection.");
	}
	if (set_host_ != nullptr && !accepted_entry_status(set_host_(host))) {
		throw std::runtime_error("The OpenFX binary refused its authenticated host.");
	}
	count_ = number_();
	if (count_ < 0 || count_ > 256) {
		throw std::runtime_error("The OpenFX binary returned an unsafe plug-in count.");
	}
}

int LoadedPluginBinary::plugin_count() const {
	if (count_ < 0) throw std::logic_error("The OpenFX binary has not received its host.");
	return count_;
}

OfxPlugin& LoadedPluginBinary::plugin(const int index) const {
	if (index < 0 || index >= plugin_count()) {
		throw std::out_of_range("The OpenFX plug-in index is outside the authenticated binary.");
	}
	auto* value = plugin_(index);
	if (value == nullptr || !valid_plugin_entry(*value)) {
		throw std::runtime_error("The OpenFX plug-in entry is malformed or unsupported.");
	}
	return *value;
}

} // namespace framescaper::openfx
