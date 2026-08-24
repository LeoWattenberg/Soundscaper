/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProductNativeRenderInputAuthorityBinding,
	ProductNativeRenderInputOperation,
} from '../common/editor/controller/product-native-render-input-authority.ts';
import {
	acquireVideoExportTimingIndexes,
	type VideoExportTimingIndexLease,
} from '../common/editor/controller/video-export-timing.ts';
import {
	captureProductVideoExportTimingSourceIds,
	type ProductVideoExportPlan,
	type ProductVideoExportStrategyEncodeRequest,
} from '../common/editor/controller/product-video-export-strategy.ts';
import { canonicalMediaContentBlob } from '../common/editor/storage/media-content-digest.ts';
import type { BlobLike } from '../common/editor/storage/media-records.ts';
import {
	createFramescaperNativeImageSequenceSourceResolver,
} from '../common/editor/ui/framescaper-native-image-sequence-source-resolver.ts';
import {
	resolveFramescaperNativeServicesBridge,
	type FramescaperNativeServicesBridge,
} from '../common/editor/ui/framescaper-native-services-bridge.ts';
import type { FramescaperNativeRenderInputV1 } from '../common/editor/ui/framescaper-native-services-lifecycle-bridge.ts';
import {
	createVideoKeyframeOfflineHtmlVideoSourceResolver,
} from '../common/editor/ui/video-keyframe-offline-html-video-source-resolver.ts';
import {
	createVideoKeyframeOfflineRgbaRenderer,
	type VideoKeyframeOfflineRgbaRenderer,
} from '../common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
import { planVideoKeyframeOfflineVideoSources } from '../common/editor/ui/video-keyframe-offline-video-export-sources.ts';
import { assertVideoKeyframeExportPlanV7 } from '../common/editor/video-keyframe-export-plan-v7.ts';
import {
	createVideoExactPictureExportFrameSource,
	createVideoKeyframeExportFrameSource,
	type VideoKeyframeExportPresentationResolver,
} from '../common/editor/video-keyframe-export-frame-source.ts';
import { createVideoKeyframeExportPresentationAuthority } from '../common/editor/video-keyframe-export-presentation-authority.ts';
import { findClip, findSource } from '../common/editor/project.js';
import type { UnifiedExactRenderPlanV14 } from '../common/editor/unified-exact-render-plan.ts';
import type { FramescaperSelectedOpenFxExecutionV28 } from './selected-v28-openfx-exact-planes.ts';
import {
	createFramescaperNativeRgbaFramePackV1,
	streamFramescaperNativeRgbaFramePackV1,
	type FramescaperNativeRgbaFramePackV1Sink,
} from './native-render-frame-pack-v1.ts';
import { createFramescaperNativeOpfsFramePackCollector } from './native-render-opfs-spool.ts';
import { createFramescaperNativeAudioCarrierV28 } from './editor-native-render-audio-carrier-v28.ts';
import {
	admitFramescaperNativeRenderInputAuthorityV28,
	admitFramescaperNativeRenderInputRequestV28,
	assertFramescaperNativeRenderOperationCurrentV28,
	currentFramescaperNativeRenderPlanV28,
	currentFramescaperNativeRenderProjectV28,
} from './editor-native-render-input-admission-v28.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import type { FramescaperProjectV28 } from './editor-project-v28.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import {
	createFramescaperNativeCarrierSourceResolverV28,
	type FramescaperNativeCarrierSourceResolverV28,
} from './editor-native-render-source-resolver-v28.ts';
import {
	createFramescaperVideoExportExactExecutionV27,
	type FramescaperVideoExportExactExecutionV27,
} from './video-export-exact-execution-v27.ts';
import {
	type FramescaperVideoExportPictureDispositionV27,
	type FramescaperVideoExportVisualAssetStoreV27,
} from './video-export-visual-execution-v27.ts';
import {
	isFramescaperVideoVisualPlanV27,
} from './video-export-visual-plan-v27.ts';
import { createFramescaperVideoExportStrategyV27 } from './video-export-strategy-v27.ts';
import {
	assertFramescaperNativeCarrierDispositionV28,
	assertFramescaperNativeCarrierFamiliesV28,
	assertFramescaperNativeCarrierPlanParityV28,
	framescaperNativeCarrierPlanningRateV28,
} from './editor-native-render-carrier-semantics-v28.ts';

