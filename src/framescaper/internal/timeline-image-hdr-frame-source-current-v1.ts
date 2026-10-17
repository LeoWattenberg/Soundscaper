/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeFramescaperHdrImageSourceCurrentV1 } from '../../common/editor/timeline-image-model-hdr-current-v1.ts';
import { normalizeImageDevelopStateThroughV4 } from '../../common/editor/imaging/image-develop-state-v4.ts';
import { framescaperImagePackSourceCurrentV1 } from '../../common/editor/timeline-image-pack-source-current-v1.ts';
import { withFramescaperHdrImageOriginalCurrentV1 } from '../../common/editor/timeline-image-hdr-original-current-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../../common/editor/imaging/image-develop-linear-current-v1.ts';
import { withLinearPixelFrameDisplayV1 } from '../../common/editor/imaging/pixel-frame-linear-display-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../common/editor/photo-library-develop-linear-port-v1.ts';
import type { PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import type { FramescaperStoredImageAssetStoreTimelineImage } from '../editor-selected-timeline-image-image-frame-source.ts';
import type { FramescaperCurrentImageFrameReader } from '../timeline-image-current-frame-source.ts';
import { createFramescaperCubeLutSourceFinishing } from '../cube-lut-source-finishing.ts';
import { createFramescaperMaskRasterSourceTimelineImageV1 } from '../timeline-image-mask-raster-source-v1.ts';
import { openFramescaperNativePackOwnerCurrentV1, retireFramescaperNativeImageCurrentV1,
	assertFramescaperNativeImageSignalCurrentV1, checkFramescaperNativeImageSignalCurrentV1 } from './timeline-image-native-pack-owner-current-v1.ts';
import { prepareFramescaperHdrImageWorkingCurrentV1 } from './timeline-image-hdr-working-plan-current-v1.ts';
import { decodeFramescaperImageFramePackHeaderV1, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES, FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES } from '../../common/editor/timeline-image-frame-pack-v1-layout.ts';
import { RepairTaskBudgetV1 } from '../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';

/** Source5 lends exact native Float32 from its authenticated generated Original.
 * The existing exclusive pack owner joins all borrows and resource retirement;
 * FramePack1 RGBA8 remains only an independently authenticated display cache. */
export async function openFramescaperHdrImageFrameSourceCurrentV1(store: FramescaperStoredImageAssetStoreTimelineImage,
	sourceValue: unknown, signal?: AbortSignal, admitMetadata?: (bytes: number) => void,
	purpose: 'preview' | 'canonical-authoring' = 'preview'): Promise<FramescaperCurrentImageFrameReader> {
	assertFramescaperNativeImageSignalCurrentV1(signal);
	if (purpose !== 'preview' && purpose !== 'canonical-authoring') throw new TypeError('Unknown Frame HDR reader purpose.');
	const source = normalizeFramescaperHdrImageSourceCurrentV1(sourceValue), options = purpose === 'canonical-authoring' ? { authoringBytes: 64 * 1024 * 1024 } : {};
	prepareFramescaperHdrImageWorkingCurrentV1(source, options);
	const stop = new AbortController(), lifetime = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
	const lut = createFramescaperCubeLutSourceFinishing(store), mask = createFramescaperMaskRasterSourceTimelineImageV1(store), cleanup = [() => lut.close(), () => mask.close()];
	let native: Awaited<ReturnType<typeof openFramescaperNativePackOwnerCurrentV1>> | undefined;
	try {
		native = await openFramescaperNativePackOwnerCurrentV1(store, framescaperImagePackSourceCurrentV1(source), lifetime, admitMetadata, 'editable', 'preview');
		const owner = native, reader = owner.reader;
		const original = <Result>(consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, admitted?: AbortSignal) =>
			withFramescaperHdrImageOriginalCurrentV1({ source, read: owner.read, ...(admitted ? { signal: admitted } : {}),
				assertCurrent: () => { checkFramescaperNativeImageSignalCurrentV1(admitted); checkFramescaperNativeImageSignalCurrentV1(signal); } }, view => consume(view.frame));
		return Object.freeze({ ...reader,
			withCanonicalFrame<Result>(consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, external?: AbortSignal): Promise<Result> {
				if (typeof consume !== 'function') return Promise.reject(new TypeError('Frame HDR Original requires a scoped consumer.'));
				return owner.run(admitted => original(consume, admitted), external, true);
			},
			withDevelopInputFrame<Result>(value: unknown, consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, external?: AbortSignal): Promise<Result> {
				try { assertFramescaperNativeImageSignalCurrentV1(external); checkFramescaperNativeImageSignalCurrentV1(signal); if (typeof consume !== 'function') throw new TypeError('Frame HDR Develop requires a consumer.');
					prepareFramescaperHdrImageWorkingCurrentV1(source, { ...options, develop: normalizeImageDevelopStateThroughV4(value) });
				} catch (error) { return Promise.reject(error); }
				return owner.run(admitted => original(consume, admitted), external, true);
			},
			readOriginal(external?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
				return owner.run(async admitted => {
					await original(() => undefined, admitted); let staged: Uint8Array<ArrayBuffer> | undefined;
					try {
						const check = () => { checkFramescaperNativeImageSignalCurrentV1(admitted); }, budget = new RepairTaskBudgetV1(check);
						const header = decodeFramescaperImageFramePackHeaderV1(owner.read(0, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES), framescaperImagePackSourceCurrentV1(source));
						staged = new Uint8Array(source.original.byteLength);
						for (let offset = 0; offset < staged.length;) {
							const length = Math.min(FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES, staged.length - offset), range = owner.read(header.originalOffset + offset, length);
							try { staged.set(range, offset); } finally { range.fill(0); }
							offset += length; await budget.yield();
						}
						check(); return staged;
					}
					catch (error) { staged?.fill(0); throw error; }
				}, external, true);
			},
			readFrame(index: number, external?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
				if (index !== 0) return Promise.reject(new RangeError('Frame HDR source has exactly one static frame.'));
				return owner.run(async admitted => {
					let staged: Uint8Array<ArrayBuffer> | undefined;
					try {
						const result = await original(frame => withImageDevelopLinearCurrentV1({ frame, develop: source.develop, ...(admitted ? { signal: admitted } : {}) }, output => {
							if (output.descriptor.width !== source.developed.width || output.descriptor.height !== source.developed.height) throw new RangeError('Frame HDR developed extent differs from its saved output.');
							return withLinearPixelFrameDisplayV1({ frame: output, ...(admitted ? { signal: admitted } : {}) }, display => {
								if (!(display.pixels instanceof Uint8Array)) throw new TypeError('Frame HDR display requires RGBA8.');
								staged = display.pixels.slice(); return staged;
							}, 'full');
						}, PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source: lut, maskSource: mask }), admitted);
						checkFramescaperNativeImageSignalCurrentV1(admitted); return result;
					} catch (error) { staged?.fill(0); throw error; }
				}, external, true);
			},
			closeAndJoin() { const joined = owner.closeAndJoin(cleanup); stop.abort(new Error('Frame HDR reader retired.')); return joined; },
		});
	} catch (error) { await retireFramescaperNativeImageCurrentV1({ error }, native ? [() => native!.closeAndJoin(cleanup)] : cleanup); throw error; }
}
