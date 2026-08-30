/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../common/editor/ffmpeg-output-stream.ts';
import { projectTrackFolderMediaStateV12 } from '../common/editor/track-folder-media-runtime.ts';
import type {
	ProductVideoExportEncodedOutput,
	ProductVideoExportSinkOutput,
	ProductVideoExportStrategy,
	ProductVideoExportStrategyEncodeRequest,
	ProductVideoExportStrategyPlanRequest,
	ProductVideoExportProjectRequest,
} from '../common/editor/controller/product-video-export-strategy.ts';
import type { ControllerProjectRuntime } from '../common/editor/controller/project-runtime.ts';
import {
	encodeVideoKeyframeOfflineVideo,
	encodeVideoKeyframeOfflineVideoToSink,
	type VideoKeyframeOfflineVideoExportRequest,
} from '../common/editor/ui/video-keyframe-offline-video-export.ts';
import {
	assertVideoKeyframeExportPlanV7,
	type VideoKeyframeExportPlanV7,
} from '../common/editor/video-keyframe-export-plan-v7.ts';
import type {
	VideoKeyframeVideoEncoderResult,
	VideoKeyframeVideoSinkEncoderResult,
} from '../common/editor/video-keyframe-video-encoder.ts';
import { createSoundscaperVideoKeyframeExportPlan } from './video-export-plan.ts';

type OfflineSinkEncoder = (
	request: VideoKeyframeOfflineVideoExportRequest,
	sink: FfmpegOutputSink<unknown>,
) => Promise<VideoKeyframeVideoSinkEncoderResult<unknown>>;

export interface SoundscaperVideoExportStrategyDependencies {
	readonly encodeOffline: typeof encodeVideoKeyframeOfflineVideo;
	readonly encodeOfflineToSink: OfflineSinkEncoder;
}

interface PlanAuthority {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly exportProject: Readonly<Record<string, unknown>>;
}

interface ExportAuthority {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly canonicalProjection: Readonly<Record<string, unknown>>;
}

const DEFAULT_DEPENDENCIES: SoundscaperVideoExportStrategyDependencies = Object.freeze({
	encodeOffline: encodeVideoKeyframeOfflineVideo,
	encodeOfflineToSink: encodeVideoKeyframeOfflineVideoToSink as OfflineSinkEncoder,
});

/** Retained desktop-only factory for older controller compositions. */
export function createSoundscaperDesktopVideoExportStrategy(
	runtime: Pick<ControllerProjectRuntime, 'cloneProject' | 'projectForRuntimeConsumers'>,
	fileService: unknown,
): ProductVideoExportStrategy | undefined {
	if (!ownDesktopFlag(fileService)) return undefined;
	return createSoundscaperVideoExportStrategy(runtime);
}

