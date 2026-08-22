/* SPDX-License-Identifier: AGPL-3.0-only */

#include "exact_retime_ordinal.hpp"

#include <array>
#include <cassert>

using namespace soundscaper::framescaper;

int main() {
	const ExactRetimeSegment almost_ten{
		RetimeMode::constant_forward,
		0,
		1,
		ExactRational(cpp_int("90071992547409909"), cpp_int("9007199254740991")),
		ExactRational(10),
		ExactRational(1),
		ExactRational(1),
	};
	assert(exact_picture_ordinal(almost_ten, 0, 0, 20) == 9);

	const ExactRetimeSegment reverse{
		RetimeMode::constant_reverse,
		0,
		2,
		ExactRational(12),
		ExactRational(10),
		ExactRational(1),
		ExactRational(1),
	};
	assert(exact_picture_ordinal(reverse, 0, 0, 20) == 11);
	assert(exact_picture_ordinal(reverse, 1, 0, 20) == 10);

	const std::vector<ExactRational> vfr{
		ExactRational(0), ExactRational(1), ExactRational(3),
		ExactRational(6), ExactRational(10),
	};
	assert(exact_picture_ordinal_at_time(vfr, ExactRational(5, 2)) == 1);
	assert(exact_picture_ordinal_at_time(vfr, ExactRational(5)) == 2);
	assert(exact_output_sample(1'999'999, 0, 1, 2'000'000, 1) == 0);
}
