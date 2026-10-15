/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeFramescaperImageSourceCurrentV1, framescaperImageSourceResourceReferencesCurrentV1 } from '../common/editor/timeline-image-model-current-v1.ts';
import { normalizeImageDevelopStateV2 } from '../common/editor/imaging/image-develop-state-v2.ts';
import { planImageDevelopRepairSpotsV1 } from '../common/editor/imaging/image-develop-repair-plan-v1.ts';
import { withFramescaperImageDevelopFrameV3 } from './timeline-image-develop-frame-v3.ts';
import { createFramescaperMaskRasterSourceTimelineImageV1 } from './timeline-image-mask-raster-source-v1.ts';
import type { FramescaperImageFramePackReaderV1 } from '../common/editor/timeline-image-frame-pack-v1.ts';
import type { PixelFrameV1 } from '../common/editor/imaging/pixel-frame-contract-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1 } from '../common/editor/video-image-geometry-v1.ts';
import { planImageGeometryV1 } from '../common/editor/imaging/image-geometry-plan-v1.ts';
import { planImageDevelopMasksV1, planAdmittedImageDevelopMasksV1 } from '../common/editor/imaging/image-develop-mask-plan-v1.ts';
import { admitImageDevelopBrushMaskAuthorityV1 } from '../common/editor/imaging/image-develop-brush-mask-v1.ts';
import { FRAMESCAPER_IMAGE_MODEL_LIMITS_V1 as IMAGE_LIMITS } from '../common/editor/timeline-image-model.ts';
import { withFramescaperImageDevelopFrameV2 } from './timeline-image-develop-frame-v2.ts';
import { createFramescaperCubeLutSourceFinishing } from './cube-lut-source-finishing.ts';
import { scaleFramescaperImageRgbaTimelineImage,
	framescaperImageDimensionsTimelineImage, type FramescaperStoredImageAssetStoreTimelineImage,
	type FramescaperCurrentImageSourceTimelineImage } from './editor-selected-timeline-image-image-frame-source.ts';
import { openFramescaperNativePackOwnerCurrentV1, captureFramescaperNativeImageLoadCurrentV1,
	assertFramescaperNativeImageSignalCurrentV1, checkFramescaperNativeImageSignalCurrentV1, retireFramescaperNativeImageCurrentV1,
	type FramescaperNativePackOwnerCurrentV1 } from './internal/timeline-image-native-pack-owner-current-v1.ts';
import { prepareFramescaperRawImageWorkingCurrentV1 } from './internal/timeline-image-raw-working-plan-current-v1.ts';

const FILL = Uint8Array.prototype.fill;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const PIXEL_LIMITS = Object.freeze({ maximumSidePixels: IMAGE_LIMITS.maximumDimension, maximumPixels: IMAGE_LIMITS.maximumPixelsPerFrame, maximumBytes: IMAGE_LIMITS.maximumPixelsPerFrame * 4 });
export interface FramescaperCurrentImageFrameReader extends FramescaperImageFramePackReaderV1 {
	withCanonicalFrame<Result>(consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, signal?: AbortSignal): Promise<Result>;
	closeAndJoin(): Promise<void>;
}

/** The current recipe owner has a transferred encoded snapshot, a canonical
 * plane, and at most four simultaneous recipe/staged-output planes. Kernel
 * computation/native Blob storage remain owned by their existing owners. */
