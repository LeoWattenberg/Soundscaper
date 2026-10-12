/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeFramescaperImageSourceCurrentV1, framescaperImageSourceResourceReferencesCurrentV1 } from '../common/editor/timeline-image-model-current-v1.ts';
import { normalizeImageDevelopStateV2 } from '../common/editor/imaging/image-develop-state-v2.ts';
import { planImageDevelopRepairSpotsV1 } from '../common/editor/imaging/image-develop-repair-plan-v1.ts';
import { withFramescaperImageDevelopFrameV3 } from './timeline-image-develop-frame-v3.ts';
import { createFramescaperMaskRasterSourceTimelineImageV1 } from './timeline-image-mask-raster-source-v1.ts';
import { openFramescaperImageFramePackV1, type FramescaperImageFramePackReaderV1 } from '../common/editor/timeline-image-frame-pack-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1 } from '../common/editor/video-image-geometry-v1.ts';
import { planImageGeometryV1 } from '../common/editor/imaging/image-geometry-plan-v1.ts';
import { planImageDevelopMasksV1, planAdmittedImageDevelopMasksV1 } from '../common/editor/imaging/image-develop-mask-plan-v1.ts';
import { admitImageDevelopBrushMaskAuthorityV1 } from '../common/editor/imaging/image-develop-brush-mask-v1.ts';
import { FRAMESCAPER_IMAGE_MODEL_LIMITS_V1 as IMAGE_LIMITS } from '../common/editor/timeline-image-model.ts';
import { withFramescaperImageDevelopFrameV2 } from './timeline-image-develop-frame-v2.ts';
import { createFramescaperCubeLutSourceFinishing } from './cube-lut-source-finishing.ts';
import { openFramescaperStoredImageFramePackTimelineImage, scaleFramescaperImageRgbaTimelineImage,
	framescaperImageDimensionsTimelineImage, type FramescaperStoredImageAssetStoreTimelineImage,
	type FramescaperCurrentImageSourceTimelineImage } from './editor-selected-timeline-image-image-frame-source.ts';

const CHECK = AbortSignal.prototype.throwIfAborted, JOIN = AbortSignal.any;
const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const READ = Blob.prototype.arrayBuffer;
const FILL = Uint8Array.prototype.fill;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const PIXEL_LIMITS = Object.freeze({ maximumSidePixels: IMAGE_LIMITS.maximumDimension, maximumPixels: IMAGE_LIMITS.maximumPixelsPerFrame, maximumBytes: IMAGE_LIMITS.maximumPixelsPerFrame * 4 });
export interface FramescaperCurrentImageFrameReader extends FramescaperImageFramePackReaderV1 { closeAndJoin(): Promise<void> }

/** The current recipe owner has a transferred encoded snapshot, a canonical
 * plane, and at most four simultaneous recipe/staged-output planes. Kernel
 * computation/native Blob storage remain owned by their existing owners. */
export function framescaperEditableImageWorkingBytes(source: FramescaperCurrentImageSourceTimelineImage): bigint {
	if (source.schemaVersion === 1) return 0n;
	const computation = source.develop.processVersion === 3 ? normalizeImageDevelopStateV2({ processVersion: 2, effects: source.develop.effects,
		geometry: source.develop.geometry, masks: source.develop.masks, maskBindings: source.develop.maskBindings }) : source.develop;
	const repair = source.develop.processVersion === 3 ? planImageDevelopRepairSpotsV1(source.develop.repairs, source.canonical.width, source.canonical.height) : undefined;
	const masks = source.schemaVersion === 3 ? planAdmittedImageDevelopMasksV1(admitImageDevelopBrushMaskAuthorityV1(computation), source.canonical.width, source.canonical.height, PIXEL_LIMITS)
		: planImageDevelopMasksV1(computation, source.canonical.width, source.canonical.height, PIXEL_LIMITS);
	let width = source.canonical.width, height = source.canonical.height, maximum = BigInt(width) * BigInt(height) * 4n;
	const geometry = (value: Parameters<typeof planImageGeometryV1>[0]) => {
		const planned = planImageGeometryV1(value, width, height); width = planned.width; height = planned.height;
		if (width * height > 33_554_432) throw new RangeError('Editable image intermediate geometry exceeds its pixel bound.');
		const bytes = BigInt(width) * BigInt(height) * 4n; if (bytes > maximum) maximum = bytes;
	};
	geometry({ schemaVersion: 1, ...source.develop.geometry, perspective: null });
	for (const effect of source.develop.effects) if (effect.enabled && effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) geometry(imageGeometryForVideoEffectV1(effect, width, height));
	if (width !== source.developed.width || height !== source.developed.height) throw new Error('Editable image natural output differs from its declared dimensions.');
	let resourceBytes = 0n;
	const resources = framescaperImageSourceResourceReferencesCurrentV1(source);
	for (const reference of resources.luts) {
		const bytes = BigInt(reference.byteLength) * 3n + BigInt(reference.size) ** 3n * 3n * 8n * 2n;
		if (bytes > resourceBytes) resourceBytes = bytes;
	}
	for (const reference of resources.brushes) resourceBytes = resourceBytes > BigInt(reference.byteLength) * 3n ? resourceBytes : BigInt(reference.byteLength) * 3n;
	const downstream = BigInt(source.canonical.width) * BigInt(source.canonical.height) * 4n + maximum * 4n + resourceBytes + BigInt(masks.maximumWorkingBytes) + 4_096n;
	// The known repair phase is four full planes plus scratch. Kernel retirement
	// precedes resource admission; downstream cache/range/canvas counts remain separate.
	return repair && BigInt(repair.stageWorkingBytes) > downstream ? BigInt(repair.stageWorkingBytes) : downstream;
}