interface OfflineCanvas extends HTMLCanvasElement { width: number; height: number }
export interface NativeRenderInputStoreV28 extends FramescaperVideoExportVisualAssetStoreV27 {
	loadMediaAsset(storageKey: string, options?: Readonly<{ readonly signal?: AbortSignal }>): PromiseLike<BlobLike | null>;
}

export interface FramescaperNativeRenderInputProducerAuthorityV28 {
	readonly authority: ProductNativeRenderInputAuthorityBinding;
	readonly store: NativeRenderInputStoreV28;
}
export interface FramescaperNativeRenderInputRequestV28 {
	readonly planPayload: string;
	readonly planFingerprint: string;
	readonly projectId: string;
	readonly projectRevision: number;
}
export interface FramescaperNativeRenderInputProducerDependenciesV28 {
	readonly acquireTiming: typeof acquireVideoExportTimingIndexes;
	readonly createCanvas: () => OfflineCanvas;
	readonly createResolver: typeof createVideoKeyframeOfflineHtmlVideoSourceResolver;
	readonly createImageSequenceResolver?: typeof createFramescaperNativeImageSequenceSourceResolver;
	readonly resolveNativeBridge?: () => FramescaperNativeServicesBridge | null;
	readonly createRenderer: typeof createVideoKeyframeOfflineRgbaRenderer;
	readonly produceCarrier?: typeof renderCarrier;
	readonly produceAudio?: typeof createFramescaperNativeAudioCarrierV28;
	readonly openFxExecute?: FramescaperSelectedOpenFxExecutionV28['execute'];
}

export const FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_V28 = Object.freeze({
	acquireTiming: acquireVideoExportTimingIndexes,
	createCanvas(): OfflineCanvas {
		if (!globalThis.document || typeof globalThis.document.createElement !== 'function') {
			throw new Error('Selected V28 carrier production requires a browser canvas.');
		}
		return globalThis.document.createElement('canvas');
	},
	createResolver: createVideoKeyframeOfflineHtmlVideoSourceResolver,
	createImageSequenceResolver: createFramescaperNativeImageSequenceSourceResolver,
	resolveNativeBridge: () => resolveFramescaperNativeServicesBridge(),
	createRenderer: createVideoKeyframeOfflineRgbaRenderer,
	produceCarrier: renderCarrier,
	produceAudio: createFramescaperNativeAudioCarrierV28,
});

/** Produce the durable evaluated-RGBA carrier bound to the immutable selected V14 plan. */
export function createFramescaperNativeRenderInputProducerV28(
	profile: unknown,
	authorityValue: FramescaperNativeRenderInputProducerAuthorityV28,
	dependenciesValue: FramescaperNativeRenderInputProducerDependenciesV28 =
		FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_V28,
): (request: FramescaperNativeRenderInputRequestV28) => Promise<readonly FramescaperNativeRenderInputV1[]> {
	const authority = admitFramescaperNativeRenderInputAuthorityV28(authorityValue);
	const dependencies = resolveFramescaperNativeRenderInputProducerDependenciesV28(dependenciesValue);
	return async (requestValue) => {
		const request = admitFramescaperNativeRenderInputRequestV28(requestValue);
		const operation = authority.authority.begin();
		let result: readonly FramescaperNativeRenderInputV1[] | null = null;
		let primary: unknown;
		let hasPrimary = false;
		try {
			assertFramescaperNativeRenderOperationCurrentV28(operation);
			const project = currentFramescaperNativeRenderProjectV28(profile, operation.project, request);
			const plan = currentFramescaperNativeRenderPlanV28(profile, project, request);
			const carrier = await dependencies.produceCarrier(
				plan, project, authority.store, operation, dependencies,
			);
			const audio = await dependencies.produceAudio(
				plan, framescaperProjectV27FoundationShapeV28(project), operation,
			);
			assertFramescaperNativeRenderOperationCurrentV28(operation);
			result = Object.freeze([Object.freeze({
				role: 'evaluated-rgba-frame-pack' as const,
				byteLength: carrier.byteLength,
				sha256: carrier.sha256,
				bytes: carrier.bytes,
			}), ...(audio ? [audio] : [])]);
		} catch (error) {
			primary = error;
			hasPrimary = true;
		}
		let cleanupFailure: unknown;
		let hasCleanupFailure = false;
		try { operation.finish(); } catch (error) {
			cleanupFailure = error;
			hasCleanupFailure = true;
		}
		if (hasPrimary || hasCleanupFailure) {
			if (hasPrimary && !hasCleanupFailure) throw primary;
			if (!hasPrimary) throw cleanupFailure;
			throw new AggregateError(
				[primary, cleanupFailure],
				'V28 carrier production and authority cleanup failed.',
				{ cause: primary },
			);
		}
		if (!result) throw new Error('Selected V28 carrier production returned no exact input.');
		return result;
	};
}

