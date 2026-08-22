/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProductNativeRenderInputAuthorityBinding,
	ProductNativeRenderInputOperation,
} from '../common/editor/controller/product-native-render-input-authority.ts';
import { acquireVideoExportTimingIndexes } from '../common/editor/controller/video-export-timing.ts';
import { audioBufferChannels } from '../common/editor/engine/buffer-math.ts';
import { applyMediaChannelMapping } from '../common/editor/media-export.js';
import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
} from '../common/editor/native-media-plan-canonical-form.ts';
import { nativeMediaEvaluatedCarrierCadenceV1 } from '../common/editor/native-media-evaluated-carrier-v1.ts';
import {
	assertNativeMediaGraphPlan,
	type NativeMediaGraphPlan,
} from '../common/editor/native-media-graph-plan-admission.ts';
import { createNativeMediaPlanEnvelopeV1 } from '../common/editor/native-media-plan-envelope.ts';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from '../common/editor/storage/media-content-digest.ts';
import type { BlobLike } from '../common/editor/storage/media-records.ts';
import { projectTrackFolderMediaStateV12 } from '../common/editor/track-folder-media-runtime.ts';
import {
	createVideoKeyframeOfflineHtmlVideoSourceResolver,
	type VideoKeyframeOfflineHtmlVideoSourceResolver,
} from '../common/editor/ui/video-keyframe-offline-html-video-source-resolver.ts';
import {
	createVideoKeyframeOfflineRgbaRenderer,
	type VideoKeyframeOfflineRgbaRenderer,
} from '../common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
import { planVideoKeyframeOfflineVideoSources } from '../common/editor/ui/video-keyframe-offline-video-export-sources.ts';
import {
	assertVideoKeyframeExportPlanV7,
	type VideoKeyframeExportPlanV7,
} from '../common/editor/video-keyframe-export-plan-v7.ts';
import { createVideoKeyframeExportFrameSource } from '../common/editor/video-keyframe-export-frame-source.ts';
import { createVideoKeyframeExportPresentationAuthority } from '../common/editor/video-keyframe-export-presentation-authority.ts';
import { encodeWav } from '../common/editor/wav.js';
import { findClip, findSource } from '../common/editor/project.js';
import { createVideoExportPlan } from '../common/editor/video-export.js';
import type { FramescaperNativeRenderInputV1 } from '../common/editor/ui/framescaper-native-services-lifecycle-bridge.ts';
import {
	cloneFramescaperProjectV20,
	type FramescaperProjectV20,
} from './editor-project-v20.ts';
import {
	assertFramescaperProjectV20Profile,
	type FramescaperProjectV20Profile,
} from './editor-project-v20-profile.ts';
import {
	framescaperProjectForPlaybackFoundationV20,
	framescaperProjectForRuntimeConsumersV20,
} from './editor-project-v20-runtime.ts';
import { createFramescaperVideoKeyframeExportPlanV20 } from './video-export-plan-v20.ts';
import { createFramescaperNativeRgbaFramePackV1 } from './native-render-frame-pack-v1.ts';

const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_PLAN_BYTES = 65_536;
const MAXIMUM_AUDIO_BYTES = 2 * 1_024 ** 3;

interface NativeRenderInputStoreV20 {
	loadMediaAsset(
		storageKey: string,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): PromiseLike<BlobLike | null>;
}

interface ExactNativeRenderInputStoreV20 {
	loadMediaAsset(
		storageKey: string,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): Promise<Blob | null>;
}

export interface FramescaperNativeRenderInputProducerAuthorityV20 {
	readonly authority: ProductNativeRenderInputAuthorityBinding;
	readonly store: NativeRenderInputStoreV20;
}

export interface FramescaperNativeRenderInputRequestV20 {
	readonly planPayload: string;
	readonly planFingerprint: string;
	readonly projectId: string;
	readonly projectRevision: number;
}

interface OfflineCanvas extends HTMLCanvasElement {
	width: number;
	height: number;
}

type SelectedV20NativeRenderPlan = VideoKeyframeExportPlanV7 | NativeMediaGraphPlan;

export interface FramescaperNativeRenderInputProducerDependenciesV20 {
	readonly acquireTiming: typeof acquireVideoExportTimingIndexes;
	readonly createCanvas: () => OfflineCanvas;
	readonly createResolver: typeof createVideoKeyframeOfflineHtmlVideoSourceResolver;
	readonly createRenderer: typeof createVideoKeyframeOfflineRgbaRenderer;
}

