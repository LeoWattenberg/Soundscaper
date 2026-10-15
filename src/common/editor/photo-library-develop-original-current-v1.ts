/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopOriginalPortV1, PhotoLibraryDevelopOriginalReadV1 } from './photo-library-develop-original-port-v1.ts';
import type { RawRecoveryFrameV2, RawRecoveryProfileV2 } from './raw/libraw-wasm-instance-v2.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

/** Canonical Original requests keep their permanent V1 meaning. This named
 * child explicitly borrows a derived fixed-profile native frame instead. */
export interface PhotoLibraryDevelopDerivedReadCurrentV1 extends PhotoLibraryDevelopOriginalReadV1 {
	readonly profile: RawRecoveryProfileV2;
}
export interface PhotoLibraryDevelopDerivedFrameCurrentV1 extends RawRecoveryFrameV2 {
	readonly photoId: string;
	readonly revision: number;
}
export interface PhotoLibraryDevelopOriginalPortCurrentV1 extends PhotoLibraryDevelopOriginalPortV1 {
	withDerivedFrame<Result>(request: PhotoLibraryDevelopDerivedReadCurrentV1,
		consume: (view: Readonly<PhotoLibraryDevelopDerivedFrameCurrentV1>) => Result | Promise<Result>,
		options?: Readonly<{ signal?: AbortSignal }>): Promise<Result>;
}

/** A selected caller captures this before a Session acquisition can yield. */
export function capturePhotoLibraryDevelopDerivedReadCurrentV1(value: unknown): Readonly<PhotoLibraryDevelopDerivedReadCurrentV1> {
	const input = record(value, 'derived Original read', ['schemaVersion', 'photoId', 'expectedRevision', 'profile']);
	const photoId = field(input, 'photoId', 'derived Original read'), expectedRevision = field(input, 'expectedRevision', 'derived Original read');
	const profile = field(input, 'profile', 'derived Original read');
	if (field(input, 'schemaVersion', 'derived Original read') !== 1) throw new RangeError('Unsupported derived Original read version.');
	if (typeof photoId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(photoId)) {
		throw new TypeError('Derived Original requires a bounded photo ID.');
	}
	if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || Object.is(expectedRevision, -0)) throw new RangeError('Derived Original requires a bounded revision.');
	if (profile !== 'linear-headroom-v1' && profile !== 'highlight-recovery-v1') throw new RangeError('Unsupported derived Original read profile.');
	return Object.freeze({ schemaVersion: 1, photoId, expectedRevision, profile });
}
