/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../common/editor/ffmpeg-output-stream.ts';
import {
	createVideoExportOfflineRequest,
	projectVideoExportBrowserResult,
	projectVideoExportSinkResult,
	type VideoExportEncodeErrorText,
} from '../common/editor/video-export-strategy-encode-core.ts';
import { assertMatchingExportDataGraph } from '../common/editor/project-export-data-graph.ts';
import { projectTrackFolderMediaStateV12 } from '../common/editor/track-folder-media-runtime.ts';
import type {
	ProductVideoExportEncodedOutput,
	ProductVideoExportSinkOutput,
	ProductVideoExportStrategy,
	ProductVideoExportStrategyEncodeRequest,
	ProductVideoExportStrategyPlanRequest,
	ProductVideoExportProjectRequest,
} from '../common/editor/controller/export/product-video-export-strategy.ts';
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
	assertFramescaperProjectRetimeProfile,
	type FramescaperProjectRetimeProfile,
} from './editor-domain-runtime-profile.ts';
import { framescaperProjectForPlaybackFoundationRetime } from './editor-project-retime-runtime.ts';
import type { FramescaperProjectRetime } from './editor-project-retime-validation.ts';
import {
	classifyFramescaperVideoExportDispatchRetime,
	type FramescaperVideoExportRangeRequestRetime,
} from './video-export-dispatch-retime.ts';
import {
	createFramescaperVideoKeyframeExportPlanRetime,
} from './video-export-plan-retime.ts';

type OfflineSinkEncoder = (
	request: VideoKeyframeOfflineVideoExportRequest,
	sink: FfmpegOutputSink<unknown>,
) => Promise<VideoKeyframeVideoSinkEncoderResult<unknown>>;

export interface FramescaperVideoExportStrategyRetimeDependencies {
	readonly encodeOffline: typeof encodeVideoKeyframeOfflineVideo;
	readonly encodeOfflineToSink: OfflineSinkEncoder;
}

export interface FramescaperVideoExportStrategyRetimeOptions {
	/** Selected finishing uses the exact RGBA path even when retime authored no keyframes. */
	readonly forceKeyed?: boolean;
}

interface PlanAuthority {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly exportProject: Readonly<Record<string, unknown>>;
}

const DEFAULT_DEPENDENCIES: FramescaperVideoExportStrategyRetimeDependencies = Object.freeze({
	encodeOffline: encodeVideoKeyframeOfflineVideo,
	encodeOfflineToSink: encodeVideoKeyframeOfflineVideoToSink as OfflineSinkEncoder,
});

