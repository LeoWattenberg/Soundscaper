/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include <atomic>
#include <memory>
#include <string>
#include <thread>

namespace framescaper::openfx {

/** One bounded stdin frame that can flip the pollable OFX abort state. */
class V12CancellationChannel final {
public:
	V12CancellationChannel(std::string invocation_id, std::string abort_signal_id);
	~V12CancellationChannel();
	V12CancellationChannel(const V12CancellationChannel&) = delete;
	V12CancellationChannel& operator=(const V12CancellationChannel&) = delete;

	[[nodiscard]] bool cancelled() const;
	[[nodiscard]] bool protocol_fault() const;

private:
	struct State final {
		std::atomic_bool cancelled{false};
		std::atomic_bool protocol_fault{false};
		std::atomic_bool reader_done{false};
	};

	std::shared_ptr<State> state_;
	std::thread reader_;
};

[[nodiscard]] std::string v12_cancellation_frame(
	const std::string& invocation_id,
	const std::string& abort_signal_id
);

} // namespace framescaper::openfx
