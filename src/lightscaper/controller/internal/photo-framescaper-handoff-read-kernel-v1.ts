/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { normalizeVideoCubeLutReferenceV1, type VideoCubeLutReferenceV1 } from '../../../common/editor/cube-lut-reference-contract.ts';
import { type BrushMaskResourceReferenceV1, withBrushMaskResourceV1 } from '../../../common/editor/imaging/brush-mask-resource-v1.ts';
import { withCubeLutResourceV1 } from '../../../common/editor/imaging/cube-lut-resource-v1.ts';
import type { CubeLutSourcePortV1 } from '../../../common/editor/imaging/cube-lut-source-port-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../../common/editor/imaging/mask-raster-source-port-v1.ts';
import { restoreNormalizedScapeAbortReason } from '../../../common/editor/scape-abort.ts';
import { readScapeArchiveEnvelope, type ScapeArchiveEnvelope, type ScapeAssetDescriptor } from '../../../common/editor/scape-archive-envelope.ts';
import { verifyScapeAssetBytes } from '../../../common/editor/scape-archive-media.ts';
import { loadScapeProjectDocument } from '../../../common/editor/scape-project-admission.ts';
import { withScapeProjectInput } from '../../../common/editor/scape-project-input.ts';
import { openFramescaperImageFramePackV1 } from '../../../common/editor/timeline-image-frame-pack-v1.ts';
import { normalizeFramescaperImageSourceV1 } from '../../../common/editor/timeline-image-model.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from '../../../framescaper/editor-project-assistance-foundation.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../../framescaper/editor-project-runtime-profile.ts';
import { cloneFramescaperProject, loadFramescaperProject } from '../../../framescaper/editor-project.ts';
import { timelineImageArchivePackProjection, validateTimelineImageCurrentArchiveAssets } from '../../../framescaper/editor-scape-asset-plan-timeline-image-current.ts';
import { createFramescaperScapeProjectAssetExtension } from '../../../framescaper/editor-scape-assets.ts';
import { id } from '../../catalog/value-validation.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../storage/photo-develop-preset-read-v2.ts';
import { promotePhotoFramescaperImageSourceV1 } from '../photo-framescaper-handoff-source-v1.ts';
import { PhotoLibrarySessionLifetime } from '../photo-library-session-lifetime.ts';
import { assertHandoffProfile, assertPhotoDevelopHandoffMasksForProfileV1, handoffResourceReferencesForProfileV1, normalizeEditableSourceForProfileV1, type EditableSource, type HandoffProfile } from './photo-image-handoff-model-kernel-v1.ts';
import { withPhotoImageHandoffScopedSourcesForProfileV1 } from './photo-library-image-handoff-kernel-v1.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { withFramescaperRawImageOriginalCurrentV1 } from '../../../common/editor/timeline-image-raw-pack-current-v1.ts';
export interface PhotoFramescaperHandoffReadRequestV1 { readonly archive: Blob; readonly sourceId: string; readonly imageClipId?: string; readonly signal?: AbortSignal }
export interface PhotoFramescaperHandoffReadViewForProfileV1 {
	readonly schemaVersion: 1 | 2; readonly projectId: string; readonly projectRevision: number;
	readonly source: Readonly<EditableSource>; readonly originalBlob: Blob;
	/** Pre-recipe canonical digest: RGBA8 for raster, native RGBA16BE for RAW. */
	readonly canonicalFrameSha256: string;
	readonly lutReferences: readonly Readonly<VideoCubeLutReferenceV1>[]; readonly signal: AbortSignal;
	readonly withLutBytes: CubeLutSourcePortV1['withBytes'];
	readonly maskRasterReferences?: readonly Readonly<BrushMaskResourceReferenceV1>[]; readonly withMaskRasterBytes?: MaskRasterSourcePortV1['withBytes'];
}
const MAXIMUM_ARCHIVE = 256 * 1024 * 1024, MAXIMUM_BODIES = 128 * 1024 * 1024, MAXIMUM_ORIGINAL = 64 * 1024 * 1024;
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, SLICE = Blob.prototype.slice, READ = Blob.prototype.arrayBuffer;
const LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'byteLength')!.get!;
const FILL = Uint8Array.prototype.fill, SET = Uint8Array.prototype.set, RANGE = Uint8Array.prototype.subarray, CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
function wipe(bytes: Uint8Array): void { if (Reflect.apply(LENGTH, bytes, []) !== 0) Reflect.apply(FILL, bytes, [0]); }

