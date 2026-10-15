/* SPDX-License-Identifier: AGPL-3.0-only */

import { cloneFramescaperProject } from '../editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../editor-project-runtime-profile.ts';
import { prepareFramescaperImageDevelopSourceCurrentV1 } from '../timeline-image-develop-authoring-current-v1.ts';
import type { FramescaperStoredImageAssetStoreTimelineImage } from '../editor-selected-timeline-image-image-frame-source.ts';
import { createFramescaperCubeLutSourceFinishing } from '../cube-lut-source-finishing.ts';
import { createFramescaperMaskRasterSourceTimelineImageV1 } from '../timeline-image-mask-raster-source-v1.ts';
import { assertFramescaperNativeImageSignalCurrentV1, checkFramescaperNativeImageSignalCurrentV1, retireFramescaperNativeImageCurrentV1 } from './timeline-image-native-pack-owner-current-v1.ts';
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../../common/editor/closed-domain-value.ts';
import { collectFramescaperImageProjectResourcesCurrentV1 } from '../../common/editor/video-cube-lut-project-references-current-v1.ts';
import { normalizeImageDevelopStateCurrentV1, type ImageDevelopStateCurrentV1 } from '../../common/editor/imaging/image-develop-state-current-v1.ts';
import { normalizeImageDevelopStateV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import { withImageDevelopFrameV3 } from '../../common/editor/imaging/image-develop-frame-v3.ts';
import { withImageDevelopLinearCurrentV1 } from '../../common/editor/imaging/image-develop-linear-current-v1.ts';
import { withLinearPixelFrameDisplayV1 } from '../../common/editor/imaging/pixel-frame-linear-display-v1.ts';
import { createPixelFrameHistogramV1 } from '../../common/editor/imaging/pixel-frame-histogram-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../common/editor/photo-library-develop-linear-port-v1.ts';
import { prepareFramescaperRawImageWorkingCurrentV1, FRAMESCAPER_RAW_IMAGE_AUTHORING_BYTES_CURRENT_V1 } from './timeline-image-raw-working-plan-current-v1.ts';
import type { ImageDevelopFrameViewV1 } from '../../common/editor/imaging/image-develop-frame-core.ts';
import { prepareImageDevelopMaskOverlaySelectionV1, type ImageDevelopMaskOverlaySelectionV1 } from '../../common/editor/imaging/image-develop-mask-overlay-v1.ts';
import { prepareImageDevelopBrushMasksV1 } from '../../common/editor/imaging/image-develop-brush-mask-v1.ts';
import { planImageDevelopRepairSpotsV1 } from '../../common/editor/imaging/image-develop-repair-plan-v1.ts';
import { planImageGeometryV1 } from '../../common/editor/imaging/image-geometry-plan-v1.ts';
import { planPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { fitPixelSizeV1 } from '../../common/editor/imaging/pixel-frame-resize-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1 } from '../../common/editor/video-image-geometry-v1.ts';
import type { WithImageRepairSpotsOriginalFrameV1 } from '../../common/editor/controller/shared/image-repair-spots-authoring-v1.ts';
import type { FramescaperImageSourceCurrentV1 } from '../../common/editor/timeline-image-model-current-v1.ts';
import { framescaperImageSourceResourceReferencesCurrentV1 } from '../../common/editor/timeline-image-model-current-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../common/editor/imaging/mask-raster-source-port-v1.ts';
import type { BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';

export interface FramescaperImageDevelopDraftFrameHostCurrentV1 {
	readonly project: unknown;
	readonly clipId: string;
	readonly store: FramescaperStoredImageAssetStoreTimelineImage;
	readonly withOriginalFrame: WithImageRepairSpotsOriginalFrameV1;
	assertCurrent(): void;
}
const PIXELS = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 67_108_864 });
const PROFILE = Object.freeze({ source: PIXELS, render: PIXELS });
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'buffer')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const FILL = Uint8Array.prototype.fill;

/** The selected Session supplies its already registered exclusive operation and
 * immutable canonical scope. This private owner borrows resources and creates
 * no store, writer, history transition or persistent source identity. */
export async function withFramescaperImageDevelopDraftFrameCurrentV1<Result>(host: FramescaperImageDevelopDraftFrameHostCurrentV1,
	request: unknown, consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, signal?: AbortSignal): Promise<Result> {
	return withDraft(host, request, consume, signal);
}

