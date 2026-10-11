/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { normalizeVideoCubeLutReferenceV1, type VideoCubeLutReferenceV1 } from '../../common/editor/cube-lut-reference-contract.ts';
import type { CubeLutSourcePortV1 } from '../../common/editor/imaging/cube-lut-source-port-v1.ts';
import type { StorageRepositoryPort } from '../../common/editor/storage/repository-port.ts';
import { parseCubeLutV1, VIDEO_COLOR_LIMITS_V1 } from '../../common/editor/video-color-cube-lut-v27.ts';
import { createPhotoCubeLutReachabilityV1 } from '../catalog/photo-cube-lut-reachability-v1.ts';
import { PhotoCubeLutRepositoryV1, type PhotoCubeLutOptionsV1, type PhotoCubeLutReceiptV1 } from './photo-cube-lut-repository-v1.ts';

export interface PhotoMediaCubeLutResourcesV1 {
	readonly source: Readonly<CubeLutSourcePortV1>;
	put(reference: unknown, bytes: unknown, options?: PhotoCubeLutOptionsV1): Promise<Readonly<PhotoCubeLutReceiptV1>>;
	importFile(file: Blob, options?: PhotoCubeLutOptionsV1): Promise<Readonly<PhotoCubeLutReceiptV1>>;
	verifyPhoto(photo: unknown, signal?: AbortSignal): Promise<void>;
	verifyPreset(preset: unknown, signal?: AbortSignal): Promise<void>;
	readonly verifyReferencesV1?: (references: readonly Readonly<VideoCubeLutReferenceV1>[], signal?: AbortSignal) => Promise<void>;
}
export interface PhotoMediaCubeLutResourceOwnerV1 {
	readonly resources: Readonly<PhotoMediaCubeLutResourcesV1>;
	close(): Promise<void>;
}
type Own = <Result>(operation: () => Promise<Result>) => Promise<Result>;
const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const BLOB_READ = Blob.prototype.arrayBuffer;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const CHECK = AbortSignal.prototype.throwIfAborted, FILL = Uint8Array.prototype.fill;

/** Three fixed borrowers share the selected media owner's guarded DB2 port.
 * Rendering can hold one scoped consumer while its single catalog writer
 * verifies immutable bodies. Installation has a separate one-operation slot;
 * there is no recipe/body queue, deletion authority or additional retention
 * session. The parent joins each entire consumer before releasing its guard.
 * Repository/parser component bounds remain <=16MiB, not a total heap bound. */
export function createPhotoMediaCubeLutResourcesV1(
	port: StorageRepositoryPort, own: Own, assertAccepting: () => void,
): Readonly<PhotoMediaCubeLutResourceOwnerV1> {
	const render = new PhotoCubeLutRepositoryV1(port), verify = new PhotoCubeLutRepositoryV1(port), writer = new PhotoCubeLutRepositoryV1(port);
	let writing = false, verifying = false, closed = false, closing: Promise<void> | null = null;
	const open = () => { assertAccepting(); if (closed) throw new Error('LUT resources are closed.'); };
	const source = Object.freeze<CubeLutSourcePortV1>({ withBytes: (reference, consume, options) => own(() => {
		open(); return render.withBytes(reference, consume, options);
	}) });
	const resources = Object.freeze<PhotoMediaCubeLutResourcesV1>({ source,
		put: (reference, bytes, options) => write(() => writer.put(reference, bytes, options)),
		importFile: (file, options) => write(async () => {
			const signal = readSignal(options); check(signal);
			const size = Number(Reflect.apply(BLOB_SIZE, file, []));
			if (size < 1 || size > VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes) throw new RangeError('LUT file exceeds its fixed byte bound.');
			open();
			const buffer = await (Reflect.apply(BLOB_READ, file, []) as Promise<ArrayBuffer>), bytes = new Uint8Array(buffer);
			try {
				check(signal); open();
				if (Reflect.apply(BUFFER_SIZE, buffer, []) !== size) throw new RangeError('LUT file body differs from its admitted byte bound.');
				if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new TypeError('LUT UTF8 must not start with a BOM.');
				const parsed = parseCubeLutV1(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
				if (parsed.byteLength !== size) throw new TypeError('LUT file requires its exact UTF8 representation.');
				const reference = Object.freeze({ storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256,
					byteLength: parsed.byteLength, size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax });
				check(signal); open(); return await writer.put(reference, bytes, { signal });
			} finally { Reflect.apply(FILL, bytes, [0]); }
		}),
		verifyPhoto: (value, signal) => verifyPacket(value, 'photo', signal),
		verifyPreset: (value, signal) => verifyPacket(value, 'preset', signal),
		verifyReferencesV1: (value, signal) => verifyPacket(value, 'references', signal),
	});
	return Object.freeze({ resources, close });

	function write<Result>(operation: () => Promise<Result>): Promise<Result> {
		return own(async () => {
			open(); if (writing) throw new Error('A LUT installation is pending.');
			writing = true;
			try { return await operation(); } finally { writing = false; }
		});
	}
	function verifyPacket(value: unknown, kind: 'photo' | 'preset' | 'references', signal?: AbortSignal): Promise<void> {
		return own(async () => {
			open(); check(signal); if (verifying) throw new Error('LUT writer verification is pending.');
			verifying = true;
			try {
				let references: readonly Readonly<VideoCubeLutReferenceV1>[];
				if (kind === 'references') references = readClosedDomainArray(value, 'selected LUT references', 0, 4_094).map(normalizeVideoCubeLutReferenceV1);
				else { const collector = createPhotoCubeLutReachabilityV1();
					if (kind === 'photo') collector.addPhoto(value); else collector.addPreset(value); references = collector.finish(); }
				open(); check(signal);
				for (const reference of references) { await verify.withBytes(reference, () => undefined, { signal }); open(); check(signal); }
			} finally { verifying = false; }
		});
	}
	function close(): Promise<void> {
		if (closing) return closing;
		closed = true;
		closing = Promise.resolve().then(async () => { await Promise.all([render.close(), verify.close(), writer.close()]); });
		return closing;
	}
}

function readSignal(value: unknown): AbortSignal | undefined {
	const record = readClosedDomainRecord(value === undefined ? {} : value, 'LUT file options', ['signal'], []);
	return Object.hasOwn(record, 'signal') ? readClosedDomainField(record, 'signal', 'LUT file options') as AbortSignal | undefined : undefined;
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