/** Own the selected Soundscaper baseline keyed-RGBA browser or desktop delivery. */
export function createSoundscaperVideoExportStrategy(
	runtime: Pick<ControllerProjectRuntime, 'cloneProject' | 'projectForRuntimeConsumers'>,
	dependenciesValue: SoundscaperVideoExportStrategyDependencies | unknown = DEFAULT_DEPENDENCIES,
): ProductVideoExportStrategy {
	if (!runtime || typeof runtime.cloneProject !== 'function'
		|| typeof runtime.projectForRuntimeConsumers !== 'function') {
		throw new TypeError('Soundscaper baseline video export requires selected runtime projection authority.');
	}
	const dependencies = snapshotDependencies(dependenciesValue);
	const exportAuthorities = new WeakMap<object, ExportAuthority>();
	const planAuthorities = new WeakMap<object, PlanAuthority>();
	return Object.freeze({
		createExportProject(request: ProductVideoExportProjectRequest) {
			const deliveryProject = assertFallbackFreeDelivery(request.delivery);
			const canonicalProjection = createDetachedExportProject(runtime, request.canonicalProject);
			const detached = runtime.cloneProject(deliveryProject);
			const projection = runtime.projectForRuntimeConsumers(detached);
			const exportProject = freezeExportProject(projectTrackFolderMediaStateV12(projection));
			exportAuthorities.set(exportProject, Object.freeze({
				canonicalProject: request.canonicalProject,
				canonicalProjection,
			}));
			return exportProject;
		},
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			const authority = exportAuthorities.get(request.exportProject);
			if (!authority || authority.canonicalProject !== request.canonicalProject) {
				throw new TypeError('The Soundscaper baseline export projection is not owned by its exact canonical project.');
			}
			assertSameData(
				authority.canonicalProjection,
				createDetachedExportProject(runtime, request.canonicalProject),
				'Soundscaper baseline canonical snapshot',
			);
			const plan = createSoundscaperVideoKeyframeExportPlan(runtime, request.canonicalProject, {
				format: request.format, range: request.range, includeAudio: request.includeAudio,
				canvas: request.canvas,
				...(request.quality === undefined ? {} : { quality: request.quality }),
				...(request.audioLayout === undefined ? {} : { audioLayout: request.audioLayout }),
				...(request.captions === undefined ? {} : { captions: request.captions }),
			});
			planAuthorities.set(plan, Object.freeze({
				canonicalProject: request.canonicalProject, exportProject: request.exportProject,
			}));
			return plan;
		},
		async encode(request: ProductVideoExportStrategyEncodeRequest) {
			const plan = ownedPlan(request, planAuthorities);
			return browserResult(await dependencies.encodeOffline(offlineRequest(request, plan)), plan);
		},
		async encodeToSink<Output>(
			request: ProductVideoExportStrategyEncodeRequest,
			sink: FfmpegOutputSink<Output>,
		): Promise<ProductVideoExportSinkOutput<Output>> {
			const plan = ownedPlan(request, planAuthorities);
			const result = await dependencies.encodeOfflineToSink(
				offlineRequest(request, plan), sink as FfmpegOutputSink<unknown>,
			);
			return sinkResult(result, plan) as ProductVideoExportSinkOutput<Output>;
		},
	});
}

function ownedPlan(
	request: ProductVideoExportStrategyEncodeRequest,
	authorities: WeakMap<object, PlanAuthority>,
): VideoKeyframeExportPlanV7 {
	assertVideoKeyframeExportPlanV7(request.plan);
	const authority = authorities.get(request.plan);
	if (!authority || authority.canonicalProject !== request.canonicalProject
		|| authority.exportProject !== request.exportProject) {
		throw new TypeError('The keyed export plan is not owned by this exact Soundscaper baseline snapshot.');
	}
	return request.plan;
}

function assertFallbackFreeDelivery(
	delivery: ProductVideoExportProjectRequest['delivery'],
): Readonly<Record<string, unknown>> {
	if (dataProperty(delivery, 'audioRenderedFallback') !== null
		|| dataProperty(delivery, 'videoRenderedFallback') !== null
		|| !emptyArray(dataProperty(delivery, 'requiredAudioSourceIds'))
		|| !emptyArray(dataProperty(delivery, 'requiredVideoSourceIds'))) {
		throw new Error('Soundscaper baseline keyed video export refuses a rendered-fallback delivery projection.');
	}
	return dataRecord(dataProperty(delivery, 'project'), 'Soundscaper baseline delivery project');
}

function createDetachedExportProject(
	runtime: Pick<ControllerProjectRuntime, 'cloneProject' | 'projectForRuntimeConsumers'>,
	project: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const detached = runtime.cloneProject(project);
	const projection = runtime.projectForRuntimeConsumers(detached);
	return freezeExportProject(projectTrackFolderMediaStateV12(projection));
}