/** Preserve the V1 pack/timing delegate; V2 retains that exact authenticated
 * pack and renders its saved recipe before any host contain/resize. A returned
 * readFrame plane is independently owned by the existing host cache, which
 * retires it; borrowed recipe planes never escape their scoped callback. */
export async function openFramescaperCurrentImageFrameSource(store: FramescaperStoredImageAssetStoreTimelineImage,
	sourceValue: unknown, signal?: AbortSignal, admitMetadata?: (bytes: number) => void): Promise<FramescaperCurrentImageFrameReader> {
	const source = normalizeFramescaperImageSourceCurrentV1(sourceValue);
	if (source.schemaVersion === 1) {
		const reader = await openFramescaperStoredImageFramePackTimelineImage(store, source, signal, admitMetadata);
		return Object.freeze({ ...reader, closeAndJoin: () => Promise.resolve() });
	}
	const extra = framescaperEditableImageWorkingBytes(source);
	if (BigInt(source.assetByteLength) * 3n + extra > 512n * 1024n * 1024n) throw new RangeError('Editable image exceeds its 512 MiB working byte bound.');
	if (signal !== undefined) {
		Reflect.apply(CHECK, signal, []);
		if (Object.getPrototypeOf(signal) !== AbortSignal.prototype || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key))) {
			throw new TypeError('Editable image requires unmodified native cancellation behavior.');
		}
	}
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	const load = capturedLoad(store), bodyStore = { loadMediaAsset: load }, lut = createFramescaperCubeLutSourceFinishing(bodyStore), mask = createFramescaperMaskRasterSourceTimelineImageV1(bodyStore);
	const { develop: _develop, developed: _developed, provenance: _provenance, ...base } = source;
	const packed = { ...base, schemaVersion: 1 as const };
	let snapshot: Uint8Array<ArrayBuffer> | undefined, sealed = false;
	const pending = new Set<Promise<unknown>>();
	try {
		check(); const blob = await load(source.storageKey, signal === undefined ? {} : { signal }); check();
		if (blob === null || Number(Reflect.apply(BLOB_SIZE, blob, [])) !== source.assetByteLength) throw new Error('Editable image native body is missing or has a stale size.');
		const backing = await Reflect.apply(READ, blob, []) as ArrayBuffer;
		snapshot = new Uint8Array(backing); check();
		if (snapshot.byteLength !== source.assetByteLength) throw new Error('Editable image body length changed during its joined native read.');
		const bytes = snapshot;
		const read = (offset: number, length: number) => { check(); return bytes.slice(offset, offset + length); };
		const reader = await openFramescaperImageFramePackV1({ source: packed, read, ...(signal === undefined ? {} : { signal }) });
		admitMetadata?.(reader.residentMetadataByteEstimate); check();
		let closing: Promise<void> | undefined;
		return Object.freeze({ ...reader,
			readFrame(index: number, external?: AbortSignal) {
				if (sealed) return Promise.reject(new Error('Editable image frame source is closed.'));
				if (index !== 0) return Promise.reject(new RangeError('Editable image has exactly one static frame.'));
				if (pending.size) return Promise.reject(new Error('Editable image frame source cannot overlap recipe readers.'));
				let captured: AbortSignal | undefined;
				try {
					if (source.schemaVersion === 3) check();
					if (external !== undefined) {
						Reflect.apply(CHECK, external, []);
						if (Object.getPrototypeOf(external) !== AbortSignal.prototype || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(external, key))) throw new TypeError('Editable image read requires native cancellation behavior.');
					}
					captured = source.schemaVersion === 3 && signal !== undefined && external !== undefined && external !== signal
						? Reflect.apply(JOIN, AbortSignal, [[signal, external]]) as AbortSignal : external ?? signal;
				} catch (error) { return Promise.reject(error); }
				let staged: Uint8Array<ArrayBuffer> | undefined;
				const work = (async () => {
					try { const run = source.schemaVersion === 2 ? withFramescaperImageDevelopFrameV2 : withFramescaperImageDevelopFrameV3;
						return await run({ source, read, ...(source.schemaVersion === 3 ? { assertCurrent: check } : {}), ...(captured === undefined ? {} : { signal: captured }) },
						view => { staged = view.frame.pixels.slice(); return staged; }, source.schemaVersion === 2 ? { source: lut } : { source: lut, maskSource: mask }); }
					catch (error) { if (staged) wipe(staged); throw error; }
				})();
				pending.add(work); void work.then(() => { pending.delete(work); }, () => { pending.delete(work); }); return work;
			},
			closeAndJoin() {
				// Seal new readers; already accepted reads keep their captured range
				// authority until joined before the owned encoded snapshot is wiped.
				if (closing) return closing; sealed = true;
				let resolve!: () => void, reject!: (reason: unknown) => void;
				const joined = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; }); closing = joined;
				void (async () => { await Promise.allSettled([...pending]); await retire(undefined, [() => lut.close(), () => mask.close(), () => wipe(bytes)]); })().then(resolve, reject); return joined;
			},
		});
	} catch (error) { await retire({ error }, [() => lut.close(), () => mask.close(), () => { if (snapshot) wipe(snapshot); }]); throw error; }
}

