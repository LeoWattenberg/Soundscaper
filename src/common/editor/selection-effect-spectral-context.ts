/* SPDX-License-Identifier: AGPL-3.0-only */

import { initializePffft } from './pffft.js';
import { applySpectralReplacement } from './spectral-edit.js';

/** Compose a length-preserving processor into the user's selected frequency band. */
export async function applySelectionEffectSpectralContext(
	input: readonly Float32Array[],
	processed: readonly Float32Array[],
	sampleRate: number,
	context?: Readonly<Record<string, unknown>>,
): Promise<Float32Array[]> {
	const selection = context?.spectralSelection;
	if (!selection) return [...processed];
	if (typeof selection !== 'object' || Array.isArray(selection)) {
		throw new TypeError('The selection effect spectral context must be an object.');
	}
	await initializePffft();
	return applySpectralReplacement([...input], [...processed], { ...selection, sampleRate });
}
