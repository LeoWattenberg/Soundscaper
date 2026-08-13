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
import {
	assertFramescaperProjectV20Profile,
	type FramescaperProjectV20Profile,
} from './editor-project-v20-profile.ts';
import { framescaperProjectForPlaybackFoundationV20 } from './editor-project-v20-runtime.ts';
import type { FramescaperProjectV20 } from './editor-project-v20-validation.ts';
import {
	classifyFramescaperVideoExportDispatchV20,
	type FramescaperVideoExportRangeRequestV20,
} from './video-export-dispatch-v20.ts';
import {
	createFramescaperVideoKeyframeExportPlanV20,
} from './video-export-plan-v20.ts';

type OfflineSinkEncoder = (
	request: VideoKeyframeOfflineVideoExportRequest,
	sink: FfmpegOutputSink<unknown>,
) => Promise<VideoKeyframeVideoSinkEncoderResult<unknown>>;

export interface FramescaperVideoExportStrategyV20Dependencies {
	readonly encodeOffline: typeof encodeVideoKeyframeOfflineVideo;
	readonly encodeOfflineToSink: OfflineSinkEncoder;
}

interface PlanAuthority {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly exportProject: Readonly<Record<string, unknown>>;
}

const DEFAULT_DEPENDENCIES: FramescaperVideoExportStrategyV20Dependencies = Object.freeze({
	encodeOffline: encodeVideoKeyframeOfflineVideo,
	encodeOfflineToSink: encodeVideoKeyframeOfflineVideoToSink as OfflineSinkEncoder,
});

/** Own the dormant V20 choice while common code retains delivery/publication ownership. */
export function createFramescaperVideoExportStrategyV20(
	profile: FramescaperProjectV20Profile | unknown,
	dependenciesValue: FramescaperVideoExportStrategyV20Dependencies | unknown = DEFAULT_DEPENDENCIES,
): ProductVideoExportStrategy {
	assertFramescaperProjectV20Profile(profile);
	const dependencies = snapshotDependencies(dependenciesValue);
	const authorities = new WeakMap<object, PlanAuthority>();
	const exportAuthorities = new WeakMap<object, Readonly<Record<string, unknown>>>();
	return Object.freeze({
		createExportProject(request: ProductVideoExportProjectRequest) {
			const foundation = framescaperProjectForPlaybackFoundationV20(
				profile,
				request.canonicalProject as FramescaperProjectV20,
			);
			assertFallbackFreeDelivery(request.delivery);
			const exportProject = freezeExportProject(projectTrackFolderMediaStateV12(foundation));
			exportAuthorities.set(exportProject, request.canonicalProject);
			return exportProject;
		},
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			if (exportAuthorities.get(request.exportProject) !== request.canonicalProject) {
				throw new TypeError('The V20 export projection is not owned by its exact canonical project.');
			}
			const currentExportProject = projectTrackFolderMediaStateV12(
				framescaperProjectForPlaybackFoundationV20(
					profile,
					request.canonicalProject as FramescaperProjectV20,
				),
			);
			assertSameData(request.exportProject, currentExportProject, 'V20 export projection');
			const decision = classifyFramescaperVideoExportDispatchV20(
				profile,
				request.canonicalProject as FramescaperProjectV20,
				request.range as FramescaperVideoExportRangeRequestV20,
			);
			if (decision.strategy === 'legacy-v6') return null;
			const plan = createFramescaperVideoKeyframeExportPlanV20(
				profile,
				request.canonicalProject as FramescaperProjectV20,
				{
					format: request.format,
					range: request.range as FramescaperVideoExportRangeRequestV20,
					includeAudio: request.includeAudio,
					...(request.canvas === undefined ? {} : {
						canvas: request.canvas as Readonly<Record<string, unknown>>,
					}),
				},
			);
			authorities.set(plan, Object.freeze({
				canonicalProject: request.canonicalProject,
				exportProject: request.exportProject,
			}));
			return plan;
		},
		async encode(
			request: ProductVideoExportStrategyEncodeRequest,
		): Promise<ProductVideoExportEncodedOutput> {
			const plan = ownedPlan(request, authorities);
			const encoded = await dependencies.encodeOffline(offlineRequest(request, plan));
			return browserResult(encoded, plan);
		},
		async encodeToSink<Output>(
			request: ProductVideoExportStrategyEncodeRequest,
			sink: FfmpegOutputSink<Output>,
		): Promise<ProductVideoExportSinkOutput<Output>> {
			const plan = ownedPlan(request, authorities);
			const encoded = await dependencies.encodeOfflineToSink(
				offlineRequest(request, plan),
				sink as FfmpegOutputSink<unknown>,
			);
			return sinkResult(encoded, plan) as ProductVideoExportSinkOutput<Output>;
		},
	});
}

