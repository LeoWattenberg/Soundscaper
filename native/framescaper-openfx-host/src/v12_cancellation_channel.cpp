/* SPDX-License-Identifier: AGPL-3.0-only */

#include "v12_cancellation_channel.hpp"

#include "isolation_contract.hpp"

#include <iostream>
#include <utility>

namespace framescaper::openfx {
namespace {

constexpr std::size_t kMaximumCancellationFrameBytes = 4'096;

void read_frame(
	const auto& state,
	const std::string& expected
) {
	std::string frame;
	frame.reserve(expected.size());
	char byte = 0;
	while (std::cin.get(byte)) {
		if (frame.size() >= kMaximumCancellationFrameBytes) {
			state->protocol_fault.store(true);
			state->cancelled.store(true);
			state->reader_done.store(true);
			return;
		}
		frame.push_back(byte);
	}
	if (!frame.empty()) {
		if (frame == expected) state->cancelled.store(true);
		else {
			state->protocol_fault.store(true);
			state->cancelled.store(true);
		}
	}
	state->reader_done.store(true);
}

} // namespace

std::string v12_cancellation_frame(
	const std::string& invocation_id,
	const std::string& abort_signal_id
) {
	if (!valid_plugin_id(invocation_id) || !valid_plugin_id(abort_signal_id)) {
		throw std::invalid_argument("A V12 cancellation frame requires canonical authenticated identities.");
	}
	return "{\"schemaVersion\":1,\"type\":\"cancel\",\"invocationId\":\""
		+ invocation_id + "\",\"abortSignalId\":\"" + abort_signal_id + "\"}\n";
}

V12CancellationChannel::V12CancellationChannel(
	std::string invocation_id,
	std::string abort_signal_id
) : state_{std::make_shared<State>()} {
	auto expected = v12_cancellation_frame(invocation_id, abort_signal_id);
	reader_ = std::thread{[state = state_, expected = std::move(expected)] {
		read_frame(state, expected);
	}};
}

V12CancellationChannel::~V12CancellationChannel() {
	if (!reader_.joinable()) return;
	if (state_->reader_done.load()) reader_.join();
	else reader_.detach();
}

bool V12CancellationChannel::cancelled() const { return state_->cancelled.load(); }
bool V12CancellationChannel::protocol_fault() const { return state_->protocol_fault.load(); }

} // namespace framescaper::openfx