async function renderCarrier(
	plan: UnifiedExactRenderPlanV14,
	project: FramescaperProjectV28,
	store: NativeRenderInputStoreV28,
	operation: ProductNativeRenderInputOperation,
	dependencies: FramescaperNativeRenderInputProducerDependenciesV28,
) {
	return executeCarrier(plan, project, store, operation, dependencies, (prepared) => (
		createFramescaperNativeRgbaFramePackV1({
			width: prepared.width, height: prepared.height, frameCount: prepared.frameCount,
			frameRate: plan.output.frameRate, signal: operation.signal,
			assertCurrent: operation.assertCurrent,
			renderFrame: (ordinal, output) => prepared.render(ordinal, output),
			createCollector: createFramescaperNativeOpfsFramePackCollector,
		})
	));
}

export async function streamFramescaperNativeRenderCarrierV28(
	plan: UnifiedExactRenderPlanV14, project: FramescaperProjectV28,
	store: NativeRenderInputStoreV28, operation: ProductNativeRenderInputOperation,
	dependencies: FramescaperNativeRenderInputProducerDependenciesV28,
	sink: FramescaperNativeRgbaFramePackV1Sink,
) {
	return executeCarrier(plan, project, store, operation, dependencies, (prepared) => (
		streamFramescaperNativeRgbaFramePackV1({
			width: prepared.width, height: prepared.height, frameCount: prepared.frameCount,
			frameRate: plan.output.frameRate, signal: operation.signal,
			assertCurrent: operation.assertCurrent,
			renderFrame: (ordinal, output) => prepared.render(ordinal, output),
		}, sink)
	));
}

