/* SPDX-License-Identifier: AGPL-3.0-only */

#include "juce_message_dispatcher.h"

#include <CoreFoundation/CoreFoundation.h>
#include <juce_events/juce_events.h>

#include <pthread.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <thread>

namespace soundscaper {
namespace {

constexpr uint32_t maximumPendingTasks = 32u;
constexpr auto taskTimeout = std::chrono::seconds(10);
constexpr CFTimeInterval pumpSliceSeconds = 0.25;

struct Invocation {
	std::mutex mutex;
	std::condition_variable condition;
	std::function<soundscaper_pro_status()> task;
	soundscaper_pro_status result = SOUNDSCAPER_PRO_UNSUPPORTED;
	bool cancelled = false;
	bool done = false;
};

struct DispatcherState {
	std::mutex mutex;
	juce::MessageManager *manager = nullptr;
	CFRunLoopRef runLoop = nullptr;
	CFRunLoopSourceRef completionSource = nullptr;
	uint32_t pendingTasks = 0u;
	bool acceptingTasks = false;
	bool transportFinished = false;
};

struct TransportStart {
	std::mutex mutex;
	std::condition_variable condition;
	bool ready = false;
	bool cancelled = false;
};

DispatcherState dispatcherState;
std::atomic<bool> dispatcherRunning{false};
std::atomic<bool> completionReady{false};

void completionWakeCallback(void *) {}

class CompletionWake final {
public:
	CompletionWake() : runLoop(CFRunLoopGetMain())
	{
		if (runLoop == nullptr) return;
		CFRunLoopSourceContext context{};
		context.perform = completionWakeCallback;
		source = CFRunLoopSourceCreate(kCFAllocatorDefault, 0, &context);
		if (source == nullptr) return;
		CFRunLoopAddSource(runLoop, source, kCFRunLoopDefaultMode);
		installed = CFRunLoopContainsSource(runLoop, source, kCFRunLoopDefaultMode);
	}

	~CompletionWake()
	{
		if (source == nullptr) return;
		if (installed) CFRunLoopRemoveSource(runLoop, source, kCFRunLoopDefaultMode);
		CFRunLoopSourceInvalidate(source);
		CFRelease(source);
	}

