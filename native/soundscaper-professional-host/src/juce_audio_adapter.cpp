/* SPDX-License-Identifier: AGPL-3.0-only */

#include "juce_audio_adapter.h"

#include <juce_audio_devices/juce_audio_devices.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <mutex>
#include <sstream>
#include <vector>

namespace soundscaper {
namespace {

std::string lower(std::string value)
{
	std::transform(value.begin(), value.end(), value.begin(),
		[](unsigned char character) { return static_cast<char>(std::tolower(character)); });
	return value;
}

bool typeMatches(const juce::String &name, const std::string &backend, bool exclusive)
{
	const std::string value = lower(name.toStdString());
	if (backend == "coreaudio") return value.find("core audio") != std::string::npos;
	if (backend == "asio") return value.find("asio") != std::string::npos;
	if (backend == "alsa") return value.find("alsa") != std::string::npos;
	if (backend == "wasapi") {
		const bool isWasapi = value.find("windows audio") != std::string::npos
			|| value.find("wasapi") != std::string::npos;
		const bool isExclusive = value.find("exclusive") != std::string::npos;
		return isWasapi && isExclusive == exclusive;
	}
	return false;
}

std::string escaped(const std::string &value)
{
	std::string output;
	output.reserve(value.size() + 2u);
	for (const char character : value) {
		if (character == '"' || character == '\\') output.push_back('\\');
		if (static_cast<unsigned char>(character) >= 0x20u) output.push_back(character);
	}
	return output;
}

void text(char *destination, const std::string &value)
{
	const size_t length = std::min(value.size(), static_cast<size_t>(SOUNDSCAPER_PRO_MAX_TEXT - 1u));
	std::memcpy(destination, value.data(), length);
	destination[length] = '\0';
}

class PeriodRing {
public:
	PeriodRing(uint32_t channels, uint32_t frames, uint32_t periods = 16u)
		: channelCount(channels), frameCount(frames), capacity(periods),
		storage(static_cast<size_t>(channels) * frames * periods, 0.0f) {}

	bool push(const float *const *planes, uint32_t availableChannels)
	{
		const uint64_t write = writeSequence.load(std::memory_order_relaxed);
		if (write - readSequence.load(std::memory_order_acquire) >= capacity) return false;
		float *slot = storage.data() + static_cast<size_t>(write % capacity) * channelCount * frameCount;
		for (uint32_t channel = 0; channel < channelCount; ++channel) {
			float *target = slot + static_cast<size_t>(channel) * frameCount;
			if (channel < availableChannels && planes != nullptr && planes[channel] != nullptr) {
				std::memcpy(target, planes[channel], static_cast<size_t>(frameCount) * sizeof(float));
			} else std::fill(target, target + frameCount, 0.0f);
		}
		writeSequence.store(write + 1u, std::memory_order_release);
		return true;
	}

	bool pop(float *const *planes, uint32_t availableChannels)
	{
		const uint64_t read = readSequence.load(std::memory_order_relaxed);
		if (read == writeSequence.load(std::memory_order_acquire)) return false;
		const float *slot = storage.data() + static_cast<size_t>(read % capacity) * channelCount * frameCount;
		for (uint32_t channel = 0; channel < availableChannels; ++channel) {
			if (planes == nullptr || planes[channel] == nullptr) continue;
			const float *source = slot + static_cast<size_t>(std::min(channel, channelCount - 1u)) * frameCount;
			std::memcpy(planes[channel], source, static_cast<size_t>(frameCount) * sizeof(float));
		}
		readSequence.store(read + 1u, std::memory_order_release);
		return true;
	}

	bool empty() const
	{
		return readSequence.load(std::memory_order_acquire) == writeSequence.load(std::memory_order_acquire);
	}

private:
	const uint32_t channelCount;
	const uint32_t frameCount;
	const uint32_t capacity;
	std::vector<float> storage;
	std::atomic<uint64_t> readSequence{0u};
	std::atomic<uint64_t> writeSequence{0u};
};

class Session final : public JuceAudioSession, private juce::AudioIODeviceCallback {
public:
	Session(std::unique_ptr<juce::AudioIODevice> opened, uint32_t channels, uint32_t frames, uint32_t direction)
		: device(std::move(opened)), channelCount(channels), frameCount(frames),
		captureEnabled(direction == 0u || direction == 2u),
		playbackEnabled(direction == 1u || direction == 2u),
		input(channels, frames), output(channels, frames) {}

	~Session() override
	{
		device->stop();
		device->close();
	}

	soundscaper_pro_status read(float **planes, uint32_t channels, uint32_t frames) override
	{
		if (!captureEnabled || !shape(planes, channels, frames)) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
		start();
		std::unique_lock<std::mutex> lock(waitMutex);
		const bool ready = captureReady.wait_for(lock, timeout(), [this] {
			return !input.empty() || failed.load(std::memory_order_acquire)
				|| stopped.load(std::memory_order_acquire);
		});
		if (!ready || failed.load(std::memory_order_acquire) || stopped.load(std::memory_order_acquire)
			|| !input.pop(planes, channels)) return SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE;
		return SOUNDSCAPER_PRO_OK;
	}