/** Read one explicit editable source without any store publication or native
 * decode. This is one selected recipe/provenance, not complete Photo history.
 * Ordinary Source1 additionally requires a genuine selected timeline/bin clip;
 * its unchanged pack is authenticated before neutral scalar promotion. Only
 * Frame's stored NFC filename survives ingest; MIME is a derived declaration.
 * ZIP input <=256MiB, unique selected pack+LUT bodies <=128MiB, original <=64MiB.
 * ZIP metadata and inherited LUT parser scratch have separate fixed bounds;
 * these limits do not claim aggregate native/ZIP peak storage. Mutable reads
 * are wiped after their joined consumers; the original is an immutable Blob. */
export async function withPhotoFramescaperHandoffReadForProfileV1<Result>(profile: HandoffProfile, request: Readonly<PhotoFramescaperHandoffReadRequestV1>,
	consume: (view: Readonly<PhotoFramescaperHandoffReadViewForProfileV1>) => Result | Promise<Result>): Promise<Result> {
	assertHandoffProfile(profile); const label = 'Photo editable archive read', input = record(request, label, ['archive', 'sourceId', 'imageClipId', 'signal'], ['archive', 'sourceId']);
	const { signal: caller } = readPhotoDevelopSignalOptionsV2(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal', label) } : {});
	if (typeof consume !== 'function') throw new TypeError('Photo editable archive read requires a scoped consumer.');
	const sourceId = id(field(input, 'sourceId', label), 'selected editable source ID'), archiveValue = field(input, 'archive', label);
	const imageClipId = Object.hasOwn(input, 'imageClipId') ? id(field(input, 'imageClipId', label), 'selected image clip ID') : undefined;
	const size = Number(Reflect.apply(SIZE, archiveValue, []));
	if (size < 1 || size > MAXIMUM_ARCHIVE) throw new RangeError('Photo editable archive exceeds its fixed input byte bound.');
	const archive = Reflect.apply(SLICE, archiveValue, [0, size]) as Blob;
	const lifetime = new PhotoLibrarySessionLifetime();
	try { return await lifetime.operation(async signal => {
		let prepared: Readonly<{ facts: Omit<PhotoFramescaperHandoffReadViewForProfileV1, 'withLutBytes' | 'withMaskRasterBytes'>; bodies: ReadonlyMap<string, Blob> }>;
		try { prepared = await withScapeProjectInput(archive, signal, async entries => {
			const extension = createFramescaperScapeProjectAssetExtension(PROFILE);
			const envelope = await readScapeArchiveEnvelope(entries, { maximumExpandedBytes: MAXIMUM_ARCHIVE }, signal, extension.assetKinds);
			check(signal); verifyScapeAssetBytes(new TextEncoder().encode(envelope.projectText), envelope.manifest.project, 'Frame project document');
			const admitted = loadScapeProjectDocument(envelope.projectText, envelope.manifest.project, {
				currentProjectSchemaFamily: 'framescaper', currentProjectSchemaVersion: 1, loadProject: value => loadFramescaperProject(PROFILE, value),
			});
			if (admitted.readOnly) throw new RangeError('Photo editable archive requires a current Frame project.');
			const project = cloneFramescaperProject(PROFILE, admitted.project);
			if (profile === 'legacy2' && project.sources.some(source => source.kind === 'image' && (source.schemaVersion === 3 || source.schemaVersion === 4))) throw new RangeError('Legacy editable archive read refuses successor sources.');
			const selected = project.sources.find(value => value.id === sourceId);
			if (!selected) throw new ReferenceError('The selected editable image source is missing.');
			const ordinary = selected.kind === 'image' && selected.schemaVersion === 1;
			const editable = ordinary ? null : normalizeEditableSourceForProfileV1(profile, selected);
			const sourceFacts = editable ?? normalizeFramescaperImageSourceV1(selected);
			if (editable && imageClipId !== undefined) throw new TypeError('Editable Source2 does not accept an ordinary image clip selection.');
			if (editable) assertPhotoDevelopHandoffMasksForProfileV1(profile, editable.develop, editable.canonical.width, editable.canonical.height);
			if (ordinary && (sourceFacts.canonical.frameCount !== 1 || !['png', 'jpeg', 'gif', 'webp', 'bmp'].includes(sourceFacts.original.recognizedFormat))) {
				throw new RangeError('Ordinary image receive requires one admitted static image frame.');
			}
			const clip = ordinary ? [...project.clips, ...project.projectBin.clips].find(value => value.id === imageClipId && value.kind === 'image') : null;
			if (ordinary && (!clip || clip.sourceId !== sourceId || !project.sequences.some(sequence => sequence.id === clip.sequenceId))) {
				throw new ReferenceError('Ordinary image receive requires an explicit matching image clip and existing sequence.');
			}
			const validation = validateTimelineImageCurrentArchiveAssets(framescaperProjectTimelineImageFoundationShapeAssistance(project), envelope.manifest);
			const resources = editable ? handoffResourceReferencesForProfileV1(profile, editable) : { luts: [], brushes: [] }, lutReferences = resources.luts, maskRasterReferences = resources.brushes;
			if (sourceFacts.original.byteLength > MAXIMUM_ORIGINAL || sourceFacts.assetByteLength + [...lutReferences, ...maskRasterReferences].reduce((sum, ref) => sum + ref.byteLength, 0) > MAXIMUM_BODIES) {
				throw new RangeError('Photo editable archive selected bodies exceed their fixed byte capacity.');
			}
			const descriptor = validation.images.descriptorByArchiveId.get(`framescaper:image:${sourceFacts.id}`);
			if (!descriptor) throw new Error('Photo editable archive selected pack descriptor is missing.');
			const pack = await readBody(envelope, descriptor, signal);
			let originalBlob: Blob, canonicalFrameSha256: string;
			try {
				if (sourceFacts.schemaVersion === 4) {
					const original = await withFramescaperRawImageOriginalCurrentV1({ source: sourceFacts, signal,
						read: (offset, length) => Reflect.apply(RANGE, pack, [offset, offset + length]) as Uint8Array<ArrayBuffer> }, view =>
						Object.freeze(new Blob([view.originalBytes], { type: sourceFacts.original.mimeType ?? '' })));
					originalBlob = original; canonicalFrameSha256 = sourceFacts.raw.pixelsSha256;
				} else {
				const projection = timelineImageArchivePackProjection(framescaperProjectTimelineImageFoundationShapeAssistance({ ...project, sources: [sourceFacts] }));
				const packedSource = projection.sources[0];
				if (packedSource?.kind !== 'image' || packedSource.schemaVersion !== 1) throw new Error('The selected editable image pack projection is missing.');
				let copyingOriginal = false;
				const reader = await openFramescaperImageFramePackV1({ source: packedSource, read: (offset, length) => {
					if (!copyingOriginal) check(signal);
					return Reflect.apply(RANGE, pack, [offset, offset + length]) as Uint8Array<ArrayBuffer>;
				} });
				// Receive the owned original before the final fence: the legacy reader
				// can otherwise throw during a later range or after allocation without
				// exposing it for wiping. This bounded copy reads our private snapshot.
				check(signal); copyingOriginal = true;
				const original = await reader.readOriginal();
				try { check(signal); originalBlob = Object.freeze(new Blob([original as Uint8Array<ArrayBuffer>], { type: sourceFacts.original.mimeType ?? '' })); }
				finally { wipe(original); }
				check(signal);
				const frame = await reader.readFrame(0);
				try { check(signal); canonicalFrameSha256 = bytesToHex(sha256(frame)); }
				finally { wipe(frame); }
				}
			} finally { wipe(pack); }
			const source = editable ?? promotePhotoFramescaperImageSourceV1({ source: sourceFacts,
				origin: { schemaFamily: 'framescaper', schemaVersion: 1, projectId: project.id, revision: project.revision,
					sourceId: sourceFacts.id, sequenceId: clip!.sequenceId, clipId: clip!.id } });
			const bodies = new Map<string, Blob>();
			for (const reference of lutReferences) {
				const ref = validation.foundation.references.find(value => value.role === 'lut' && value.storageKey === reference.storageKey);
				const descriptor = ref && validation.foundation.descriptorByArchiveId.get(ref.archiveId);
				if (!descriptor) throw new Error('Photo editable archive selected LUT descriptor is missing.');
				const bytes = await readBody(envelope, descriptor, signal);
				try { await withCubeLutResourceV1({ reference, bytes, signal }, () => undefined); check(signal);
					bodies.set(reference.storageKey, new Blob([bytes], { type: 'text/plain' }));
				} finally { wipe(bytes); }
			}
			for (const reference of maskRasterReferences) {
				const descriptor = validation.masks.descriptors.get(reference.storageKey);
				if (!descriptor) throw new Error('Photo editable archive selected brush descriptor is missing.');
				const bytes = await readBody(envelope, descriptor, signal);
				try { await withBrushMaskResourceV1({ reference, bytes, signal }, () => undefined); check(signal);
					bodies.set(reference.storageKey, new Blob([bytes], { type: 'application/octet-stream' }));
				} finally { wipe(bytes); }
			}
			const facts: Omit<PhotoFramescaperHandoffReadViewForProfileV1, 'withLutBytes' | 'withMaskRasterBytes'> = {
				schemaVersion: profile === 'legacy2' ? 1 : 2, projectId: project.id, projectRevision: project.revision, source, originalBlob, canonicalFrameSha256, lutReferences, signal,
				...(profile === 'current3' ? { maskRasterReferences } : {}),
			};
			return { facts, bodies };
		}); } catch (error) { check(signal); throw restoreNormalizedScapeAbortReason(error); }
		// The ZIP reader is now closed. Independent immutable bodies stay scoped
		// to the same operation; opaque consumer failures need no ZIP normalization.
		return profile === 'legacy2' ? await deliver(prepared.facts, prepared.bodies, consume) : await deliverCurrent(prepared.facts, prepared.bodies, consume);
	}, caller); } finally { await lifetime.close(async () => undefined); }
}

async function readBody(envelope: ScapeArchiveEnvelope, descriptor: ScapeAssetDescriptor, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
	check(signal); const entry = envelope.entryByName.get(descriptor.entry);
	if (!entry?.getData || entry.uncompressedSize !== descriptor.size) throw new Error('Editable archive body entry differs from its declared size.');
	const bytes = new Uint8Array(descriptor.size); let offset = 0;
	try {
		await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
			check(signal); const length = Number(Reflect.apply(LENGTH, chunk, []));
			if (length > 4 * 1024 * 1024 || length > bytes.byteLength - offset) throw new RangeError('Editable archive body emission exceeds its fixed bound.');
			envelope.expandedByteBudget.consume(length, descriptor.entry); Reflect.apply(SET, bytes, [chunk, offset]); offset += length;
		} }), { signal, strictness: 'strict' });
		check(signal); if (offset !== bytes.byteLength) throw new Error('Editable archive body emission is incomplete.');
		verifyScapeAssetBytes(bytes, descriptor, 'Editable archive body'); return bytes;
	} catch (error) { wipe(bytes); throw error; }
}