/** Private temporary-body entry point. The ordinary Session draft function
 * remains installed-only and keeps its exact closed request admission. */
export async function withFramescaperImageDevelopBrushDraftFrameCurrentV1<Result>(host: FramescaperImageDevelopDraftFrameHostCurrentV1,
	request: unknown, consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, signal: AbortSignal | undefined,
	override: Readonly<{ reference: Readonly<BrushMaskResourceReferenceV1>; source: Readonly<MaskRasterSourcePortV1> }>): Promise<Result> {
	return withDraft(host, request, consume, signal, override);
}
async function withDraft<Result>(host: FramescaperImageDevelopDraftFrameHostCurrentV1,
	request: unknown, consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, signal?: AbortSignal,
	override?: Readonly<{ reference: Readonly<BrushMaskResourceReferenceV1>; source: Readonly<MaskRasterSourcePortV1> }>): Promise<Result> {
	assertFramescaperNativeImageSignalCurrentV1(signal);
	const current = host.assertCurrent, original = host.withOriginalFrame, store = host.store, clipId = host.clipId;
	const check = () => { checkFramescaperNativeImageSignalCurrentV1(signal); Reflect.apply(current, host, []); checkFramescaperNativeImageSignalCurrentV1(signal); };
	check(); if (typeof consume !== 'function' || typeof original !== 'function' || typeof current !== 'function') throw new TypeError('Frame draft rendering requires its selected canonical owner and consumer.');
	const { develop, selection, source, references, retained } = (() => {
		try {
			const input = record(request, 'Frame Develop draft', ['develop', 'maskOverlay'], ['develop']);
			const develop = normalizeImageDevelopStateCurrentV1(field(input, 'develop', 'Frame Develop draft'));
			const rawSelection = Object.hasOwn(input, 'maskOverlay') ? field(input, 'maskOverlay', 'Frame Develop draft') : undefined;
			const selection = rawSelection === undefined ? undefined : prepareImageDevelopMaskOverlaySelectionV1(rawSelection);
			const project = cloneFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, host.project);
			const prepared = prepareFramescaperImageDevelopSourceCurrentV1(project, clipId, develop), source = prepared.source;
			if (!source) throw new TypeError('Frame draft rendering requires its exact image source.');
			if (override && !framescaperImageSourceResourceReferencesCurrentV1(source).brushes.some(value => value.storageKey === override.reference.storageKey)) throw new RangeError('The temporary brush is not declared by the exact selected draft.');
			const references = collectFramescaperImageProjectResourcesCurrentV1({ ...project, sources: project.sources.map(value => value.id === source.id ? source : value) });
			const retained = override ? collectFramescaperImageProjectResourcesCurrentV1(project) : undefined;
			const budgetReferences = retained ? { luts: [...retained.luts, ...references.luts], brushes: [...retained.brushes, ...references.brushes] } : references;
			preflight(source, develop, selection, budgetReferences, override?.reference.byteLength ?? 0); check(); return { develop, selection, source, references, retained };
		} catch (error) { check(); throw error; }
	})();
	// Both real native body readers capture the store method and receiver before
	// any resource await. Disabled and unused declarations authenticate too.
	const luts = createFramescaperCubeLutSourceFinishing(store), brushes = createFramescaperMaskRasterSourceTimelineImageV1(store);
	const cleanup = [() => luts.close(), () => brushes.close()];
	try {
		// A supplied temporary body cannot conceal a corrupt saved declaration,
		// including an unchanged declaration with the same content key.
		if (retained) {
			for (const reference of retained.luts) { check(); await luts.withBytes(reference, () => undefined, { signal }); check(); }
			for (const reference of retained.brushes) { check(); await brushes.withBytes(reference, () => undefined, { signal }); check(); }
		}
		for (const reference of references.luts) { check(); await luts.withBytes(reference, () => undefined, { signal }); check(); }
		const maskSource: Readonly<MaskRasterSourcePortV1> = override ? Object.freeze({ withBytes<Result>(reference: Readonly<BrushMaskResourceReferenceV1>, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result> {
			return reference.storageKey === override.reference.storageKey ? override.source.withBytes(reference, consume, options) : brushes.withBytes(reference, consume, options);
		} }) : brushes;
		for (const reference of references.brushes) { check(); await maskSource.withBytes(reference, () => undefined, { signal }); check(); }
		return await Reflect.apply(original, host, [async (frame: Parameters<Parameters<WithImageRepairSpotsOriginalFrameV1>[0]>[0]) => {
			let outcome: { value: Result } | { error: unknown };
			try {
				check(); if (frame.descriptor.width !== source.canonical.width || frame.descriptor.height !== source.canonical.height) throw new RangeError('Frame draft Original differs from its exact canonical source.');
				if (source.schemaVersion === 4) {
					if (frame.descriptor.sampleFormat !== 'unorm16' || frame.descriptor.transfer !== 'linear' || frame.descriptor.primaries !== 'srgb') throw new TypeError('Frame RAW draft requires its authenticated native Original words.');
					outcome = { value: await withImageDevelopLinearCurrentV1({ frame, develop, signal, ...(selection ? { maskOverlay: selection } : {}) },
						(output, overlay) => withLinearPixelFrameDisplayV1({ frame: output, signal }, async display => {
							check(); if (display.descriptor.width !== source.developed.width || display.descriptor.height !== source.developed.height) throw new RangeError('Frame RAW draft natural output differs from its admitted source dimensions.');
							if (!(display.pixels instanceof Uint8Array)) throw new TypeError('Frame RAW draft display requires canonical RGBA8.');
							const histogram = await createPixelFrameHistogramV1(display, { limits: PIXELS, signal }); check();
							const result = await consume(Object.freeze({ frame: Object.freeze({ descriptor: display.descriptor, pixels: display.pixels }), histogram, ...(overlay ? { maskOverlay: overlay } : {}) })); check(); return result;
						}, 'full'), PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source: luts, maskSource }) };
				} else outcome = { value: await withImageDevelopFrameV3({ frame, develop, signal, ...(selection ? { maskOverlay: selection } : {}) },
					async view => {
						check(); const natural = source.schemaVersion === 1 ? source.canonical : source.developed;
						if (view.frame.descriptor.width !== natural.width || view.frame.descriptor.height !== natural.height) throw new RangeError('Frame draft natural output differs from its admitted source dimensions.');
						const result = develop.processVersion === 3
							? await consume(view) : await withPhysicalRetirement(view, consume, signal);
						check(); return result;
					}, PROFILE, { source: luts, maskSource }) };
			} catch (error) { outcome = { error }; }
			// Resource sources drain before the canonical scope can release pixels.
			await retireFramescaperNativeImageCurrentV1('error' in outcome ? outcome : undefined, cleanup);
			if ('error' in outcome) throw outcome.error; return outcome.value;
		}, { signal }]) as Result;
	} catch (error) { await retireFramescaperNativeImageCurrentV1({ error }, cleanup); throw error; }
}

