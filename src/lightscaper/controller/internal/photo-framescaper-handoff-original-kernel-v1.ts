/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS } from '../../../common/editor/image-import-admission.ts';
import { readImageMetadataV1 } from '../../../common/editor/imaging/image-metadata-reader-v1.ts';
import { normalizeEditableSourceForProfileV1, assertHandoffProfile, type HandoffProfile, type EditableSource } from './photo-image-handoff-model-kernel-v1.ts';
import { openFramescaperBrowserNativeImageV1 } from '../../../common/editor/timeline-image-browser-native-port.ts';
import type { FramescaperBrowserNativeImageDecodeSessionV1, OpenFramescaperBrowserNativeImageV1 } from '../../../common/editor/timeline-image-native-decode-v1.ts';
import { name } from '../../catalog/value-validation.ts';
import { adaptPhotoImportMetadataV1, type PhotoImportMetadataV1 } from '../../import/metadata-adapter-v1.ts';
import { createPhotoNativeImagePortV1 } from '../../import/photo-native-image-port-v1.ts';
import { admitPhotoSourceV1 } from '../../import/photo-source-admission-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../storage/photo-develop-preset-read-v2.ts';
import { PhotoLibrarySessionLifetime } from '../photo-library-session-lifetime.ts';
import { preparePhotoFramescaperHandoffRawOriginalCurrentV1 } from './photo-framescaper-handoff-raw-original-current-v1.ts';
import type { FramescaperRawImageOriginalPortsCurrentV1 } from '../../../common/editor/timeline-image-raw-pack-current-v1.ts';
import { preparePhotoFramescaperHandoffHdrOriginalCurrentV1 } from './photo-framescaper-handoff-hdr-original-current-v1.ts';

export interface PhotoFramescaperHandoffOriginalRequestForProfileV1 {
	readonly source: Readonly<EditableSource>; readonly originalBlob: Blob;
	readonly canonicalFrameSha256: string; readonly signal?: AbortSignal;
}
export interface PhotoFramescaperHandoffOriginalV1 extends PhotoImportMetadataV1 { readonly originalBlob: Blob }
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, TYPE = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!;
const SLICE = Blob.prototype.slice, READ = Blob.prototype.arrayBuffer, CHECK = AbortSignal.prototype.throwIfAborted;
const LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'byteLength')!.get!;
const FILL = Uint8Array.prototype.fill, NativeController = AbortController, ABORT = AbortController.prototype.abort;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
function wipe(bytes: Uint8Array | null): void { if (bytes && Reflect.apply(LENGTH, bytes, []) !== 0) Reflect.apply(FILL, bytes, [0]); }
function digest(bytes: Uint8Array): string { return bytesToHex(sha256(bytes)); }

/** Verify a retained original against its authenticated pre-recipe canonical
 * frame. Original and owned RGBA are each <=64MiB; native scratch is separate.
 * No decoded plane, native handle, catalog publication or delivery authority
 * escapes. Supplier pixels remain supplier-owned until the static adapter
 * publishes its independently owned canonical snapshot. */