function ownedPlan(
	request: ProductVideoExportStrategyEncodeRequest,
	authorities: WeakMap<object, PlanAuthority>,
): VideoKeyframeExportPlanV7 {
	assertVideoKeyframeExportPlanV7(request.plan);
	const authority = authorities.get(request.plan);
	if (!authority
		|| authority.canonicalProject !== request.canonicalProject
		|| authority.exportProject !== request.exportProject) {
		throw new TypeError('The keyed export plan is not owned by this exact V20 project snapshot.');
	}
	return request.plan;
}

function assertFallbackFreeDelivery(
	delivery: ProductVideoExportProjectRequest['delivery'],
): void {
	if (dataProperty(delivery, 'audioRenderedFallback', 'V20 video export delivery') !== null
		|| dataProperty(delivery, 'videoRenderedFallback', 'V20 video export delivery') !== null
		|| !emptyArray(dataProperty(delivery, 'requiredAudioSourceIds', 'V20 video export delivery'))
		|| !emptyArray(dataProperty(delivery, 'requiredVideoSourceIds', 'V20 video export delivery'))) {
		throw new Error('Native V20 video export refuses a rendered-fallback delivery projection.');
	}
	dataRecord(dataProperty(delivery, 'project', 'V20 video export delivery'), 'V20 delivery project');
}