const DEFAULT_DEPENDENCIES: FramescaperNativeRenderInputProducerDependenciesV20 = Object.freeze({
	acquireTiming: acquireVideoExportTimingIndexes,
	createCanvas(): OfflineCanvas {
		if (!globalThis.document || typeof globalThis.document.createElement !== 'function') {
			throw new Error('Selected V20 native input production requires a browser canvas.');
		}
		return globalThis.document.createElement('canvas');
	},
	createResolver: createVideoKeyframeOfflineHtmlVideoSourceResolver,
	createRenderer: createVideoKeyframeOfflineRgbaRenderer,
});

/** Build the controller method consumed by the selected V20 queue action. */
export function createFramescaperNativeRenderInputProducerV20(
	profileValue: FramescaperProjectV20Profile | unknown,
	authorityValue: FramescaperNativeRenderInputProducerAuthorityV20,
	dependencies: FramescaperNativeRenderInputProducerDependenciesV20 = DEFAULT_DEPENDENCIES,
): (request: FramescaperNativeRenderInputRequestV20) => Promise<readonly FramescaperNativeRenderInputV1[]> {
	assertFramescaperProjectV20Profile(profileValue);
	const profile = profileValue;
	const authority = producerAuthority(authorityValue);
	const runtime = producerDependencies(dependencies);
	return async (requestValue) => {
		const request = requestSnapshot(requestValue);
		const operation = authority.authority.begin();
		let timing: Awaited<ReturnType<typeof acquireVideoExportTimingIndexes>> | null = null;
		let result: readonly FramescaperNativeRenderInputV1[] | null = null;
		let primary: unknown;
		let hasPrimary = false;
		try {
			assertReady(operation);
			const project = exactProject(profile, operation.project, request);
			const plan = exactPlan(profile, project, request);
			const renderProject = projectTrackFolderMediaStateV12(
				framescaperProjectForPlaybackFoundationV20(profile, project),
			);
			if (plan.version === 8) {
				const audio = await renderAudio(plan, renderProject, operation);
				assertReady(operation);
				result = Object.freeze(audio ? [audio] : []);
			} else {
				const activeSourceIds = selectedV20ActiveSourceIds(plan);
				const store = exactBlobStore(authority.store);
				timing = await runtime.acquireTiming(renderProject, store, {
					findClip, findSource,
				}, {
					signal: operation.signal,
					assertCurrent: operation.assertCurrent,
					requiredSourceIds: activeSourceIds,
				});
				assertReady(operation);
				const carrier = await renderCarrier(
					plan, activeSourceIds, renderProject, timing.timingBySourceId, store, operation, runtime,
				);
				const audio = await renderAudio(plan, renderProject, operation);
				assertReady(operation);
				result = Object.freeze([
					Object.freeze({
						role: 'evaluated-rgba-frame-pack' as const,
						byteLength: carrier.byteLength,
						sha256: carrier.sha256,
						bytes: carrier.bytes,
					}),
					...(audio ? [audio] : []),
				]);
			}
		} catch (error) {
			primary = error;
			hasPrimary = true;
		}
		const cleanupFailures: unknown[] = [];
		if (timing) {
			try { timing.release(); } catch (error) { cleanupFailures.push(error); }
		}
		try { operation.finish(); } catch (error) { cleanupFailures.push(error); }
		if (hasPrimary || cleanupFailures.length > 0) {
			if (hasPrimary && cleanupFailures.length === 0) throw primary;
			if (!hasPrimary && cleanupFailures.length === 1) throw cleanupFailures[0];
			throw new AggregateError(
				hasPrimary ? [primary, ...cleanupFailures] : cleanupFailures,
				'Selected V20 render-input production and authority cleanup did not both complete.',
				{ ...(hasPrimary ? { cause: primary } : {}) },
			);
		}
		if (!result) throw new Error('Selected V20 render-input production returned no exact inputs.');
		return result;
	};
}

