/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageHandoffPortV1, PhotoLibraryImageHandoffRequestV1, PhotoLibraryImageHandoffViewV1 } from '../../../common/editor/photo-library-image-handoff-port-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../../common/editor/timeline-image-native-decode-v1.ts';
import type { CubeLutSourcePortV1 } from '../../../common/editor/imaging/cube-lut-source-port-v1.ts';
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { normalizeVideoCubeLutReferenceV1 } from '../../../common/editor/cube-lut-reference-contract.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../../../common/editor/timeline-image-model.ts';
import { sanitizeSuggestedSaveName } from '../../../common/editor/browser-file-save-service.ts';
import { createFramescaperScapeNativeRuntime } from '../../../framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../../framescaper/editor-project-runtime-profile.ts';
import { parsePhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../../catalog/photo-export-sidecar-v1.ts';
import { createPhotoCubeLutClosureV1 } from '../../catalog/photo-cube-lut-closure-v1.ts';
import { id, integer } from '../../catalog/value-validation.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../storage/photo-develop-preset-read-v2.ts';
import { decodePhotoImageHandoffSourceForProfileV1 } from './photo-image-handoff-decode-kernel-v1.ts';
import { assertHandoffProfile, createPhotoFramescaperHandoffProjectForProfileV1, handoffResourceReferencesForProfileV1, type HandoffProfile } from './photo-image-handoff-model-kernel-v1.ts';
import { parsePhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../../catalog/photo-export-sidecar-current-v1.ts';
import type { PhotoLibraryImageHandoffPortV2, PhotoLibraryImageHandoffViewV2 } from '../../../common/editor/photo-library-image-handoff-port-v2.ts';
import type { MaskRasterSourcePortV1 } from '../../../common/editor/imaging/mask-raster-source-port-v1.ts';
import { admitPhotoImageHandoffBrushReferenceV1 } from './photo-library-image-handoff-kernel-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../../catalog/photo-resource-reachability-current-v1.ts';
import { PhotoLibrarySessionLifetime } from '../photo-library-session-lifetime.ts';

export interface PhotoFramescaperHandoffArchiveRequestForProfileV1 {
	readonly capture: Readonly<PhotoLibraryImageHandoffPortV1 | PhotoLibraryImageHandoffPortV2>; readonly binding: Readonly<PhotoLibraryImageHandoffRequestV1>; readonly signal?: AbortSignal;
}
export interface PhotoFramescaperHandoffArchiveDependenciesV1 {
	readonly openImage?: OpenFramescaperBrowserNativeImageV1; readonly createId?: () => string; readonly now?: () => string;
}
export interface PhotoFramescaperHandoffArchiveV1 { readonly blob: Blob; readonly fileName: string; readonly projectId: string }

const MAXIMUM_BODIES = 128 * 1024 * 1024, MAXIMUM_ARCHIVE = 256 * 1024 * 1024;
const CHECK = AbortSignal.prototype.throwIfAborted;
const ANY = AbortSignal.any;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** Export an ordinary current editable .fscape without creating a sender or
 * destination project. Unique immutable pack/LUT bodies are <=128MiB before
 * archive copies; final ZIP output is independently <=256MiB. Existing decoder
 * and scoped LUT limits remain; codec/ZIP native peak storage is not promised.
 * Complete Photo metadata/history remain in the unchanged sending Photo. */
export async function exportPhotoFramescaperHandoffArchiveForProfileV1(profile: HandoffProfile, request: Readonly<PhotoFramescaperHandoffArchiveRequestForProfileV1>,
	dependencies: Readonly<PhotoFramescaperHandoffArchiveDependenciesV1> = {}): Promise<Readonly<PhotoFramescaperHandoffArchiveV1>> {
	assertHandoffProfile(profile); const label = 'Photo editable archive request', input = record(request, label, ['capture', 'binding', 'signal'], ['capture', 'binding']);
	const options = readPhotoDevelopSignalOptionsV2(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal', label) } : {});
	const capture = field(input, 'capture', label), cap = record(capture, 'Photo handoff capture', ['withCapture']);
	const withCapture = field(cap, 'withCapture', 'Photo handoff capture');
	if (typeof withCapture !== 'function') throw new TypeError('Photo handoff requires a callable capture capability.');
	const value = record(field(input, 'binding', label), 'Photo handoff binding', ['catalogId', 'photoId', 'versionId', 'expectedRevision']);
	const binding = Object.freeze({ catalogId: id(field(value, 'catalogId', label), 'handoff catalog ID'), photoId: id(field(value, 'photoId', label), 'handoff photo ID'),
		versionId: id(field(value, 'versionId', label), 'handoff version ID'), expectedRevision: integer(field(value, 'expectedRevision', label), 0, Number.MAX_SAFE_INTEGER, 'handoff photo revision') });
	const ports = record(dependencies, 'Photo archive dependencies', ['openImage', 'createId', 'now'], []);
	const pin = (name: string, fallback: () => unknown) => {
		const method = Object.hasOwn(ports, name) ? field(ports, name, 'Photo archive dependencies') : fallback;
		if (typeof method !== 'function') throw new TypeError(`Photo archive ${name} must be callable.`);
		return Reflect.apply(Function.prototype.bind, method, [dependencies]) as () => unknown;
	};
	const createId = pin('createId', () => crypto.randomUUID()), now = pin('now', () => new Date().toISOString());
	const openImageValue = Object.hasOwn(ports, 'openImage') ? field(ports, 'openImage', 'Photo archive dependencies') : undefined;
	if (openImageValue !== undefined && typeof openImageValue !== 'function') throw new TypeError('Photo archive requires a callable native image port.');
	const decoder = openImageValue ? { openImage: Reflect.apply(Function.prototype.bind, openImageValue, [dependencies]) as OpenFramescaperBrowserNativeImageV1 } : {};
	const projectId = id(createId(), 'handoff project ID'), sourceId = id(createId(), 'handoff source ID'), sequenceId = id(createId(), 'handoff sequence ID');
	const trackId = id(createId(), 'handoff track ID'), clipId = id(createId(), 'handoff clip ID'), timestampValue = now();
	if (new Set([projectId, sourceId, sequenceId, trackId, clipId]).size !== 5) throw new Error('Photo handoff identifiers must be distinct.');
	if (typeof timestampValue !== 'string' || !Number.isFinite(Date.parse(timestampValue))) throw new TypeError('Photo archive timestamp is invalid.');
	const timestamp = timestampValue;
	type Outcome = { readonly ok: true; readonly value: Readonly<PhotoFramescaperHandoffArchiveV1> } | { readonly ok: false; readonly reason: unknown };
	const delivery: { entered: boolean; settled: Promise<Outcome> | null } = { entered: false, settled: null };
	let accepting = true, failed = false, primary: unknown, violation: unknown;
	try {
		await (Reflect.apply(withCapture, capture, [binding, (view: Readonly<PhotoLibraryImageHandoffViewV1 | PhotoLibraryImageHandoffViewV2>) => {
			if (!accepting || delivery.entered) { violation ??= new Error('Photo archive requires exactly one joined capture delivery.'); throw violation; }
			delivery.entered = true;
			const work = build(view);
			delivery.settled = work.then(value => ({ ok: true, value }), reason => ({ ok: false, reason }));
			return work;
		}, options]) as Promise<unknown>);
	} catch (error) { failed = true; primary = error; }
	accepting = false;
	const outcome = await delivery.settled;
	if (failed) {
		if (outcome?.ok === false && outcome.reason !== primary) throw new AggregateError([primary, outcome.reason], 'Photo capture transport and archive failed.', { cause: primary });
		throw primary;
	}
	if (profile === 'current3' && violation !== undefined) throw violation;
	if (outcome === null) throw new Error('Photo archive capture did not deliver its authenticated saved facts.');
	if (!outcome.ok) throw outcome.reason;
	if (options.signal) check(options.signal);
	return outcome.value;

	async function build(viewValue: Readonly<PhotoLibraryImageHandoffViewV1 | PhotoLibraryImageHandoffViewV2>): Promise<Readonly<PhotoFramescaperHandoffArchiveV1>> {
		const label = 'Photo archive captured view', view = record(viewValue, label, ['schemaVersion', 'signal', 'factsJson', 'original', 'originalBlob', 'lutReferences', 'withLutBytes', ...(profile === 'current3' ? ['maskRasterReferences', 'withMaskRasterBytes'] : [])]);
		if (field(view, 'schemaVersion', label) !== (profile === 'current3' ? 2 : 1)) throw new TypeError('Photo archive requires its current captured view.');
		const factsJson = field(view, 'factsJson', label);
		if (typeof factsJson !== 'string') throw new TypeError('Photo archive requires canonical saved facts.');
		const original = field(view, 'original', label) as PhotoLibraryImageHandoffViewV1['original'], originalBlob = field(view, 'originalBlob', label) as Blob;
		const rawSignal = readPhotoDevelopSignalOptionsV2({ signal: field(view, 'signal', label) }).signal;
		if (!rawSignal) throw new TypeError('Photo archive requires its captured native lifetime.');
		const facts = profile === 'legacy2' ? parsePhotoExportSidecarV1(factsJson) : parsePhotoExportSidecarCurrentV1(factsJson);
		if ((profile === 'legacy2' ? serializePhotoExportSidecarV1(facts) : serializePhotoExportSidecarCurrentV1(facts)) !== factsJson || facts.binding.catalogId !== binding.catalogId || facts.binding.photoId !== binding.photoId
			|| facts.binding.revision !== binding.expectedRevision || facts.version.id !== binding.versionId || facts.binding.activeVersionId !== binding.versionId) {
			throw new Error('Photo editable archive selected active saved facts changed.');
		}
		const closure = createPhotoCubeLutClosureV1();
		let references: ReturnType<typeof closure.finish>, masks: ReturnType<ReturnType<typeof createPhotoResourceReachabilityCurrentV1>['finish']>['brushes'] = [];
		if (profile === 'legacy2') { closure.addDevelop(facts.version.develop); references = closure.finish(); }
		else { const current = createPhotoResourceReachabilityCurrentV1(); current.addDevelop(facts.version.develop); const refs = current.finish(); references = refs.luts; masks = refs.brushes; }
		const capturedReferences = array(field(view, 'lutReferences', label), 'Photo archive LUT closure', 0, references.length).map(normalizeVideoCubeLutReferenceV1);
		if (JSON.stringify(references) !== JSON.stringify(capturedReferences)) throw new Error('Photo archive captured resource closure changed.');
		if (profile === 'current3') {
			const captured = array(field(view, 'maskRasterReferences', label), 'Photo archive brush closure', 0, masks.length).map(admitPhotoImageHandoffBrushReferenceV1);
			if (JSON.stringify(masks) !== JSON.stringify(captured)) throw new Error('Photo archive captured brush closure changed.');
		}
		const resourceBytes = [...references, ...masks].reduce((total, reference) => total + reference.byteLength, 0);
		if (resourceBytes > MAXIMUM_BODIES) throw new RangeError('Photo archive bodies exceed their fixed byte capacity.');
		const borrower = field(view, 'withLutBytes', label);
		if (typeof borrower !== 'function') throw new TypeError('Photo archive requires its scoped LUT reader.');
		const readLut = Reflect.apply(Function.prototype.bind, borrower, [viewValue]) as CubeLutSourcePortV1['withBytes'];
		const maskMethod = profile === 'current3' ? field(view, 'withMaskRasterBytes', label) : undefined;
		if (profile === 'current3' && typeof maskMethod !== 'function') throw new TypeError('Photo archive requires its scoped brush reader.');
		const readMask = maskMethod === undefined ? undefined : Reflect.apply(Function.prototype.bind, maskMethod, [viewValue]) as MaskRasterSourcePortV1['withBytes'];
		const joined = Reflect.apply(ANY, AbortSignal, [[rawSignal, ...(options.signal ? [options.signal] : [])]]) as AbortSignal;
		const lifetime = new PhotoLibrarySessionLifetime();
		try { return await lifetime.operation(async signal => {
			const decoded = await decodePhotoImageHandoffSourceForProfileV1(profile, { factsJson, original, originalBlob, signal }, sourceId, decoder);
			check(signal);
			if (decoded.body.size + resourceBytes > MAXIMUM_BODIES) throw new RangeError('Photo archive bodies exceed their fixed byte capacity.');
			if (JSON.stringify(handoffResourceReferencesForProfileV1(profile, decoded.source)) !== JSON.stringify({ luts: references, brushes: masks })) throw new Error('Photo archive decoded resource closure changed.');
			const project = createPhotoFramescaperHandoffProjectForProfileV1(profile, decoded.source, { projectId, sequenceId, trackId, clipId, now: timestamp });
			let open = true;
			const cached = new Map<string, Blob>();
			let reading: { key: string; promise: Promise<Blob> } | null = null;
			const metadata = (key: string) => {
				if (!open) throw new Error('Photo archive body adapter is closed.'); check(signal);
				if (key === sourceId) return { sourceId, size: decoded.source.assetByteLength, sha256: decoded.source.contentSha256,
					mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, kind: 'timeline-image', encoding: 'framescaper-image-asset-v1' };
				const ref = [...references, ...masks].find(reference => reference.storageKey === key);
				if (!ref) throw new ReferenceError('Photo archive body is outside the captured closure.');
				return masks.some(reference => reference.storageKey === key)
					? { sourceId: key, size: ref.byteLength, sha256: ref.sha256, mimeType: 'application/octet-stream', kind: 'photo-mask-raster', encoding: 'lightscaper-mask-raster-v1' }
					: { sourceId: key, size: ref.byteLength, sha256: ref.sha256, mimeType: 'text/plain' };
			};
			const adapter = Object.freeze({ getMediaAssetMetadata: metadata,
				loadProject(key: string) { if (!open) throw new Error('Photo archive body adapter is closed.'); check(signal); return key === projectId ? project : null; },
				async loadMediaAsset(key: string) { metadata(key);
					if (key === sourceId) return decoded.body;
					const existing = cached.get(key); if (existing) return existing;
					if (reading) { if (reading.key === key) return await reading.promise; throw new Error('A photo archive LUT read is already pending.'); }
					const brush = masks.find(reference => reference.storageKey === key), lut = references.find(reference => reference.storageKey === key);
					const work = brush ? readMask!(brush, bytes => new Blob([bytes], { type: 'application/octet-stream' })) : readLut(lut!, bytes => new Blob([bytes], { type: 'text/plain' })); reading = { key, promise: work };
					try { const blob = await work; check(signal); cached.set(key, blob); return blob; } finally { reading = null; }
				}, readSourceChunks() { throw new TypeError('Photo handoff has no audio body authority.'); } });
			try {
				const exported = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, adapter,
					{ signal, maximumBlobBytes: MAXIMUM_ARCHIVE, assertCurrent: () => { check(signal); } });
				check(signal); if (!exported.blob) throw new Error('Photo handoff archive did not produce its bounded Blob.');
				return Object.freeze({ blob: exported.blob, fileName: sanitizeSuggestedSaveName(facts.original.fileName.replace(/\.[^.]+$/u, '') + '.fscape'), projectId });
			} finally { open = false; }
		}, joined); } finally { await lifetime.close(async () => undefined); }
	}
}