	soundscaper_pro_status write(
		const float *const *planes, uint32_t channels, uint32_t frames) override
	{
		if (!playbackEnabled || !shape(planes, channels, frames)) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
		if (!output.push(planes, channels)) return fail();
		playbackStarted.store(true, std::memory_order_release);
		start();
		if (failed.load(std::memory_order_acquire) || stopped.load(std::memory_order_acquire)) {
			return SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE;
		}
		return SOUNDSCAPER_PRO_OK;
	}

private:
	template <typename Plane> bool shape(Plane planes, uint32_t channels, uint32_t frames) const
	{
		if (planes == nullptr || channels != channelCount || frames != frameCount) return false;
		for (uint32_t channel = 0; channel < channels; ++channel) if (planes[channel] == nullptr) return false;
		return true;
	}

	void audioDeviceIOCallbackWithContext(
		const float *const *inputs, int inputChannels, float *const *outputs,
		int outputChannels, int frames, const juce::AudioIODeviceCallbackContext &) override
	{
		if (frames != static_cast<int>(frameCount)) return audioFault(outputs, outputChannels, frames);
		if (captureEnabled && !input.push(inputs, static_cast<uint32_t>(std::max(0, inputChannels)))) {
			audioFault(outputs, outputChannels, frames);
			return;
		}
		if (captureEnabled) captureReady.notify_one();
		if (!playbackEnabled || !output.pop(outputs, static_cast<uint32_t>(std::max(0, outputChannels)))) {
			for (int channel = 0; channel < outputChannels; ++channel) {
				if (outputs[channel] != nullptr) std::fill(outputs[channel], outputs[channel] + frames, 0.0f);
			}
			if (playbackEnabled && playbackStarted.load(std::memory_order_acquire)) failed.store(true, std::memory_order_release);
		}
	}

	void audioDeviceAboutToStart(juce::AudioIODevice *) override { stopped.store(false, std::memory_order_release); }
	void audioDeviceStopped() override { stopped.store(true, std::memory_order_release); captureReady.notify_all(); }
	void audioDeviceError(const juce::String &) override { failed.store(true, std::memory_order_release); captureReady.notify_all(); }

	void start()
	{
		const std::lock_guard<std::mutex> lock(startMutex);
		if (started) return;
		started = true;
		device->start(this);
	}

	soundscaper_pro_status fail()
	{
		failed.store(true, std::memory_order_release);
		captureReady.notify_all();
		return SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE;
	}

	void audioFault(float *const *outputs, int outputChannels, int frames)
	{
		failed.store(true, std::memory_order_release);
		for (int channel = 0; channel < outputChannels; ++channel) {
			if (outputs[channel] != nullptr) std::fill(outputs[channel], outputs[channel] + std::max(0, frames), 0.0f);
		}
		captureReady.notify_all();
	}

	std::chrono::milliseconds timeout() const
	{
		const double milliseconds = 2000.0 * static_cast<double>(frameCount)
			/ std::max(1.0, device->getCurrentSampleRate());
		return std::chrono::milliseconds(static_cast<int>(std::clamp(milliseconds, 10.0, 500.0)));
	}