async function renderCarrier(
	plan: SelectedV20NativeRenderPlan,
	activeSourceIds: readonly string[],
	project: Readonly<Record<string, unknown>>,
	timingBySourceId: Awaited<ReturnType<typeof acquireVideoExportTimingIndexes>>['timingBySourceId'],
	store: ExactNativeRenderInputStoreV20,
	operation: ProductNativeRenderInputOperation,
	dependencies: FramescaperNativeRenderInputProducerDependenciesV20,
) {
	const cadence = nativeMediaEvaluatedCarrierCadenceV1(createNativeMediaPlanEnvelopeV1(plan));
	const sourcePlan = planVideoKeyframeOfflineVideoSources({
		project,
		timingBySourceId,
		startFrame: plan.range.startFrame,
		endFrame: plan.range.endFrame,
	});
	if (sourcePlan.activeSourceIds.length !== activeSourceIds.length
		|| sourcePlan.activeSourceIds.some((sourceId) => !activeSourceIds.includes(sourceId))) {
		throw new Error('Selected V20 active sources changed between plan and renderer evaluation.');
	}
	const presentation = createVideoKeyframeExportPresentationAuthority({
		project: sourcePlan.project,
		timingBySourceId,
	});
	const sourceBlobs = await loadActiveSources(plan, activeSourceIds, store, operation);
	const assets = await sourcePlan.authenticate(
		sourceBlobs,
		presentation.presentationForEntry,
		Object.freeze({ signal: operation.signal, assertCurrent: operation.assertCurrent }),
	);
	assertReady(operation);
	const frameSource = createVideoKeyframeExportFrameSource({
		project,
		canvas: Object.freeze({
			width: plan.canvas.width,
			height: plan.canvas.height,
			frameRate: cadence,
			fit: plan.canvas.fit,
			backgroundColor: plan.canvas.backgroundColor,
		}),
		startFrame: plan.range.startFrame,
		endFrame: plan.range.endFrame,
		resolvePresentationDescriptor: presentation.resolvePresentationDescriptor,
	});
	if (frameSource.frameCount !== plan.outputFrameCount) {
		throw new Error('Selected V20 frame-source cadence changed after plan authentication.');
	}
	let resolver: VideoKeyframeOfflineHtmlVideoSourceResolver | null = null;
	let renderer: VideoKeyframeOfflineRgbaRenderer | null = null;
	let result: Awaited<ReturnType<typeof createFramescaperNativeRgbaFramePackV1>> | null = null;
	let primary: unknown;
	let hasPrimary = false;
	try {
		resolver = dependencies.createResolver(Object.freeze({ sources: assets }));
		const canvas = dependencies.createCanvas();
		canvas.width = plan.canvas.width;
		canvas.height = plan.canvas.height;
		renderer = dependencies.createRenderer(Object.freeze({
			frameSource, canvas, resolveSource: resolver.resolveSource,
		}));
		if (renderer.width !== plan.canvas.width || renderer.height !== plan.canvas.height
			|| renderer.byteLength !== plan.canvas.width * plan.canvas.height * 4) {
			throw new Error('The shared preview/export renderer changed selected V20 canvas geometry.');
		}
		result = await createFramescaperNativeRgbaFramePackV1({
			width: plan.canvas.width,
			height: plan.canvas.height,
			frameCount: plan.outputFrameCount,
			frameRate: cadence,
			signal: operation.signal,
			assertCurrent: operation.assertCurrent,
			renderFrame: (ordinal, output) => renderer!.produce(
				frameSource.frame(ordinal), output, { signal: operation.signal },
			),
		});
	} catch (error) {
		primary = error;
		hasPrimary = true;
	}
	const cleanupFailures: unknown[] = [];
	if (renderer) {
		const failure = await cleanupTwice(() => renderer!.dispose());
		if (failure) cleanupFailures.push(failure);
	}
	if (resolver) {
		const failure = await cleanupTwice(() => resolver!.dispose());
		if (failure) cleanupFailures.push(failure);
	}
	if (hasPrimary || cleanupFailures.length > 0) {
		if (hasPrimary && cleanupFailures.length === 0) throw primary;
		if (!hasPrimary && cleanupFailures.length === 1) throw cleanupFailures[0];
		throw new AggregateError(
			hasPrimary ? [primary, ...cleanupFailures] : cleanupFailures,
			'Selected V20 picture production and browser resource cleanup did not both complete.',
			{ ...(hasPrimary ? { cause: primary } : {}) },
		);
	}
	assertReady(operation);
	if (!result) throw new Error('Selected V20 picture production returned no exact carrier.');
	return result;
}

