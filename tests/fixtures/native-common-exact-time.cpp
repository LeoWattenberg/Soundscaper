/* SPDX-License-Identifier: AGPL-3.0-only */

#include "../../native/common/exact_time.hpp"

#include <cstdint>
#include <stdexcept>
#include <string>
#include <utility>

namespace {

void require(const bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

} // namespace

int main() {
	using scape::native_common::compare_rationals;

	require(compare_rationals({1, 2}, {2, 4}) == 0, "equivalent rationals differ");
	require(compare_rationals({-5, 7}, {-4, 7}) < 0, "negative rational order drifted");
	require(compare_rationals({9'007'199'254'740'991LL, 9'007'199'254'740'990LL},
		{9'007'199'254'740'990LL, 9'007'199'254'740'989LL}) < 0,
		"overflow-free rational order drifted");

#if defined(SCAPE_EXPECT_EXACT_CADENCE) && !defined(SCAPE_NATIVE_COMMON_HAS_EXACT_CADENCE)
#error "The provisioned exact-cadence closure was not detected."
#endif
#if defined(SCAPE_NATIVE_COMMON_HAS_EXACT_CADENCE)
	using scape::native_common::exact_cadence_status;
	using scape::native_common::sequence_frame_at_sample;
	const auto first = sequence_frame_at_sample(0, 24'000, 1'001, 48'000);
	const auto middle = sequence_frame_at_sample(2'001, 24'000, 1'001, 48'000);
	const auto boundary = sequence_frame_at_sample(4'004, 24'000, 1'001, 48'000);
	require(first.status == exact_cadence_status::ok && first.frame == 0,
		"zero cadence sample drifted");
	require(middle.status == exact_cadence_status::ok && middle.frame == 0,
		"pre-boundary cadence sample drifted");
	require(boundary.status == exact_cadence_status::ok && boundary.frame == 2,
		"rounded cadence boundary drifted");
	require(sequence_frame_at_sample(0, 0, 1, 48'000).status
		== exact_cadence_status::invalid, "zero rate numerator was accepted");
	require(sequence_frame_at_sample(0, 24, 0, 48'000).status
		== exact_cadence_status::invalid, "zero rate denominator was accepted");
#endif
	return 0;
}
