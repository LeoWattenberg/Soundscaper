/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeFramescaperImageSourceCurrentV1 } from '../../common/editor/timeline-image-model-current-v1.ts';
import { normalizeImageDevelopStateThroughV4, type ImageDevelopStateThroughV4 } from '../../common/editor/imaging/image-develop-state-v4.ts';
import { framescaperImagePackSourceCurrentV1 } from '../../common/editor/timeline-image-pack-source-current-v1.ts';
import { withFramescaperRawImageOriginalCurrentV1 } from '../../common/editor/timeline-image-raw-pack-current-v1.ts';
import { withFramescaperRawImageDerivedCurrentV1 } from '../../common/editor/timeline-image-raw-derived-current-v1.ts';
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
import { prepareFramescaperRawImageWorkingCurrentV1, FRAMESCAPER_RAW_IMAGE_AUTHORING_BYTES_CURRENT_V1 } from './timeline-image-raw-working-plan-current-v1.ts';

const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const FILL = Uint8Array.prototype.fill;
function wipe(value: Uint8Array<ArrayBuffer>): void { if (Reflect.apply(SIZE, value.buffer, []) !== 0) Reflect.apply(FILL, value, [0]); }

/** Source4's FramePack1 contains a byte presentation cache. Only its authenticated
 * retained Original can produce authoring/Develop pixels. Every native worker
 * terminates before its word callback, and the exclusive pack owner joins that
 * complete callback before releasing encoded snapshot/resource custody. */
export async function openFramescaperRawImageFrameSourceCurrentV1(store: FramescaperStoredImageAssetStoreTimelineImage,
	sourceValue: unknown, signal?: AbortSignal, admitMetadata?: (bytes: number) => void,
	purpose: 'preview' | 'canonical-authoring' = 'preview'): Promise<FramescaperCurrentImageFrameReader> {
	assertFramescaperNativeImageSignalCurrentV1(signal);
	if (purpose !== 'preview' && purpose !== 'canonical-authoring') throw new TypeError('Unknown Frame RAW reader purpose.');
	const source = normalizeFramescaperImageSourceCurrentV1(sourceValue);
	if (source.schemaVersion !== 4) throw new TypeError('Frame RAW reader requires its complete Current Source4.');
	prepareFramescaperRawImageWorkingCurrentV1(source, { ...(purpose === 'canonical-authoring' ? { authoringBytes: FRAMESCAPER_RAW_IMAGE_AUTHORING_BYTES_CURRENT_V1 } : {}) });
	const stop = new AbortController(), lifetime = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
	const lut = createFramescaperCubeLutSourceFinishing(store), mask = createFramescaperMaskRasterSourceTimelineImageV1(store);
	const cleanup = [() => lut.close(), () => mask.close()];
	let native: Awaited<ReturnType<typeof openFramescaperNativePackOwnerCurrentV1>> | undefined;
	try {
		// This owner supplies only authenticated snapshot/range/lifetime authority.
		// Its byte canonical-authoring branch is deliberately never called.
		native = await openFramescaperNativePackOwnerCurrentV1(store, framescaperImagePackSourceCurrentV1(source), lifetime, admitMetadata, 'editable', 'preview');
		const owner = native, reader = owner.reader;
		const original = <Result>(consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, admitted?: AbortSignal) =>
			withFramescaperRawImageOriginalCurrentV1({ source, read: owner.read, ...(admitted ? { signal: admitted } : {}),
				assertCurrent: () => { checkFramescaperNativeImageSignalCurrentV1(admitted); checkFramescaperNativeImageSignalCurrentV1(signal); } }, view => consume(view.frame));
		const developInput = <Result>(develop: Readonly<ImageDevelopStateThroughV4>, consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, admitted?: AbortSignal): Promise<Result> => {
			if (develop.processVersion !== 4 || develop.rawDevelopment.mode === 'canonical') return original(consume, admitted);
			return withFramescaperRawImageDerivedCurrentV1({ binding: { pack: framescaperImagePackSourceCurrentV1(source), raw: source.raw },
				profile: develop.rawDevelopment.mode === 'headroom' ? 'linear-headroom-v1' : 'highlight-recovery-v1', read: owner.read,
				...(admitted ? { signal: admitted } : {}), assertCurrent: () => {
					checkFramescaperNativeImageSignalCurrentV1(admitted); checkFramescaperNativeImageSignalCurrentV1(signal);
				} }, view => consume(view.frame));
		};
		return Object.freeze({ ...reader,
			withCanonicalFrame<Result>(consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, external?: AbortSignal): Promise<Result> {
				if (typeof consume !== 'function') return Promise.reject(new TypeError('Frame RAW Original requires a scoped consumer.'));
				return owner.run(admitted => original(consume, admitted), external, true);
			},
			async withDevelopInputFrame<Result>(developValue: unknown, consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, external?: AbortSignal): Promise<Result> {
				assertFramescaperNativeImageSignalCurrentV1(external); checkFramescaperNativeImageSignalCurrentV1(signal);
				if (typeof consume !== 'function') throw new TypeError('Frame RAW Develop input requires a scoped consumer.');
				const develop = normalizeImageDevelopStateThroughV4(developValue);
				prepareFramescaperRawImageWorkingCurrentV1(source, { develop,
					...(purpose === 'canonical-authoring' ? { authoringBytes: FRAMESCAPER_RAW_IMAGE_AUTHORING_BYTES_CURRENT_V1 } : {}) });
				return owner.run(admitted => developInput(develop, consume, admitted), external, true);
			},
			readOriginal(external?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
				return owner.run(async admitted => {
					let staged: Uint8Array<ArrayBuffer> | undefined;
					try {
						const result = await withFramescaperRawImageOriginalCurrentV1({ source, read: owner.read,
							...(admitted ? { signal: admitted } : {}) }, view => { staged = view.originalBytes.slice(); return staged; });
						checkFramescaperNativeImageSignalCurrentV1(admitted); return result;
					} catch (error) { if (staged) wipe(staged); throw error; }
				}, external, true);
			},
			readFrame(index: number, external?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
				if (index !== 0) return Promise.reject(new RangeError('Frame RAW source has exactly one static frame.'));
				return owner.run(async admitted => {
					let staged: Uint8Array<ArrayBuffer> | undefined;
					try {
						const result = await developInput(source.develop, frame => withImageDevelopLinearCurrentV1({ frame, develop: source.develop,
							...(admitted ? { signal: admitted } : {}) }, async output => {
							if (output.descriptor.width !== source.developed.width || output.descriptor.height !== source.developed.height) throw new RangeError('Frame RAW developed extent differs from its saved natural output.');
							return withLinearPixelFrameDisplayV1({ frame: output, ...(admitted ? { signal: admitted } : {}) }, display => {
								if (!(display.pixels instanceof Uint8Array)) throw new TypeError('Frame RAW display requires canonical RGBA8.');
								staged = display.pixels.slice(); return staged;
							}, 'full');
						}, PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source: lut, maskSource: mask }), admitted);
						checkFramescaperNativeImageSignalCurrentV1(admitted); return result;
					} catch (error) { if (staged) wipe(staged); throw error; }
				}, external, true);
			},
			closeAndJoin() { const joined = owner.closeAndJoin(cleanup); stop.abort(new Error('Frame RAW reader retired.')); return joined; },
		});
	} catch (error) {
		await retireFramescaperNativeImageCurrentV1({ error }, native ? [() => native!.closeAndJoin(cleanup)] : cleanup); throw error;
	}
}