export function framescaperEditableImageWorkingBytes(source: FramescaperCurrentImageSourceTimelineImage): bigint {
	if (source.schemaVersion === 4) return prepareFramescaperRawImageWorkingCurrentV1(source).recipeWorkingBytes;
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
	sourceValue: unknown, signal?: AbortSignal, admitMetadata?: (bytes: number) => void,
	purpose: 'preview' | 'canonical-authoring' = 'preview'): Promise<FramescaperCurrentImageFrameReader> {
	assertFramescaperNativeImageSignalCurrentV1(signal);
	if (purpose !== 'preview' && purpose !== 'canonical-authoring') throw new TypeError('Unknown fixed current image reader purpose.');
	const source = normalizeFramescaperImageSourceCurrentV1(sourceValue);
	if (source.schemaVersion === 4) return (await import('./internal/timeline-image-raw-frame-source-current-v1.ts'))
		.openFramescaperRawImageFrameSourceCurrentV1(store, source, signal, admitMetadata, purpose);
	const extra = framescaperEditableImageWorkingBytes(source);
	if (source.schemaVersion !== 1 && BigInt(source.assetByteLength) * 3n + extra > 512n * 1024n * 1024n) {
		throw new RangeError('Editable image exceeds its 512 MiB working byte bound.');
	}
	const check = () => { checkFramescaperNativeImageSignalCurrentV1(signal); };
	const load = captureFramescaperNativeImageLoadCurrentV1(store), bodyStore = { loadMediaAsset: load };
	const lut = source.schemaVersion === 1 ? undefined : createFramescaperCubeLutSourceFinishing(bodyStore);
	const mask = source.schemaVersion === 1 ? undefined : createFramescaperMaskRasterSourceTimelineImageV1(bodyStore);
	let packed = source.schemaVersion === 1 ? source : undefined;
	if (source.schemaVersion !== 1) { const { develop: _develop, developed: _developed, provenance: _provenance, ...base } = source; packed = { ...base, schemaVersion: 1 }; }
	let owner: FramescaperNativePackOwnerCurrentV1 | undefined;
	const cleanup = [() => lut?.close(), () => mask?.close()];
	try {
		if (!packed) throw new TypeError('Current image requires its admitted immutable pack source.');
		owner = await openFramescaperNativePackOwnerCurrentV1(bodyStore, packed, signal, admitMetadata, source.schemaVersion === 1 ? 'source1' : 'editable', purpose);
		const native = owner, reader = native.reader;
		const raw = (read: (admitted?: AbortSignal) => Promise<Uint8Array>, external?: AbortSignal) => native.run(async admitted => {
			const value = await read(admitted);
			try { checkFramescaperNativeImageSignalCurrentV1(admitted); return value; }
			catch (error) { wipe(value); throw error; }
		}, external, source.schemaVersion !== 1);
		return Object.freeze({ ...reader, withCanonicalFrame: native.withCanonicalFrame,
			readOriginal(external?: AbortSignal) { return raw(admitted => reader.readOriginal(admitted), external); },
			readFrame(index: number, external?: AbortSignal) {
				if (source.schemaVersion === 1) return raw(admitted => reader.readFrame(index, admitted), external);
				if (index !== 0) return Promise.reject(new RangeError('Editable image has exactly one static frame.'));
				return native.run(async admitted => {
					let staged: Uint8Array<ArrayBuffer> | undefined;
					try { const run = source.schemaVersion === 2 ? withFramescaperImageDevelopFrameV2 : withFramescaperImageDevelopFrameV3;
						return await run({ source, read: native.read, ...(source.schemaVersion === 3 ? { assertCurrent: check } : {}), ...(admitted === undefined ? {} : { signal: admitted }) },
							view => { staged = view.frame.pixels.slice(); return staged; }, source.schemaVersion === 2 ? { source: lut } : { source: lut, maskSource: mask });
					} catch (error) { if (staged) wipe(staged); throw error; }
				}, external, true);
			},
			closeAndJoin() { return native.closeAndJoin(cleanup); },
		});
	} catch (error) { await retireFramescaperNativeImageCurrentV1({ error }, owner ? [() => owner!.closeAndJoin(cleanup)] : cleanup); throw error; }
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

function wipe(bytes: Uint8Array): void { const backing = bytes.buffer; if (Number(Reflect.apply(BUFFER_SIZE, backing, []))) Reflect.apply(FILL, new Uint8Array(backing), [0]); }