/** Own the selected retime choice while common code retains delivery/publication ownership. */
export function createFramescaperVideoExportStrategyRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	dependenciesValue: FramescaperVideoExportStrategyRetimeDependencies | unknown = DEFAULT_DEPENDENCIES,
	options: FramescaperVideoExportStrategyRetimeOptions = {},
): ProductVideoExportStrategy {
	assertFramescaperProjectRetimeProfile(profile);
	const dependencies = snapshotDependencies(dependenciesValue);
	const forceKeyed = options.forceKeyed === true;
	const authorities = new WeakMap<object, PlanAuthority>();
	const exportAuthorities = new WeakMap<object, Readonly<Record<string, unknown>>>();
	return Object.freeze({
		createExportProject(request: ProductVideoExportProjectRequest) {
			const foundation = framescaperProjectForPlaybackFoundationRetime(
				profile,
				request.canonicalProject as FramescaperProjectRetime,
			);
			assertFallbackFreeDelivery(request.delivery);
			const exportProject = freezeExportProject(projectTrackFolderMediaStateV12(foundation));
			exportAuthorities.set(exportProject, request.canonicalProject);
			return exportProject;
		},
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			if (exportAuthorities.get(request.exportProject) !== request.canonicalProject) {
				throw new TypeError('The retime export projection is not owned by its exact canonical project.');
			}
			const currentExportProject = projectTrackFolderMediaStateV12(
				framescaperProjectForPlaybackFoundationRetime(
					profile,
					request.canonicalProject as FramescaperProjectRetime,
				),
			);
			assertMatchingExportDataGraph(request.exportProject, currentExportProject,
				'retime export projection', 'canonical retime project');
			const decision = classifyFramescaperVideoExportDispatchRetime(
				profile,
				request.canonicalProject as FramescaperProjectRetime,
				request.range as FramescaperVideoExportRangeRequestRetime,
			);
			if (decision.strategy === 'legacy-v6' && !forceKeyed) return null;
			const plan = createFramescaperVideoKeyframeExportPlanRetime(
				profile,
				request.canonicalProject as FramescaperProjectRetime,
				{
					format: request.format,
					range: request.range as FramescaperVideoExportRangeRequestRetime,
					includeAudio: request.includeAudio,
					...(request.canvas === undefined ? {} : {
						canvas: request.canvas as Readonly<Record<string, unknown>>,
					}),
					...(request.quality === undefined ? {} : { quality: request.quality }),
					...(request.audioLayout === undefined ? {} : { audioLayout: request.audioLayout }),
					// Forwarded so the plan builder can answer for it. Leaving it out
					// here is what made a caption request vanish without a word.
					...(request.captions === undefined ? {} : { captions: request.captions }),
				},
				{ allowNeutralExact: forceKeyed },
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
			return projectVideoExportBrowserResult(encoded, plan, EXPORT_ERRORS);
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
			return projectVideoExportSinkResult(encoded, plan, EXPORT_ERRORS) as ProductVideoExportSinkOutput<Output>;
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
		throw new TypeError('The keyed export plan is not owned by this exact retime project snapshot.');
	}
	return request.plan;
}

function assertFallbackFreeDelivery(
	delivery: ProductVideoExportProjectRequest['delivery'],
): void {
	if (dataProperty(delivery, 'audioRenderedFallback', 'retime video export delivery') !== null
		|| dataProperty(delivery, 'videoRenderedFallback', 'retime video export delivery') !== null
		|| !emptyArray(dataProperty(delivery, 'requiredAudioSourceIds', 'retime video export delivery'))
		|| !emptyArray(dataProperty(delivery, 'requiredVideoSourceIds', 'retime video export delivery'))) {
		throw new Error('Native retime video export refuses a rendered-fallback delivery projection.');
	}
	dataRecord(dataProperty(delivery, 'project', 'retime video export delivery'), 'retime delivery project');
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
		if (nodeCount > 2_000_000) throw new RangeError('The retime export projection exceeds its freeze budget.');
		for (const key of Reflect.ownKeys(current)) {
			const descriptor = Object.getOwnPropertyDescriptor(current, key);
			if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError('The retime export projection must contain only data properties.');
			}
			const child = descriptor.value;
			if (child && typeof child === 'object') stack.push(child as object);
		}
	}
	for (let index = order.length - 1; index >= 0; index -= 1) Object.freeze(order[index]);
	return value;
}

const EXPORT_ERRORS: VideoExportEncodeErrorText = Object.freeze({
	sourceSet: 'The keyed export video Blob set must exactly match its active source IDs.',
	sourceMissing: (sourceId: string) => `The keyed export active source ${sourceId} has no authenticated video Blob.`,
	audioMix: 'The keyed export audio mix must exactly match its detached plan.',
	identity: 'The keyed encoder output does not match its detached export plan.',
	bytes: 'The keyed browser output byte length is inconsistent.',
	chunks: 'The keyed direct output chunk count is invalid.',
});

function offlineRequest(
	request: ProductVideoExportStrategyEncodeRequest,
	plan: VideoKeyframeExportPlanV7,
): VideoKeyframeOfflineVideoExportRequest {
	return createVideoExportOfflineRequest(request, plan, {
		...(request.webCodecs ? { webCodecs: request.webCodecs } : {}),
		editorFfmpeg: request.editorFfmpeg as VideoKeyframeOfflineVideoExportRequest['editorFfmpeg'],
	}, EXPORT_ERRORS);
}

function snapshotDependencies(value: unknown): FramescaperVideoExportStrategyRetimeDependencies {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper retime video export dependencies must be an object.');
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
		throw new TypeError(`Framescaper retime video export dependencies.${key} must be an own function.`);
	}
	return descriptor.value as (...arguments_: never[]) => unknown;
}
