/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField } from '../../common/editor/closed-domain-value.ts';
import { assertPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../catalog/photo-resource-reachability-current-v1.ts';
import { verifyPhotoResourceReferencesCurrentV1, type PhotoResourceVerificationHostCurrentV1 } from './photo-media-resource-verification-current-v1.ts';
const CHECK = AbortSignal.prototype.throwIfAborted;

/** A real Current draft owns resource declarations without inventing a Photo.
 * Both selected factory receivers pin before normalization or the first yield. */
export async function verifyDevelopResourcesCurrentV1(value: unknown, host: PhotoResourceVerificationHostCurrentV1, signal?: AbortSignal): Promise<void> {
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const luts = readClosedDomainField(host as unknown as Record<string, unknown>, 'cubeLutResources', 'selected draft resource factories');
	const brushes = readClosedDomainField(host as unknown as Record<string, unknown>, 'maskRasterResources', 'selected draft resource factories');
	if (typeof luts !== 'function' || typeof brushes !== 'function') throw new TypeError('Current draft resource verification requires selected factories.');
	try {
		const collector = createPhotoResourceReachabilityCurrentV1(); collector.addDevelop(value); const references = collector.finish();
		if (signal !== undefined) Reflect.apply(CHECK, signal, []);
		await verifyPhotoResourceReferencesCurrentV1(references, { cubeLutResources: () => Reflect.apply(luts, host, []) as ReturnType<PhotoResourceVerificationHostCurrentV1['cubeLutResources']>,
			maskRasterResources: () => Reflect.apply(brushes, host, []) as ReturnType<PhotoResourceVerificationHostCurrentV1['maskRasterResources']> }, signal);
	} catch (error) { if (signal !== undefined) Reflect.apply(CHECK, signal, []); throw error; }
}
