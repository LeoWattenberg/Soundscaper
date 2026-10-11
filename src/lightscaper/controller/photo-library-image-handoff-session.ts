/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageHandoffRequestV1, PhotoLibraryImageHandoffViewV1 } from '../../common/editor/photo-library-image-handoff-port-v1.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../../common/editor/storage/media-content-digest.ts';
import { createPhotoCubeLutClosureV1 } from '../catalog/photo-cube-lut-closure-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { canonicalPhotoDocumentJsonV1 } from '../catalog/photo-document-json-v1.ts';
import { assertPhotoMaskRasterPortableV1 } from '../catalog/photo-mask-raster-portability-v1.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../catalog/photo-export-sidecar-v1.ts';
import type { PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';
import { withPhotoLibraryImageHandoffResourcesV1 } from './photo-library-image-handoff-resources-v1.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** Runs inside the parent Session's pending operation. The original is a
 * native immutable Blob view, <=64MiB. Declared original + unique LUT bytes
 * are <=512MiB; each scoped LUT reader retains its existing <=16MiB bound.
 * No aggregate raw LUT copies, decoding workspace or native-heap claim.
 * Complete admitted Photo facts are fenced before delivery and on settlement.
 * One active LUT borrower and one settled failure witness bound capture-owned
 * tracking; admitted reads join even when a consumer forgets to await them. */
export async function withPhotoLibraryImageHandoff<Result>(
	ports: PhotoLibrarySessionPortsV2, catalogId: string, request: Readonly<PhotoLibraryImageHandoffRequestV1>,
	consume: (view: Readonly<PhotoLibraryImageHandoffViewV1>) => Result | Promise<Result>, signal: AbortSignal,
): Promise<Result> {
	check(signal);
	if (catalogId !== request.catalogId) throw new Error('Image handoff selected catalog changed.');
	const load = ports.backup?.loadOriginal;
	if (!load) throw new Error('Image handoff original source is unavailable.');
	const initial = await read();
	assertPhotoMaskRasterPortableV1(initial);
	const factsJson = serializePhotoExportSidecarV1(createPhotoExportSidecarV1(initial, request));
	const fullJson = canonicalPhotoDocumentJsonV1(initial), collector = createPhotoCubeLutClosureV1();
	collector.addDevelop(initial.versions.find(version => version.id === request.versionId)!.develop);
	const lutReferences = collector.finish(), original = initial.original;
	if (original.byteLength > IMAGE_IMPORT_LIMITS.maximumFileInputBytes
		|| lutReferences.reduce((size, reference) => size + reference.byteLength, original.byteLength) > IMAGE_IMPORT_LIMITS.maximumGestureInputBytes) {
		throw new RangeError('Image handoff bodies exceed their fixed byte capacity.');
	}
	// The selected resource source is acquired and bound before the original
	// read can yield to caller mutation. Empty closures require no LUT owner.
	let originalBlob!: Blob;
	const result = await withPhotoLibraryImageHandoffResourcesV1(ports, lutReferences, signal, async () => {
		check(signal); originalBlob = Object.freeze(canonicalMediaContentBlob(await load(original, signal))); check(signal);
		if (originalBlob.size !== original.byteLength || await digestMediaContent(originalBlob, { signal }) !== original.contentSha256) {
			throw new Error('Image handoff original body identity changed.');
		}
	}, async withLutBytes => {
		await current();
		return consume(Object.freeze({ schemaVersion: 1, signal, factsJson, originalBlob, lutReferences, withLutBytes,
			original: Object.freeze({ exactName: original.name, contentSha256: original.contentSha256, byteLength: original.byteLength,
				mimeType: original.mimeType, width: original.width, height: original.height, hasAlpha: original.hasAlpha }) }));
	});
	check(signal); await current(); return result;

	async function read() {
		const value = await ports.catalog.loadPhoto(catalogId, request.photoId); check(signal);
		if (!value) throw new ReferenceError('The selected image handoff photo is missing.');
		const photo = normalizePhotoDocumentV1OrV2(value);
		// Owning projection admission verifies catalog/photo/revision/version.
		createPhotoExportSidecarV1(photo, request); check(signal); return photo;
	}
	async function current(): Promise<void> {
		if (canonicalPhotoDocumentJsonV1(await read()) !== fullJson) throw new Error('Image handoff complete photo facts changed.');
		check(signal);
	}
}