async function deliver<Result>(facts: Omit<PhotoFramescaperHandoffReadViewForProfileV1, 'withLutBytes' | 'withMaskRasterBytes'>, bodies: ReadonlyMap<string, Blob>,
	consume: (view: Readonly<PhotoFramescaperHandoffReadViewForProfileV1>) => Result | Promise<Result>): Promise<Result> {
	let accepting = true, reading = false, resourceFailed = false, resourceFailure: unknown, joined: Promise<void> | null = null;
	const withLutBytes: CubeLutSourcePortV1['withBytes'] = (value, borrower, options) => {
		try {
			if (!accepting) throw new Error('Editable archive LUT capability is closed.'); check(facts.signal);
			const { signal } = readPhotoDevelopSignalOptionsV2(options ?? {});
			if (signal !== undefined && signal !== facts.signal) throw new TypeError('Editable archive LUT reads use their captured lifetime signal.');
			const reference = normalizeVideoCubeLutReferenceV1(value), body = bodies.get(reference.storageKey);
			if (!body || !facts.lutReferences.some(expected => JSON.stringify(expected) === JSON.stringify(reference))) throw new Error('Editable archive LUT reference is outside the selected closure.');
			if (typeof borrower !== 'function') throw new TypeError('Editable archive LUT requires a scoped consumer.');
			if (reading) throw new Error('An editable archive LUT read is already pending.'); reading = true;
			const work = (async () => {
				const bytes = new Uint8Array(await (Reflect.apply(READ, body, []) as Promise<ArrayBuffer>));
				try { check(facts.signal); return await withCubeLutResourceV1({ reference, bytes, signal: facts.signal }, () => borrower(bytes)); }
				finally { wipe(bytes); }
			})();
			joined = work.then(() => { reading = false; }, error => { reading = false; if (!resourceFailed) { resourceFailed = true; resourceFailure = error; } });
			return work;
		} catch (error) { return Promise.reject(error); }
	};
	let result!: Result, failed = false, primary: unknown;
	try { check(facts.signal); result = await consume(Object.freeze({ ...facts, withLutBytes })); }
	catch (error) { failed = true; primary = error; }
	accepting = false; await joined;
	if (failed) {
		if (resourceFailed && resourceFailure !== primary) throw new AggregateError([primary, resourceFailure], 'Editable archive consumer and LUT borrower failed.', { cause: primary });
		throw primary;
	}
	if (resourceFailed) throw resourceFailure;
	check(facts.signal); return result;
}