function offlineRequest(
	request: ProductVideoExportStrategyEncodeRequest,
	plan: VideoKeyframeExportPlanV7,
): VideoKeyframeOfflineVideoExportRequest {
	const sources = exactSources(plan, request.videoBlobs);
	const includesAudio = plan.inputs.some((input) => input.kind === 'staged-audio-mix');
	if (includesAudio !== (request.audioMix instanceof Blob)) {
		throw new TypeError('The Soundscaper keyed export audio mix must exactly match its plan.');
	}
	return Object.freeze({
		project: request.exportProject,
		timingBySourceId: request.timingBySourceId,
		sources,
		canvas: Object.freeze({
			width: plan.canvas.width, height: plan.canvas.height,
			frameRate: plan.canvas.frameRate, fit: plan.canvas.fit,
			backgroundColor: plan.canvas.backgroundColor,
		}),
		startFrame: plan.range.startFrame,
		endFrame: plan.range.endFrame,
		format: plan.format,
		quality: plan.quality,
		...(request.webCodecs
			? { webCodecs: request.webCodecs }
			: { editorFfmpeg: request.editorFfmpeg as VideoKeyframeOfflineVideoExportRequest['editorFfmpeg'] }),
		...(request.audioMix instanceof Blob ? { audioMix: request.audioMix } : {}),
		...(request.maximumOutputBytes === undefined ? {} : {
			maximumOutputBytes: request.maximumOutputBytes as number,
		}),
		...(request.rgbaPostprocessor === undefined ? {} : { rgbaPostprocessor: request.rgbaPostprocessor }),
		...(request.rgbaCompositor === undefined ? {} : { rgbaCompositor: request.rgbaCompositor }),
		signal: request.signal,
		assertCurrent: request.assertCurrent,
	});
}

function exactSources(
	plan: VideoKeyframeExportPlanV7,
	videoBlobs: ReadonlyMap<string, Blob>,
): readonly Readonly<{ sourceId: string; blob: Blob }>[] {
	if (!(videoBlobs instanceof Map) || videoBlobs.size !== plan.activeSourceIds.length) {
		throw new TypeError('The Soundscaper keyed export Blob set must exactly match active source IDs.');
	}
	return Object.freeze(plan.activeSourceIds.map((sourceId) => {
		const blob = videoBlobs.get(sourceId);
		if (!(blob instanceof Blob)) throw new TypeError(`Active source ${sourceId} has no authenticated video Blob.`);
		return Object.freeze({ sourceId, blob });
	}));
}

function browserResult(
	encoded: VideoKeyframeVideoEncoderResult,
	plan: VideoKeyframeExportPlanV7,
): ProductVideoExportEncodedOutput {
	assertResultIdentity(encoded, plan);
	if (!(encoded.bytes instanceof Uint8Array) || encoded.bytes.byteLength !== encoded.byteLength) {
		throw new Error('The Soundscaper keyed browser output byte length is inconsistent.');
	}
	return Object.freeze({
		bytes: encoded.bytes, byteLength: encoded.byteLength, videoEncoder: encoded.videoEncoder,
		...(encoded.codec === undefined ? {} : { codec: encoded.codec }),
		extension: encoded.extension, mimeType: encoded.mimeType,
	});
}

function sinkResult(
	encoded: VideoKeyframeVideoSinkEncoderResult<unknown>,
	plan: VideoKeyframeExportPlanV7,
): ProductVideoExportSinkOutput<unknown> {
	assertResultIdentity(encoded, plan);
	if (!Number.isSafeInteger(encoded.outputChunkCount) || encoded.outputChunkCount < 0) {
		throw new RangeError('The Soundscaper keyed direct output chunk count is invalid.');
	}
	return Object.freeze({
		output: encoded.output, byteLength: encoded.byteLength, chunkCount: encoded.outputChunkCount,
		videoEncoder: encoded.videoEncoder,
		...(encoded.codec === undefined ? {} : { codec: encoded.codec }),
		extension: encoded.extension, mimeType: encoded.mimeType,
	});
}

function assertResultIdentity(
	encoded: Readonly<{
		readonly byteLength: number; readonly format: string; readonly extension: string;
		readonly mimeType: string;
	}>,
	plan: VideoKeyframeExportPlanV7,
): void {
	if (!Number.isSafeInteger(encoded.byteLength) || encoded.byteLength < 0
		|| encoded.format !== plan.format || encoded.extension !== `.${plan.extension}`
		|| encoded.mimeType !== plan.mimeType) {
		throw new Error('The Soundscaper keyed encoder output does not match its detached plan.');
	}
}

