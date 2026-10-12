/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageHandoffRequestV1, PhotoLibraryImageHandoffViewV1 } from '../../../common/editor/photo-library-image-handoff-port-v1.ts';
import type { PhotoLibraryImageHandoffViewV2 } from '../../../common/editor/photo-library-image-handoff-port-v2.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import type { CubeLutSourcePortV1 } from '../../../common/editor/imaging/cube-lut-source-port-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../../common/editor/imaging/mask-raster-source-port-v1.ts';
import { withCubeLutResourceV1 } from '../../../common/editor/imaging/cube-lut-resource-v1.ts';
import { normalizeBrushMaskResourceReferenceV1, withBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../../../common/editor/imaging/brush-mask-resource-v1.ts';
import { normalizeVideoCubeLutReferenceV1 } from '../../../common/editor/cube-lut-reference-contract.ts';
import type { VideoCubeLutReferenceV1 } from '../../../common/editor/video-color-cube-lut-v27.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../../../common/editor/storage/media-content-digest.ts';
import { IMAGE_IMPORT_LIMITS } from '../../../common/editor/image-import-admission.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../../../common/editor/scape-archive-limits.ts';
import { createPhotoCubeLutClosureV1 } from '../../catalog/photo-cube-lut-closure-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../../catalog/photo-resource-reachability-current-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../../catalog/photo-document-v2.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1 } from '../../catalog/photo-document-current-v1.ts';
import { canonicalPhotoDocumentJsonV1 } from '../../catalog/photo-document-json-v1.ts';
import { assertPhotoMaskRasterPortableV1 } from '../../catalog/photo-mask-raster-portability-v1.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../../catalog/photo-export-sidecar-v1.ts';
import { createPhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../../catalog/photo-export-sidecar-current-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../storage/photo-develop-preset-read-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../photo-library-session-ports-v2.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from '../photo-library-session-ports-current-v1.ts';
import { assertPhotoDevelopHandoffMasksForProfileV1 } from './photo-image-handoff-model-kernel-v1.ts';

type Profile = 'legacy2' | 'current3';
type Ports = PhotoLibrarySessionPortsV2 | PhotoLibrarySessionPortsCurrentV1;
type View = PhotoLibraryImageHandoffViewV1 | PhotoLibraryImageHandoffViewV2;
export interface ImageHandoffResourceReferencesV1 { readonly luts: readonly Readonly<VideoCubeLutReferenceV1>[]; readonly brushes: readonly Readonly<BrushMaskResourceReferenceV1>[] }
export interface ImageHandoffScopedReadersV1 { readonly withLutBytes: CubeLutSourcePortV1['withBytes']; readonly withMaskRasterBytes: MaskRasterSourcePortV1['withBytes'] }
type References = ImageHandoffResourceReferencesV1;
type Readers = ImageHandoffScopedReadersV1;
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
function assertProfile(profile: unknown): asserts profile is Profile { if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed image handoff profile.'); }
export function admitPhotoImageHandoffBrushReferenceV1(value: unknown): Readonly<BrushMaskResourceReferenceV1> {
	const label = 'image handoff brush reference', keys = ['storageKey', 'sha256', 'width', 'height', 'byteLength'] as const;
	const input = record(value, label, keys), canonical = normalizeBrushMaskResourceReferenceV1(field(input, 'storageKey', label));
	for (const key of keys) if (field(input, key, label) !== canonical[key]) throw new TypeError('Image handoff brush reference differs from its canonical storage key.');
	return canonical;
}

/** One selected operation owns full saved facts, independent retained-resource
 * verification, then the unchanged encoded Original and one serial scoped reader. */
export async function withPhotoLibraryImageHandoffForProfileV1<Result>(profile: Profile, ports: Ports, catalogId: string,
	request: Readonly<PhotoLibraryImageHandoffRequestV1>, consume: (view: Readonly<View>) => Result | Promise<Result>, signal: AbortSignal): Promise<Result> {
	assertProfile(profile); check(signal);
	if (catalogId !== request.catalogId) throw new Error('Image handoff selected catalog changed.');
	const backup = ports.backup, load = backup?.loadOriginal, catalog = ports.catalog, loadPhoto = catalog.loadPhoto, verify = ports.verifyResources;
	if (typeof load !== 'function' || typeof loadPhoto !== 'function') throw new Error('Image handoff original source is unavailable.');
	const initial = await read();
	let references: References;
	if (profile === 'legacy2') {
		assertPhotoMaskRasterPortableV1(initial); const collector = createPhotoCubeLutClosureV1();
		collector.addDevelop(initial.versions.find(version => version.id === request.versionId)!.develop);
		references = { luts: collector.finish(), brushes: [] };
	} else {
		const complete = createPhotoResourceReachabilityCurrentV1();
		for (const version of initial.versions) for (const develop of [version.develop, ...(version.workspace?.entries.map(entry => entry.develop) ?? []), ...(version.workspace?.snapshots.map(snapshot => snapshot.develop) ?? [])]) {
			for (const graph of develop.masks) for (const input of graph.inputs) normalizeBrushMaskResourceReferenceV1(input.sourceRef);
		}
		complete.addPhoto(initial); const retained = complete.finish();
		const selected = initial.versions.find(version => version.id === request.versionId)!;
		assertPhotoDevelopHandoffMasksForProfileV1('current3', selected.develop, initial.original.width, initial.original.height);
		const collector = createPhotoResourceReachabilityCurrentV1(); collector.addDevelop(selected.develop); references = collector.finish();
		const bytes = [...references.luts, ...references.brushes].reduce((size, reference) => size + reference.byteLength, initial.original.byteLength);
		if (BigInt(initial.original.width) * BigInt(initial.original.height) * 4n > 64n * 1024n * 1024n
			|| initial.original.byteLength > IMAGE_IMPORT_LIMITS.maximumFileInputBytes || bytes + 384 > 128 * 1024 * 1024
			|| references.luts.length + references.brushes.length + 1 > SCAPE_ARCHIVE_LIMITS.maximumEntryCount - 2) {
			throw new RangeError('Image handoff bodies or canonical expansion exceed their fixed byte capacity.');
		}
		if (retained.luts.length + retained.brushes.length) {
			if (typeof verify !== 'function') throw new TypeError('Current image handoff requires independent complete retained-resource verification.');
			await Reflect.apply(verify, ports, [initial, signal]); check(signal);
		}
	}
	const original = initial.original, resourceBytes = [...references.luts, ...references.brushes].reduce((size, reference) => size + reference.byteLength, 0);
	if (original.byteLength > IMAGE_IMPORT_LIMITS.maximumFileInputBytes || resourceBytes + original.byteLength > IMAGE_IMPORT_LIMITS.maximumGestureInputBytes
		|| profile === 'current3' && (BigInt(original.width) * BigInt(original.height) * 4n > 64n * 1024n * 1024n || original.byteLength + resourceBytes + 384 > 128 * 1024 * 1024)) {
		throw new RangeError('Image handoff bodies or canonical expansion exceed their fixed byte capacity.');
	}
	const factsJson = profile === 'legacy2' ? serializePhotoExportSidecarV1(createPhotoExportSidecarV1(initial, request))
		: serializePhotoExportSidecarCurrentV1(createPhotoExportSidecarCurrentV1(initial, request));
	const fullJson = profile === 'legacy2' ? canonicalPhotoDocumentJsonV1(initial) : serializePhotoDocumentCurrentV1(initial);
	let originalBlob!: Blob;
	const result = await withPhotoLibraryImageHandoffResourcesForProfileV1(profile, ports, references, signal, async () => {
		check(signal); originalBlob = Object.freeze(canonicalMediaContentBlob(await Reflect.apply(load, backup, [original, signal]))); check(signal);
		if (originalBlob.size !== original.byteLength || await digestMediaContent(originalBlob, { signal }) !== original.contentSha256) throw new Error('Image handoff original body identity changed.');
	}, async readers => {
		await current();
		const common = { signal, factsJson, originalBlob, lutReferences: references.luts, withLutBytes: readers.withLutBytes,
			original: Object.freeze({ exactName: original.name, contentSha256: original.contentSha256, byteLength: original.byteLength,
				mimeType: original.mimeType, width: original.width, height: original.height, hasAlpha: original.hasAlpha }) };
		return consume(profile === 'legacy2' ? Object.freeze({ schemaVersion: 1, ...common })
			: Object.freeze({ schemaVersion: 2, ...common, maskRasterReferences: references.brushes, withMaskRasterBytes: readers.withMaskRasterBytes }));
	});
	check(signal); await current(); return result;

	async function read() {
		const value = await Reflect.apply(loadPhoto, catalog, [catalogId, request.photoId]); check(signal);
		if (!value) throw new ReferenceError('The selected image handoff photo is missing.');
		const photo = profile === 'legacy2' ? normalizePhotoDocumentV1OrV2(value) : normalizePhotoDocumentCurrentV1(value);
		if (profile === 'legacy2') createPhotoExportSidecarV1(photo, request); else createPhotoExportSidecarCurrentV1(photo, request);
		check(signal); return photo;
	}
	async function current(): Promise<void> {
		const latest = await read(), text = profile === 'legacy2' ? canonicalPhotoDocumentJsonV1(latest) : serializePhotoDocumentCurrentV1(latest);
		if (text !== fullJson) throw new Error('Image handoff complete photo facts changed.'); check(signal);
	}
}

/** Actual source and consumer outcomes join independently. Both body kinds
 * share the same active-child gate, and closed/busy admission precedes reflection. */
export async function withPhotoLibraryImageHandoffResourcesForProfileV1<Result>(profile: Profile, ports: Ports, references: References,
	signal: AbortSignal, prepare: () => Promise<void>, consume: (readers: Readonly<Readers>) => Result | Promise<Result>): Promise<Result> {
	assertProfile(profile); check(signal);
	const lutFactory = ports.cubeLutResources, maskFactory = ports.maskRasterResources;
	let lut: Readonly<CubeLutSourcePortV1> | undefined, mask: Readonly<MaskRasterSourcePortV1> | undefined;
	if (references.luts.length) {
		if (typeof lutFactory !== 'function') throw new Error('Image handoff LUT source is unavailable.');
		lut = captureSource((await Reflect.apply(lutFactory, ports, [])).source) as Readonly<CubeLutSourcePortV1>; check(signal);
	}
	if (references.brushes.length) {
		if (typeof maskFactory !== 'function') throw new Error('Image handoff brush source is unavailable.');
		mask = captureSource((await Reflect.apply(maskFactory, ports, [])).source) as Readonly<MaskRasterSourcePortV1>; check(signal);
	}
	return withPhotoImageHandoffScopedSourcesForProfileV1(profile, references, { lut, mask }, signal, prepare, consume);
}

/** Archive readers lend authenticated immutable body snapshots through the
 * same closed serial scope without constructing a selected Session or store. */
export async function withPhotoImageHandoffScopedSourcesForProfileV1<Result>(profile: Profile, references: References,
	sources: Readonly<{ lut?: Readonly<CubeLutSourcePortV1>; mask?: Readonly<MaskRasterSourcePortV1> }>, signal: AbortSignal,
	prepare: () => Promise<void>, consume: (readers: Readonly<Readers>) => Result | Promise<Result>): Promise<Result> {
	assertProfile(profile); check(signal);
	const lut = sources.lut === undefined ? undefined : captureSource(sources.lut) as Readonly<CubeLutSourcePortV1>,
		mask = sources.mask === undefined ? undefined : captureSource(sources.mask) as Readonly<MaskRasterSourcePortV1>;
	if (profile === 'legacy2') { await prepare(); check(signal); }
	for (const reference of references.luts) await read('lut', reference, () => undefined);
	for (const reference of references.brushes) await read('brush', reference, () => undefined);
	if (profile === 'current3') { await prepare(); check(signal); }
	let open = true, busy = false, childFailed = false, childFailure: unknown, joining: Promise<void> | null = null;
	function borrow<Value>(kind: 'lut' | 'brush', value: unknown, borrower: (bytes: Uint8Array<ArrayBuffer>) => Value | Promise<Value>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Value> {
		try {
			if (!open) throw new Error('Image handoff resource capability is closed.'); check(signal);
			if (profile === 'current3' && busy) throw new Error('A serial image handoff resource read is already pending.');
			const { signal: caller } = readPhotoDevelopSignalOptionsV2(options ?? {});
			if (caller !== undefined && caller !== signal) throw new TypeError('Image handoff resource reads use their captured lifetime signal.');
			const reference = kind === 'lut' ? normalizeVideoCubeLutReferenceV1(value) : admitPhotoImageHandoffBrushReferenceV1(value);
			const declared = kind === 'lut' ? references.luts : references.brushes;
			if (!declared.some(expected => JSON.stringify(expected) === JSON.stringify(reference))) throw new Error('Image handoff resource reference is outside the captured closure.');
			if (typeof borrower !== 'function') throw new TypeError('Image handoff resource requires a callable consumer.');
			if (busy) throw new Error('An image handoff resource read is already pending.'); busy = true;
			const work = read(kind, reference, borrower);
			joining = work.then(() => { busy = false; }, error => { busy = false; if (!childFailed) { childFailed = true; childFailure = error; } });
			return work;
		} catch (error) { return Promise.reject(error); }
	}
	const readers = Object.freeze<Readers>({ withLutBytes: (reference, borrower, options) => borrow('lut', reference, borrower, options),
		withMaskRasterBytes: (reference, borrower, options) => borrow('brush', reference, borrower, options) });
	let result!: Result, failed = false, primary: unknown;
	try { result = await consume(readers); } catch (error) { failed = true; primary = error; }
	open = false; await joining;
	if (failed) {
		if (childFailed && !Object.is(childFailure, primary)) throw new AggregateError([primary, childFailure], 'Image handoff consumer and resource read failed.', { cause: primary }); throw primary;
	}
	if (childFailed) throw childFailure; check(signal); return result;

	async function read<Value>(kind: 'lut' | 'brush', reference: Readonly<VideoCubeLutReferenceV1> | Readonly<BrushMaskResourceReferenceV1>, borrower: (bytes: Uint8Array<ArrayBuffer>) => Value | Promise<Value>): Promise<Value> {
		check(signal); const source = kind === 'lut' ? lut : mask;
		if (!source) throw new Error('Image handoff body source is unavailable.');
		type Outcome = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly reason: unknown };
		let accepting = true, failed = false, primary: unknown, violation: unknown;
		const delivery: { entered: boolean; settled: Promise<Outcome> | null } = { entered: false, settled: null };
		try { await Reflect.apply(source.withBytes, source, [reference, (bytes: Uint8Array<ArrayBuffer>) => {
			if (!accepting || delivery.entered) {
				if (profile === 'legacy2') throw new Error('Image handoff LUT source requires exactly one joined body delivery.');
				violation ??= new Error('Image handoff requires exactly one joined body delivery.'); throw violation;
			}
			delivery.entered = true;
			const consume = () => profile === 'legacy2' ? borrower(bytes) : withOwnedBody(bytes, borrower);
			const work = kind === 'lut' ? withCubeLutResourceV1({ reference, bytes, signal }, consume)
				: withBrushMaskResourceV1({ reference, bytes, signal }, consume);
			delivery.settled = work.then(value => ({ ok: true, value }), reason => ({ ok: false, reason })); return work;
		}, { signal }]); } catch (error) { failed = true; primary = error; }
		accepting = false; const outcome = await delivery.settled;
		if (failed) { if (outcome?.ok === false && !Object.is(outcome.reason, primary)) throw new AggregateError([primary, outcome.reason], 'Image handoff source and body consumer failed.', { cause: primary }); throw primary; }
		if (violation !== undefined) throw violation;
		if (!outcome) throw new Error('Image handoff source did not deliver its authenticated body.'); if (!outcome.ok) throw outcome.reason;
		check(signal); return outcome.value;
	}
}
const TYPED_ARRAY = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED_ARRAY, 'byteOffset')!.get!,
	LENGTH = Object.getOwnPropertyDescriptor(TYPED_ARRAY, 'byteLength')!.get!, BACKING_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const SET = Uint8Array.prototype.set, FILL = Uint8Array.prototype.fill;
async function withOwnedBody<Result>(source: Uint8Array<ArrayBuffer>, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>): Promise<Result> {
	const length = Number(Reflect.apply(LENGTH, source, [])), backing = Reflect.apply(BUFFER, source, []) as ArrayBuffer, offset = Number(Reflect.apply(OFFSET, source, []));
	const bytes = new Uint8Array(length), owned = bytes.buffer; Reflect.apply(SET, bytes, [new Uint8Array(backing, offset, length)]);
	let failed = false, primary: unknown, result!: Result;
	try { result = await consume(bytes); } catch (error) { failed = true; primary = error; }
	let cleanup: Readonly<{ error: unknown }> | undefined;
	try { if (Reflect.apply(BACKING_LENGTH, owned, []) !== length) throw new TypeError('Image handoff body backing was detached before retirement.');
		Reflect.apply(FILL, new Uint8Array(owned, 0, length), [0]); } catch (error) { cleanup = { error }; }
	if (failed) { if (cleanup && !Object.is(primary, cleanup.error)) throw new AggregateError([primary, cleanup.error], 'Image handoff body and retirement failed.', { cause: primary }); throw primary; }
	if (cleanup) throw cleanup.error; return result;
}
function captureSource(value: unknown): Readonly<{ withBytes: (...args: never[]) => unknown }> {
	if (value === null || typeof value !== 'object') throw new TypeError('Image handoff requires a body source.');
	const descriptor = Object.getOwnPropertyDescriptor(value, 'withBytes');
	if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Image handoff requires an own callable body source.');
	const method = descriptor.value as (...args: never[]) => unknown;
	return Object.freeze({ withBytes: (...args: never[]) => Reflect.apply(method, value, args) });
}
