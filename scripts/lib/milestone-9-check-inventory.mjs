/* SPDX-License-Identifier: AGPL-3.0-only */

export const MILESTONE_9_EXPECTED_PREFIX_COUNTS = Object.freeze({
	SB: 9,
	FB: 17,
	SD: 5,
	FD: 6,
	PI: 4,
	SW: 5,
	FW: 6,
	PW: 4,
	SN: 12,
	FN: 14,
	SDL: 9,
	FDL: 10,
	LA: 17,
	CAP: 10,
	REL: 14,
	GAT: 10,
});

export const MILESTONE_9_EXPECTED_CHECK_IDS = Object.freeze(
	Object.entries(MILESTONE_9_EXPECTED_PREFIX_COUNTS).flatMap(([prefix, count]) =>
		Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(2, '0')}`)),
);
