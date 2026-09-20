/* SPDX-License-Identifier: AGPL-3.0-only */

#include "vamp_analyzer_adapter.h"

#include <filesystem>
#include <memory>
#include <string>
#include <vector>

int main(int argc, char **argv)
{
	using namespace soundscaper::vamp;
	if (argc != 2) return 1;
	const std::string rawPath(argv[1]);
	const auto path = std::filesystem::weakly_canonical(std::filesystem::path(std::u8string(
		reinterpret_cast<const char8_t *>(rawPath.data()),
		reinterpret_cast<const char8_t *>(rawPath.data() + rawPath.size()))));
	std::string detail;
	std::vector<AnalyzerDescriptor> descriptors;
	if (ExactVampAnalyzer::scanExactLibrary(path, 48000.0, descriptors, detail) != Status::ok
		|| descriptors.size() != 1u
		|| descriptors[0].identifier != "org.soundscaper.fixture.amplitude"
		|| descriptors[0].parameters.size() != 1u || descriptors[0].outputs.size() != 1u) return 2;
	std::unique_ptr<ExactVampAnalyzer> analyzer;
	if (ExactVampAnalyzer::openExactLibrary(path, descriptors[0].identifier, 48000.0,
		analyzer, detail) != Status::ok || analyzer == nullptr) return 3;
	Configuration configuration;
	configuration.sampleRate = 48000.0;
	configuration.channelCount = 1u;
	configuration.stepSize = 2u;
	configuration.blockSize = 4u;
	configuration.frameCount = 4u;
	configuration.parameters.emplace_back("gain", 1.0F);
	configuration.program = "Default";
	std::vector<OutputDescriptor> outputs;
	if (analyzer->configure(configuration, outputs, detail) != Status::ok
		|| outputs.size() != 1u || outputs[0].identifier != "amplitude") return 4;
	const std::vector<float> pcm{0.25F, 0.5F, 0.75F, 1.0F};
	const float *planes[] = { pcm.data() };
	std::vector<Feature> features;
	if (analyzer->processPcm(0u, planes, 1u, pcm.size(), features, detail) != Status::ok
		|| features.size() != 1u || features[0].values.size() != 1u
		|| features[0].values[0] != 0.25F) return 5;
	if (analyzer->finish(features, detail) != Status::ok || features.empty()) return 6;
	analyzer->cancel();
	return 0;
}
