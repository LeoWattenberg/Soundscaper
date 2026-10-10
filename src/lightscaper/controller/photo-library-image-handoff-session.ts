/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageHandoffRequestV1, PhotoLibraryImageHandoffViewV1 } from '../../common/editor/photo-library-image-handoff-port-v1.ts';
import type { CubeLutSourcePortV1 } from '../../common/editor/imaging/cube-lut-source-port-v1.ts';
import { withCubeLutResourceV1 } from '../../common/editor/imaging/cube-lut-resource-v1.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../../common/editor/storage/media-content-digest.ts';
import { normalizeVideoColorGradeV1 } from '../../common/editor/video-color-management-v27.ts';
import type { VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';
import { createPhotoCubeLutClosureV1 } from '../catalog/photo-cube-lut-closure-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { canonicalPhotoDocumentJsonV1 } from '../catalog/photo-document-json-v1.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../catalog/photo-export-sidecar-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';

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
	const initial = await read(), factsJson = serializePhotoExportSidecarV1(createPhotoExportSidecarV1(initial, request));
	const fullJson = canonicalPhotoDocumentJsonV1(initial), collector = createPhotoCubeLutClosureV1();
	collector.addDevelop(initial.versions.find(version => version.id === request.versionId)!.develop);
	const lutReferences = collector.finish(), original = initial.original;
	if (original.byteLength > IMAGE_IMPORT_LIMITS.maximumFileInputBytes
		|| lutReferences.reduce((size, reference) => size + reference.byteLength, original.byteLength) > IMAGE_IMPORT_LIMITS.maximumGestureInputBytes) {
		throw new RangeError('Image handoff bodies exceed their fixed byte capacity.');
	}
	// The selected resource source is acquired and bound before the original
	// read can yield to caller mutation. Empty closures require no LUT owner.
	let source: Readonly<CubeLutSourcePortV1> | undefined, loadLut: CubeLutSourcePortV1['withBytes'] | undefined;
	if (lutReferences.length) {
		if (!ports.cubeLutResources) throw new Error('Image handoff LUT source is unavailable.');
		check(signal);
		source = (await ports.cubeLutResources()).source; check(signal);
		const descriptor = Object.getOwnPropertyDescriptor(source, 'withBytes');
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Image handoff requires an own callable LUT source.');
		loadLut = descriptor.value as CubeLutSourcePortV1['withBytes'];
	}
	check(signal);
	const originalBlob = Object.freeze(canonicalMediaContentBlob(await load(original, signal))); check(signal);
	if (originalBlob.size !== original.byteLength || await digestMediaContent(originalBlob, { signal }) !== original.contentSha256) {
		throw new Error('Image handoff original body identity changed.');
	}
	check(signal);
	const readLut = async <Value>(reference: Readonly<VideoCubeLutReferenceV1>, borrower: (bytes: Uint8Array<ArrayBuffer>) => Value | Promise<Value>): Promise<Value> => {
		if (!source || !loadLut) throw new Error('Image handoff LUT source is unavailable.');
		check(signal);
		type Outcome = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly reason: unknown };
		const delivery: { entered: boolean; settled: Promise<Outcome> | null } = { entered: false, settled: null };
		let acceptingBody = true, failed = false, primary: unknown;
		try {
			await (Reflect.apply(loadLut, source, [reference, (bytes: Uint8Array<ArrayBuffer>) => {
				if (!acceptingBody || delivery.entered) throw new Error('Image handoff LUT source requires exactly one joined body delivery.');
				delivery.entered = true;
				const work = withCubeLutResourceV1({ reference, bytes, signal }, () => borrower(bytes));
				delivery.settled = work.then(value => ({ ok: true, value }), reason => ({ ok: false, reason }));
				return work;
			}, { signal }]) as Promise<unknown>);
		} catch (error) { failed = true; primary = error; }
		acceptingBody = false;
		const outcome = await delivery.settled;
		if (failed) {
			if (outcome?.ok === false && outcome.reason !== primary) throw new AggregateError([primary, outcome.reason], 'Image handoff LUT transport and borrower failed.', { cause: primary });
			throw primary;
		}
		if (outcome === null) throw new Error('Image handoff LUT source did not deliver its authenticated body.');
		if (!outcome.ok) throw outcome.reason;
		check(signal); return outcome.value;
	};
	for (const reference of lutReferences) { await readLut(reference, () => undefined); check(signal); }
	await current();
	let accepting = true, reading = false, resourceFailed = false, resourceFailure: unknown;
	let joined: Promise<void> | null = null;
	const withLutBytes: CubeLutSourcePortV1['withBytes'] = (value, borrower, options) => {
		try {
			if (!accepting) throw new Error('Image handoff resource capability is closed.');
			check(signal);
			const { signal: caller } = readPhotoDevelopSignalOptionsV2(options ?? {});
			if (caller !== undefined && caller !== signal) throw new TypeError('Image handoff resource reads use their captured lifetime signal.');
			const reference = normalizeVideoColorGradeV1({ ...normalizeVideoColorGradeV1(), lut: value }).lut;
			if (!reference || !lutReferences.some(expected => JSON.stringify(expected) === JSON.stringify(reference))) {
				throw new Error('Image handoff resource reference is outside the captured closure.');
			}
			if (typeof borrower !== 'function') throw new TypeError('Image handoff resource requires a callable consumer.');
			if (reading) throw new Error('An image handoff LUT read is already pending.');
			reading = true;
			const work = readLut(reference, borrower);
			// Capture one fulfilled join witness before caller continuations run.
			joined = work.then(() => { reading = false; }, error => {
				reading = false; if (!resourceFailed) { resourceFailed = true; resourceFailure = error; }
			});
			return work;
		} catch (error) { return Promise.reject(error); }
	};
	let result!: Result, failed = false, primary: unknown;
	try {
		result = await consume(Object.freeze({ schemaVersion: 1, signal, factsJson, originalBlob, lutReferences, withLutBytes,
			original: Object.freeze({ exactName: original.name, contentSha256: original.contentSha256, byteLength: original.byteLength,
				mimeType: original.mimeType, width: original.width, height: original.height, hasAlpha: original.hasAlpha }) }));
	} catch (error) { failed = true; primary = error; }
	accepting = false;
	await joined;
	if (failed) {
		if (resourceFailed && resourceFailure !== primary) throw new AggregateError([primary, resourceFailure], 'Image handoff consumer and resource read failed.', { cause: primary });
		throw primary;
	}
	if (resourceFailed) throw resourceFailure;
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