async function executeCarrier<Result>(
	plan: UnifiedExactRenderPlanV14, project: FramescaperProjectV28,
	store: NativeRenderInputStoreV28, operation: ProductNativeRenderInputOperation,
	dependencies: FramescaperNativeRenderInputProducerDependenciesV28,
	produce: (prepared: PreparedCarrierRenderer) => Promise<Result>,
): Promise<Result> {
	assertFramescaperNativeCarrierFamiliesV28(plan, project);
	const inherited = framescaperProjectV27FoundationShapeV28(project);
	const strategy = createFramescaperVideoExportStrategyV27(
		FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, undefined, store,
	);
	const delivery = Object.freeze({
		project: inherited, audioRenderedFallback: null, videoRenderedFallback: null,
		requiredAudioSourceIds: Object.freeze([]), requiredVideoSourceIds: Object.freeze([]),
	});
	const exportProject = strategy.createExportProject({ canonicalProject: inherited, delivery });
	const renderPlan = strategy.createPlan({
		canonicalProject: inherited, exportProject, format: 'mp4', range: 'project',
		includeAudio: false,
		canvas: Object.freeze({
			size: Object.freeze({
				width: plan.output.canvas.width, height: plan.output.canvas.height,
			}),
			frameRate: framescaperNativeCarrierPlanningRateV28(plan.output.frameRate),
			fit: plan.output.canvas.fit, backgroundColor: plan.output.canvas.backgroundColor,
		}),
		quality: plan.output.quality,
	});
	if (!renderPlan) throw new Error('Selected V28 Web Core did not create an exact inherited picture plan.');
	assertFramescaperNativeCarrierPlanParityV28(plan, renderPlan);
	const requiredSourceIds = captureProductVideoExportTimingSourceIds(strategy, renderPlan);
	let timing: VideoExportTimingIndexLease | null = null;
	let prepared: PreparedCarrierRenderer | null = null;
	let result: Result | undefined;
	let primary: unknown;
	try {
		timing = await dependencies.acquireTiming(exportProject, exactBlobStore(store), {
			findClip, findSource,
		}, {
			signal: operation.signal, assertCurrent: operation.assertCurrent,
			requiredSourceIds, allowInactiveRequiredSources: true,
		});
		assertReady(operation);
		prepared = isFramescaperVideoVisualPlanV27(renderPlan)
			? await prepareVisualCarrier(
				renderPlan, inherited, exportProject, timing, store, operation,
				plan, dependencies.openFxExecute,
			)
			: await prepareKeyedCarrier(
				renderPlan, inherited, project, exportProject, timing, store, operation, dependencies,
				plan,
			);
		result = await produce(prepared);
		const disposition = prepared.disposition();
		assertFramescaperNativeCarrierDispositionV28(plan, disposition);
	} catch (error) { primary = error; }
	const cleanup: unknown[] = [];
	if (prepared) try { await prepared.dispose(); } catch (error) { cleanup.push(error); }
	if (timing) try { timing.release(); } catch (error) { cleanup.push(error); }
	if (primary !== undefined || cleanup.length !== 0) {
		if (primary !== undefined && cleanup.length === 0) throw primary;
		throw new AggregateError(primary === undefined ? cleanup : [primary, ...cleanup],
			'Selected V28 Web carrier execution and cleanup did not both complete.',
			{ ...(primary === undefined ? {} : { cause: primary }) });
	}
	if (result === undefined) throw new Error('Selected V28 Web carrier production returned no bytes.');
	return result;
}

interface PreparedCarrierRenderer {
	readonly width: number;
	readonly height: number;
	readonly frameCount: number;
	render(ordinal: number, output: Uint8Array): PromiseLike<void> | void;
	disposition(): FramescaperVideoExportPictureDispositionV27;
	dispose(): Promise<void>;
}

async function prepareKeyedCarrier(
	renderPlan: ProductVideoExportPlan,
	project: ReturnType<typeof framescaperProjectV27FoundationShapeV28>,
	sourceProject: FramescaperProjectV28,
	exportProject: Readonly<Record<string, unknown>>,
	timing: VideoExportTimingIndexLease,
	store: NativeRenderInputStoreV28,
	operation: ProductNativeRenderInputOperation,
	dependencies: FramescaperNativeRenderInputProducerDependenciesV28,
	v14Plan: UnifiedExactRenderPlanV14,
): Promise<PreparedCarrierRenderer> {
	assertVideoKeyframeExportPlanV7(renderPlan);
	const sourcePlan = planVideoKeyframeOfflineVideoSources({
		project: exportProject, timingBySourceId: timing.timingBySourceId,
		startFrame: renderPlan.range.startFrame, endFrame: renderPlan.range.endFrame,
	});
	if (sourcePlan.activeSourceIds.length !== renderPlan.activeSourceIds.length
		|| sourcePlan.activeSourceIds.some((id, index) => id !== renderPlan.activeSourceIds[index])) {
		throw new Error('Selected V28 inherited source inventory changed before carrier evaluation.');
	}
	const blobs = await loadVideoBlobs(renderPlan, store, operation);
	const presentation = createVideoKeyframeExportPresentationAuthority({
		project: sourcePlan.project, timingBySourceId: timing.timingBySourceId,
	});
	const assets = await sourcePlan.authenticate(
		[...blobs].map(([sourceId, blob]) => Object.freeze({ sourceId, blob })),
		presentation.presentationForEntry,
		{ signal: operation.signal, assertCurrent: operation.assertCurrent },
	);
	const frameSource = createFramescaperNativeCarrierFrameSourceV28({
		plan: v14Plan, exportProject,
		startFrame: renderPlan.range.startFrame, endFrame: renderPlan.range.endFrame,
		resolvePresentationDescriptor: presentation.resolvePresentationDescriptor,
	});
	const request = encodeRequest(project, exportProject, renderPlan, timing, blobs, operation);
	const exact = await createFramescaperVideoExportExactExecutionV27({
		profile: FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, project, request, store,
		...(dependencies.openFxExecute ? { createOpenFxExecution: () => Object.freeze({
			plan: v14Plan, execute: dependencies.openFxExecute!,
		}) } : {}),
	});
	let resolver: FramescaperNativeCarrierSourceResolverV28 | null = null;
	let renderer: VideoKeyframeOfflineRgbaRenderer | null = null;
	try {
		resolver = createFramescaperNativeCarrierSourceResolverV28(assets, sourceProject, {
			createHtmlResolver: dependencies.createResolver,
			createImageSequenceResolver: dependencies.createImageSequenceResolver,
			nativeBridge: dependencies.resolveNativeBridge ?? (() => resolveFramescaperNativeServicesBridge()),
			createCanvas: dependencies.createCanvas,
			assertCurrent: () => assertReady(operation),
		});
		const canvas = dependencies.createCanvas();
		canvas.width = renderPlan.canvas.width; canvas.height = renderPlan.canvas.height;
		renderer = dependencies.createRenderer({
			frameSource, canvas, resolveSource: resolver.resolveSource, compose: exact.compositor,
		});
	} catch (error) {
		await cleanupResources(renderer, resolver, exact);
		throw error;
	}
	return Object.freeze({
		width: renderer.width, height: renderer.height, frameCount: frameSource.frameCount,
		render: (ordinal: number, output: Uint8Array) => renderer!.produce(
			frameSource.frame(ordinal), output, { signal: operation.signal },
		),
		disposition: exact.disposition,
		dispose: () => cleanupResources(renderer, resolver, exact),
	});
}

