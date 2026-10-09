/* SPDX-License-Identifier: AGPL-3.0-only */
#include "juce_ara_adapter.h"
#include "ara_factory_library_lease.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <map>
#include <limits>
#include <mutex>
namespace soundscaper {
namespace {
constexpr size_t maximumArchiveBytes = SOUNDSCAPER_PRO_MAX_STATE_BYTES - 64u;
using SourceConverter = juce::ARAHostModel::ConversionFunctions<AraClipData *, ARA::ARAAudioSourceHostRef>;
class AudioAccess final : public ARA::Host::AudioAccessControllerInterface {
	struct Reader { AraClipData *source; bool use64Bit; };
	using Converter = juce::ARAHostModel::ConversionFunctions<Reader *, ARA::ARAAudioReaderHostRef>;
	std::mutex mutex;
	std::map<Reader *, std::unique_ptr<Reader>> readers;
public:
	ARA::ARAAudioReaderHostRef createAudioReaderForSource(ARA::ARAAudioSourceHostRef source, bool wide) noexcept override
	{
		try {
			auto reader = std::make_unique<Reader>(Reader{SourceConverter::fromHostRef(source), wide});
			const auto ref = Converter::toHostRef(reader.get());
			std::lock_guard lock(mutex);
			readers.emplace(reader.get(), std::move(reader));
			return ref;
		} catch (...) { return nullptr; }
	}
	bool readAudioSamples(ARA::ARAAudioReaderHostRef ref, ARA::ARASamplePosition start,
		ARA::ARASampleCount count, void *const *buffers) noexcept override
	{
		std::lock_guard lock(mutex);
		const auto found = readers.find(Converter::fromHostRef(ref));
		return found != readers.end() && found->second->source->read(start, count, buffers, found->second->use64Bit);
	}
	void destroyAudioReader(ARA::ARAAudioReaderHostRef ref) noexcept override
	{
		std::lock_guard lock(mutex);
		readers.erase(Converter::fromHostRef(ref));
	}
};
struct Archive {
	std::vector<uint8_t> bytes;
	const char *id;
	bool failed = false;
};
using ArchiveReader = juce::ARAHostModel::ConversionFunctions<Archive *, ARA::ARAArchiveReaderHostRef>;
using ArchiveWriter = juce::ARAHostModel::ConversionFunctions<Archive *, ARA::ARAArchiveWriterHostRef>;
class Archiving final : public ARA::Host::ArchivingControllerInterface {
public:
	ARA::ARASize getArchiveSize(ARA::ARAArchiveReaderHostRef ref) noexcept override { return ArchiveReader::fromHostRef(ref)->bytes.size(); }
	bool readBytesFromArchive(ARA::ARAArchiveReaderHostRef ref, ARA::ARASize position,
		ARA::ARASize length, ARA::ARAByte *buffer) noexcept override
	{
		auto &bytes = ArchiveReader::fromHostRef(ref)->bytes;
		if (position > bytes.size() || length > bytes.size() - position || (length > 0u && buffer == nullptr)) return false;
		if (length > 0u) std::memcpy(buffer, bytes.data() + position, length);
		return true;
	}
	bool writeBytesToArchive(ARA::ARAArchiveWriterHostRef ref, ARA::ARASize position,
		ARA::ARASize length, const ARA::ARAByte *buffer) noexcept override
	{
		auto &archive = *ArchiveWriter::fromHostRef(ref);
		if (position > maximumArchiveBytes || length > maximumArchiveBytes - position || (length > 0u && buffer == nullptr)) {
			archive.failed = true; return false;
		}
		try {
			archive.bytes.resize(std::max(archive.bytes.size(), position + length));
			if (length > 0u) std::memcpy(archive.bytes.data() + position, buffer, length);
			return true;
		} catch (...) { archive.failed = true; return false; }
	}
	void notifyDocumentArchivingProgress(float) noexcept override {}
	void notifyDocumentUnarchivingProgress(float) noexcept override {}
	ARA::ARAPersistentID getDocumentArchiveID(ARA::ARAArchiveReaderHostRef ref) noexcept override { return ArchiveReader::fromHostRef(ref)->id; }
};
class ModelUpdates final : public ARA::Host::ModelUpdateControllerInterface {
public:
	bool analyzing = false;
	void notifyAudioSourceAnalysisProgress(ARA::ARAAudioSourceHostRef, ARA::ARAAnalysisProgressState state, float) noexcept override
	{
		analyzing = state != ARA::kARAAnalysisProgressCompleted;
	}
	void notifyAudioSourceContentChanged(ARA::ARAAudioSourceHostRef, const ARA::ARAContentTimeRange *, ARA::ContentUpdateScopes) noexcept override {}
	void notifyAudioModificationContentChanged(ARA::ARAAudioModificationHostRef, const ARA::ARAContentTimeRange *, ARA::ContentUpdateScopes) noexcept override {}
	void notifyPlaybackRegionContentChanged(ARA::ARAPlaybackRegionHostRef, const ARA::ARAContentTimeRange *, ARA::ContentUpdateScopes) noexcept override {}
	void notifyDocumentDataChanged() noexcept override {}
};
class PlayHead final : public juce::AudioPlayHead {
public:
	juce::Optional<PositionInfo> getPosition() const override { return position; }
	PositionInfo position;
};
juce::ARAFactoryWrapper factoryFor(juce::AudioPluginInstance &plugin)
{
	// The pinned JUCE VST3 client calls this callback synchronously. No AU/CLAP
	// instance is passed here, so no asynchronous lifetime assumption is made.
	juce::ARAFactoryWrapper factory;
	juce::createARAFactoryAsync(plugin, [&](juce::ARAFactoryWrapper value) { factory = std::move(value); });
	return factory;
}
}
class JuceAraSession::Impl : public juce::Timer {
public:
	Impl(juce::AudioPluginInstance &opened, uint32_t maximumFrames) : plugin(opened), ceiling(maximumFrames) {}
	void timerCallback() override { if (document != nullptr) document->getDocumentController().notifyModelUpdates(); }
	juce::AudioPluginInstance &plugin;
	uint32_t ceiling;
	AraClipData data;
	PlayHead playHead;
	juce::AudioBuffer<float> buffer;
	juce::MidiBuffer midi;
	// The ARA document outlives the VST3 instance. JUCE releases the instance's
	// DLL handle first, so retain Windows code until document and factory teardown.
	AraFactoryLibraryLease factoryLibrary;
	juce::ARAFactoryWrapper factory;
	ModelUpdates *updates = nullptr;
	std::unique_ptr<juce::ARAHostDocumentController> document;
	std::unique_ptr<juce::ARAHostModel::MusicalContext> context;
	std::unique_ptr<juce::ARAHostModel::RegionSequence> sequence;
	std::unique_ptr<juce::ARAHostModel::AudioSource> source;
	std::unique_ptr<juce::ARAHostModel::AudioModification> modification;
	std::unique_ptr<juce::ARAHostModel::PlaybackRegion> region;
	std::unique_ptr<juce::ARAHostModel::PlaybackRendererInterface> playbackRenderer;
	std::unique_ptr<juce::ARAHostModel::EditorRendererInterface> editorRenderer;
	bool prepared = false;
	uint64_t renderedThrough = std::numeric_limits<uint64_t>::max();
	uint32_t renderLatency = 0u;
	std::string modificationId;
};
bool JuceAraSession::supported(juce::AudioPluginInstance &plugin)
{
	return plugin.getPluginDescription().hasARAExtension && factoryFor(plugin).get() != nullptr;
}
JuceAraSession::JuceAraSession(juce::AudioPluginInstance &plugin, uint32_t maximumFrames)
	: impl(std::make_unique<Impl>(plugin, maximumFrames)) {}
JuceAraSession::~JuceAraSession() = default;
void JuceAraSession::unregisterRenderers()
{
	impl->stopTimer();
	// JUCE 9.0.1's registry destructor iterates the map it erases from. Remove
	// our region explicitly while both model and extension are still alive.
	if (impl->region != nullptr) {
		if (impl->playbackRenderer != nullptr) impl->playbackRenderer->remove(*impl->region);
		if (impl->editorRenderer != nullptr && impl->editorRenderer->isValid()) impl->editorRenderer->remove(*impl->region);
	}
	impl->playbackRenderer.reset(); impl->editorRenderer.reset();
}
soundscaper_pro_status JuceAraSession::configure(const soundscaper_pro_ara_clip &clip)
{
	if (impl->document != nullptr) return SOUNDSCAPER_PRO_MODE_REFUSED;
	if (std::abs(clip.sample_rate - impl->plugin.getSampleRate()) > 1e-9) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	const auto status = impl->data.configure(clip);
	if (status != SOUNDSCAPER_PRO_OK) return status;
	auto layout = impl->plugin.getBusesLayout();
	const auto channels = juce::AudioChannelSet::canonicalChannelSet(static_cast<int>(clip.channel_count));
	if (!layout.inputBuses.isEmpty()) layout.inputBuses.set(0, channels);
	if (!layout.outputBuses.isEmpty()) layout.outputBuses.set(0, channels);
	for (int index = 1; index < layout.inputBuses.size(); ++index) layout.inputBuses.set(index, juce::AudioChannelSet::disabled());
	for (int index = 1; index < layout.outputBuses.size(); ++index) layout.outputBuses.set(index, juce::AudioChannelSet::disabled());
	if (!impl->plugin.setBusesLayout(layout)) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	return SOUNDSCAPER_PRO_OK;
}
soundscaper_pro_status JuceAraSession::write(uint32_t start, const float *const *planes, uint32_t channels, uint32_t frames)
{
	return impl->document != nullptr ? SOUNDSCAPER_PRO_MODE_REFUSED : impl->data.write(start, planes, channels, frames);
}
soundscaper_pro_status JuceAraSession::bind()
{
	auto &s = *impl;
	if (s.document != nullptr || !s.data.ready()) return SOUNDSCAPER_PRO_MODE_REFUSED;
	s.factory = factoryFor(s.plugin);
	if (s.factory.get() == nullptr || s.factory.get()->highestSupportedApiGeneration < ARA::kARAAPIGeneration_2_0_Final) return SOUNDSCAPER_PRO_UNSUPPORTED;
	if (!s.factoryLibrary.retain(reinterpret_cast<const void *>(s.factory.get()->initializeARAWithConfiguration))) return SOUNDSCAPER_PRO_UNSUPPORTED;
	s.plugin.releaseResources();
	s.plugin.setNonRealtime(true);
	auto updates = std::make_unique<ModelUpdates>();
	s.updates = updates.get();
	s.document = juce::ARAHostDocumentController::create(s.factory, "Soundscaper / Framescaper clip",
		std::make_unique<AudioAccess>(), std::make_unique<Archiving>(), nullptr, std::move(updates));
	if (s.document == nullptr) return SOUNDSCAPER_PRO_UNSUPPORTED;
	const auto roles = ARA::kARAPlaybackRendererRole | ARA::kARAEditorRendererRole | ARA::kARAEditorViewRole;
	const auto extension = s.document->bindDocumentToPluginInstance(s.plugin, roles, roles);
	if (!extension.isValid()) return SOUNDSCAPER_PRO_UNSUPPORTED;
	s.playbackRenderer = std::make_unique<juce::ARAHostModel::PlaybackRendererInterface>(extension.getPlaybackRendererInterface());
	s.editorRenderer = std::make_unique<juce::ARAHostModel::EditorRendererInterface>(extension.getEditorRendererInterface());
	if (!s.playbackRenderer->isValid()) return SOUNDSCAPER_PRO_UNSUPPORTED;
	auto &dc = s.document->getDocumentController();
	{
		juce::ARAEditGuard edit(dc);
		auto context = juce::ARAHostModel::MusicalContext::getEmptyProperties();
		context.name = "Clip timeline"; context.orderIndex = 0; context.color = nullptr;
		s.context = std::make_unique<juce::ARAHostModel::MusicalContext>(nullptr, dc, context);
		auto sequence = juce::ARAHostModel::RegionSequence::getEmptyProperties();
		sequence.name = s.data.name.c_str(); sequence.orderIndex = 0; sequence.musicalContextRef = s.context->getPluginRef(); sequence.color = nullptr;
		s.sequence = std::make_unique<juce::ARAHostModel::RegionSequence>(nullptr, dc, sequence);
		auto source = juce::ARAHostModel::AudioSource::getEmptyProperties();
		source.name = s.data.name.c_str(); source.persistentID = s.data.id.c_str(); source.sampleCount = s.data.frameCount;
		source.sampleRate = s.data.sampleRate; source.channelCount = static_cast<int32_t>(s.data.channelCount); source.merits64BitSamples = ARA::kARAFalse;
		s.source = std::make_unique<juce::ARAHostModel::AudioSource>(SourceConverter::toHostRef(&s.data), dc, source);
		auto modification = juce::ARAHostModel::AudioModification::getEmptyProperties();
		s.modificationId = s.data.id + "/modification"; modification.persistentID = s.modificationId.c_str();
		s.modification = std::make_unique<juce::ARAHostModel::AudioModification>(nullptr, dc, *s.source, modification);
		auto region = juce::ARAHostModel::PlaybackRegion::getEmptyProperties();
		region.transformationFlags = ARA::kARAPlaybackTransformationNoChanges;
		region.startInModificationTime = s.data.sourceStart; region.durationInModificationTime = s.data.duration;
		region.startInPlaybackTime = s.data.playbackStart; region.durationInPlaybackTime = s.data.duration;
		region.musicalContextRef = s.context->getPluginRef(); region.regionSequenceRef = s.sequence->getPluginRef();
		region.name = s.data.name.c_str(); region.color = nullptr;
		s.region = std::make_unique<juce::ARAHostModel::PlaybackRegion>(nullptr, dc, *s.modification, region);
		s.source->enableAudioSourceSamplesAccess(true);
	}
	s.playbackRenderer->add(*s.region);
	if (s.editorRenderer->isValid()) s.editorRenderer->add(*s.region);
	s.plugin.setPlayHead(&s.playHead);
	s.buffer.setSize(static_cast<int>(s.data.channelCount), static_cast<int>(s.ceiling));
	s.plugin.prepareToPlay(s.data.sampleRate, static_cast<int>(s.ceiling));
	s.prepared = true;
	s.startTimer(50);
	return SOUNDSCAPER_PRO_OK;
}
soundscaper_pro_status JuceAraSession::render(uint32_t start, float **planes, uint32_t channels, uint32_t frames)
{
	auto &s = *impl;
	const auto durationFrames = static_cast<uint64_t>(std::llround(s.data.duration * s.data.sampleRate));
	if (!s.prepared || planes == nullptr || channels != s.data.channelCount || frames == 0u || frames > s.ceiling
		|| start > durationFrames || frames > durationFrames - start) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	for (uint32_t channel = 0u; channel < channels; ++channel) if (planes[channel] == nullptr) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	s.document->getDocumentController().notifyModelUpdates();
	if (s.updates->analyzing) return SOUNDSCAPER_PRO_MODE_REFUSED;
	const uint32_t latency = static_cast<uint32_t>(std::max(0, s.plugin.getLatencySamples()));
	if (latency > s.data.sampleRate * 10.0) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	uint32_t discard = 0u;
	uint64_t position = static_cast<uint64_t>(start) + latency;
	if (s.renderedThrough != position || s.renderLatency != latency) {
		s.plugin.reset();
		position = start; discard = latency;
	}
	uint32_t copied = 0u;
	juce::ScopedNoDenormals guard;
	while (discard > 0u || copied < frames) {
		const uint32_t count = static_cast<uint32_t>(std::min<uint64_t>(s.ceiling, static_cast<uint64_t>(discard) + frames - copied));
		s.playHead.position.setTimeInSamples(static_cast<int64_t>(std::llround(s.data.playbackStart * s.data.sampleRate)) + static_cast<int64_t>(position));
		s.playHead.position.setTimeInSeconds(s.data.playbackStart + static_cast<double>(position) / s.data.sampleRate);
		s.playHead.position.setIsPlaying(true);
		s.buffer.setSize(static_cast<int>(channels), static_cast<int>(count), false, false, true);
		s.buffer.clear(); s.midi.clear();
		s.plugin.processBlock(s.buffer, s.midi);
		const uint32_t skip = std::min(discard, count);
		const uint32_t available = count - skip;
		for (uint32_t channel = 0u; channel < channels; ++channel) {
			std::copy_n(s.buffer.getReadPointer(static_cast<int>(channel)) + skip, available, planes[channel] + copied);
		}
		copied += available; discard -= skip; position += count;
	}
	s.renderedThrough = position; s.renderLatency = latency;
	s.playHead.position.setIsPlaying(false);
	return SOUNDSCAPER_PRO_OK;
}
soundscaper_pro_status JuceAraSession::save(uint8_t *bytes, size_t capacity, size_t &written)
{
	auto &s = *impl;
	written = 0u;
	if (!s.prepared) return SOUNDSCAPER_PRO_MODE_REFUSED;
	Archive archive{{}, s.factory.get()->documentArchiveID};
	s.document->getDocumentController().notifyModelUpdates();
	if (!s.document->getDocumentController().storeObjectsToArchive(ArchiveWriter::toHostRef(&archive), nullptr)) {
		return archive.failed ? SOUNDSCAPER_PRO_STATE_TOO_LARGE : SOUNDSCAPER_PRO_STATE_REJECTED;
	}
	written = archive.bytes.size();
	if (capacity < written) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
	if (written > 0u && bytes == nullptr) return SOUNDSCAPER_PRO_STATE_REJECTED;
	if (written > 0u) std::memcpy(bytes, archive.bytes.data(), written);
	return SOUNDSCAPER_PRO_OK;
}
soundscaper_pro_status JuceAraSession::load(const uint8_t *bytes, size_t length)
{
	auto &s = *impl;
	if (!s.prepared || (length > 0u && bytes == nullptr)) return SOUNDSCAPER_PRO_STATE_REJECTED;
	if (length > maximumArchiveBytes) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
	Archive archive{{}, s.factory.get()->documentArchiveID};
	if (length > 0u) archive.bytes.assign(bytes, bytes + length);
	s.renderedThrough = std::numeric_limits<uint64_t>::max();
	juce::ARAEditGuard edit(s.document->getDocumentController());
	return s.document->getDocumentController().restoreObjectsFromArchive(ArchiveReader::toHostRef(&archive), nullptr)
		? SOUNDSCAPER_PRO_OK : SOUNDSCAPER_PRO_STATE_REJECTED;
}
}
