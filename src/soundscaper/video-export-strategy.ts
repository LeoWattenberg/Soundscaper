/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../common/editor/ffmpeg-output-stream.ts';
import {
	createVideoExportOfflineRequest,
	projectVideoExportBrowserResult,
	projectVideoExportSinkResult,
	type VideoExportEncodeErrorText,
} from '../common/editor/video-export-strategy-encode-core.ts';
import { createExportRenderProject } from '../common/editor/controller/export/export-render-project.ts';
import { assertMatchingExportDataGraph } from '../common/editor/project-export-data-graph.ts';
import { projectTrackFolderMediaStateV12 } from '../common/editor/track-folder-media-runtime.ts';
import type {
	ProductVideoExportSinkOutput,
	ProductVideoExportStrategy,
	ProductVideoExportStrategyEncodeRequest,
	ProductVideoExportStrategyPlanRequest,
	ProductVideoExportProjectRequest,
} from '../common/editor/controller/export/product-video-export-strategy.ts';
import type { ControllerProjectRuntime } from '../common/editor/controller/document/project-runtime.ts';
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
			const exportProject = freezeExportProject(createExportRenderProject(deliveryProject));
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
			assertMatchingExportDataGraph(
				authority.canonicalProjection,
				createDetachedExportProject(runtime, request.canonicalProject),
				'Soundscaper baseline canonical snapshot',
				'canonical project',
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
			return projectVideoExportBrowserResult(await dependencies.encodeOffline(offlineRequest(request, plan)), plan, EXPORT_ERRORS);
		},
		async encodeToSink<Output>(
			request: ProductVideoExportStrategyEncodeRequest,
			sink: FfmpegOutputSink<Output>,
		): Promise<ProductVideoExportSinkOutput<Output>> {
			const plan = ownedPlan(request, planAuthorities);
			const result = await dependencies.encodeOfflineToSink(
				offlineRequest(request, plan), sink as FfmpegOutputSink<unknown>,
			);
			return projectVideoExportSinkResult(result, plan, EXPORT_ERRORS) as ProductVideoExportSinkOutput<Output>;
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
	// What this refuses is a rendered compatibility fallback, which the two metadata
	// records state on their own. The required source roots do not: a fresh track
	// freeze publishes the derived source its substitution renders from as a root
	// with no fallback metadata, and refusing that refused exporting any project
	// with a frozen track.
	if (dataProperty(delivery, 'audioRenderedFallback') !== null
		|| dataProperty(delivery, 'videoRenderedFallback') !== null) {
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

const EXPORT_ERRORS: VideoExportEncodeErrorText = Object.freeze({
	sourceSet: 'The Soundscaper keyed export Blob set must exactly match active source IDs.',
	sourceMissing: (sourceId: string) => `Active source ${sourceId} has no authenticated video Blob.`,
	audioMix: 'The Soundscaper keyed export audio mix must exactly match its plan.',
	identity: 'The Soundscaper keyed encoder output does not match its detached plan.',
	bytes: 'The Soundscaper keyed browser output byte length is inconsistent.',
	chunks: 'The Soundscaper keyed direct output chunk count is invalid.',
});

function offlineRequest(
	request: ProductVideoExportStrategyEncodeRequest,
	plan: VideoKeyframeExportPlanV7,
): VideoKeyframeOfflineVideoExportRequest {
	const backend = request.webCodecs
		? { webCodecs: request.webCodecs }
		: { editorFfmpeg: request.editorFfmpeg as VideoKeyframeOfflineVideoExportRequest['editorFfmpeg'] };
	return createVideoExportOfflineRequest(request, plan, backend, EXPORT_ERRORS);
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

function dataFunction(value: object, key: 'encodeOffline' | 'encodeOfflineToSink') {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
		throw new TypeError(`Soundscaper baseline video export dependencies.${key} must be an own function.`);
	}
	return descriptor.value as (...arguments_: never[]) => unknown;
}