function emptyArray(value: unknown): boolean {
	return Array.isArray(value) && value.length === 0;
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function dataProperty(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own data property.`);
	}
	return descriptor.value;
}

function freezeExportProject(
	value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const stack: object[] = [value];
	const seen = new WeakSet<object>();
	const order: object[] = [];
	let nodeCount = 0;
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (seen.has(current)) continue;
		seen.add(current);
		order.push(current);
		nodeCount += 1;
		if (nodeCount > 2_000_000) throw new RangeError('The V20 export projection exceeds its freeze budget.');
		for (const key of Reflect.ownKeys(current)) {
			const descriptor = Object.getOwnPropertyDescriptor(current, key);
			if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError('The V20 export projection must contain only data properties.');
			}
			const child = descriptor.value;
			if (child && typeof child === 'object') stack.push(child as object);
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
			throw new Error(`${name} diverges from its exact canonical V20 project.`);
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
			throw new Error(`${name} diverges from its exact canonical V20 project.`);
		}
		const leftKeys = Reflect.ownKeys(leftObject);
		const rightKeys = Reflect.ownKeys(rightObject);
		if (leftKeys.length !== rightKeys.length
			|| leftKeys.some((key, index) => key !== rightKeys[index])) {
			throw new Error(`${name} diverges from its exact canonical V20 project.`);
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

function offlineRequest(
	request: ProductVideoExportStrategyEncodeRequest,
	plan: VideoKeyframeExportPlanV7,
): VideoKeyframeOfflineVideoExportRequest {
	const sources = exactSources(plan, request.videoBlobs);
	const includesAudio = plan.inputs.some((input) => input.kind === 'staged-audio-mix');
	if (includesAudio !== (request.audioMix instanceof Blob)) {
		throw new TypeError('The keyed export audio mix must exactly match its detached plan.');
	}
	return Object.freeze({
		project: request.exportProject,
		timingBySourceId: request.timingBySourceId,
		sources,
		canvas: Object.freeze({
			width: plan.canvas.width,
			height: plan.canvas.height,
			frameRate: plan.canvas.frameRate,
		}),
		startFrame: plan.range.startFrame,
		endFrame: plan.range.endFrame,
		format: plan.format,
		editorFfmpeg: request.editorFfmpeg as VideoKeyframeOfflineVideoExportRequest['editorFfmpeg'],
		...(request.audioMix instanceof Blob ? { audioMix: request.audioMix } : {}),
		...(request.maximumOutputBytes === undefined ? {} : {
			maximumOutputBytes: request.maximumOutputBytes as number,
		}),
		signal: request.signal,
		assertCurrent: request.assertCurrent,
	});
}

function exactSources(
	plan: VideoKeyframeExportPlanV7,
	videoBlobs: ReadonlyMap<string, Blob>,
): readonly Readonly<{ sourceId: string; blob: Blob }>[] {
	if (!(videoBlobs instanceof Map) || videoBlobs.size !== plan.activeSourceIds.length) {
		throw new TypeError('The keyed export video Blob set must exactly match its active source IDs.');
	}
	return Object.freeze(plan.activeSourceIds.map((sourceId) => {
		const blob = videoBlobs.get(sourceId);
		if (!(blob instanceof Blob)) {
			throw new TypeError(`The keyed export active source ${sourceId} has no authenticated video Blob.`);
		}
		return Object.freeze({ sourceId, blob });
	}));
}

function browserResult(
	encoded: VideoKeyframeVideoEncoderResult,
	plan: VideoKeyframeExportPlanV7,
): ProductVideoExportEncodedOutput {
	assertResultIdentity(encoded, plan);
	if (!(encoded.bytes instanceof Uint8Array) || encoded.bytes.byteLength !== encoded.byteLength) {
		throw new Error('The keyed browser output byte length is inconsistent.');
	}
	return Object.freeze({
		bytes: encoded.bytes,
		byteLength: encoded.byteLength,
		extension: encoded.extension,
		mimeType: encoded.mimeType,
	});
}

function sinkResult(
	encoded: VideoKeyframeVideoSinkEncoderResult<unknown>,
	plan: VideoKeyframeExportPlanV7,
): ProductVideoExportSinkOutput<unknown> {
	assertResultIdentity(encoded, plan);
	if (!Number.isSafeInteger(encoded.outputChunkCount) || encoded.outputChunkCount < 0) {
		throw new RangeError('The keyed direct output chunk count is invalid.');
	}
	return Object.freeze({
		output: encoded.output,
		byteLength: encoded.byteLength,
		chunkCount: encoded.outputChunkCount,
		extension: encoded.extension,
		mimeType: encoded.mimeType,
	});
}

function assertResultIdentity(
	encoded: Readonly<{
		readonly byteLength: number;
		readonly format: string;
		readonly extension: string;
		readonly mimeType: string;
	}>,
	plan: VideoKeyframeExportPlanV7,
): void {
	if (!Number.isSafeInteger(encoded.byteLength) || encoded.byteLength < 0
		|| encoded.format !== plan.format
		|| encoded.extension !== `.${plan.extension}`
		|| encoded.mimeType !== plan.mimeType) {
		throw new Error('The keyed encoder output does not match its detached export plan.');
	}
}

function snapshotDependencies(value: unknown): FramescaperVideoExportStrategyV20Dependencies {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper V20 video export dependencies must be an object.');
	}
	const encodeOffline = dataFunction(value, 'encodeOffline');
	const encodeOfflineToSink = dataFunction(value, 'encodeOfflineToSink');
	return Object.freeze({
		encodeOffline(request: VideoKeyframeOfflineVideoExportRequest) {
			return Promise.resolve(Reflect.apply(encodeOffline, value, [request]) as (
				PromiseLike<VideoKeyframeVideoEncoderResult> | VideoKeyframeVideoEncoderResult
			));
		},
		encodeOfflineToSink(
			request: VideoKeyframeOfflineVideoExportRequest,
			sink: FfmpegOutputSink<unknown>,
		) {
			return Promise.resolve(Reflect.apply(encodeOfflineToSink, value, [request, sink]) as (
				PromiseLike<VideoKeyframeVideoSinkEncoderResult<unknown>>
				| VideoKeyframeVideoSinkEncoderResult<unknown>
			));
		},
	});
}

function dataFunction(
	value: object,
	key: 'encodeOffline' | 'encodeOfflineToSink',
): (...arguments_: never[]) => unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
		|| typeof descriptor.value !== 'function') {
		throw new TypeError(`Framescaper V20 video export dependencies.${key} must be an own function.`);
	}
	return descriptor.value as (...arguments_: never[]) => unknown;
}
