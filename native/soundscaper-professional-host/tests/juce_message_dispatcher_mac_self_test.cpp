/* SPDX-License-Identifier: AGPL-3.0-only */

#include "juce_message_dispatcher.h"

#include <CoreFoundation/CoreFoundation.h>
#include <pthread.h>

#include <atomic>
#include <chrono>
#include <thread>

namespace {

struct Evidence {
	std::atomic<bool> framedPeerOnWorker{false};
	std::atomic<bool> dispatchedOnMain{false};
	std::atomic<bool> shutdownCalled{false};
	std::atomic<bool> externalSourceSignalled{false};
	std::atomic<bool> afterShutdownOnMain{false};
	std::atomic<bool> asyncPostCompleted{false};
	std::atomic<bool> racePostRejected{false};
	std::atomic<bool> unexpectedCallback{false};
};

bool await(const std::atomic<bool> &flag)
{
	const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
	while (!flag.load(std::memory_order_acquire)) {
		if (std::chrono::steady_clock::now() >= deadline) return false;
		std::this_thread::yield();
	}
	return true;
}

void afterShutdownCallback(void *context)
{
	auto &evidence = *static_cast<Evidence *>(context);
	evidence.afterShutdownOnMain.store(pthread_main_np() != 0, std::memory_order_release);
}

bool runOnce()
{
	Evidence evidence;
	auto runLoop = CFRunLoopGetMain();
	if (runLoop == nullptr) return false;
	CFRunLoopSourceContext context{};
	context.info = &evidence;
	context.perform = afterShutdownCallback;
	auto source = CFRunLoopSourceCreate(kCFAllocatorDefault, 0, &context);
	if (source == nullptr) return false;
	CFRunLoopAddSource(runLoop, source, kCFRunLoopDefaultMode);
	const auto started = std::chrono::steady_clock::now();
	const int result = soundscaper::runMacJuceMessageDispatcher([&]() {
		evidence.framedPeerOnWorker.store(pthread_main_np() == 0, std::memory_order_release);
		const auto status = soundscaper::dispatchJuceMessageTask([&]() {
			evidence.dispatchedOnMain.store(pthread_main_np() != 0, std::memory_order_release);
			return SOUNDSCAPER_PRO_OK;
		});
		const bool posted = soundscaper::postJuceMessageTask([&]() {
			soundscaper::shutdownJuceMessageDispatcher();
			evidence.shutdownCalled.store(true, std::memory_order_release);
			if (await(evidence.externalSourceSignalled)) {
				evidence.asyncPostCompleted.store(true, std::memory_order_release);
			}
		});
		if (!posted || !await(evidence.shutdownCalled)) return 1;
		evidence.racePostRejected.store(!soundscaper::postJuceMessageTask([&]() {
			evidence.unexpectedCallback.store(true, std::memory_order_release);
		}), std::memory_order_release);
		CFRunLoopSourceSignal(source);
		evidence.externalSourceSignalled.store(true, std::memory_order_release);
		CFRunLoopWakeUp(runLoop);
		return status == SOUNDSCAPER_PRO_OK && await(evidence.afterShutdownOnMain) ? 0 : 1;
	});
	const auto elapsed = std::chrono::steady_clock::now() - started;
	CFRunLoopRemoveSource(runLoop, source, kCFRunLoopDefaultMode);
	CFRunLoopSourceInvalidate(source);
	CFRelease(source);
	const bool rejectedAfterRun = !soundscaper::postJuceMessageTask([&]() {
		evidence.unexpectedCallback.store(true, std::memory_order_release);
	});
	return result == 0 && evidence.framedPeerOnWorker.load(std::memory_order_acquire)
		&& evidence.dispatchedOnMain.load(std::memory_order_acquire)
		&& evidence.asyncPostCompleted.load(std::memory_order_acquire)
		&& evidence.racePostRejected.load(std::memory_order_acquire)
		&& !evidence.unexpectedCallback.load(std::memory_order_acquire)
		&& rejectedAfterRun && elapsed < std::chrono::seconds(5);
}

} // namespace

int main()
{
	return runOnce() && runOnce() ? 0 : 1;
}