async function loadActiveSources(
	plan: SelectedV20NativeRenderPlan,
	activeSourceIds: readonly string[],
	store: ExactNativeRenderInputStoreV20,
	operation: ProductNativeRenderInputOperation,
): Promise<readonly Readonly<{ sourceId: string; blob: Blob }>[]> {
	const videoInputs = plan.inputs.filter((input) => input.kind === 'video-source');
	if (videoInputs.length !== activeSourceIds.length) {
		throw new Error('Selected V20 active source and plan input inventories diverge.');
	}
	const result: Readonly<{ sourceId: string; blob: Blob }>[] = [];
	for (const [index, input] of videoInputs.entries()) {
		assertReady(operation);
		if (input.sourceId !== activeSourceIds[index]) {
			throw new Error('Selected V20 active sources are not in canonical input order.');
		}
		const value = await store.loadMediaAsset(input.storageKey, { signal: operation.signal });
		assertReady(operation);
		if (!(value instanceof Blob) || value.size < 1) {
			throw new Error(`Selected V20 active source ${input.sourceId} is unavailable.`);
		}
		result.push(Object.freeze({
			sourceId: input.sourceId,
			blob: canonicalMediaContentBlob(value),
		}));
	}
	return Object.freeze(result);
}

async function renderAudio(
	plan: SelectedV20NativeRenderPlan,
	project: Readonly<Record<string, unknown>>,
	operation: ProductNativeRenderInputOperation,
): Promise<FramescaperNativeRenderInputV1 | null> {
	const audio = plan.inputs.find((input) => input.kind === 'staged-audio-mix');
	if (!audio) return null;
	const audioAuthority = audio as typeof audio & Readonly<{ channelLayout: string }>;
	const sampleRate = plan.version === 7 ? plan.sampleRate : audio.sampleRate;
	assertReady(operation);
	const rendered = await operation.renderAudio(project, Object.freeze({
		startFrame: plan.range.startFrame,
		endFrame: plan.range.endFrame,
		includeTail: false,
		outputFrames: plan.range.durationFrames,
		preRollFrames: Math.min(plan.range.startFrame, sampleRate * 10),
	}));
	assertReady(operation);
	if (!rendered || typeof rendered !== 'object'
		|| (rendered as Readonly<{ sampleRate?: unknown }>).sampleRate !== sampleRate) {
		throw new Error('The selected V20 audio renderer changed the plan sample rate.');
	}
	const channels = applyMediaChannelMapping(
		audioBufferChannels(rendered as AudioBuffer),
		audioAuthority.channelLayout,
	);
	if (channels.length < 1 || channels.length > 32
		|| channels.some((channel) => channel.length !== plan.range.durationFrames)) {
		throw new Error('The selected V20 audio render changed its exact frame or channel geometry.');
	}
	const expectedBytes = 44 + plan.range.durationFrames * channels.length * 4;
	if (!Number.isSafeInteger(expectedBytes) || expectedBytes > MAXIMUM_AUDIO_BYTES) {
		throw new RangeError('The selected V20 float32 WAV exceeds its 2 GiB stage.');
	}
	const wav = encodeWav(channels, {
		sampleRate,
		bitDepth: 32,
		float: true,
		dither: 'none',
	});
	assertReady(operation);
	if (wav.byteLength !== expectedBytes) {
		throw new Error('The selected V20 float32 WAV has an unexpected exact length.');
	}
	const bytes = new Blob([new Uint8Array(wav).buffer], { type: 'audio/wav' });
	wav.fill(0);
	const sha256 = await digestMediaContent(bytes, { signal: operation.signal });
	assertReady(operation);
	return Object.freeze({
		role: 'staged-audio-mix',
		byteLength: bytes.size,
		sha256,
		bytes,
	});
}

function exactProject(
	profile: FramescaperProjectV20Profile,
	value: unknown,
	request: FramescaperNativeRenderInputRequestV20,
): FramescaperProjectV20 {
	const project = cloneFramescaperProjectV20(profile, value);
	if (project.id !== request.projectId || project.revision !== request.projectRevision) {
		throw new Error('The selected V20 native render request does not identify the current project snapshot.');
	}
	return project;
}

function exactPlan(
	profile: FramescaperProjectV20Profile,
	project: FramescaperProjectV20,
	request: FramescaperNativeRenderInputRequestV20,
): SelectedV20NativeRenderPlan {
	let parsed: unknown;
	try { parsed = JSON.parse(request.planPayload) as unknown; } catch (cause) {
		throw new TypeError('The selected V20 native render plan is not JSON.', { cause });
	}
	if ((parsed as Readonly<{ version?: unknown }> | null)?.version === 7) {
		assertVideoKeyframeExportPlanV7(parsed);
	} else {
		assertNativeMediaGraphPlan(parsed);
	}
	const canonical = canonicalizeNativeMediaPlan(parsed);
	if (canonical !== request.planPayload
		|| fingerprintNativeMediaPlan(parsed).sha256 !== request.planFingerprint) {
		throw new Error('The selected V20 native render plan has no exact canonical identity.');
	}
	const expected = parsed.version === 7
		? createFramescaperVideoKeyframeExportPlanV20(profile, project, {
			format: 'mp4', range: 'project', includeAudio: true,
		})
		: createVideoExportPlan(framescaperProjectForRuntimeConsumersV20(profile, project), {
			format: 'mp4', range: 'project', includeAudio: true,
		}) as unknown;
	if (canonicalizeNativeMediaPlan(expected) !== canonical
		|| fingerprintNativeMediaPlan(expected).sha256 !== request.planFingerprint) {
		throw new Error('The selected V20 native render plan changed from its current project authority.');
	}
	return parsed as SelectedV20NativeRenderPlan;
}

