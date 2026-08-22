/* SPDX-License-Identifier: AGPL-3.0-only */

#include "media_plan.hpp"

#include <exception>
#include <iostream>

int main(const int argc, char** argv) {
	if (argc != 3) {
		std::cerr << "usage: unified_plan_admission_fixture PLAN SHA256\n";
		return 64;
	}
	try {
		const auto plan = framescaper::media::authenticate_media_plan(argv[1], argv[2]);
		std::cout << plan.version << '|'
			<< (plan.requires_evaluated_rgba_carrier ? "carrier" : "original-only") << '|'
			<< plan.unsupported_render_family << '\n';
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 65;
	}
}