async function deliverCurrent<Result>(facts: Omit<PhotoFramescaperHandoffReadViewForProfileV1, 'withLutBytes' | 'withMaskRasterBytes'>,
	bodies: ReadonlyMap<string, Blob>, consume: (view: Readonly<PhotoFramescaperHandoffReadViewForProfileV1>) => Result | Promise<Result>): Promise<Result> {
	const read = async <Value>(reference: Readonly<{ storageKey: string }>, borrower: (bytes: Uint8Array<ArrayBuffer>) => Value | Promise<Value>): Promise<Value> => {
		check(facts.signal); const body = bodies.get(reference.storageKey); if (!body) throw new Error('Editable archive body is outside the selected closure.');
		const backing = await Reflect.apply(READ, body, []) as ArrayBuffer, bytes = new Uint8Array(backing);
		try { check(facts.signal); return await borrower(bytes); } finally { Reflect.apply(FILL, new Uint8Array(backing), [0]); }
	};
	const lut: CubeLutSourcePortV1 = Object.freeze({ withBytes: read }), mask: MaskRasterSourcePortV1 = Object.freeze({ withBytes: read });
	return withPhotoImageHandoffScopedSourcesForProfileV1('current3', { luts: facts.lutReferences, brushes: facts.maskRasterReferences ?? [] },
		{ lut, mask }, facts.signal, async () => undefined, readers => consume(Object.freeze({ ...facts, ...readers })));
}