	bool valid() const { return runLoop != nullptr && source != nullptr && installed; }
	CFRunLoopRef getRunLoop() const { return runLoop; }
	CFRunLoopSourceRef getSource() const { return source; }

private:
	CFRunLoopRef runLoop = nullptr;
	CFRunLoopSourceRef source = nullptr;
	bool installed = false;
};

soundscaper_pro_status invoke(const std::function<soundscaper_pro_status()> &task)
{
	try { return task(); }
	catch (...) { return SOUNDSCAPER_PRO_UNSUPPORTED; }
}

void signalCompletionIfDrainedLocked()
{
	if (!dispatcherState.transportFinished || dispatcherState.pendingTasks != 0u) return;
	completionReady.store(true, std::memory_order_release);
	if (dispatcherState.completionSource != nullptr) {
		CFRunLoopSourceSignal(dispatcherState.completionSource);
	}
	if (dispatcherState.runLoop != nullptr) CFRunLoopWakeUp(dispatcherState.runLoop);
}

juce::MessageManager *reserveTaskLocked()
{
	if (!dispatcherState.acceptingTasks || dispatcherState.manager == nullptr
		|| dispatcherState.pendingTasks >= maximumPendingTasks) return nullptr;
	++dispatcherState.pendingTasks;
	return dispatcherState.manager;
}

void releaseTaskLocked()
{
	if (dispatcherState.pendingTasks == 0u) return;
	--dispatcherState.pendingTasks;
	signalCompletionIfDrainedLocked();
}

void releaseTask()
{
	std::lock_guard lock(dispatcherState.mutex);
	releaseTaskLocked();
}

void execute(const std::shared_ptr<Invocation> &invocation)
{
	{
		std::lock_guard lock(invocation->mutex);
		if (invocation->cancelled) {
			invocation->done = true;
			releaseTask();
			invocation->condition.notify_all();
			return;
		}
	}
	const auto result = invoke(invocation->task);
	{
		std::lock_guard lock(invocation->mutex);
		invocation->result = result;
		invocation->done = true;
	}
	releaseTask();
	invocation->condition.notify_all();
}

bool activateDispatcher(juce::MessageManager &manager, const CompletionWake &completion)
{
	std::lock_guard lock(dispatcherState.mutex);
	if (dispatcherState.manager != nullptr || dispatcherState.pendingTasks != 0u
		|| dispatcherState.acceptingTasks || dispatcherState.transportFinished) return false;
	dispatcherState.manager = &manager;
	dispatcherState.runLoop = completion.getRunLoop();
	dispatcherState.completionSource = completion.getSource();
	dispatcherState.acceptingTasks = true;
	completionReady.store(false, std::memory_order_release);
	return true;
}

void finishTransport()
{
	std::lock_guard lock(dispatcherState.mutex);
	dispatcherState.acceptingTasks = false;
	dispatcherState.transportFinished = true;
	signalCompletionIfDrainedLocked();
}

void retireDispatcher()
{
	std::lock_guard lock(dispatcherState.mutex);
	dispatcherState.acceptingTasks = false;
	dispatcherState.manager = nullptr;
	dispatcherState.runLoop = nullptr;
	dispatcherState.completionSource = nullptr;
	dispatcherState.pendingTasks = 0u;
	dispatcherState.transportFinished = false;
	completionReady.store(false, std::memory_order_release);
	dispatcherRunning.store(false, std::memory_order_release);
}

void releaseTransport(TransportStart &start, bool cancelled)
{
	{
		std::lock_guard lock(start.mutex);
		start.cancelled = cancelled;
		start.ready = true;
	}
	start.condition.notify_all();
}

} // namespace

soundscaper_pro_status dispatchJuceMessageTask(
	const std::function<soundscaper_pro_status()> &task)
{
	if (!task) return SOUNDSCAPER_PRO_UNSUPPORTED;
	std::shared_ptr<Invocation> invocation;
	try {
		invocation = std::make_shared<Invocation>();
		invocation->task = task;
	} catch (...) {
		return SOUNDSCAPER_PRO_UNSUPPORTED;
	}
	bool executeDirectly = false;
	{
		std::lock_guard lock(dispatcherState.mutex);
		auto *manager = reserveTaskLocked();
		if (manager == nullptr) return SOUNDSCAPER_PRO_UNSUPPORTED;
		executeDirectly = manager->isThisTheMessageThread();
		if (!executeDirectly) {
			bool posted = false;
			try {
				posted = juce::MessageManager::callAsync([invocation]() { execute(invocation); });
			} catch (...) {
				posted = false;
			}
			if (!posted) {
				releaseTaskLocked();
				return SOUNDSCAPER_PRO_UNSUPPORTED;
			}
		}
	}
	if (executeDirectly) {
		const auto result = invoke(invocation->task);
		releaseTask();
		return result;
	}
	std::unique_lock lock(invocation->mutex);
	if (!invocation->condition.wait_for(lock, taskTimeout, [&]() { return invocation->done; })) {
		invocation->cancelled = true;
		return SOUNDSCAPER_PRO_UNSUPPORTED;
	}
	return invocation->result;
}

bool postJuceMessageTask(const std::function<void()> &task)
{
	if (!task) return false;
	std::lock_guard lock(dispatcherState.mutex);
	if (reserveTaskLocked() == nullptr) return false;
	bool posted = false;
	try {
		posted = juce::MessageManager::callAsync([task]() {
			try { task(); } catch (...) { /* Native UI callbacks never cross the ABI. */ }
			releaseTask();
		});
	} catch (...) {
		posted = false;
	}
	if (!posted) releaseTaskLocked();
	return posted;
}

void shutdownJuceMessageDispatcher()
{
	std::lock_guard lock(dispatcherState.mutex);
	dispatcherState.acceptingTasks = false;
	signalCompletionIfDrainedLocked();
}

int runMacJuceMessageDispatcher(const std::function<int()> &framedPeer)
{
	bool expected = false;
	if (!framedPeer || pthread_main_np() == 0
		|| !dispatcherRunning.compare_exchange_strong(expected, true, std::memory_order_acq_rel)) return 125;
	juce::ScopedJuceInitialiser_GUI runtime;
	auto *manager = juce::MessageManager::getInstance();
	if (manager == nullptr || !manager->isThisTheMessageThread()) {
		dispatcherRunning.store(false, std::memory_order_release);
		return 125;
	}
	CompletionWake completion;
	if (!completion.valid()) {
		dispatcherRunning.store(false, std::memory_order_release);
		return 125;
	}
	std::atomic<int> result{125};
	TransportStart start;
	std::thread transport;
	try {
		transport = std::thread([&]() {
			{
				std::unique_lock lock(start.mutex);
				start.condition.wait(lock, [&]() { return start.ready; });
				if (start.cancelled) return;
			}
			try { result.store(framedPeer(), std::memory_order_release); }
			catch (...) { result.store(125, std::memory_order_release); }
			finishTransport();
		});
	} catch (...) {
		dispatcherRunning.store(false, std::memory_order_release);
		return 125;
	}
	if (!activateDispatcher(*manager, completion)) {
		releaseTransport(start, true);
		if (transport.joinable()) transport.join();
		dispatcherRunning.store(false, std::memory_order_release);
		return 125;
	}
	releaseTransport(start, false);
	while (!completionReady.load(std::memory_order_acquire)) {
		@autoreleasepool {
			(void)CFRunLoopRunInMode(kCFRunLoopDefaultMode, pumpSliceSeconds, true);
		}
	}
	if (transport.joinable()) transport.join();
	retireDispatcher();
	return result.load(std::memory_order_acquire);
}

} // namespace soundscaper
