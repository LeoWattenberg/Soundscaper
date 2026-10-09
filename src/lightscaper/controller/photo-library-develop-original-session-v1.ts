/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopOriginalPortV1 } from '../../common/editor/photo-library-develop-original-port-v1.ts';
import { admitPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-admission-v1.ts';
import { normalizePhotoDocumentV1 } from '../catalog/photo-document.ts';
import type { PhotoDocumentV1, PhotoOriginalV1 } from '../catalog/types.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { readPhotoStackSignalOptionsV1 } from '../catalog/photo-stack-repository-v1.ts';
import { field, id, integer, record } from '../catalog/value-validation.ts';
import { withPhotoOriginalFrameV1 } from '../preview/photo-original-frame-v1.ts';
import { normalizePhotoPreviewOriginalBindingV1, PHOTO_PREVIEW_SOURCE_LIMITS_V1 } from '../preview/photo-preview-plan-v1.ts';
import type { PhotoLibrarySessionPortsV1 } from './photo-library-session-ports.ts';

export interface PhotoLibraryDevelopOriginalSessionHostV1 {
	readonly repository: Pick<PhotoLibrarySessionPortsV1['catalog'], 'loadPhoto'>;
	readonly ready: () => Promise<string>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly loadOriginal: (original: PhotoOriginalV1, signal: AbortSignal) => Promise<unknown>;
	readonly withFrame?: typeof withPhotoOriginalFrameV1;
}

const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** Borrows the selected Session lifetime; rechecks the revision and immutable source before and after delivery. */
export function createPhotoLibraryDevelopOriginalSessionV1(host: PhotoLibraryDevelopOriginalSessionHostV1): Readonly<PhotoLibraryDevelopOriginalPortV1> {
	const loadPhoto = host.repository.loadPhoto.bind(host.repository), ready = host.ready.bind(host);
	const operation = host.operation.bind(host), loadOriginal = host.loadOriginal.bind(host), decode = host.withFrame?.bind(host) ?? withPhotoOriginalFrameV1;
	return Object.freeze({
		async withFrame(value, consume, options = {}) {
			const input = record(value, 'develop original request', ['schemaVersion', 'photoId', 'expectedRevision']);
			if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported develop original request version.');
			const photoId = id(field(input, 'photoId'), 'develop original photo ID');
			const expectedRevision = integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'develop original revision');
			if (typeof consume !== 'function') throw new TypeError('Develop original pixels require a scoped consumer.');
			const { signal } = readPhotoStackSignalOptionsV1(options);
			return operation(async admitted => {
				const catalogId = await ready(); check(admitted);
				const read = async (): Promise<PhotoDocumentV1> => {
					const raw = await loadPhoto(catalogId, photoId); check(admitted);
					if (!raw) throw new ReferenceError('The photo is missing.');
					const photo = normalizePhotoDocumentV1(raw);
					if (photo.catalogId !== catalogId || photo.id !== photoId) throw new ReferenceError('The photo changed its requested identity.');
					if (photo.revision !== expectedRevision) throw new PhotoCatalogRevisionConflictError('photo');
					return photo;
				};
				const photo = await read(), originalIdentity = JSON.stringify(photo.original);
				const binding = normalizePhotoPreviewOriginalBindingV1({ catalogId, photoId, originalId: photo.original.id, storageKey: photo.original.storageKey,
					contentSha256: photo.original.contentSha256, byteLength: photo.original.byteLength, width: photo.original.width, height: photo.original.height });
				admitPixelFrameV1({ schemaVersion: 1, width: binding.width, height: binding.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
					{ limits: PHOTO_PREVIEW_SOURCE_LIMITS_V1 });
				const current = async () => {
					if (JSON.stringify((await read()).original) !== originalIdentity) throw new PhotoCatalogRevisionConflictError('photo');
				};
				const body = await loadOriginal(photo.original, admitted); check(admitted);
				await current(); check(admitted);
				return decode({ binding, body, signal: admitted }, async frame => {
					await current(); check(admitted);
					const result = await consume(Object.freeze({ photoId, revision: expectedRevision, frame }));
					check(admitted); await current(); check(admitted); return result;
				});
			}, signal);
		},
	} satisfies PhotoLibraryDevelopOriginalPortV1);
}