export interface PhotoFramescaperHandoffSourceChoiceForProfileV1 {
	readonly sourceId: string; readonly name: string; readonly originalName: string;
	readonly processVersion: 1 | 2 | 3; readonly width: number; readonly height: number;
	readonly versionKind?: 'master' | 'virtual-copy';
	/** Ordinary Source1 choices retain only Frame's stored NFC original name. */
	readonly imageClips?: readonly Readonly<{ clipId: string; sequenceId: string; sequenceName: string; scope: 'timeline' | 'bin' }>[];
}
export interface PhotoFramescaperHandoffInspectionForProfileV1 {
	readonly schemaVersion: 1 | 2; readonly projectId: string; readonly projectRevision: number; readonly title: string;
	readonly sources: readonly Readonly<PhotoFramescaperHandoffSourceChoiceForProfileV1>[]; readonly unsupportedImageCount: number;
}

/** Authenticate current project facts and its declared asset inventory, then
 * close the ZIP before returning scalar choices. No original, LUT or pixel
 * bodies are read or granted here; receive must authenticate the selection.
 * The archive and expanded envelope share the reader's fixed 256MiB bound.
 * Eligible ordinary Source1 additionally lists genuine timeline/bin contexts;
 * zero placements and unsupported images are counted, never silently selected
 * or flattened. Clip presence conveys the stored filename limitation. */