function selectedV20ActiveSourceIds(plan: SelectedV20NativeRenderPlan): readonly string[] {
	const ids = plan.version === 7
		? plan.activeSourceIds
		: plan.inputs.filter((input) => input.kind === 'video-source').map(({ sourceId }) => sourceId);
	if (new Set(ids).size !== ids.length) {
		throw new Error('Selected V20 render inputs contain a duplicate active source identity.');
	}
	return Object.freeze([...ids]);
}

function requestSnapshot(value: unknown): FramescaperNativeRenderInputRequestV20 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A selected V20 native render-input request is required.');
	}
	const row = value as Readonly<Record<string, unknown>>;
	const fields = ['planPayload', 'planFingerprint', 'projectId', 'projectRevision'];
	if (Reflect.ownKeys(row).length !== fields.length || fields.some((field) => {
		const descriptor = Object.getOwnPropertyDescriptor(row, field);
		return !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value');
	})) throw new TypeError('The selected V20 native render-input request must be a closed data record.');
	if (typeof row.planPayload !== 'string' || row.planPayload.length < 1
		|| new TextEncoder().encode(row.planPayload).byteLength > MAXIMUM_PLAN_BYTES
		|| typeof row.planFingerprint !== 'string' || !SHA256.test(row.planFingerprint)
		|| typeof row.projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(row.projectId)
		|| typeof row.projectRevision !== 'number' || !Number.isSafeInteger(row.projectRevision)
		|| row.projectRevision < 0) {
		throw new TypeError('The selected V20 native render-input request is invalid.');
	}
	return Object.freeze({
		planPayload: row.planPayload,
		planFingerprint: row.planFingerprint,
		projectId: row.projectId,
		projectRevision: row.projectRevision,
	});
}

function producerAuthority(value: unknown): FramescaperNativeRenderInputProducerAuthorityV20 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Selected V20 native render-input authority is required.');
	}
	const row = value as Partial<FramescaperNativeRenderInputProducerAuthorityV20>;
	if (!row.authority || typeof row.authority.begin !== 'function'
		|| !row.store || typeof row.store.loadMediaAsset !== 'function') {
		throw new TypeError('Selected V20 native render-input authority is incomplete.');
	}
	return Object.freeze({ authority: row.authority, store: row.store });
}

function producerDependencies(
	value: FramescaperNativeRenderInputProducerDependenciesV20,
): FramescaperNativeRenderInputProducerDependenciesV20 {
	if (!value || typeof value !== 'object'
		|| typeof value.acquireTiming !== 'function'
		|| typeof value.createCanvas !== 'function'
		|| typeof value.createResolver !== 'function'
		|| typeof value.createRenderer !== 'function') {
		throw new TypeError('Selected V20 native render-input dependencies are incomplete.');
	}
	return Object.freeze({ ...value });
}

function exactBlobStore(store: NativeRenderInputStoreV20): ExactNativeRenderInputStoreV20 {
	return Object.freeze({
		async loadMediaAsset(storageKey: string, options?: Readonly<{ readonly signal?: AbortSignal }>) {
			const value = await store.loadMediaAsset(storageKey, options);
			if (value === null) return null;
			if (!(value instanceof Blob)) {
				throw new TypeError(`Selected V20 retained media ${storageKey} is not a genuine Blob.`);
			}
			return canonicalMediaContentBlob(value);
		},
	});
}

function assertReady(operation: ProductNativeRenderInputOperation): void {
	if (operation.signal.aborted) {
		throw operation.signal.reason ?? new DOMException('Selected V20 input production was cancelled.', 'AbortError');
	}
	operation.assertCurrent();
}

async function cleanupTwice(dispose: () => PromiseLike<void> | void): Promise<unknown | null> {
	try { await dispose(); return null; } catch (error) {
		try { await dispose(); return null; } catch (retryError) {
			return new AggregateError([error, retryError], 'Selected V20 browser resource cleanup failed twice.');
		}
	}
}
