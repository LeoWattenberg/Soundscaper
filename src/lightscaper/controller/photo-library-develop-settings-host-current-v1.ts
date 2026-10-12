/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibrarySessionPortsCurrentV1 } from './photo-library-session-ports-current-v1.ts';
import type { PhotoLibraryDevelopSettingsSessionHostCurrentV1 } from './photo-library-develop-settings-session-current-v1.ts';
import { verifyDevelopResourcesCurrentV1 } from '../storage/photo-develop-resource-verification-current-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../catalog/photo-resource-reachability-current-v1.ts';

export interface PhotoDevelopSettingsHostBindingCurrentV1 extends Pick<PhotoLibraryDevelopSettingsSessionHostCurrentV1, 'ready' | 'operation' | 'mutate' | 'withPhoto'> {
	readonly ports: PhotoLibrarySessionPortsCurrentV1;
}

/** The real selected factories/method receivers pin before any initialization
 * or resource wait. This adapter adds no writer, lifetime or render source. */
export function bindPhotoDevelopSettingsHostCurrentV1(host: PhotoDevelopSettingsHostBindingCurrentV1): Readonly<PhotoLibraryDevelopSettingsSessionHostCurrentV1> {
	const ports = host.ports, repository = ports.catalog, load = repository.loadPhoto, verify = ports.verifyResources;
	const luts = ports.cubeLutResources, brushes = ports.maskRasterResources;
	const ready = host.ready, operation = host.operation, mutate = host.mutate, withPhoto = host.withPhoto;
	const resources = { cubeLutResources: async () => { if (!luts) throw new Error('Selected LUT resources are unavailable.'); return Reflect.apply(luts, ports, []) as ReturnType<NonNullable<typeof luts>>; },
		maskRasterResources: async () => { if (!brushes) throw new Error('Selected brush resources are unavailable.'); return Reflect.apply(brushes, ports, []) as ReturnType<NonNullable<typeof brushes>>; } };
	return Object.freeze<PhotoLibraryDevelopSettingsSessionHostCurrentV1>({ repository: { loadPhoto: (...args: Parameters<typeof load>) => Reflect.apply(load, repository, args) as ReturnType<typeof load> },
		ready: () => Reflect.apply(ready, host, []) as ReturnType<typeof ready>,
		operation: <Result>(...args: Parameters<typeof operation<Result>>) => Reflect.apply(operation<Result>, host, args) as Promise<Result>,
		mutate: <Result>(...args: Parameters<typeof mutate<Result>>) => Reflect.apply(mutate<Result>, host, args) as Promise<Result>,
		withPhoto: <Result>(...args: Parameters<typeof withPhoto<Result>>) => Reflect.apply(withPhoto<Result>, host, args) as Promise<Result>,
		async verifyPhotoResources(photo, signal) {
			if (verify) { await Reflect.apply(verify, ports, [photo, signal]); return; }
			const collector = createPhotoResourceReachabilityCurrentV1(); collector.addPhoto(photo); const closure = collector.finish();
			if (closure.luts.length || closure.brushes.length) throw new Error('Selected Current resources require their independent verifier.');
		},
		verifyDevelopResources: (develop, signal) => verifyDevelopResourcesCurrentV1(develop, resources, signal),
	});
}
