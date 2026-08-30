/* SPDX-License-Identifier: AGPL-3.0-only */

/** Soundscaper stable packaging gate, kept separate from preview staging. */

import {
	assertSoundscaperProfessionalNativeStablePackageRelease,
} from './soundscaper-professional-native-payload.mjs';

export function assertDesktopProfessionalNativeReleasePolicy(options, dependencies = {}) {
	const productId = options?.productId;
	const metadata = options?.productMetadata;
	const stableSelected = productId === 'soundscaper'
		&& (metadata?.applicationVersionChannel === 'stable' || metadata?.releaseChannel === 'stable');
	if (!stableSelected) return options?.release ?? null;
	if (!options?.release) {
		throw new Error('Stable Soundscaper desktop preparation requires a professional native release.');
	}
	const assertStable = dependencies.assertStable
		?? assertSoundscaperProfessionalNativeStablePackageRelease;
	assertStable(options.release);
	if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/u.test(String(options.sourceRevision))
		|| options.release.productionReadiness?.candidateAuthority?.sourceRevision
			!== options.sourceRevision) {
		throw new Error(
			'Stable Soundscaper professional candidate source revision does not match the desktop source revision.',
		);
	}
	return options.release;
}
