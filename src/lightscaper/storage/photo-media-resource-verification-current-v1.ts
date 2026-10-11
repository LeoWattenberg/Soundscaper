/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField } from '../../common/editor/closed-domain-value.ts';
import { assertPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../catalog/photo-resource-reachability-current-v1.ts';
import type { PhotoMediaCubeLutResourcesV1 } from './photo-media-cube-lut-resources-v1.ts';
import type { PhotoMediaMaskRasterResourcesV1 } from './photo-media-mask-raster-resources-v1.ts';

export interface PhotoResourceVerificationHostCurrentV1 {
	cubeLutResources(): Promise<Readonly<PhotoMediaCubeLutResourcesV1>>;
	maskRasterResources(): Promise<Readonly<PhotoMediaMaskRasterResourcesV1>>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }

/** Full retained Current closure and both real factory receivers are captured
 * before yielding. The selected independent verification slots authenticate
 * serially; render scopes and original custody are never borrowed here. */
export async function verifyPhotoResourcesCurrentV1(photo: unknown, host: PhotoResourceVerificationHostCurrentV1, signal?: AbortSignal): Promise<void> {
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	check(signal);
	const luts = readClosedDomainField(host as unknown as Record<string, unknown>, 'cubeLutResources', 'selected resource factories');
	const brushes = readClosedDomainField(host as unknown as Record<string, unknown>, 'maskRasterResources', 'selected resource factories');
	if (typeof luts !== 'function' || typeof brushes !== 'function') throw new TypeError('Current resource verification requires selected callable factories.');
	let references: ReturnType<ReturnType<typeof createPhotoResourceReachabilityCurrentV1>['finish']>;
	try { const collector = createPhotoResourceReachabilityCurrentV1(); collector.addPhoto(photo); references = collector.finish(); }
	catch (error) { check(signal); throw error; }
	check(signal);
	if (references.luts.length) {
		const resources = await Reflect.apply(luts, host, []) as Readonly<PhotoMediaCubeLutResourcesV1>; check(signal);
		const verify = readClosedDomainField(resources as unknown as Record<string, unknown>, 'verifyReferencesV1', 'selected LUT verifier');
		if (typeof verify !== 'function') throw new TypeError('Current LUT resources require an independent selected verifier.');
		await Reflect.apply(verify, resources, [references.luts, signal]); check(signal);
	}
	if (references.brushes.length) {
		const resources = await Reflect.apply(brushes, host, []) as Readonly<PhotoMediaMaskRasterResourcesV1>; check(signal);
		const verify = readClosedDomainField(resources as unknown as Record<string, unknown>, 'verifyReferencesV1', 'selected brush verifier');
		if (typeof verify !== 'function') throw new TypeError('Current brush resources require an independent selected verifier.');
		await Reflect.apply(verify, resources, [references.brushes, signal]); check(signal);
	}
}