function snapshotDependencies(value: unknown): SoundscaperVideoExportStrategyDependencies {
	const record = dataRecord(value, 'Soundscaper baseline video export dependencies');
	const encodeOffline = dataFunction(record, 'encodeOffline');
	const encodeOfflineToSink = dataFunction(record, 'encodeOfflineToSink');
	return Object.freeze({
		encodeOffline(request: VideoKeyframeOfflineVideoExportRequest) {
			return Promise.resolve(Reflect.apply(encodeOffline, value, [request]) as never);
		},
		encodeOfflineToSink(request: VideoKeyframeOfflineVideoExportRequest, sink: FfmpegOutputSink<unknown>) {
			return Promise.resolve(Reflect.apply(encodeOfflineToSink, value, [request, sink]) as never);
		},
	});
}

function ownDesktopFlag(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'isDesktop');
	return Boolean(descriptor?.enumerable && Object.hasOwn(descriptor, 'value') && descriptor.value === true);
}

function freezeExportProject(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
	const stack: object[] = [value]; const seen = new WeakSet<object>(); const order: object[] = [];
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (seen.has(current)) continue;
		if (order.length >= 2_000_000) throw new RangeError('Soundscaper baseline export projection exceeds its freeze budget.');
		seen.add(current); order.push(current);
		for (const key of Reflect.ownKeys(current)) {
			const descriptor = Object.getOwnPropertyDescriptor(current, key);
			if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError('Soundscaper baseline export projection must contain only data properties.');
			}
			if (descriptor.value && typeof descriptor.value === 'object') stack.push(descriptor.value as object);
		}
	}
	for (let index = order.length - 1; index >= 0; index -= 1) Object.freeze(order[index]);
	return value;
}

function assertSameData(left: unknown, right: unknown, name: string): void {
	const pending: Array<readonly [unknown, unknown]> = [[left, right]];
	const paired = new WeakMap<object, object>();
	let nodeCount = 0;
	while (pending.length > 0) {
		const [leftValue, rightValue] = pending.pop()!;
		if (Object.is(leftValue, rightValue)) continue;
		if (!leftValue || typeof leftValue !== 'object'
			|| !rightValue || typeof rightValue !== 'object') {
			throw new Error(`${name} diverges from its exact canonical project.`);
		}
		const leftObject = leftValue as object;
		const rightObject = rightValue as object;
		const prior = paired.get(leftObject);
		if (prior) {
			if (prior !== rightObject) throw new Error(`${name} has divergent object aliases.`);
			continue;
		}
		paired.set(leftObject, rightObject);
		nodeCount += 1;
		if (nodeCount > 2_000_000) throw new RangeError(`${name} exceeds its comparison budget.`);
		if (Array.isArray(leftObject) !== Array.isArray(rightObject)) {
			throw new Error(`${name} diverges from its exact canonical project.`);
		}
		const leftKeys = Reflect.ownKeys(leftObject);
		const rightKeys = Reflect.ownKeys(rightObject);
		if (leftKeys.length !== rightKeys.length
			|| leftKeys.some((key, index) => key !== rightKeys[index])) {
			throw new Error(`${name} diverges from its exact canonical project.`);
		}
		for (const key of leftKeys) {
			const leftDescriptor = Object.getOwnPropertyDescriptor(leftObject, key);
			const rightDescriptor = Object.getOwnPropertyDescriptor(rightObject, key);
			if (!leftDescriptor || !rightDescriptor
				|| !Object.hasOwn(leftDescriptor, 'value')
				|| !Object.hasOwn(rightDescriptor, 'value')
				|| leftDescriptor.enumerable !== rightDescriptor.enumerable) {
				throw new TypeError(`${name} must contain matching data properties.`);
			}
			pending.push([leftDescriptor.value, rightDescriptor.value]);
		}
	}
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	return value as Readonly<Record<string, unknown>>;
}

function dataProperty(value: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Soundscaper baseline video delivery.${key} must be an own data property.`);
	}
	return descriptor.value;
}

function emptyArray(value: unknown): boolean {
	return Array.isArray(value) && value.length === 0;
}

function dataFunction(value: object, key: 'encodeOffline' | 'encodeOfflineToSink') {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
		throw new TypeError(`Soundscaper baseline video export dependencies.${key} must be an own function.`);
	}
	return descriptor.value as (...arguments_: never[]) => unknown;
}