function exactCarrierCanvas(plan: UnifiedExactRenderPlanV14) {
	return Object.freeze({
		width: plan.output.canvas.width,
		height: plan.output.canvas.height,
		frameRate: plan.output.frameRate,
		fit: plan.output.canvas.fit,
		backgroundColor: plan.output.canvas.backgroundColor,
	});
}

export function createFramescaperNativeCarrierFrameSourceV28(input: Readonly<{
	readonly plan: UnifiedExactRenderPlanV14;
	readonly exportProject: Readonly<Record<string, unknown>>;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly resolvePresentationDescriptor?: VideoKeyframeExportPresentationResolver;
}>) {
	return createVideoKeyframeExportFrameSource({
		project: input.exportProject, canvas: exactCarrierCanvas(input.plan),
		startFrame: input.startFrame, endFrame: input.endFrame,
		...(input.resolvePresentationDescriptor === undefined ? {} : {
			resolvePresentationDescriptor: input.resolvePresentationDescriptor,
		}),
	});
}

async function prepareVisualCarrier(
	renderPlan: ProductVideoExportPlan,
	project: ReturnType<typeof framescaperProjectV27FoundationShapeV28>,
	exportProject: Readonly<Record<string, unknown>>,
	timing: VideoExportTimingIndexLease,
	store: NativeRenderInputStoreV28,
	operation: ProductNativeRenderInputOperation,
	v14Plan: UnifiedExactRenderPlanV14,
	openFxExecute: FramescaperSelectedOpenFxExecutionV28['execute'] | undefined,
): Promise<PreparedCarrierRenderer> {
	const canvas = exactCarrierCanvas(v14Plan);
	const frameSource = createVideoExactPictureExportFrameSource({
		sampleRate: Number(exportProject.sampleRate),
		startFrame: renderPlan.range.startFrame, endFrame: renderPlan.range.endFrame,
		canvas,
	});
	const exact = await createFramescaperVideoExportExactExecutionV27({
		profile: FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, project,
		request: encodeRequest(project, exportProject, renderPlan, timing, new Map(), operation), store,
		...(openFxExecute ? { createOpenFxExecution: () => Object.freeze({
			plan: v14Plan, execute: openFxExecute,
		}) } : {}),
	});
	return Object.freeze({
		width: canvas.width, height: canvas.height,
		frameCount: frameSource.frameCount,
		render: (ordinal: number, output: Uint8Array) => exact.compositor({
			frame: frameSource.frame(ordinal), layers: [], width: canvas.width,
			height: canvas.height, rgba: output as Uint8Array<ArrayBuffer>,
			signal: operation.signal,
		}),
		disposition: exact.disposition,
		dispose: exact.dispose,
	});
}