export async function materializeFramescaperCurrentImageThumbnail(store: FramescaperStoredImageAssetStoreTimelineImage,
	source: FramescaperCurrentImageSourceTimelineImage, ticks: bigint, width: number, height: number, signal?: AbortSignal,
	admitMetadata?: (bytes: number) => void): Promise<Uint8Array<ArrayBuffer>> {
	const reader = await openFramescaperCurrentImageFrameSource(store, source, signal, admitMetadata);
	try {
		const raw = await reader.readFrame(reader.frameIndexAtTicks(ticks), signal), size = framescaperImageDimensionsTimelineImage(source);
		try { return scaleFramescaperImageRgbaTimelineImage(raw, size.width, size.height, width, height, signal); }
		finally { wipe(raw); }
	} finally { await reader.closeAndJoin(); }
}

function capturedLoad(store: FramescaperStoredImageAssetStoreTimelineImage): FramescaperStoredImageAssetStoreTimelineImage['loadMediaAsset'] {
	let owner: object | null = store;
	for (let depth = 0; owner && depth < 32; depth++) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, 'loadMediaAsset');
		if (descriptor) {
			if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Current editable image requires a data body reader.');
			const method = descriptor.value as FramescaperStoredImageAssetStoreTimelineImage['loadMediaAsset'];
			return (...args) => Reflect.apply(method, store, args) as ReturnType<typeof method>;
		}
		owner = Object.getPrototypeOf(owner) as object | null;
	}
	throw new TypeError('Current editable image requires a captured body reader.');
}
async function retire(primary: Readonly<{ error: unknown }> | undefined, tasks: readonly (() => void | Promise<void>)[]): Promise<void> {
	const failures: unknown[] = primary ? [primary.error] : [];
	for (const task of tasks) try { await task(); } catch (error) { if (!failures.some(value => Object.is(value, error))) failures.push(error); }
	if (failures.length === 1) throw failures[0]; if (failures.length > 1) throw new AggregateError(failures, 'Frame reader operation and native retirement failed.', { cause: failures[0] });
}
function wipe(bytes: Uint8Array): void { const backing = bytes.buffer; if (Number(Reflect.apply(BUFFER_SIZE, backing, []))) Reflect.apply(FILL, new Uint8Array(backing), [0]); }
