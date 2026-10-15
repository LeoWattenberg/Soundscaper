/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { prepareFramescaperRawImageOriginalCurrentV1, verifyFramescaperRawOriginalViewCurrentV1,
	type FramescaperRawImageOriginalPortsCurrentV1 } from '../../../common/editor/timeline-image-raw-pack-current-v1.ts';
import { withDecodedRawOriginalV1, type RawDecodedOriginalV1 } from '../../../common/editor/raw/libraw-runtime-v1.ts';
import { probeRawSourceV1, rawFlipExifOrientationV1 } from '../../../common/editor/raw/raw-source-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { readImageMetadataV1 } from '../../../common/editor/imaging/image-metadata-reader-v1.ts';
import { adaptPhotoImportMetadataV1 } from '../../import/metadata-adapter-v1.ts';
import { normalizePhotoMetadataV1 } from '../../catalog/photo-metadata.ts';
import { name } from '../../catalog/value-validation.ts';
import type { PhotoFramescaperHandoffOriginalRequestForProfileV1, PhotoFramescaperHandoffOriginalV1 } from './photo-framescaper-handoff-original-kernel-v1.ts';

const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, READ = Blob.prototype.arrayBuffer;
const TYPE = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!, SLICE = Blob.prototype.slice;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** Current RAW has native words as its canonical authority. The inherited
 * byte-cache hash is syntax-checked but never used as a native pixel digest. */
export async function preparePhotoFramescaperHandoffRawOriginalCurrentV1(value: Readonly<PhotoFramescaperHandoffOriginalRequestForProfileV1>,
	dependencies: FramescaperRawImageOriginalPortsCurrentV1 & Readonly<{ openImage?: unknown }> = {}): Promise<Readonly<PhotoFramescaperHandoffOriginalV1>> {
	const input = record(value, 'RAW Photo handoff Original', ['source', 'originalBlob', 'canonicalFrameSha256', 'signal'], ['source', 'originalBlob', 'canonicalFrameSha256']);
	const signal = captureRepairSignalV1(Object.hasOwn(input, 'signal') ? field(input, 'signal', 'RAW Photo handoff Original') : undefined), check = () => { checkRepairSignalV1(signal); };
	check(); const { source } = prepareFramescaperRawImageOriginalCurrentV1(field(input, 'source', 'RAW Photo handoff Original'));
	const canonical = field(input, 'canonicalFrameSha256', 'RAW Photo handoff Original');
	if (typeof canonical !== 'string' || !/^[a-f0-9]{64}$/u.test(canonical)) throw new TypeError('RAW Photo receive requires its authenticated pack cache digest.');
	const body = field(input, 'originalBlob', 'RAW Photo handoff Original'), size = Number(Reflect.apply(SIZE, body, []));
	if (size !== source.original.byteLength) throw new RangeError('RAW Photo Original differs from its exact byte capacity.');
	const originalBlob = Object.freeze(Reflect.apply(SLICE, body, [0, size, Reflect.apply(TYPE, body, [])]) as Blob);
	const ports = record(dependencies, 'RAW Photo handoff dependencies', ['openImage', 'withRawOriginal'], []);
	const decode = Object.hasOwn(ports, 'withRawOriginal') ? field(ports, 'withRawOriginal', 'RAW Photo handoff dependencies') : withDecodedRawOriginalV1;
	if (typeof decode !== 'function' || Object.hasOwn(ports, 'openImage') && typeof field(ports, 'openImage', 'RAW Photo handoff dependencies') !== 'function') throw new TypeError('RAW Photo Original requires captured native methods.');
	return withOriginalBytes(originalBlob, async owned => {
		let result: Readonly<PhotoFramescaperHandoffOriginalV1>;
		try {
			check();
			if (owned.byteLength !== size || bytesToHex(sha256(owned)) !== source.original.sha256) throw new Error('RAW Photo Original complete SHA or length differs from its binding.');
			const admission = probeRawSourceV1(owned);
			if (!admission || admission.format !== source.original.recognizedFormat || admission.mimeType !== source.original.mimeType) throw new Error('RAW Photo Original signature or MIME differs from its receipt.');
			const extractedMetadata = admission.format === 'dng' ? readImageMetadataV1(owned) : { schemaVersion: 1 as const, container: 'unsupported' as const, exif: null, iptc: null, issues: [] };
			let fileName = source.provenance.original.exactName, aliased = false;
			try { name(fileName, 'RAW Photo Original filename'); } catch {
				aliased = true; fileName = ''; for (const character of source.provenance.original.exactName.replace(/[\p{Cc}\p{Cf}]/gu, '')) {
					if (fileName.length + character.length > 256) break; fileName += character;
				} if (!fileName.trim()) fileName = `Imported image.${admission.format}`;
			}
			const facts = adaptPhotoImportMetadataV1({ fileName, modifiedTime: null, byteLength: size, extractedMetadata });
			result = await Reflect.apply(decode, dependencies, [{ bytes: owned, ...(signal ? { signal } : {}) }, async (view: RawDecodedOriginalV1) => {
				check(); await verifyFramescaperRawOriginalViewCurrentV1(source, view, signal); check();
				return Object.freeze({ originalBlob, ...facts, metadata: normalizePhotoMetadataV1({ ...facts.metadata, orientation: rawFlipExifOrientationV1(view.rawFlip) }),
					...(aliased ? { notices: Object.freeze([...facts.notices, Object.freeze({ field: 'fileName' as const, reason: 'display-bound' as const })]) } : {}) });
			}]) as Readonly<PhotoFramescaperHandoffOriginalV1>;
			check(); if (bytesToHex(sha256(owned)) !== source.original.sha256) throw new Error('RAW Photo native verification changed its Original bytes.'); return result;
		} catch (error) { check(); throw error; }
	});
}

/** Receive the native Blob allocation before post-IO cancellation. Keep its
 * real geometry private and join native work before physical retirement. */
async function withOriginalBytes<Result>(body: Blob, consume: (bytes: Uint8Array<ArrayBuffer>) => Promise<Result>): Promise<Result> {
	const backing = await Reflect.apply(READ, body, []) as ArrayBuffer;
	const length = Number(Reflect.apply(BUFFER_SIZE, backing, [])), bytes = new Uint8Array(backing);
	const outcome = await Promise.resolve().then(() => consume(bytes)).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	let cleanup: { error: unknown } | undefined;
	try {
		if (Number(Reflect.apply(BUFFER_SIZE, backing, [])) !== length) throw new TypeError('RAW Photo Original backing detached before physical retirement.');
		new Uint8Array(backing).fill(0);
	} catch (error) { cleanup = { error }; }
	if (!outcome.ok) {
		if (cleanup && !Object.is(cleanup.error, outcome.error)) throw new AggregateError([outcome.error, cleanup.error], 'RAW Photo verification and Original retirement failed.', { cause: outcome.error });
		throw outcome.error;
	}
	if (cleanup) throw cleanup.error; return outcome.value;
}