function encodeRequest(
	project: ReturnType<typeof framescaperProjectV27FoundationShapeV28>,
	exportProject: Readonly<Record<string, unknown>>,
	plan: ProductVideoExportPlan,
	timing: VideoExportTimingIndexLease,
	videoBlobs: ReadonlyMap<string, Blob>,
	operation: ProductNativeRenderInputOperation,
): ProductVideoExportStrategyEncodeRequest {
	return Object.freeze({
		canonicalProject: project, exportProject, plan,
		timingBySourceId: timing.timingBySourceId,
		timingViewsBySourceId: timing.timingViewsBySourceId,
		videoBlobs, audioMix: null, editorFfmpeg: null, webCodecs: null,
		signal: operation.signal, assertCurrent: operation.assertCurrent,
		maximumOutputBytes: undefined,
	});
}

async function loadVideoBlobs(
	plan: ProductVideoExportPlan,
	store: NativeRenderInputStoreV28,
	operation: ProductNativeRenderInputOperation,
): Promise<ReadonlyMap<string, Blob>> {
	const output = new Map<string, Blob>();
	for (const input of plan.inputs) {
		if (input.kind !== 'video-source') continue;
		assertReady(operation);
		const value = await store.loadMediaAsset(String(input.storageKey), { signal: operation.signal });
		if (!(value instanceof Blob) || value.size < 1) throw new Error(`Selected V28 source ${String(input.sourceId)} is unavailable.`);
		output.set(String(input.sourceId), canonicalMediaContentBlob(value));
	}
	return Object.freeze(output);
}

export function resolveFramescaperNativeRenderInputProducerDependenciesV28(
	value: FramescaperNativeRenderInputProducerDependenciesV28,
) {
	if (typeof value?.acquireTiming !== 'function' || typeof value.createCanvas !== 'function'
		|| typeof value.createResolver !== 'function' || typeof value.createRenderer !== 'function'
		|| (value.createImageSequenceResolver !== undefined && typeof value.createImageSequenceResolver !== 'function')
		|| (value.resolveNativeBridge !== undefined && typeof value.resolveNativeBridge !== 'function')
		|| (value.produceCarrier !== undefined && typeof value.produceCarrier !== 'function')
		|| (value.produceAudio !== undefined && typeof value.produceAudio !== 'function')
		|| (value.openFxExecute !== undefined && typeof value.openFxExecute !== 'function')) {
		throw new TypeError('Selected V28 carrier dependencies are incomplete.');
	}
	return Object.freeze({ ...value, produceCarrier: value.produceCarrier ?? renderCarrier,
		produceAudio: value.produceAudio ?? createFramescaperNativeAudioCarrierV28 });
}
function exactBlobStore(store: NativeRenderInputStoreV28) {
	return Object.freeze({ async loadMediaAsset(storageKey: string, options?: Readonly<{ signal?: AbortSignal }>) {
		const value = await store.loadMediaAsset(storageKey, options);
		if (value === null) return null;
		if (!(value instanceof Blob)) throw new TypeError(`Selected V28 retained media ${storageKey} is not a Blob.`);
		return canonicalMediaContentBlob(value);
	} });
}
function assertReady(operation: ProductNativeRenderInputOperation): void {
	if (operation.signal.aborted) throw operation.signal.reason ?? new DOMException('V28 carrier production was cancelled.', 'AbortError');
	operation.assertCurrent();
}
async function cleanupResources(
	renderer: VideoKeyframeOfflineRgbaRenderer | null,
	resolver: FramescaperNativeCarrierSourceResolverV28 | null,
	exact: FramescaperVideoExportExactExecutionV27,
): Promise<void> {
	const results = await Promise.allSettled([
		Promise.resolve().then(() => renderer?.dispose()),
		Promise.resolve().then(() => resolver?.dispose()),
		Promise.resolve().then(() => exact.dispose()),
	]);
	const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(({ reason }) => reason);
	if (failures.length) throw new AggregateError(failures, 'Selected V28 carrier resources did not close.');
}
