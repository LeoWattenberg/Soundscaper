// SPDX-License-Identifier: AGPL-3.0-only

#include "professional_source_probe.hpp"

int main() {
	return framescaper::media::professional_source_characteristics_self_test() ? 0 : 1;
}