export async function preparePhotoFramescaperHandoffOriginalForProfileV1(profile: HandoffProfile, value: Readonly<PhotoFramescaperHandoffOriginalRequestForProfileV1>,
	dependencies: Readonly<{ openImage?: OpenFramescaperBrowserNativeImageV1 }> & FramescaperRawImageOriginalPortsCurrentV1 = {}): Promise<Readonly<PhotoFramescaperHandoffOriginalV1>> {
	assertHandoffProfile(profile); const label = 'Photo handoff original', input = record(value, label, ['source', 'originalBlob', 'canonicalFrameSha256', 'signal'], ['source', 'originalBlob', 'canonicalFrameSha256']);
	const source = normalizeEditableSourceForProfileV1(profile, field(input, 'source', label));
	if (profile === 'current3' && source.schemaVersion === 4) return preparePhotoFramescaperHandoffRawOriginalCurrentV1(value, dependencies);
	if (profile === 'current3' && source.schemaVersion === 5) return preparePhotoFramescaperHandoffHdrOriginalCurrentV1(value);
	const canonical = field(input, 'canonicalFrameSha256', label);
	if (typeof canonical !== 'string' || !/^[a-f0-9]{64}$/u.test(canonical)) throw new TypeError('Photo handoff requires an authenticated canonical frame SHA-256.');
	const { signal: caller } = readPhotoDevelopSignalOptionsV2(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal', label) } : {});
	const body = field(input, 'originalBlob', label), size: unknown = Reflect.apply(SIZE, body, []);
	if (!Number.isSafeInteger(size) || Number(size) < 1 || Number(size) > IMAGE_IMPORT_LIMITS.maximumFileInputBytes || size !== source.original.byteLength) {
		throw new RangeError('Retained handoff original exceeds or differs from its bound byte length.');
	}
	const originalBlob = Object.freeze(Reflect.apply(SLICE, body, [0, size, Reflect.apply(TYPE, body, [])]) as Blob);
	const ports = record(dependencies, 'Photo handoff native ports', ['openImage'], []);
	const native = Object.hasOwn(ports, 'openImage') ? field(ports, 'openImage', 'Photo handoff native ports') : openFramescaperBrowserNativeImageV1;
	if (typeof native !== 'function') throw new TypeError('Photo handoff requires a native extraction port.');
	const openImage: OpenFramescaperBrowserNativeImageV1 = request => Reflect.apply(native, dependencies, [request]) as ReturnType<OpenFramescaperBrowserNativeImageV1>;
	const lifetime = new PhotoLibrarySessionLifetime(), deadline = new NativeController();
	const timer = setTimeout(() => { Reflect.apply(ABORT, deadline, [new DOMException('Photo handoff original exceeded its decode deadline.', 'TimeoutError')]); }, IMAGE_IMPORT_LIMITS.maximumDecodeMillisecondsPerFile);
	try { return await lifetime.operation(signal => prepare(source, originalBlob, canonical, openImage, signal),
		caller === undefined ? deadline.signal : AbortSignal.any([caller, deadline.signal])); }
	finally { clearTimeout(timer); await lifetime.close(async () => undefined); }
}

async function prepare(source: Readonly<EditableSource>, originalBlob: Blob, canonical: string,
	openImage: OpenFramescaperBrowserNativeImageV1, signal: AbortSignal): Promise<Readonly<PhotoFramescaperHandoffOriginalV1>> {
	let bytes: Uint8Array<ArrayBuffer> | null = null, pixels: Uint8Array | null = null;
	let session: FramescaperBrowserNativeImageDecodeSessionV1 | null = null;
	let failed = false, primary: unknown, result: Readonly<PhotoFramescaperHandoffOriginalV1> | undefined;
	const cleanup: unknown[] = [];
	try {
		check(signal); bytes = new Uint8Array(await (Reflect.apply(READ, originalBlob, []) as Promise<ArrayBuffer>)); check(signal);
		if (digest(bytes) !== source.original.sha256 || Reflect.apply(LENGTH, bytes, []) !== source.original.byteLength) throw new RangeError('Retained handoff original SHA-256 or length differs from its binding.');
		const admission = admitPhotoSourceV1(bytes), extracted = readImageMetadataV1(bytes), orientation = extracted.exif?.orientation ?? 1;
		if (admission.format !== source.original.recognizedFormat) throw new RangeError('Retained original signature differs from its declared format.');
		if (source.original.mimeType !== `image/${admission.format}`) throw new RangeError('Retained original declared MIME differs from its admitted format.');
		const swapped = [5, 6, 7, 8].includes(orientation), width = swapped ? admission.height : admission.width, height = swapped ? admission.width : admission.height;
		if (width !== source.canonical.width || height !== source.canonical.height) throw new RangeError('Retained original oriented dimensions differ from the canonical frame.');
		const facts = metadata(source.provenance.original.exactName, admission.format, source.original.byteLength, extracted);
		const open = createPhotoNativeImagePortV1(admission, orientation, openImage, signal);
		session = await open({ bytes, format: admission.format, mimeType: `image/${admission.format}`, signal }); check(signal);
		const decoded = await session.decodeFrame(0, signal); pixels = decoded.rgba; check(signal);
		if (digest(bytes) !== source.original.sha256) throw new RangeError('Native extraction changed the retained original SHA-256.');
		let hasAlpha = false;
		for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset] !== 255) { hasAlpha = true; break; }
		if (hasAlpha !== source.canonical.hasAlpha) throw new RangeError('Retained original alpha differs from the canonical frame.');
		if (digest(pixels) !== canonical) throw new RangeError('Retained original canonical pixel digest differs from its authenticated frame.');
		result = Object.freeze({ originalBlob, ...facts });
	} catch (error) { failed = true; primary = error; }
	try { session?.close(); } catch (error) { cleanup.push(error); }
	try { check(signal); } catch (error) { if (!failed) { failed = true; primary = error; } }
	wipe(pixels); wipe(bytes);
	if (failed) {
		if (cleanup.length && cleanup[0] !== primary) throw new AggregateError([primary, ...cleanup], 'Photo handoff verification and native cleanup failed.', { cause: primary });
		throw primary;
	}
	if (cleanup.length) throw cleanup[0];
	check(signal); if (!result) throw new Error('Photo handoff original preparation produced no result.'); return result;
}

function metadata(exactName: string, format: string, byteLength: number,
	extractedMetadata: PhotoImportMetadataV1['extractedMetadata']): Readonly<PhotoImportMetadataV1> {
	let fileName = exactName, aliased = false;
	try { name(exactName, 'Photo handoff metadata filename'); }
	catch {
		aliased = true; fileName = '';
		for (const character of exactName.replace(/[\p{Cc}\p{Cf}]/gu, '')) { if (fileName.length + character.length > 256) break; fileName += character; }
		if (!fileName.trim()) fileName = `Imported image.${format}`;
	}
	const facts = adaptPhotoImportMetadataV1({ fileName, modifiedTime: null, byteLength, extractedMetadata });
	return aliased ? Object.freeze({ ...facts, notices: Object.freeze([...facts.notices, Object.freeze({ field: 'fileName' as const, reason: 'display-bound' as const })]) }) : facts;
}
