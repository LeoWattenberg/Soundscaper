/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeFramescaperImageSourceV1OrV2, framescaperImageSourceResourceReferencesV2 } from '../common/editor/timeline-image-model-v2.ts';
import { openFramescaperImageFramePackV1, type FramescaperImageFramePackReaderV1 } from '../common/editor/timeline-image-frame-pack-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1 } from '../common/editor/video-image-geometry-v1.ts';
import { planImageGeometryV1 } from '../common/editor/imaging/image-geometry-plan-v1.ts';
import { planImageDevelopMasksV1 } from '../common/editor/imaging/image-develop-mask-plan-v1.ts';
import { FRAMESCAPER_IMAGE_MODEL_LIMITS_V1 as IMAGE_LIMITS } from '../common/editor/timeline-image-model.ts';
import { withFramescaperImageDevelopFrameV2 } from './timeline-image-develop-frame-v2.ts';
import { createFramescaperCubeLutSourceFinishing } from './cube-lut-source-finishing.ts';
import { openFramescaperStoredImageFramePackTimelineImage, scaleFramescaperImageRgbaTimelineImage,
	framescaperImageDimensionsTimelineImage, type FramescaperStoredImageAssetStoreTimelineImage,
	type FramescaperCurrentImageSourceTimelineImage } from './editor-selected-timeline-image-image-frame-source.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const READ = Blob.prototype.arrayBuffer;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const PIXEL_LIMITS = Object.freeze({ maximumSidePixels: IMAGE_LIMITS.maximumDimension, maximumPixels: IMAGE_LIMITS.maximumPixelsPerFrame, maximumBytes: IMAGE_LIMITS.maximumPixelsPerFrame * 4 });
export interface FramescaperCurrentImageFrameReader extends FramescaperImageFramePackReaderV1 { closeAndJoin(): Promise<void> }

/** The current recipe owner has a transferred encoded snapshot, a canonical
 * plane, and at most four simultaneous recipe/staged-output planes. Kernel
 * computation/native Blob storage remain owned by their existing owners. */
export function framescaperEditableImageWorkingBytes(source: FramescaperCurrentImageSourceTimelineImage): bigint {
	if (source.schemaVersion === 1) return 0n;
	const masks = planImageDevelopMasksV1(source.develop, source.canonical.width, source.canonical.height, PIXEL_LIMITS);
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
	for (const reference of framescaperImageSourceResourceReferencesV2(source)) {
		const bytes = BigInt(reference.byteLength) * 3n + BigInt(reference.size) ** 3n * 3n * 8n * 2n;
		if (bytes > resourceBytes) resourceBytes = bytes;
	}
	return BigInt(source.canonical.width) * BigInt(source.canonical.height) * 4n + maximum * 4n + resourceBytes + BigInt(masks.maximumWorkingBytes) + 4_096n;
}

/** Preserve the V1 pack/timing delegate; V2 retains that exact authenticated
 * pack and renders its saved recipe before any host contain/resize. A returned
 * readFrame plane is independently owned by the existing host cache, which
 * retires it; borrowed recipe planes never escape their scoped callback. */
export async function openFramescaperCurrentImageFrameSource(store: FramescaperStoredImageAssetStoreTimelineImage,
	sourceValue: unknown, signal?: AbortSignal, admitMetadata?: (bytes: number) => void): Promise<FramescaperCurrentImageFrameReader> {
	const source = normalizeFramescaperImageSourceV1OrV2(sourceValue);
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
	const load = capturedLoad(store), lut = createFramescaperCubeLutSourceFinishing(store);
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
				const captured = external ?? signal;
				let staged: Uint8Array<ArrayBuffer> | undefined;
				const work = (async () => {
					try { return await withFramescaperImageDevelopFrameV2({ source, read, ...(captured === undefined ? {} : { signal: captured }) },
						view => { staged = view.frame.pixels.slice(); return staged; }, { source: lut }); }
					catch (error) { if (staged) wipe(staged); throw error; }
				})();
				pending.add(work); void work.then(() => { pending.delete(work); }, () => { pending.delete(work); }); return work;
			},
			closeAndJoin() {
				// Seal new readers; already accepted reads keep their captured range
				// authority until joined before the owned encoded snapshot is wiped.
				return closing ??= (async () => { sealed = true; await Promise.allSettled([...pending]); await lut.close(); wipe(bytes); })();
			},
		});
	} catch (error) { await lut.close(); if (snapshot) wipe(snapshot); throw error; }
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
function wipe(bytes: Uint8Array): void { if (Number(Reflect.apply(BUFFER_SIZE, bytes.buffer, []))) Uint8Array.prototype.fill.call(bytes, 0); }
