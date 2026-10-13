/* SPDX-License-Identifier: AGPL-3.0-only */

import { cloneFramescaperProject } from '../editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../editor-project-runtime-profile.ts';
import { createFramescaperMaskRasterSourceTimelineImageV1 } from '../timeline-image-mask-raster-source-v1.ts';
import type { FramescaperStoredImageAssetStoreTimelineImage } from '../editor-selected-timeline-image-image-frame-source.ts';
import { collectFramescaperImageProjectResourcesCurrentV1 } from '../../common/editor/video-cube-lut-project-references-current-v1.ts';
import { normalizeFramescaperImageSourceCurrentV1 } from '../../common/editor/timeline-image-model-current-v1.ts';
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../../common/editor/closed-domain-value.ts';
import { normalizeBrushMaskResourceReferenceV1, withBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import type { ImageBrushMaskResourceAcknowledgementV1, ImageBrushMaskResourcePortV1 } from '../../common/editor/image-brush-mask-resource-port-v1.ts';
import type { MediaAssetWriteOptions, OwnedMediaAssetWriter, OwnedMediaAssetPublication } from '../../common/editor/storage/media-asset-write-contract.ts';
import { checkFramescaperNativeImageSignalCurrentV1, retireFramescaperNativeImageCurrentV1 } from './timeline-image-native-pack-owner-current-v1.ts';

export interface FramescaperImageBrushMaskAcknowledgementCurrentV1 extends ImageBrushMaskResourceAcknowledgementV1 { readonly projectId: string }
export interface FramescaperImageBrushMaskStoreCurrentV1 extends FramescaperStoredImageAssetStoreTimelineImage {
	getMediaAssetMetadata(key: string): Promise<unknown>;
	beginMediaAssetWrite(key: string, metadata: Readonly<Record<string, unknown>>, options: Readonly<MediaAssetWriteOptions>): Promise<OwnedMediaAssetWriter>;
}
export interface FramescaperImageBrushMaskHostCurrentV1 {
	readonly project: unknown;
	readonly store: FramescaperImageBrushMaskStoreCurrentV1;
	assertCurrent(): void;
	operation<Result>(run: (signal: AbortSignal) => Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result>;
	authenticate(signal: AbortSignal): Promise<void>;
}
export interface FramescaperImageBrushBodyCurrentV1 {
	readonly reference: Readonly<BrushMaskResourceReferenceV1>;
	readonly bytes: Uint8Array<ArrayBuffer>;
	retire(): void;
}
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SET = Uint8Array.prototype.set, FILL = Uint8Array.prototype.fill, SUBARRAY = Uint8Array.prototype.subarray;
const KIND = 'photo-mask-raster', ENCODING = 'lightscaper-mask-raster-v1', MIME = 'application/octet-stream';

/** Synchronous bounded ownership precedes every lazy renderer/native await. */
export function prepareFramescaperImageBrushBodyCurrentV1(referenceValue: unknown, bytesValue: unknown): Readonly<FramescaperImageBrushBodyCurrentV1> {
	const reference = admitReference(referenceValue);
	if (Reflect.apply(TAG, bytesValue, []) !== 'Uint8Array') throw new TypeError('Frame brush bytes require a native Uint8Array.');
	for (const key of ['buffer', 'byteLength', 'byteOffset', 'length']) if (Object.hasOwn(bytesValue as object, key)) throw new TypeError('Frame brush byte geometry may not be shadowed.');
	const input = Reflect.apply(BUFFER, bytesValue, []) as ArrayBuffer;
	if (Reflect.apply(RESIZABLE, input, []) !== false || Reflect.apply(SIZE, input, []) !== reference.byteLength
		|| Reflect.apply(LENGTH, bytesValue, []) !== reference.byteLength || Reflect.apply(OFFSET, bytesValue, []) !== 0) throw new RangeError('Frame brush bytes require their exact fixed native body.');
	const bytes = new Uint8Array(reference.byteLength), backing = bytes.buffer; Reflect.apply(SET, bytes, [new Uint8Array(input)]);
	let retired = false;
	return Object.freeze({ reference, bytes, retire() {
		if (retired) return; retired = true;
		if (Number(Reflect.apply(SIZE, backing, [])) !== reference.byteLength) throw new TypeError('Frame brush snapshot was detached before physical retirement.');
		Reflect.apply(FILL, new Uint8Array(backing), [0]);
	} });
}

/** One optional selected Session child borrows the existing native writer.
 * Publication never edits a recipe and acknowledged bytes remain immutable
 * under the native pending-root/GC lifecycle, including failed later Apply. */
export function createFramescaperImageBrushMaskPortCurrentV1(host: FramescaperImageBrushMaskHostCurrentV1): Readonly<{
	port: Readonly<ImageBrushMaskResourcePortV1<FramescaperImageBrushMaskAcknowledgementCurrentV1> & { readonly projectId: string }>;
	closeAndJoin(): Promise<void>;
}> {
	const project = cloneFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, host.project), store = host.store;
	const get = method<FramescaperImageBrushMaskStoreCurrentV1['getMediaAssetMetadata']>(store, 'getMediaAssetMetadata');
	const begin = method<FramescaperImageBrushMaskStoreCurrentV1['beginMediaAssetWrite']>(store, 'beginMediaAssetWrite');
	const native = createFramescaperMaskRasterSourceTimelineImageV1(store), operation = host.operation, authenticate = host.authenticate, current = host.assertCurrent;
	const retained = collectFramescaperImageProjectResourcesCurrentV1(project), allowed = new Set(retained.brushes.map(value => value.storageKey));
	const preflight = (reference: Readonly<BrushMaskResourceReferenceV1>) => {
		// The Session may retain its canonical reader after an earlier preview.
		// Charge its pack/canonical maximum plus the live 64 MiB brush authoring
		// owner, native stage/publication copies and complete resource auth.
		let resident = 0n, authentication = 0n;
		for (const raw of project.sources) if (raw.kind === 'image') {
			const source = normalizeFramescaperImageSourceCurrentV1(raw);
			const bytes = BigInt(source.assetByteLength) * 3n + BigInt(source.canonical.width) * BigInt(source.canonical.height) * 4n;
			if (bytes > resident) resident = bytes;
		}
		for (const lut of retained.luts) { const bytes = BigInt(lut.byteLength) * 3n + BigInt(lut.size) ** 3n * 3n * 8n * 2n; if (bytes > authentication) authentication = bytes; }
		for (const brush of retained.brushes) { const bytes = BigInt(brush.byteLength) * 3n; if (bytes > authentication) authentication = bytes; }
		if (resident + authentication + 64n * 1024n * 1024n + BigInt(reference.byteLength) * 8n + 4_096n > 512n * 1024n * 1024n) throw new RangeError('Frame brush authoring exceeds its 512 MiB working byte bound.');
	};
	let sealed = false, closing: Promise<void> | undefined; const retirementFailures: unknown[] = [];
	const check = (signal: AbortSignal) => { checkFramescaperNativeImageSignalCurrentV1(signal); Reflect.apply(current, host, []); checkFramescaperNativeImageSignalCurrentV1(signal); if (sealed) throw new Error('The Frame brush child is closed.'); };
	const port = Object.freeze<ImageBrushMaskResourcePortV1<FramescaperImageBrushMaskAcknowledgementCurrentV1> & { readonly projectId: string }>({
		schemaVersion: 1, projectId: project.id,
		source: Object.freeze({ withBytes<Result>(value: Readonly<BrushMaskResourceReferenceV1>, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
			return Reflect.apply(operation, host, [async (signal: AbortSignal) => {
				check(signal); let reference: Readonly<BrushMaskResourceReferenceV1>;
				try { reference = admitReference(value); if (typeof consume !== 'function') throw new TypeError('Frame brush borrowing requires a consumer.');
					if (!allowed.has(reference.storageKey)) throw new RangeError('The brush is neither retained nor acknowledged by this selected Frame Session.'); preflight(reference); check(signal);
				} catch (error) { check(signal); throw error; }
				await Reflect.apply(authenticate, host, [signal]); check(signal); assertMetadata(await get(reference.storageKey), reference); check(signal);
				return native.withBytes(reference, async bytes => { check(signal); const result = await consume(bytes); check(signal); return result; }, { signal });
			}, options]) as Promise<Result>;
		} }),
		install(referenceValue: unknown, bytesValue: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<FramescaperImageBrushMaskAcknowledgementCurrentV1>> {
			return Reflect.apply(operation, host, [async (signal: AbortSignal) => {
				check(signal); let body: Readonly<FramescaperImageBrushBodyCurrentV1>;
				try { body = prepareFramescaperImageBrushBodyCurrentV1(referenceValue, bytesValue); } catch (error) { check(signal); throw error; }
				let outcome: { value: Readonly<FramescaperImageBrushMaskAcknowledgementCurrentV1> } | { error: unknown };
				try {
					try { preflight(body.reference); check(signal); } catch (error) { check(signal); throw error; }
					await withBrushMaskResourceV1({ reference: body.reference, bytes: body.bytes, signal }, () => undefined); check(signal);
					await Reflect.apply(authenticate, host, [signal]); check(signal);
					const existing = await get(body.reference.storageKey); check(signal);
					if (existing !== null && existing !== undefined) {
						assertMetadata(existing, body.reference); await native.withBytes(body.reference, () => undefined, { signal }); check(signal);
						allowed.add(body.reference.storageKey); outcome = { value: receipt(body.reference, false) };
					} else { const ack = await publish(body, signal); allowed.add(body.reference.storageKey); outcome = { value: ack }; }
				} catch (error) { outcome = { error }; }
				if ('value' in outcome) {
					try { body.retire(); } catch (error) { retirementFailures.push(error); return receipt(body.reference, outcome.value.created, true); }
				} else await retireFramescaperNativeImageCurrentV1(outcome, [body.retire]);
				if ('error' in outcome) throw outcome.error; return outcome.value;
			}, options]) as Promise<Readonly<FramescaperImageBrushMaskAcknowledgementCurrentV1>>;
		},
	});
	return Object.freeze({ port, closeAndJoin() { sealed = true; return closing ??= retireFramescaperNativeImageCurrentV1(undefined,
		[() => native.close(), ...retirementFailures.map(error => () => { throw error; })]); } });
	function receipt(reference: Readonly<BrushMaskResourceReferenceV1>, created: boolean, cleanupFailed = false): Readonly<FramescaperImageBrushMaskAcknowledgementCurrentV1> {
		return Object.freeze({ schemaVersion: 1, projectId: project.id, reference, created, notices: Object.freeze(cleanupFailed ? ['cleanup-failed'] as const : []) });
	}
	async function publish(body: Readonly<FramescaperImageBrushBodyCurrentV1>, signal: AbortSignal): Promise<Readonly<FramescaperImageBrushMaskAcknowledgementCurrentV1>> {
		const reference = body.reference, options = { signal }, writer = await begin(reference.storageKey,
			{ name: reference.storageKey, kind: KIND, encoding: ENCODING, mimeType: MIME }, { expectedBytes: reference.byteLength, expectedSha256: reference.sha256, signal });
		let publication: OwnedMediaAssetPublication | undefined;
		const abort = method<OwnedMediaAssetWriter['abort']>(writer, 'abort');
		try {
			const write = method<OwnedMediaAssetWriter['write']>(writer, 'write'), commit = method<OwnedMediaAssetWriter['commitOwned']>(writer, 'commitOwned');
			const maximum = writer.maximumChunkBytes;
			if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 4 * 1024 * 1024) throw new RangeError('Frame brushes require a bounded native chunk writer.');
			check(signal);
			for (let offset = 0; offset < reference.byteLength; offset += maximum) { check(signal); await write(Reflect.apply(SUBARRAY, body.bytes, [offset, Math.min(offset + maximum, reference.byteLength)]) as Uint8Array<ArrayBuffer>, options); }
			check(signal); publication = await commit(options); assertMetadata(publication.metadata, reference);
			// The completed genuine native publication is the ACK boundary. A late
			// cancellation/currentness check must not revoke its detached receipt.
			return receipt(reference, true);
		} catch (error) {
				const provisional = publication;
				await retireFramescaperNativeImageCurrentV1({ error }, [provisional ? () => provisional.discardIfCurrent().then(() => undefined) : abort]); throw error;
		}
	}
}
function admitReference(value: unknown): Readonly<BrushMaskResourceReferenceV1> {
	const input = record(value, 'Frame brush reference', ['storageKey', 'sha256', 'width', 'height', 'byteLength']);
	const canonical = normalizeBrushMaskResourceReferenceV1(field(input, 'storageKey', 'Frame brush reference'));
	for (const key of ['storageKey', 'sha256', 'width', 'height', 'byteLength'] as const) if (field(input, key, 'Frame brush reference') !== canonical[key]) throw new TypeError('Frame brush reference differs from its exact canonical identity.');
	return canonical;
}
function assertMetadata(value: unknown, reference: Readonly<BrushMaskResourceReferenceV1>): void {
	if (!value || typeof value !== 'object') throw new RangeError('The Frame brush native body is missing.');
	const row = value as Readonly<Record<string, unknown>>;
	if (row.sourceId !== reference.storageKey || row.size !== reference.byteLength || row.sha256 !== reference.sha256 || row.kind !== KIND || row.encoding !== ENCODING || row.mimeType !== MIME) throw new TypeError('Frame brush native metadata differs from its exact declaration.');
}
function method<Method extends (...args: never[]) => unknown>(receiver: object, key: string): Method {
	let owner: object | null = receiver;
	for (let depth = 0; owner && depth < 32; depth++) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, key);
		if (descriptor) { if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Frame brush storage requires a captured native data method.');
			const callable = descriptor.value as Method; return ((...args: Parameters<Method>) => Reflect.apply(callable, receiver, args)) as Method; }
		owner = Object.getPrototypeOf(owner) as object | null;
	}
	throw new TypeError('Frame brush storage requires its native data method.');
}
