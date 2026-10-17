/* SPDX-License-Identifier: AGPL-3.0-only */
#include "../src/frame_carrier.hpp"
#include "frame_fixture.hpp"
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <sstream>

int main(const int argc, char** argv) {
	try {
		if (argc != 1 && argc != 2) throw std::runtime_error("fixture requires zero or one carrier file");
		const auto generated = motionscaper::media::fixture::frames(); std::istringstream memory{generated};
		std::ifstream file; std::uint64_t length = generated.size();
		if (argc == 2) { const std::filesystem::path path{argv[1]}; file.open(path, std::ios::binary); length = std::filesystem::file_size(path); }
		std::istream& input = argc == 2 ? static_cast<std::istream&>(file) : static_cast<std::istream&>(memory);
		motionscaper::media::frame_carrier carrier{input, length, {"p", std::string(64, 'a'), "c"}};
		if (carrier.header().rate_num != 30000 || carrier.header().rate_den != 1001 || carrier.header().first_frame != 123) throw std::runtime_error("exact cadence differs");
		for (std::uint64_t index = 0; index < carrier.header().frame_count; ++index) {
			const auto frame = carrier.read(index); const auto encoded = motionscaper::media::rgba64_rec709(frame);
			if (encoded.empty()) throw std::runtime_error("empty frame");
			std::cout << encoded[0] << ' ' << encoded[3] << '\n';
		}
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
