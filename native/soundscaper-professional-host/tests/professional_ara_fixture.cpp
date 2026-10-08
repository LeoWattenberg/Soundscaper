/* SPDX-License-Identifier: AGPL-3.0-only */
/** A real ARA-over-VST3 fixture: rendering reads host source PCM at random positions. */
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <memory>
class FixtureRenderer final : public juce::ARAPlaybackRenderer {
public:
	FixtureRenderer(ARA::PlugIn::DocumentController *dc, float &gainValue) : juce::ARAPlaybackRenderer(dc), gain(gainValue) {}
	void prepareToPlay(double rate, int, int channels, juce::AudioProcessor::ProcessingPrecision, AlwaysNonRealtime) override
	{
		sampleRate = rate; delay.assign(static_cast<size_t>(channels), std::vector<float>(4u)); delayPosition = 0u;
	}
	void releaseResources() override {}
	bool processBlock(juce::AudioBuffer<float> &buffer, juce::AudioProcessor::Realtime,
		const juce::AudioPlayHead::PositionInfo &position) noexcept override
	{
		buffer.clear();
		for (auto *region : getPlaybackRegions()) {
			auto *source = region->getAudioModification()->getAudioSource();
			juce::ARAAudioSourceReader reader(source);
			const auto start = position.getTimeInSamples().orFallback(0)
				- static_cast<int64_t>(std::llround(region->getStartInPlaybackTime() * sampleRate))
				+ region->getStartInAudioModificationSamples();
			if (!reader.read(&buffer, 0, buffer.getNumSamples(), start, true, true)) return false;
			buffer.applyGain(gain);
		}
		for (int channel = 0; channel < buffer.getNumChannels(); ++channel) {
			for (int frame = 0; frame < buffer.getNumSamples(); ++frame) {
				const size_t index = (delayPosition + static_cast<size_t>(frame)) % 4u;
				const float input = buffer.getSample(channel, frame);
				buffer.setSample(channel, frame, delay[static_cast<size_t>(channel)][index]);
				delay[static_cast<size_t>(channel)][index] = input;
			}
		}
		delayPosition = (delayPosition + static_cast<size_t>(buffer.getNumSamples())) % 4u;
		return true;
	}
private:
	double sampleRate = 48000.0;
	float &gain;
	std::vector<std::vector<float>> delay;
	size_t delayPosition = 0u;
};
class FixtureDocument final : public juce::ARADocumentControllerSpecialisation {
public:
	using juce::ARADocumentControllerSpecialisation::ARADocumentControllerSpecialisation;
	bool doRestoreObjectsFromStream(juce::ARAInputStream &input, const juce::ARARestoreObjectsFilter *) override
	{
		if (input.readInt() != 0x41524132) return false;
		const float restored = input.readFloat();
		if (input.failed() || !std::isfinite(restored) || restored < 0.0F || restored > 1.0F) return false;
		gain = restored;
		return true;
	}
	bool doStoreObjectsToStream(juce::ARAOutputStream &output, const juce::ARAStoreObjectsFilter *) override
	{
		return output.writeInt(0x41524132) && output.writeFloat(gain);
	}
	juce::ARAPlaybackRenderer *doCreatePlaybackRenderer() override { return new FixtureRenderer(getDocumentController(), gain); }
private:
	float gain = 0.5F;
};
class FixtureProcessor final : public juce::AudioProcessor, private juce::AudioProcessorARAExtension {
public:
	FixtureProcessor() : juce::AudioProcessor(BusesProperties().withInput("Input", juce::AudioChannelSet::stereo(), true)
		.withOutput("Output", juce::AudioChannelSet::stereo(), true)) { setLatencySamples(4); }
	const juce::String getName() const override { return "SoundscaperARAFixture"; }
	void prepareToPlay(double rate, int frames) override { prepareToPlayForARA(rate, frames, getMainBusNumOutputChannels(), getProcessingPrecision()); }
	void releaseResources() override { releaseResourcesForARA(); }
	void processBlock(juce::AudioBuffer<float> &buffer, juce::MidiBuffer &) override
	{
		if (!processBlockForARA(buffer, isRealtime(), getPlayHead())) buffer.clear();
	}
	bool isBusesLayoutSupported(const BusesLayout &layout) const override
	{
		return layout.getMainInputChannelSet() == layout.getMainOutputChannelSet()
			&& (layout.getMainOutputChannelSet() == juce::AudioChannelSet::stereo() || layout.getMainOutputChannelSet() == juce::AudioChannelSet::mono());
	}
	juce::AudioProcessorARAExtension *getARAClientExtensions() override { return this; }
	juce::AudioProcessorEditor *createEditor() override { return new juce::GenericAudioProcessorEditor(*this); }
	bool hasEditor() const override { return true; }
	bool acceptsMidi() const override { return false; }
	bool producesMidi() const override { return false; }
	double getTailLengthSeconds() const override { return 0.0; }
	int getNumPrograms() override { return 1; }
	int getCurrentProgram() override { return 0; }
	void setCurrentProgram(int) override {}
	const juce::String getProgramName(int) override { return {}; }
	void changeProgramName(int, const juce::String &) override {}
	void getStateInformation(juce::MemoryBlock &) override {}
	void setStateInformation(const void *, int) override {}
};
juce::AudioProcessor *JUCE_CALLTYPE createPluginFilter() { return new FixtureProcessor; }
const ARA::ARAFactory *JUCE_CALLTYPE createARAFactory()
{
	return juce::ARADocumentControllerSpecialisation::createARAFactory<FixtureDocument>();
}
