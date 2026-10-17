/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopOriginalPortCurrentV1, PhotoLibraryDevelopDerivedReadCurrentV1, PhotoLibraryDevelopDerivedFrameCurrentV1 } from '../../common/editor/photo-library-develop-original-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { readPhotoStackSignalOptionsV1 } from '../catalog/photo-stack-repository-v1.ts';
import { field, id, integer, record } from '../catalog/value-validation.ts';
import { normalizePhotoPreviewOriginalBindingV1 } from '../preview/photo-preview-plan-v1.ts';
import { admitPhotoOriginalDerivedBindingCurrentV1, withPhotoOriginalDerivedFrameCurrentV1 } from '../preview/photo-original-derived-frame-current-v1.ts';
import { createPhotoLibraryDevelopOriginalSessionCurrentV1, type PhotoLibraryDevelopOriginalSessionHostCurrentV1 } from './photo-library-develop-original-session-current-v1.ts';

export interface PhotoLibraryDevelopDerivedOriginalSessionHostCurrentV1 extends PhotoLibraryDevelopOriginalSessionHostCurrentV1 {
	readonly withDerivedFrame?: typeof withPhotoOriginalDerivedFrameCurrentV1;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal) Reflect.apply(CHECK, signal, []); }

/** The selected Session owns both methods. Canonical reads keep their permanent
 * request and pixels; a derived request explicitly selects the native profile.
 * The decoder's phase fences share this same operation, identity and revision. */
export function createPhotoLibraryDevelopDerivedOriginalSessionCurrentV1(host: PhotoLibraryDevelopDerivedOriginalSessionHostCurrentV1): Readonly<PhotoLibraryDevelopOriginalPortCurrentV1> {
	const repository = host.repository, reader = repository.loadPhoto, initialize = host.ready;
	const operation = host.operation, originalReader = host.loadOriginal, decode = host.withDerivedFrame ?? withPhotoOriginalDerivedFrameCurrentV1;
	for (const method of [reader, initialize, operation, originalReader, decode]) {
		if (typeof method !== 'function') throw new TypeError('Complete derived Original read capabilities are required.');
	}
	const canonical = createPhotoLibraryDevelopOriginalSessionCurrentV1(host);
	const loadPhoto = (catalogId: string, photoId: string) => Reflect.apply(reader, repository, [catalogId, photoId]);
	return Object.freeze({ withFrame: canonical.withFrame,
		async withDerivedFrame<Result>(value: PhotoLibraryDevelopDerivedReadCurrentV1,
			consume: (view: Readonly<PhotoLibraryDevelopDerivedFrameCurrentV1>) => Result | Promise<Result>, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Result> {
			const { signal } = readPhotoStackSignalOptionsV1(options); check(signal);
			const input = record(value, 'derived Original request', ['schemaVersion', 'photoId', 'expectedRevision', 'profile']);
			if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported derived Original request version.');
			const photoId = id(field(input, 'photoId'), 'derived Original photo ID');
			const expectedRevision = integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'derived Original revision');
			const profile = field(input, 'profile');
			if (profile !== 'linear-headroom-v1' && profile !== 'highlight-recovery-v1') throw new RangeError('Unsupported derived Original profile.');
			if (typeof consume !== 'function') throw new TypeError('Derived Original requires a scoped consumer.');
			return Reflect.apply(operation, host, [async (admitted: AbortSignal) => {
				const catalogId = await (Reflect.apply(initialize, host, []) as Promise<string>); check(admitted);
				const read = async () => {
					const raw: unknown = await loadPhoto(catalogId, photoId); check(admitted);
					if (!raw) throw new ReferenceError('The photo is missing.');
					const photo = normalizePhotoDocumentCurrentV1(raw);
					if (photo.catalogId !== catalogId || photo.id !== photoId) throw new ReferenceError('The photo changed its requested identity.');
					if (photo.revision !== expectedRevision) throw new PhotoCatalogRevisionConflictError('photo');
					return photo;
				};
				const photo = await read(), identity = JSON.stringify(photo.original);
				const binding = normalizePhotoPreviewOriginalBindingV1({ catalogId, photoId, originalId: photo.original.id, storageKey: photo.original.storageKey,
					contentSha256: photo.original.contentSha256, byteLength: photo.original.byteLength, width: photo.original.width, height: photo.original.height });
				admitPhotoOriginalDerivedBindingCurrentV1(binding);
				const current = async () => {
					check(admitted);
					if (JSON.stringify((await read()).original) !== identity) throw new PhotoCatalogRevisionConflictError('photo');
					check(admitted);
				};
				const body: unknown = await (Reflect.apply(originalReader, host, [photo.original, admitted]) as Promise<unknown>);
				check(admitted); await current();
				const result = await (Reflect.apply(decode, host, [{ binding, body, profile, signal: admitted },
					async (view: Parameters<Parameters<typeof withPhotoOriginalDerivedFrameCurrentV1>[1]>[0]) => {
						await current();
						const result = await consume(Object.freeze({ ...view, photoId, revision: expectedRevision }));
						check(admitted); await current(); return result;
					}, { assertCurrent: current }]) as Promise<Result>);
				// Rejections preserve their complete native/cleanup outcome. Success
				// must still belong to this revision after both physical retirements.
				check(admitted); await current(); return result;
			}, signal]) as Promise<Result>;
		},
	} satisfies PhotoLibraryDevelopOriginalPortCurrentV1);
}