export async function inspectPhotoFramescaperHandoffSourcesForProfileV1(profile: HandoffProfile, value: Readonly<{ archive: Blob; signal?: AbortSignal }>): Promise<Readonly<PhotoFramescaperHandoffInspectionForProfileV1>> {
	assertHandoffProfile(profile); const label = 'Photo editable archive inspection', input = record(value, label, ['archive', 'signal'], ['archive']);
	const { signal: caller } = readPhotoDevelopSignalOptionsV2(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal', label) } : {});
	const candidate = field(input, 'archive', label), size = Number(Reflect.apply(SIZE, candidate, []));
	if (size < 1 || size > MAXIMUM_ARCHIVE) throw new RangeError('Photo editable archive exceeds its fixed input byte bound.');
	const archive = Reflect.apply(SLICE, candidate, [0, size]) as Blob, lifetime = new PhotoLibrarySessionLifetime();
	try { return await lifetime.operation(async signal => {
		try { return await withScapeProjectInput(archive, signal, async entries => {
			const extension = createFramescaperScapeProjectAssetExtension(PROFILE);
			const envelope = await readScapeArchiveEnvelope(entries, { maximumExpandedBytes: MAXIMUM_ARCHIVE }, signal, extension.assetKinds);
			check(signal); verifyScapeAssetBytes(new TextEncoder().encode(envelope.projectText), envelope.manifest.project, 'Frame project document');
			const admitted = loadScapeProjectDocument(envelope.projectText, envelope.manifest.project, {
				currentProjectSchemaFamily: 'framescaper', currentProjectSchemaVersion: 1, loadProject: project => loadFramescaperProject(PROFILE, project),
			});
			if (admitted.readOnly) throw new RangeError('Photo editable archive requires a current Frame project.');
			const project = cloneFramescaperProject(PROFILE, admitted.project);
			if (profile === 'legacy2' && project.sources.some(source => source.kind === 'image' && (source.schemaVersion === 3 || source.schemaVersion === 4))) throw new RangeError('Legacy editable archive inspection refuses successor sources.');
			validateTimelineImageCurrentArchiveAssets(framescaperProjectTimelineImageFoundationShapeAssistance(project), envelope.manifest);
			const sources: Readonly<PhotoFramescaperHandoffSourceChoiceForProfileV1>[] = []; let unsupportedImageCount = 0;
			for (const candidate of project.sources) {
				check(signal); if (candidate.kind !== 'image') continue;
				if (candidate.schemaVersion === 1) {
					const source = normalizeFramescaperImageSourceV1(candidate);
					const imageClips: NonNullable<PhotoFramescaperHandoffSourceChoiceForProfileV1['imageClips']>[number][] = [];
					for (const [scope, clips] of [['timeline', project.clips], ['bin', project.projectBin.clips]] as const) {
						for (const clip of clips) {
							if (clip.kind !== 'image' || clip.sourceId !== source.id) continue;
							const sequence = project.sequences.find(value => value.id === clip.sequenceId);
							if (!sequence) throw new ReferenceError('Ordinary image clip sequence is missing.');
							if (typeof sequence.name !== 'string') throw new TypeError('Ordinary image clip sequence requires its stored name.');
							imageClips.push(Object.freeze({ clipId: clip.id, sequenceId: sequence.id, sequenceName: sequence.name, scope }));
						}
					}
					if (!imageClips.length || source.canonical.frameCount !== 1 || !['png', 'jpeg', 'gif', 'webp', 'bmp'].includes(source.original.recognizedFormat)
						|| source.original.byteLength > MAXIMUM_ORIGINAL || source.assetByteLength > MAXIMUM_BODIES) { unsupportedImageCount++; continue; }
					sources.push(Object.freeze({ sourceId: source.id, name: source.name, originalName: source.original.fileName,
						processVersion: 1, width: source.canonical.width, height: source.canonical.height, imageClips: Object.freeze(imageClips) }));
					continue;
				}
				const source = normalizeEditableSourceForProfileV1(profile, candidate), origin = source.provenance.origin;
				const lutBytes = (() => { const refs = handoffResourceReferencesForProfileV1(profile, source); return [...refs.luts, ...refs.brushes].reduce((sum, reference) => sum + reference.byteLength, 0); })();
				try { assertPhotoDevelopHandoffMasksForProfileV1(profile, source.develop, source.canonical.width, source.canonical.height); }
				catch { unsupportedImageCount++; continue; }
				if (source.original.byteLength > MAXIMUM_ORIGINAL
					|| source.assetByteLength + lutBytes > MAXIMUM_BODIES) { unsupportedImageCount++; continue; }
				sources.push(Object.freeze({ sourceId: source.id, name: source.name, originalName: source.provenance.original.exactName,
					processVersion: source.develop.processVersion, width: source.canonical.width, height: source.canonical.height,
					...(origin.schemaFamily === 'lightscaper' ? { versionKind: origin.versionKind } : {}) }));
			}
			check(signal); return Object.freeze({ schemaVersion: profile === 'legacy2' ? 1 : 2, projectId: project.id, projectRevision: project.revision, title: project.title,
				sources: Object.freeze(sources), unsupportedImageCount });
		}); } catch (error) { check(signal); throw restoreNormalizedScapeAbortReason(error); }
	}, caller); } finally { await lifetime.close(async () => undefined); }
}