function preflight(source: FramescaperImageSourceCurrentV1, develop: ImageDevelopStateCurrentV1,
	selection: Readonly<ImageDevelopMaskOverlaySelectionV1> | undefined,
	references: ReturnType<typeof collectFramescaperImageProjectResourcesCurrentV1>, temporaryBodyBytes = 0): void {
	if (source.schemaVersion === 4) {
		const plan = prepareFramescaperRawImageWorkingCurrentV1(source, { develop, ...(selection ? { maskOverlay: selection } : {}),
			authoringBytes: FRAMESCAPER_RAW_IMAGE_AUTHORING_BYTES_CURRENT_V1, temporaryBodyBytes });
		// Complete project declarations authenticate before the Original borrow.
		// Their peak is separate from decoding and Current render resource scopes.
		let authentication = 0n;
		for (const reference of references.luts) {
			const bytes = BigInt(reference.byteLength) * 3n + BigInt(reference.size) ** 3n * 48n;
			if (bytes > authentication) authentication = bytes;
		}
		for (const reference of references.brushes) { const bytes = BigInt(reference.byteLength) * 3n; if (bytes > authentication) authentication = bytes; }
		const peak = BigInt(source.assetByteLength) * 3n + authentication + BigInt(FRAMESCAPER_RAW_IMAGE_AUTHORING_BYTES_CURRENT_V1) + BigInt(temporaryBodyBytes) * 3n;
		if (peak > BigInt(plan.maximumWorkingBytes)) throw new RangeError('Frame RAW draft authentication exceeds its 1 GiB working byte bound.');
		return;
	}
	planPixelFrameV1({ schemaVersion: 1, width: source.canonical.width, height: source.canonical.height,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, PIXELS);
	const computation = develop.processVersion === 3 ? normalizeImageDevelopStateV2({ processVersion: 2, effects: develop.effects,
		geometry: develop.geometry, masks: develop.masks, maskBindings: develop.maskBindings }) : develop;
	const masks = prepareImageDevelopBrushMasksV1(computation, source.canonical.width, source.canonical.height, PIXELS, selection);
	const repairs = develop.processVersion === 3 ? planImageDevelopRepairSpotsV1(develop.repairs, source.canonical.width, source.canonical.height) : undefined;
	let width = source.canonical.width, height = source.canonical.height, maximum = BigInt(width) * BigInt(height) * 4n;
	const geometry = (value: Parameters<typeof planImageGeometryV1>[0]) => {
		const plan = planImageGeometryV1(value, width, height); width = plan.width; height = plan.height;
		planPixelFrameV1({ schemaVersion: 1, width, height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, PIXELS);
		const bytes = BigInt(width) * BigInt(height) * 4n; if (bytes > maximum) maximum = bytes;
	};
	geometry({ schemaVersion: 1, ...develop.geometry, perspective: null });
	for (const effect of develop.effects) if (effect.enabled && effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) geometry(imageGeometryForVideoEffectV1(effect, width, height));
	let lutBytes = 0n, authenticationBytes = 0n;
	for (const reference of references.luts) {
		const bytes = BigInt(reference.byteLength) * 3n + BigInt(reference.size) ** 3n * 3n * 8n * 2n;
		if (bytes > lutBytes) lutBytes = bytes; if (bytes > authenticationBytes) authenticationBytes = bytes;
	}
	for (const reference of references.brushes) {
		const bytes = BigInt(reference.byteLength) * 3n; if (bytes > authenticationBytes) authenticationBytes = bytes;
	}
	// Source1 also renders: its canonical and staged planes are never a zero cost.
	const display = fitPixelSizeV1(width, height, 2048, 2048), displayPlane = BigInt(display.width) * BigInt(display.height) * 4n;
	// Proxy presentation owns fitted After/optional Overlay JS planes and their
	// corresponding native canvas planes. Native ImageData aliases those JS
	// buffers; its qualified legacy probe fits the separate 4096-byte reserve.
	const presentation = displayPlane * (selection ? 4n : 2n);
	const render = BigInt(source.canonical.width) * BigInt(source.canonical.height) * 4n + maximum * 4n + lutBytes + BigInt(masks.peakWorkingBytes) + presentation + 4_096n;
	let peak = render > authenticationBytes ? render : authenticationBytes;
	if (repairs && BigInt(repairs.stageWorkingBytes) > peak) peak = BigInt(repairs.stageWorkingBytes);
	// The brush dialog's bounded authoring/display owner remains alive while
	// this temporary snapshot, authentication copy and renderer are borrowed.
	const authoring = temporaryBodyBytes ? 64n * 1024n * 1024n + BigInt(temporaryBodyBytes) * 3n : 0n;
	if (BigInt(source.assetByteLength) * 3n + peak + authoring > 512n * 1024n * 1024n) throw new RangeError('Frame draft rendering exceeds its 512 MiB working byte bound.');
}

/** Process3's shared renderer certifies its own backings. Older local drafts
 * need the same physical certification even though their shared kernel only
 * wipes still-attached buffers. Never inspect opaque consumer failures. */
async function withPhysicalRetirement<Result>(view: Readonly<ImageDevelopFrameViewV1>,
	consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, signal?: AbortSignal): Promise<Result> {
	const buffers = [view.frame.pixels, ...(view.maskOverlay ? [view.maskOverlay.coverage] : [])].map(bytes => {
		const backing = Reflect.apply(BUFFER, bytes, []) as ArrayBuffer; return { backing, length: Number(Reflect.apply(SIZE, backing, [])) };
	});
	let outcome: { value: Result } | { error: unknown };
	try { const value = await consume(view); checkFramescaperNativeImageSignalCurrentV1(signal); outcome = { value }; }
	catch (error) { let primary = error; try { checkFramescaperNativeImageSignalCurrentV1(signal); } catch (reason) { primary = reason; } outcome = { error: primary }; }
	await retireFramescaperNativeImageCurrentV1('error' in outcome ? outcome : undefined, buffers.map(({ backing, length }) => () => {
		if (Number(Reflect.apply(SIZE, backing, [])) !== length) throw new TypeError('Frame draft backing was detached or changed before physical retirement.');
		Reflect.apply(FILL, new Uint8Array(backing), [0]);
	}));
	if ('error' in outcome) throw outcome.error; return outcome.value;
}
