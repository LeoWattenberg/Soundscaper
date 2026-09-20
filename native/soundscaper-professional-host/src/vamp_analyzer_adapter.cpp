/* SPDX-License-Identifier: AGPL-3.0-only */

#include "vamp_analyzer_adapter.h"
#include "vamp_exact_library.h"

#include <vamp-hostsdk/PluginHostAdapter.h>
#include <vamp-hostsdk/PluginInputDomainAdapter.h>
#include <vamp/vamp.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <limits>
#include <map>
#include <memory>
#include <set>
#include <utility>

namespace soundscaper::vamp {
namespace {

constexpr std::size_t maximumTextLength = 512u;
constexpr std::size_t maximumLabelLength = 4096u;
constexpr std::size_t maximumDescriptors = 256u;
constexpr std::size_t maximumParameters = 256u;
constexpr std::size_t maximumPrograms = 1024u;
constexpr std::size_t maximumOutputs = 256u;
constexpr std::size_t maximumBins = 65536u;
constexpr std::size_t maximumChannels = 64u;
constexpr std::size_t maximumBlockFrames = 1048576u;
constexpr std::size_t maximumChunkFrames = 65536u;
constexpr std::size_t maximumBatchFeatures = 65536u;
constexpr std::size_t maximumBatchValues = 1048576u;
constexpr std::uint64_t maximumSessionSeconds = 12u * 60u * 60u;

struct LoadedLibrary {
	detail::ExactDynamicLibrary library;
	VampGetPluginDescriptorFunction descriptors = nullptr;
};

Status loadExact(
	const std::filesystem::path &path, LoadedLibrary &loaded, std::string &detail)
{
	if (!detail::ExactDynamicLibrary::isExactPath(path)) {
		detail = "Vamp library path must be absolute and normalized.";
		return Status::invalidArgument;
	}
	if (!loaded.library.open(path)) {
		detail = "The exact Vamp library could not be opened.";
		return Status::libraryUnreadable;
	}
	loaded.descriptors = reinterpret_cast<VampGetPluginDescriptorFunction>(
		loaded.library.symbol("vampGetPluginDescriptor"));
	if (loaded.descriptors == nullptr) {
		detail = "The exact library has no Vamp descriptor entry point.";
		return Status::libraryMalformed;
	}
	return Status::ok;
}

bool boundedText(const std::string &value, std::size_t maximum = maximumTextLength)
{
	return value.size() <= maximum && value.find('\0') == std::string::npos;
}

bool identifier(const std::string &value)
{
	if (value.empty() || value.size() > 256u) return false;
	for (std::size_t index = 0; index < value.size(); ++index) {
		const unsigned char character = static_cast<unsigned char>(value[index]);
		const bool admitted = std::isalnum(character) != 0 || (index > 0u
			&& (character == '.' || character == '_' || character == ':' || character == '+'
				|| character == '/' || character == '-'));
		if (!admitted) return false;
	}
	return true;
}

bool finite(float value) { return std::isfinite(static_cast<double>(value)); }

bool copyParameter(
	const Vamp::PluginBase::ParameterDescriptor &source, ParameterDescriptor &target)
{
	if (!identifier(source.identifier) || !boundedText(source.name)
		|| !boundedText(source.description) || !boundedText(source.unit)
		|| !finite(source.minValue) || !finite(source.maxValue) || !finite(source.defaultValue)
		|| source.minValue > source.maxValue || source.defaultValue < source.minValue
		|| source.defaultValue > source.maxValue || source.valueNames.size() > maximumBins) return false;
	target.identifier = source.identifier;
	target.name = source.name;
	target.description = source.description;
	target.unit = source.unit;
	target.minimumValue = source.minValue;
	target.maximumValue = source.maxValue;
	target.defaultValue = source.defaultValue;
	if (source.isQuantized) {
		if (!finite(source.quantizeStep) || source.quantizeStep <= 0.0F) return false;
		target.quantizeStep = source.quantizeStep;
	}
	for (const auto &name : source.valueNames) {
		if (!boundedText(name)) return false;
		target.valueNames.push_back(name);
	}
	return true;
}

bool copyOutput(const Vamp::Plugin::OutputDescriptor &source, OutputDescriptor &target)
{
	if (!identifier(source.identifier) || !boundedText(source.name)
		|| !boundedText(source.description) || !boundedText(source.unit)
		|| source.binCount > maximumBins || source.binNames.size() > maximumBins) return false;
	target.identifier = source.identifier;
	target.name = source.name;
	target.description = source.description;
	target.unit = source.unit;
	if (source.hasFixedBinCount) target.binCount = source.binCount;
	if (!source.binNames.empty() && (!source.hasFixedBinCount || source.binNames.size() != source.binCount)) {
		return false;
	}
	for (const auto &name : source.binNames) {
		if (!boundedText(name)) return false;
		target.binNames.push_back(name);
	}
	if (source.hasKnownExtents) {
		if (!finite(source.minValue) || !finite(source.maxValue) || source.minValue > source.maxValue) return false;
		target.extents = std::make_pair(source.minValue, source.maxValue);
	}
	if (source.isQuantized) {
		if (!finite(source.quantizeStep) || source.quantizeStep <= 0.0F) return false;
		target.quantizeStep = source.quantizeStep;
	}
	switch (source.sampleType) {
		case Vamp::Plugin::OutputDescriptor::OneSamplePerStep:
			target.sampleType = SampleType::oneSamplePerStep;
			break;
		case Vamp::Plugin::OutputDescriptor::FixedSampleRate:
			if (!finite(source.sampleRate) || source.sampleRate <= 0.0F) return false;
			target.sampleType = SampleType::fixedSampleRate;
			target.sampleRate = source.sampleRate;
			break;
		case Vamp::Plugin::OutputDescriptor::VariableSampleRate:
			target.sampleType = SampleType::variableSampleRate;
			break;
		default: return false;
	}
	target.hasDuration = source.hasDuration;
	return true;
}

bool describe(Vamp::Plugin &plugin, AnalyzerDescriptor &target, std::string &detail)
{
	target.identifier = plugin.getIdentifier();
	target.name = plugin.getName();
	target.description = plugin.getDescription();
	target.maker = plugin.getMaker();
	target.copyright = plugin.getCopyright();
	if (!identifier(target.identifier) || !boundedText(target.name)
		|| !boundedText(target.description) || !boundedText(target.maker)
		|| !boundedText(target.copyright)) {
		detail = "The Vamp analyzer reported malformed identity text.";
		return false;
	}
	target.pluginVersion = plugin.getPluginVersion();
	target.vampApiVersion = plugin.getVampApiVersion();
	if (target.pluginVersion < 0 || target.vampApiVersion < 1u
		|| target.vampApiVersion > VAMP_API_VERSION) {
		detail = "The Vamp analyzer reported unsupported version metadata.";
		return false;
	}
	target.inputDomain = plugin.getInputDomain() == Vamp::Plugin::FrequencyDomain
		? InputDomain::frequency : InputDomain::time;
	target.minimumChannels = plugin.getMinChannelCount();
	target.maximumChannels = plugin.getMaxChannelCount();
	target.preferredStepSize = plugin.getPreferredStepSize();
	target.preferredBlockSize = plugin.getPreferredBlockSize();
	if (target.minimumChannels < 1u || target.minimumChannels > target.maximumChannels
		|| target.maximumChannels > maximumChannels
		|| target.preferredStepSize > maximumBlockFrames
		|| target.preferredBlockSize > maximumBlockFrames) {
		detail = "The Vamp analyzer reported unsupported stream geometry.";
		return false;
	}
	const auto parameters = plugin.getParameterDescriptors();
	const auto programs = plugin.getPrograms();
	const auto outputs = plugin.getOutputDescriptors();
	if (parameters.size() > maximumParameters || programs.size() > maximumPrograms
		|| outputs.empty() || outputs.size() > maximumOutputs) {
		detail = "The Vamp analyzer descriptor exceeds collection limits.";
		return false;
	}
	std::set<std::string> parameterIds;
	for (const auto &source : parameters) {
		ParameterDescriptor parameter;
		if (!copyParameter(source, parameter) || !parameterIds.insert(parameter.identifier).second) {
			detail = "The Vamp analyzer reported a malformed parameter descriptor.";
			return false;
		}
		target.parameters.push_back(std::move(parameter));
	}
	std::set<std::string> programNames;
	for (const auto &program : programs) {
		if (!boundedText(program) || !programNames.insert(program).second) {
			detail = "The Vamp analyzer reported a malformed program list.";
			return false;
		}
		target.programs.push_back(program);
	}
	std::set<std::string> outputIds;
	for (const auto &source : outputs) {
		OutputDescriptor output;
		if (!copyOutput(source, output) || !outputIds.insert(output.identifier).second) {
			detail = "The Vamp analyzer reported a malformed output descriptor.";
			return false;
		}
		target.outputs.push_back(std::move(output));
	}
	return true;
}

Time copyTime(const Vamp::RealTime &source)
{
	return Time{static_cast<std::int64_t>(source.sec), static_cast<std::int32_t>(source.nsec)};
}

Vamp::RealTime frameTime(std::uint64_t frame, double sampleRate)
{
	const auto seconds = static_cast<std::int64_t>(frame / static_cast<std::uint64_t>(sampleRate));
	const double remainder = static_cast<double>(frame) - static_cast<double>(seconds) * sampleRate;
	auto nanoseconds = static_cast<std::int64_t>(std::llround(remainder * 1000000000.0 / sampleRate));
	std::int64_t normalizedSeconds = seconds;
	if (nanoseconds >= 1000000000LL) { ++normalizedSeconds; nanoseconds -= 1000000000LL; }
	return Vamp::RealTime(static_cast<int>(normalizedSeconds), static_cast<int>(nanoseconds));
}

bool appendFeatures(
	const Vamp::Plugin::FeatureSet &source, const std::vector<OutputDescriptor> &outputs,
	std::vector<Feature> &target, std::string &detail)
{
	std::size_t valueCount = 0u;
	for (const auto &feature : target) {
		if (valueCount > maximumBatchValues - feature.values.size()) return false;
		valueCount += feature.values.size();
	}
	for (const auto &[outputIndex, featureList] : source) {
		if (outputIndex < 0 || static_cast<std::size_t>(outputIndex) >= outputs.size()) {
			detail = "The Vamp analyzer returned an unknown output index.";
			return false;
		}
		for (const auto &sourceFeature : featureList) {
			const auto &output = outputs[static_cast<std::size_t>(outputIndex)];
			if (target.size() >= maximumBatchFeatures
				|| sourceFeature.values.size() > maximumBins
				|| (output.binCount.has_value() && sourceFeature.values.size() != *output.binCount)
				|| valueCount > maximumBatchValues - sourceFeature.values.size()
				|| !boundedText(sourceFeature.label, maximumLabelLength)) {
				detail = "The Vamp analyzer feature batch exceeds its limits.";
				return false;
			}
			Feature feature;
			feature.outputId = output.identifier;
			if (sourceFeature.hasTimestamp) feature.timestamp = copyTime(sourceFeature.timestamp);
			if (sourceFeature.hasDuration) feature.duration = copyTime(sourceFeature.duration);
			for (const float value : sourceFeature.values) {
				if (!finite(value)) {
					detail = "The Vamp analyzer returned a non-finite feature value.";
					return false;
				}
				feature.values.push_back(value);
			}
			feature.label = sourceFeature.label;
			valueCount += feature.values.size();
			target.push_back(std::move(feature));
		}
	}
	return true;
}

} // namespace

struct ExactVampAnalyzer::Impl {
	detail::ExactDynamicLibrary library;
	std::unique_ptr<Vamp::Plugin> plugin;
	AnalyzerDescriptor descriptor;
	double sampleRate = 0.0;
	std::size_t channelCount = 0u;
	std::size_t stepSize = 0u;
	std::size_t blockSize = 0u;
	std::uint64_t frameCount = 0u;
	std::uint64_t receivedFrames = 0u;
	std::uint64_t windowStart = 0u;
	std::vector<OutputDescriptor> outputs;
	std::vector<std::vector<float>> buffers;
	bool configured = false;
	bool finished = false;
	bool cancelled = false;
};

Status ExactVampAnalyzer::scanExactLibrary(
	const std::filesystem::path &libraryPath, double sampleRate,
	std::vector<AnalyzerDescriptor> &descriptors, std::string &detail)
{
	descriptors.clear();
	detail.clear();
	if (!std::isfinite(sampleRate) || std::floor(sampleRate) != sampleRate
		|| sampleRate < 8000.0 || sampleRate > 768000.0) {
		detail = "Invalid Vamp scan sample rate.";
		return Status::invalidArgument;
	}
	try {
		LoadedLibrary loaded;
		const Status status = loadExact(libraryPath, loaded, detail);
		if (status != Status::ok) return status;
		for (unsigned int index = 0u; index <= maximumDescriptors; ++index) {
			const VampPluginDescriptor *descriptor = loaded.descriptors(VAMP_API_VERSION, index);
			if (descriptor == nullptr) {
				if (descriptors.empty()) {
					detail = "The exact Vamp library contains no analyzers.";
					return Status::libraryMalformed;
				}
				return Status::ok;
			}
			if (index == maximumDescriptors) {
				detail = "The exact Vamp library exceeds the analyzer limit.";
				return Status::limitExceeded;
			}
			Vamp::PluginHostAdapter plugin(descriptor, static_cast<float>(sampleRate));
			AnalyzerDescriptor copied;
			if (!describe(plugin, copied, detail)) return Status::libraryMalformed;
			descriptors.push_back(std::move(copied));
		}
	} catch (...) {
		detail = "The exact Vamp library failed while its descriptors were inspected.";
		return Status::libraryMalformed;
	}
	return Status::libraryMalformed;
}

Status ExactVampAnalyzer::openExactLibrary(
	const std::filesystem::path &libraryPath, const std::string &analyzerIdentifier,
	double sampleRate, std::unique_ptr<ExactVampAnalyzer> &analyzer, std::string &detail)
{
	analyzer.reset();
	detail.clear();
	if (!identifier(analyzerIdentifier) || !std::isfinite(sampleRate)
		|| std::floor(sampleRate) != sampleRate
		|| sampleRate < 8000.0 || sampleRate > 768000.0) {
		detail = "Invalid Vamp analyzer open request.";
		return Status::invalidArgument;
	}
	try {
		LoadedLibrary loaded;
		const Status status = loadExact(libraryPath, loaded, detail);
		if (status != Status::ok) return status;
		const VampPluginDescriptor *selected = nullptr;
		for (unsigned int index = 0u; index <= maximumDescriptors; ++index) {
			const VampPluginDescriptor *candidate = loaded.descriptors(VAMP_API_VERSION, index);
			if (candidate == nullptr) break;
			if (index == maximumDescriptors) return Status::limitExceeded;
			if (candidate->identifier != nullptr && analyzerIdentifier == candidate->identifier) {
				selected = candidate;
				break;
			}
		}
		if (selected == nullptr) {
			detail = "The exact Vamp library does not contain that analyzer.";
			return Status::analyzerNotFound;
		}
		auto plugin = std::make_unique<Vamp::PluginHostAdapter>(selected, static_cast<float>(sampleRate));
		AnalyzerDescriptor copied;
		if (!describe(*plugin, copied, detail) || copied.identifier != analyzerIdentifier) {
			return Status::libraryMalformed;
		}
		std::unique_ptr<Vamp::Plugin> adapted = std::move(plugin);
		if (adapted->getInputDomain() == Vamp::Plugin::FrequencyDomain) {
			adapted = std::make_unique<Vamp::HostExt::PluginInputDomainAdapter>(adapted.release());
		}
		auto impl = std::make_unique<Impl>();
		impl->library = std::move(loaded.library);
		impl->plugin = std::move(adapted);
		impl->descriptor = std::move(copied);
		impl->sampleRate = sampleRate;
		analyzer = std::unique_ptr<ExactVampAnalyzer>(new ExactVampAnalyzer(std::move(impl)));
		return Status::ok;
	} catch (...) {
		detail = "The exact Vamp analyzer failed while it was opened.";
		return Status::libraryMalformed;
	}
}

ExactVampAnalyzer::ExactVampAnalyzer(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}
ExactVampAnalyzer::~ExactVampAnalyzer() = default;

const AnalyzerDescriptor &ExactVampAnalyzer::descriptor() const noexcept { return impl_->descriptor; }

Status ExactVampAnalyzer::configure(
	const Configuration &configuration, std::vector<OutputDescriptor> &outputs,
	std::string &detail)
{
	outputs.clear();
	detail.clear();
	if (impl_->cancelled) return Status::cancelled;
	if (impl_->configured || impl_->finished || configuration.sampleRate != impl_->sampleRate
		|| std::floor(configuration.sampleRate) != configuration.sampleRate
		|| configuration.channelCount < impl_->descriptor.minimumChannels
		|| configuration.channelCount > impl_->descriptor.maximumChannels
		|| configuration.stepSize < 1u || configuration.stepSize > configuration.blockSize
		|| configuration.blockSize > maximumBlockFrames
		|| configuration.frameCount > static_cast<std::uint64_t>(configuration.sampleRate * maximumSessionSeconds)) {
		detail = "Invalid Vamp analyzer configuration.";
		return Status::invalidArgument;
	}
	try {
		if (configuration.program.has_value()) {
			if (std::find(impl_->descriptor.programs.begin(), impl_->descriptor.programs.end(),
				*configuration.program) == impl_->descriptor.programs.end()) return Status::configurationRefused;
			impl_->plugin->selectProgram(*configuration.program);
		}
		std::set<std::string> seen;
		for (const auto &[parameterId, value] : configuration.parameters) {
			const auto found = std::find_if(impl_->descriptor.parameters.begin(), impl_->descriptor.parameters.end(),
				[&parameterId](const ParameterDescriptor &candidate) { return candidate.identifier == parameterId; });
			if (found == impl_->descriptor.parameters.end() || !seen.insert(parameterId).second
				|| !finite(value) || value < found->minimumValue || value > found->maximumValue) {
				return Status::configurationRefused;
			}
			impl_->plugin->setParameter(parameterId, value);
		}
		if (seen.size() != impl_->descriptor.parameters.size()) return Status::configurationRefused;
		if (!impl_->plugin->initialise(configuration.channelCount,
			configuration.stepSize, configuration.blockSize)) {
			detail = "The Vamp analyzer refused its stream configuration.";
			return Status::configurationRefused;
		}
		const auto nativeOutputs = impl_->plugin->getOutputDescriptors();
		if (nativeOutputs.size() > maximumOutputs) return Status::limitExceeded;
		std::set<std::string> identifiers;
		for (const auto &nativeOutput : nativeOutputs) {
			OutputDescriptor output;
			if (!copyOutput(nativeOutput, output) || !identifiers.insert(output.identifier).second) {
				return Status::libraryMalformed;
			}
			outputs.push_back(std::move(output));
		}
		impl_->channelCount = configuration.channelCount;
		impl_->stepSize = configuration.stepSize;
		impl_->blockSize = configuration.blockSize;
		impl_->frameCount = configuration.frameCount;
		impl_->outputs = outputs;
		impl_->buffers.assign(configuration.channelCount, {});
		for (auto &buffer : impl_->buffers) buffer.reserve(configuration.blockSize + maximumChunkFrames);
		impl_->configured = true;
		return Status::ok;
	} catch (...) {
		cancel();
		detail = "The Vamp analyzer failed while it was configured.";
		return Status::libraryMalformed;
	}
}

Status ExactVampAnalyzer::processPcm(
	std::uint64_t startFrame, const float *const *channels, std::size_t channelCount,
	std::size_t frameCount, std::vector<Feature> &features, std::string &detail)
{
	features.clear();
	detail.clear();
	if (impl_->cancelled) return Status::cancelled;
	if (!impl_->configured || impl_->finished || startFrame != impl_->receivedFrames
		|| channelCount != impl_->channelCount || frameCount < 1u || frameCount > maximumChunkFrames
		|| channels == nullptr || startFrame + frameCount > impl_->frameCount) {
		detail = "Invalid Vamp PCM stream chunk.";
		return Status::invalidArgument;
	}
	try {
		for (std::size_t channel = 0u; channel < channelCount; ++channel) {
			if (channels[channel] == nullptr) return Status::invalidArgument;
			for (std::size_t frame = 0u; frame < frameCount; ++frame) {
				if (!finite(channels[channel][frame])) return Status::invalidArgument;
			}
			impl_->buffers[channel].insert(impl_->buffers[channel].end(),
				channels[channel], channels[channel] + frameCount);
		}
		impl_->receivedFrames += frameCount;
		while (!impl_->buffers.empty() && impl_->buffers[0].size() >= impl_->blockSize) {
			std::vector<const float *> pointers;
			pointers.reserve(impl_->channelCount);
			for (const auto &buffer : impl_->buffers) pointers.push_back(buffer.data());
			const auto native = impl_->plugin->process(pointers.data(),
				frameTime(impl_->windowStart, impl_->sampleRate));
			if (!appendFeatures(native, impl_->outputs, features, detail)) return Status::limitExceeded;
			for (auto &buffer : impl_->buffers) buffer.erase(buffer.begin(), buffer.begin() + impl_->stepSize);
			impl_->windowStart += impl_->stepSize;
		}
		return Status::ok;
	} catch (...) {
		cancel();
		detail = "The Vamp analyzer failed while it processed PCM.";
		return Status::libraryMalformed;
	}
}

Status ExactVampAnalyzer::finish(std::vector<Feature> &features, std::string &detail)
{
	features.clear();
	detail.clear();
	if (impl_->cancelled) return Status::cancelled;
	if (!impl_->configured || impl_->finished || impl_->receivedFrames != impl_->frameCount) {
		detail = "The Vamp analyzer cannot finish an incomplete stream.";
		return Status::invalidArgument;
	}
	try {
		while (impl_->windowStart < impl_->frameCount) {
			std::vector<std::vector<float>> block(impl_->channelCount,
				std::vector<float>(impl_->blockSize, 0.0F));
			std::vector<const float *> pointers;
			for (std::size_t channel = 0u; channel < impl_->channelCount; ++channel) {
				const std::size_t copied = std::min(impl_->blockSize, impl_->buffers[channel].size());
				std::copy_n(impl_->buffers[channel].begin(), copied, block[channel].begin());
				pointers.push_back(block[channel].data());
			}
			const auto native = impl_->plugin->process(pointers.data(),
				frameTime(impl_->windowStart, impl_->sampleRate));
			if (!appendFeatures(native, impl_->outputs, features, detail)) return Status::limitExceeded;
			for (auto &buffer : impl_->buffers) {
				const std::size_t erased = std::min(impl_->stepSize, buffer.size());
				buffer.erase(buffer.begin(), buffer.begin() + erased);
			}
			impl_->windowStart += impl_->stepSize;
		}
		if (!appendFeatures(impl_->plugin->getRemainingFeatures(), impl_->outputs, features, detail)) {
			return Status::limitExceeded;
		}
		impl_->finished = true;
		for (auto &buffer : impl_->buffers) buffer.clear();
		return Status::ok;
	} catch (...) {
		cancel();
		detail = "The Vamp analyzer failed while it finished.";
		return Status::libraryMalformed;
	}
}

void ExactVampAnalyzer::cancel() noexcept
{
	impl_->cancelled = true;
	for (auto &buffer : impl_->buffers) buffer.clear();
}

} // namespace soundscaper::vamp
