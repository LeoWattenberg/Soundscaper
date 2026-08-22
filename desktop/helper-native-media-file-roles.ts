/* SPDX-License-Identifier: AGPL-3.0-only */

import { HelperContractViolationError } from './helper-wire-admission.ts';
import type { HelperNativeInputRole } from './helper-native-image-sequence-grant.ts';

/** Validate the exact ordered role subset admitted by encode and render file grants. */
export function assertHelperMediaFileRoles(
	values: readonly Readonly<{ readonly role: HelperNativeInputRole }>[],
): void {
	let carrierCount = 0;
	let audioCount = 0;
	let extrasStarted = false;
	for (const value of values) {
		if (value.role === 'original') {
			if (extrasStarted) unsafe('A media file job must place original inputs before derived inputs.');
			continue;
		}
		extrasStarted = true;
		if (value.role === 'evaluated-rgba-frame-pack') {
			if (audioCount > 0 || ++carrierCount > 1) {
				unsafe('A media file job admits at most one evaluated RGBA carrier before staged audio.');
			}
		} else if (value.role === 'staged-audio-mix') {
			if (++audioCount > 1) unsafe('A media file job admits at most one staged audio mix.');
		} else {
			unsafe('A media file job source has an unrelated role.');
		}
	}
}

function unsafe(message: string): never {
	throw new HelperContractViolationError('unsafe-grant', message);
}
