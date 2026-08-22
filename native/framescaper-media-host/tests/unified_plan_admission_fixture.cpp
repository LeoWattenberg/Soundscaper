/* SPDX-License-Identifier: AGPL-3.0-only */

#include "media_plan.hpp"

#include <exception>
#include <filesystem>
#include <iostream>
#include <vector>

int main(const int argc, char** argv) {
	if (argc < 3 || (argc - 3) % 2 != 0) {
		std::cerr << "usage: unified_plan_admission_fixture PLAN SHA256 [TIMING SHA256]...\n";
		return 64;
	}
	try {
		std::vector<framescaper::media::video_timing_asset_grant> timing_grants;
		for (int index = 3; index < argc; index += 2) {
			timing_grants.push_back({std::filesystem::path{argv[index]}, argv[index + 1]});
		}
		const auto plan = framescaper::media::authenticate_media_plan(
			argv[1], argv[2], timing_grants
		);
		std::cout << plan.version << '|'
			<< (plan.requires_evaluated_rgba_carrier ? "carrier" : "original-only") << '|'
			<< plan.unsupported_render_family << '\n';
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 65;
	}
}
