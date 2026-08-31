/* SPDX-License-Identifier: AGPL-3.0-only */

/** Soundscaper stable packaging gate, kept separate from preview staging. */

import {
	assertSoundscaperProfessionalNativePackageInputs,
} from './soundscaper-professional-native-payload.mjs';

export function assertDesktopProfessionalNativeReleasePolicy(options, dependencies = {}) {
	const productId = options?.productId;
	const metadata = options?.productMetadata;
	const stableSelected = productId === 'soundscaper'
		&& (metadata?.applicationVersionChannel === 'stable' || metadata?.releaseChannel === 'stable');
	if (!stableSelected) return options?.release ?? null;
	if (options?.harnessPreparation === true) {
		if (!options?.release || !['built', 'pending-external'].includes(options.release.status)) {
			throw new Error('Harness preparation requires a verified native payload manifest result.');
		}
		return options.release;
	}
	if (!options?.release) {
		throw new Error('Stable Soundscaper desktop preparation requires professional native package inputs.');
	}
	const assertPackageInputs = dependencies.assertPackageInputs
		?? assertSoundscaperProfessionalNativePackageInputs;
	assertPackageInputs(options.release);
	if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/u.test(String(options.sourceRevision))
		|| options.release.buildAuthority?.sourceRevision
			!== options.sourceRevision) {
		throw new Error(
			'Stable Soundscaper professional native build result does not match the desktop source revision.',
		);
	}
	return options.release;
}
