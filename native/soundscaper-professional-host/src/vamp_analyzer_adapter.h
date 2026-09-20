/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_VAMP_ANALYZER_ADAPTER_H
#define SOUNDSCAPER_VAMP_ANALYZER_ADAPTER_H

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace soundscaper::vamp {

enum class Status {
	ok,
	invalidArgument,
	libraryUnreadable,
	libraryMalformed,
	analyzerNotFound,
	configurationRefused,
	limitExceeded,
	cancelled,
};

enum class InputDomain { time, frequency };
enum class SampleType { oneSamplePerStep, fixedSampleRate, variableSampleRate };

struct ParameterDescriptor {
	std::string identifier;
	std::string name;
	std::string description;
	std::string unit;
	float minimumValue = 0.0F;
	float maximumValue = 0.0F;
	float defaultValue = 0.0F;
	std::optional<float> quantizeStep;
	std::vector<std::string> valueNames;
};

struct OutputDescriptor {
	std::string identifier;
	std::string name;
	std::string description;
	std::string unit;
	std::optional<std::size_t> binCount;
	std::vector<std::string> binNames;
	std::optional<std::pair<float, float>> extents;
	std::optional<float> quantizeStep;
	SampleType sampleType = SampleType::oneSamplePerStep;
	std::optional<float> sampleRate;
	bool hasDuration = false;
};

struct AnalyzerDescriptor {
	std::string identifier;
	std::string name;
	std::string description;
	std::string maker;
	std::string copyright;
	int pluginVersion = 0;
	unsigned int vampApiVersion = 0;
	InputDomain inputDomain = InputDomain::time;
	std::size_t minimumChannels = 0;
	std::size_t maximumChannels = 0;
	std::size_t preferredStepSize = 0;
	std::size_t preferredBlockSize = 0;
	std::vector<ParameterDescriptor> parameters;
	std::vector<std::string> programs;
	std::vector<OutputDescriptor> outputs;
};

struct Configuration {
	double sampleRate = 0.0;
	std::size_t channelCount = 0;
	std::size_t stepSize = 0;
	std::size_t blockSize = 0;
	std::uint64_t frameCount = 0;
	std::vector<std::pair<std::string, float>> parameters;
	std::optional<std::string> program;
};

struct Time {
	std::int64_t seconds = 0;
	std::int32_t nanoseconds = 0;
};

struct Feature {
	std::string outputId;
	std::optional<Time> timestamp;
	std::optional<Time> duration;
	std::vector<float> values;
	std::string label;
};

/**
 * One analyzer loaded from one absolute, normalized library path. Discovery is
 * deliberately outside this type: callers must grant the exact library first.
 */
class ExactVampAnalyzer final {
public:
	static Status scanExactLibrary(
		const std::filesystem::path &libraryPath, double sampleRate,
		std::vector<AnalyzerDescriptor> &descriptors, std::string &detail);

	static Status openExactLibrary(
		const std::filesystem::path &libraryPath, const std::string &analyzerIdentifier,
		double sampleRate, std::unique_ptr<ExactVampAnalyzer> &analyzer, std::string &detail);

	~ExactVampAnalyzer();
	ExactVampAnalyzer(const ExactVampAnalyzer &) = delete;
	ExactVampAnalyzer &operator=(const ExactVampAnalyzer &) = delete;

	const AnalyzerDescriptor &descriptor() const noexcept;
	Status configure(
		const Configuration &configuration, std::vector<OutputDescriptor> &outputs,
		std::string &detail);
	Status processPcm(
		std::uint64_t startFrame, const float *const *channels, std::size_t channelCount,
		std::size_t frameCount, std::vector<Feature> &features, std::string &detail);
	Status finish(std::vector<Feature> &features, std::string &detail);
	void cancel() noexcept;

private:
	struct Impl;
	explicit ExactVampAnalyzer(std::unique_ptr<Impl> impl);
	std::unique_ptr<Impl> impl_;
};

} // namespace soundscaper::vamp

#endif