	std::unique_ptr<juce::AudioIODevice> device;
	const uint32_t channelCount;
	const uint32_t frameCount;
	const bool captureEnabled;
	const bool playbackEnabled;
	PeriodRing input;
	PeriodRing output;
	std::atomic<bool> failed{false};
	std::atomic<bool> stopped{false};
	std::atomic<bool> playbackStarted{false};
	std::mutex startMutex;
	std::mutex waitMutex;
	std::condition_variable captureReady;
	bool started = false;
};

/**
 * `AudioDeviceManager::createAudioDeviceTypes` is a protected virtual, so it was
 * never callable the way this host called it, and JUCE 9 made that a hard error
 * rather than a warning. Building the one requested type from the static factory
 * is also the narrower thing to do: enumerating a backend no longer constructs
 * every other backend's device type as a side effect, which on Linux meant an
 * ALSA query could not be answered without JACK being brought up first.
 */
std::unique_ptr<juce::AudioIODeviceType> selectedType(const std::string &backend, bool exclusive)
{
	std::unique_ptr<juce::AudioIODeviceType> candidate;
#if JUCE_MAC
	if (backend == "coreaudio") candidate.reset(juce::AudioIODeviceType::createAudioIODeviceType_CoreAudio());
#elif JUCE_WINDOWS
	if (backend == "wasapi") {
		candidate.reset(juce::AudioIODeviceType::createAudioIODeviceType_WASAPI(exclusive
			? juce::WASAPIDeviceMode::exclusive
			: juce::WASAPIDeviceMode::shared));
	}
 #if JUCE_ASIO
	if (backend == "asio") candidate.reset(juce::AudioIODeviceType::createAudioIODeviceType_ASIO());
 #endif
#elif JUCE_LINUX
	if (backend == "alsa") candidate.reset(juce::AudioIODeviceType::createAudioIODeviceType_ALSA());
#endif
	if (candidate == nullptr || !typeMatches(candidate->getTypeName(), backend, exclusive)) return nullptr;
	return candidate;
}

} // namespace

soundscaper_pro_status enumerateJuceAudio(const std::string &backend, std::string &json)
{
	if (backend == "jack" || backend == "pipewire") return SOUNDSCAPER_PRO_UNSUPPORTED;
	auto type = selectedType(backend, false);
	if (type == nullptr && backend == "wasapi") type = selectedType(backend, true);
	if (type == nullptr) return SOUNDSCAPER_PRO_BACKEND_ABSENT;
	type->scanForDevices();
	std::ostringstream output;
	output << "[";
	bool first = true;
	for (const bool input : { false, true }) {
		for (const auto &name : type->getDeviceNames(input)) {
			if (!first) output << ",";
			first = false;
			output << "{\"handle\":\"" << escaped(name.toStdString())
				<< "\",\"label\":\"" << escaped(name.toStdString())
				<< "\",\"direction\":\"" << (input ? "input" : "output") << "\"}";
		}
	}
	output << "]";
	json = output.str();
	return SOUNDSCAPER_PRO_OK;
}

soundscaper_pro_audio_result openJuceAudio(
	const soundscaper_pro_audio_request &request, std::unique_ptr<JuceAudioSession> &session)
{
	soundscaper_pro_audio_result result{};
	result.status = SOUNDSCAPER_PRO_BACKEND_ABSENT;
	const std::string backend = request.backend == nullptr ? "" : request.backend;
	text(result.backend, backend);
	if (backend == "jack" || backend == "pipewire") {
		result.status = SOUNDSCAPER_PRO_UNSUPPORTED;
		text(result.detail, "PipeWire is supplied by the system-ABI adapter; JACK is discovery-only.");
		return result;
	}
	auto type = selectedType(backend, request.exclusive != 0u);
	if (type == nullptr) {
		text(result.detail, "The requested JUCE audio backend is absent.");
		return result;
	}
	if (backend == "asio" && request.exclusive == 0u) {
		result.status = SOUNDSCAPER_PRO_MODE_REFUSED;
		text(result.detail, "ASIO is an exclusive backend.");
		return result;
	}
	type->scanForDevices();
	const juce::String handle(request.device_handle == nullptr ? "" : request.device_handle);
	const juce::String inputName = request.direction == 0u || request.direction == 2u ? handle : juce::String();
	const juce::String outputName = request.direction == 1u || request.direction == 2u ? handle : juce::String();
	// `createDevice` hands back an owning raw pointer, so it is adopted here
	// rather than at the `Session` that eventually takes it: every refusal below
	// this line returns early, and each one used to drop the device on the floor.
	std::unique_ptr<juce::AudioIODevice> device(type->createDevice(outputName, inputName));
	if (device == nullptr) {
		result.status = SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE;
		text(result.detail, "The requested opaque device handle is unavailable.");
		return result;
	}
	juce::BigInteger inputs;
	juce::BigInteger outputs;
	if (request.direction == 0u || request.direction == 2u) inputs.setRange(0, static_cast<int>(request.channel_count), true);
	if (request.direction == 1u || request.direction == 2u) outputs.setRange(0, static_cast<int>(request.channel_count), true);
	const juce::String error = device->open(inputs, outputs, request.sample_rate, request.period_frames);
	if (error.isNotEmpty()) {
		result.status = SOUNDSCAPER_PRO_FORMAT_REFUSED;
		text(result.detail, error.toStdString());
		return result;
	}
	if (static_cast<uint32_t>(device->getCurrentSampleRate()) != request.sample_rate
		|| static_cast<uint32_t>(device->getCurrentBufferSizeSamples()) != request.period_frames) {
		device->close();
		result.status = SOUNDSCAPER_PRO_FORMAT_REFUSED;
		text(result.detail, "The device substituted a sample rate or period.");
		return result;
	}
	session = std::make_unique<Session>(
		std::move(device), request.channel_count, request.period_frames, request.direction);
	result.status = SOUNDSCAPER_PRO_OK;
	result.sample_rate = request.sample_rate;
	result.period_frames = request.period_frames;
	result.channel_count = request.channel_count;
	result.exclusive = request.exclusive;
	return result;
}

soundscaper_pro_status readJuceAudio(JuceAudioSession &session, float **planes, uint32_t channels, uint32_t frames)
{
	return session.read(planes, channels, frames);
}

soundscaper_pro_status writeJuceAudio(
	JuceAudioSession &session, const float *const *planes, uint32_t channels, uint32_t frames)
{
	return session.write(planes, channels, frames);
}

} // namespace soundscaper
