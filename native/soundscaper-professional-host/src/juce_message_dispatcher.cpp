/* SPDX-License-Identifier: AGPL-3.0-only */

#include "juce_message_dispatcher.h"

#if !defined(__APPLE__)

#include <juce_events/juce_events.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <thread>

namespace soundscaper {
namespace {

constexpr uint32_t maximumPendingTasks = 32u;
constexpr auto taskTimeout = std::chrono::seconds(10);

class Dispatcher;
std::atomic<Dispatcher *> liveDispatcher{nullptr};

struct Invocation {
	std::mutex mutex;
	std::condition_variable condition;
	std::function<soundscaper_pro_status()> task;
	soundscaper_pro_status result = SOUNDSCAPER_PRO_UNSUPPORTED;
	bool cancelled = false;
	bool done = false;
};

class Dispatcher final {
public:
	Dispatcher() : worker([this]() { run(); })
	{
		liveDispatcher.store(this, std::memory_order_release);
		std::unique_lock lock(stateMutex);
		stateChanged.wait_for(lock, taskTimeout, [this]() { return started; });
	}

	~Dispatcher()
	{
		shutdown();
		liveDispatcher.store(nullptr, std::memory_order_release);
	}

	void shutdown()
	{
		{
			std::lock_guard lock(stateMutex);
			accepting = false;
		}
		auto *current = manager.load(std::memory_order_acquire);
		if (current != nullptr) current->stopDispatchLoop();
		if (worker.joinable()) worker.join();
	}

	soundscaper_pro_status call(const std::function<soundscaper_pro_status()> &task)
	{
		auto *current = admittedManager();
		if (current == nullptr) return SOUNDSCAPER_PRO_UNSUPPORTED;
		if (current->isThisTheMessageThread()) return task();
		if (!reserve()) return SOUNDSCAPER_PRO_UNSUPPORTED;
		auto invocation = std::make_shared<Invocation>();
		invocation->task = task;
		if (!juce::MessageManager::callAsync([this, invocation]() { execute(invocation); })) {
			release();
			return SOUNDSCAPER_PRO_UNSUPPORTED;
		}
		std::unique_lock lock(invocation->mutex);
		if (!invocation->condition.wait_for(lock, taskTimeout, [&]() { return invocation->done; })) {
			invocation->cancelled = true;
			return SOUNDSCAPER_PRO_UNSUPPORTED;
		}
		return invocation->result;
	}

	bool post(const std::function<void()> &task)
	{
		if (admittedManager() == nullptr || !reserve()) return false;
		if (juce::MessageManager::callAsync([this, task]() {
			try { task(); } catch (...) { /* Native UI callbacks never cross the ABI. */ }
			release();
		})) return true;
		release();
		return false;
	}

private:
	juce::MessageManager *admittedManager()
	{
		std::lock_guard lock(stateMutex);
		return accepting ? manager.load(std::memory_order_acquire) : nullptr;
	}

	bool reserve()
	{
		uint32_t count = pending.load(std::memory_order_relaxed);
		while (count < maximumPendingTasks) {
			if (pending.compare_exchange_weak(count, count + 1u, std::memory_order_acq_rel)) return true;
		}
		return false;
	}

	void release() { pending.fetch_sub(1u, std::memory_order_acq_rel); }

	void execute(const std::shared_ptr<Invocation> &invocation)
	{
		{
			std::lock_guard lock(invocation->mutex);
			if (invocation->cancelled) {
				invocation->done = true;
				release();
				invocation->condition.notify_all();
				return;
			}
		}
		soundscaper_pro_status result = SOUNDSCAPER_PRO_UNSUPPORTED;
		try { result = invocation->task(); } catch (...) { /* Fail closed at the C ABI. */ }
		{
			std::lock_guard lock(invocation->mutex);
			invocation->result = result;
			invocation->done = true;
		}
		release();
		invocation->condition.notify_all();
	}

	void run()
	{
		juce::ScopedJuceInitialiser_GUI runtime;
		auto *current = juce::MessageManager::getInstance();
		{
			std::lock_guard lock(stateMutex);
			manager.store(current, std::memory_order_release);
			started = true;
		}
		stateChanged.notify_all();
		current->runDispatchLoop();
		manager.store(nullptr, std::memory_order_release);
	}

	std::mutex stateMutex;
	std::condition_variable stateChanged;
	std::atomic<juce::MessageManager *> manager{nullptr};
	std::atomic<uint32_t> pending{0u};
	bool started = false;
	bool accepting = true;
	std::thread worker;
};

Dispatcher &dispatcher()
{
	static Dispatcher value;
	return value;
}

} // namespace

soundscaper_pro_status dispatchJuceMessageTask(
	const std::function<soundscaper_pro_status()> &task)
{
	return task ? dispatcher().call(task) : SOUNDSCAPER_PRO_UNSUPPORTED;
}

bool postJuceMessageTask(const std::function<void()> &task)
{
	return task && dispatcher().post(task);
}

void shutdownJuceMessageDispatcher()
{
	if (auto *value = liveDispatcher.load(std::memory_order_acquire)) value->shutdown();
}

} // namespace soundscaper

#endif
