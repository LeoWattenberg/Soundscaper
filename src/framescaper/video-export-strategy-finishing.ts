/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../common/editor/ffmpeg-output-stream.ts';
import { assertManagedVideoColorRenderAdmissionV1 } from '../common/editor/video-color-management-v27.ts';
import {
	createVideoExactPictureExportFrameSource,
	type VideoKeyframeExportFrame,
} from '../common/editor/video-keyframe-export-frame-source.ts';
import {
	encodeVideoKeyframeVideo,
	encodeVideoKeyframeVideoToSink,
	type VideoKeyframeVideoEncoderRequest,
	type VideoKeyframeVideoEncoderResult,
	type VideoKeyframeVideoSinkEncoderResult,
} from '../common/editor/video-keyframe-video-encoder.ts';
import {
	createVideoKeyframeOfflineEncoderRequest,
	preflightVideoKeyframeOfflineEncoder,
	type VideoKeyframeOfflineEncoderOptions,
} from '../common/editor/ui/video-keyframe-offline-video-export-encoder.ts';
import type { VideoKeyframeOfflineRgbaRenderer } from '../common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
import { createVisibleVideoTrackPredicate } from '../common/editor/video-track-visibility.js';
import type {
	ProductVideoExportEncodedOutput,
	ProductVideoExportPlan,
	ProductVideoExportSinkOutput,
	ProductVideoExportStrategy,
	ProductVideoExportStrategyEncodeRequest,
	ProductVideoExportStrategyPlanRequest,
	ProductVideoExportProjectRequest,
} from '../common/editor/controller/product-video-export-strategy.ts';
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import {
	assertVideoKeyframeExportPlanV7,
} from '../common/editor/video-keyframe-export-plan-v7.ts';
import { framescaperProjectRetimeFoundationFinishing } from './editor-project-finishing-runtime.ts';
import { assertFramescaperProjectFinishingProfile } from './editor-domain-runtime-profile.ts';
import {
	validateFramescaperProjectFinishing,
	type FramescaperProjectFinishing,
} from './editor-project-finishing.ts';
import { FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	createFramescaperVideoExportStrategyRetime,
	type FramescaperVideoExportStrategyRetimeDependencies,
} from './video-export-strategy-retime.ts';
import {
	type FramescaperVideoExportPictureDispositionFinishing,
	type FramescaperVideoExportVisualAssetStoreFinishing,
} from './video-export-visual-execution-finishing.ts';
import {
	createFramescaperVideoExportExactExecutionFinishing,
	type CreateFramescaperOpenFxExactExecutionNativeMedia,
	type CreateFramescaperVideoExportSupplementalPictureExecutionFinishing,
	type FramescaperVideoExportExactExecutionFinishing,
} from './video-export-exact-execution-finishing.ts';
import {
	createFramescaperVideoVisualPlanFinishing,
	isFramescaperVideoVisualPlanFinishing,
	type FramescaperVideoVisualPlanFinishing,
} from './video-export-visual-plan-finishing.ts';
import type { CaptureFrameFinishing } from './selected-finishing-exact-frame-execution.ts';
import {
	framescaperPictureBrowserResultFinishing,
	framescaperPictureSinkResultFinishing,
} from './video-export-picture-results-finishing.ts';

interface ExportAuthorityFinishing {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly retimeProject: Readonly<Record<string, unknown>>;
	readonly retimeExportProject: Readonly<Record<string, unknown>>;
}

type PictureSinkEncoderFinishing = <Output>(
	editorFfmpeg: unknown,
	request: VideoKeyframeVideoEncoderRequest,
	sink: FfmpegOutputSink<Output>,
) => Promise<VideoKeyframeVideoSinkEncoderResult<Output>>;

interface PictureEncodersFinishing {
	readonly encodePicture: (
		editorFfmpeg: unknown, request: VideoKeyframeVideoEncoderRequest,
	) => Promise<VideoKeyframeVideoEncoderResult>;
	readonly encodePictureToSink: PictureSinkEncoderFinishing;
}

export interface FramescaperVideoExportStrategyFinishingDependencies
	extends FramescaperVideoExportStrategyRetimeDependencies {
	readonly encodePicture?: typeof encodeVideoKeyframeVideo;
	readonly encodePictureToSink?: PictureSinkEncoderFinishing;
	readonly captureExactFrame?: CaptureFrameFinishing;
	readonly createExactAcceleratorCanvas?: () => unknown;
}

interface ExactExecutionDependenciesFinishing {
	readonly captureFrame?: CaptureFrameFinishing;
	readonly createAcceleratorCanvas?: () => unknown;
	readonly createOpenFxExecution?: CreateFramescaperOpenFxExactExecutionNativeMedia;
	readonly createSupplementalPictureExecution?: CreateFramescaperVideoExportSupplementalPictureExecutionFinishing;
}

const DEFAULT_PICTURE_ENCODERS = Object.freeze({
	encodePicture: encodeVideoKeyframeVideo,
	encodePictureToSink: encodeVideoKeyframeVideoToSink as PictureSinkEncoderFinishing,
});

const DISPOSITIONS = new WeakMap<object, FramescaperVideoExportPictureDispositionFinishing>();

/** Read the exact post-encode node ledger retained for acceptance and reports. */
export function framescaperVideoExportDispositionFinishingFor(
	plan: ProductVideoExportPlan,
): FramescaperVideoExportPictureDispositionFinishing {
	const result = DISPOSITIONS.get(plan);
	if (!result) throw new ReferenceError('The finishing picture export plan has no completed disposition.');
	return result;
}

/**
 * Authenticate finishing, then delegate only the state the maintained retime browser
 * encoder represents exactly. Selected V13 finishing is never silently lost.
 */
export function createFramescaperVideoExportStrategyFinishing(
	profile: unknown,
	dependencies?: FramescaperVideoExportStrategyFinishingDependencies,
	assetStore?: FramescaperVideoExportVisualAssetStoreFinishing,
	createOpenFxExecution?: CreateFramescaperOpenFxExactExecutionNativeMedia,
	createSupplementalPictureExecution?: CreateFramescaperVideoExportSupplementalPictureExecutionFinishing,
): ProductVideoExportStrategy {
	assertFramescaperProjectFinishingProfile(profile);
	const pictureEncoders = snapshotPictureEncoders(dependencies);
	const exactDependencies = snapshotExactExecutionDependencies(
		dependencies, createOpenFxExecution, createSupplementalPictureExecution,
	);
	const delegate = createFramescaperVideoExportStrategyRetime(
		FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE, dependencies,
		{ forceKeyed: true },
	);
	const exports = new WeakMap<object, ExportAuthorityFinishing>();
	const plans = new WeakMap<object, ExportAuthorityFinishing>();
	const timingSources = new WeakMap<object, readonly string[]>();
	return Object.freeze({
		createExportProject(request: ProductVideoExportProjectRequest) {
			const retimeProject = executableFoundation(profile, request.canonicalProject);
			const retimeExportProject = delegate.createExportProject({
				canonicalProject: retimeProject,
				delivery: request.delivery,
			});
			const exportProject = dataRecord(
				request.delivery.project, 'Selected finishing browser delivery project',
			);
			exports.set(exportProject, Object.freeze({
				canonicalProject: request.canonicalProject,
				retimeProject,
				retimeExportProject,
			}));
			return exportProject;
		},
		hasPicture(exportProject: Readonly<Record<string, unknown>>) {
			const authority = exports.get(exportProject);
			if (!authority) throw new TypeError('Selected finishing picture authority requires an owned export project.');
			return hasVisibleVisualPicture(authority.canonicalProject);
		},
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			const authority = currentAuthority(profile, request, exports);
			if (request.captions != null) {
				throw new RangeError('Selected finishing caption delivery is sidecar-only through Caption Tracks; video export mux and burn-in are unavailable.');
			}
			const plan = hasVisibleVideoPicture(authority.canonicalProject)
				? delegate.createPlan({
					...request,
					canonicalProject: authority.retimeProject,
					exportProject: authority.retimeExportProject,
					// finishing captions are accounted and delivered as explicit sidecars;
					// they are not a keyed picture mux/burn request for the retime core.
					captions: undefined,
				})
				: createFramescaperVideoVisualPlanFinishing(
					authority.canonicalProject as unknown as FramescaperProjectFinishing, request,
				);
			if (!plan) throw new Error('Selected finishing browser export requires an exact RGBA route.');
			plans.set(plan, authority);
			timingSources.set(plan, allVideoSourceIds(authority.canonicalProject));
			return plan;
		},
		async encode(
			request: ProductVideoExportStrategyEncodeRequest,
		): Promise<ProductVideoExportEncodedOutput> {
			const authority = ownedPlanAuthority(profile, request, exports, plans);
			if (isFramescaperVideoVisualPlanFinishing(request.plan)) {
				return encodeVisualPicture(
					profile, authority, request, assetStore, pictureEncoders, exactDependencies,
				);
			}
			return encodeKeyedPicture(
				profile, authority, request, assetStore, delegate, exactDependencies,
			);
		},
		async encodeToSink<Output>(
			request: ProductVideoExportStrategyEncodeRequest,
			sink: FfmpegOutputSink<Output>,
		): Promise<ProductVideoExportSinkOutput<Output>> {
			const authority = ownedPlanAuthority(profile, request, exports, plans);
			if (isFramescaperVideoVisualPlanFinishing(request.plan)) {
				return encodeVisualPictureToSink(
					profile, authority, request, assetStore, pictureEncoders, sink, exactDependencies,
				);
			}
			return encodeKeyedPictureToSink(
				profile, authority, request, assetStore, delegate, sink, exactDependencies,
			);
		},
		captureTimingSourceIds(plan: ProductVideoExportPlan) {
			const sourceIds = timingSources.get(plan);
			if (!sourceIds) throw new TypeError('Selected finishing timing closure requires an owned export plan.');
			return sourceIds;
		},
	});
}

async function createKeyedExecution(
	profile: unknown,
	authority: ExportAuthorityFinishing,
	request: ProductVideoExportStrategyEncodeRequest,
	assetStore: FramescaperVideoExportVisualAssetStoreFinishing | undefined,
	exactDependencies: ExactExecutionDependenciesFinishing,
): Promise<FramescaperVideoExportExactExecutionFinishing> {
	assertVideoKeyframeExportPlanV7(request.plan);
	return createFramescaperVideoExportExactExecutionFinishing({
		profile, project: authority.canonicalProject as unknown as FramescaperProjectFinishing,
		request, ...(assetStore ? { store: assetStore } : {}),
		...exactDependencies,
	});
}

async function encodeKeyedPicture(
	profile: unknown,
	authority: ExportAuthorityFinishing,
	request: ProductVideoExportStrategyEncodeRequest,
	assetStore: FramescaperVideoExportVisualAssetStoreFinishing | undefined,
	delegate: ProductVideoExportStrategy,
	exactDependencies: ExactExecutionDependenciesFinishing,
): Promise<ProductVideoExportEncodedOutput> {
	const execution = await createKeyedExecution(
		profile, authority, request, assetStore, exactDependencies,
	);
	try {
		const result = await delegate.encode({
			...request, canonicalProject: authority.retimeProject,
			exportProject: authority.retimeExportProject, rgbaCompositor: execution.compositor,
		});
		DISPOSITIONS.set(request.plan, execution.disposition());
		return result;
	} finally { await execution.dispose(); }
}

async function encodeKeyedPictureToSink<Output>(
	profile: unknown,
	authority: ExportAuthorityFinishing,
	request: ProductVideoExportStrategyEncodeRequest,
	assetStore: FramescaperVideoExportVisualAssetStoreFinishing | undefined,
	delegate: ProductVideoExportStrategy,
	sink: FfmpegOutputSink<Output>,
	exactDependencies: ExactExecutionDependenciesFinishing,
): Promise<ProductVideoExportSinkOutput<Output>> {
	const execution = await createKeyedExecution(
		profile, authority, request, assetStore, exactDependencies,
	);
	try {
		const result = await delegate.encodeToSink({
			...request, canonicalProject: authority.retimeProject,
			exportProject: authority.retimeExportProject, rgbaCompositor: execution.compositor,
		}, sink);
		DISPOSITIONS.set(request.plan, execution.disposition());
		return result;
	} finally { await execution.dispose(); }
}

async function createVisualExecution(
	profile: unknown,
	authority: ExportAuthorityFinishing,
	request: ProductVideoExportStrategyEncodeRequest,
	assetStore: FramescaperVideoExportVisualAssetStoreFinishing | undefined,
	exactDependencies: ExactExecutionDependenciesFinishing,
) {
	if (!isFramescaperVideoVisualPlanFinishing(request.plan)) {
		throw new TypeError('Selected finishing picture-only execution requires its exact V13 output plan.');
	}
	const visualPlan = request.plan;
	if (!(request.videoBlobs instanceof Map) || request.videoBlobs.size !== 0) {
		throw new TypeError('Selected finishing picture-only execution refuses unplanned video inputs.');
	}
	const includesAudio = request.plan.inputs.some(({ kind }) => kind === 'staged-audio-mix');
	if (includesAudio !== (request.audioMix instanceof Blob)) {
		throw new TypeError('Selected finishing picture-only audio must exactly match its detached plan.');
	}
	const exact = await createFramescaperVideoExportExactExecutionFinishing({
		profile, project: authority.canonicalProject as unknown as FramescaperProjectFinishing,
		request, ...(assetStore === undefined ? {} : { store: assetStore }),
		...exactDependencies,
	});
	const frameSource = createVideoExactPictureExportFrameSource({
		sampleRate: request.plan.sampleRate,
		startFrame: request.plan.range.startFrame,
		endFrame: request.plan.range.endFrame,
		canvas: {
			width: request.plan.canvas.width, height: request.plan.canvas.height,
			frameRate: request.plan.canvas.frameRate, fit: request.plan.canvas.fit,
			backgroundColor: request.plan.canvas.backgroundColor,
		},
	});
	const renderer: VideoKeyframeOfflineRgbaRenderer = Object.freeze({
		width: visualPlan.canvas.width, height: visualPlan.canvas.height,
		byteLength: visualPlan.canvas.width * visualPlan.canvas.height * 4,
		async produce(frame: VideoKeyframeExportFrame, target: Uint8Array,
			options: Readonly<{ readonly signal: AbortSignal }>) {
			await exact.compositor({
				frame, layers: [], width: visualPlan.canvas.width, height: visualPlan.canvas.height,
				rgba: target as Uint8Array<ArrayBuffer>, signal: options.signal,
			});
		},
		async dispose() { await exact.dispose(); },
	});
	const encoderOptions: Readonly<Record<string, number>> = request.maximumOutputBytes === undefined
		? Object.freeze({}) : Object.freeze({ maximumOutputBytes: request.maximumOutputBytes as number });
	const options: VideoKeyframeOfflineEncoderOptions = Object.freeze({
		format: request.plan.format,
		quality: request.plan.quality,
		...(request.webCodecs ? { webCodecs: request.webCodecs } : {}),
		...(request.audioMix instanceof Blob ? { audioMix: request.audioMix } : {}),
		encoderOptions,
		signal: request.signal, assertCurrent: request.assertCurrent,
	});
	await preflightVideoKeyframeOfflineEncoder(options, frameSource);
	return Object.freeze({ exact, encoderRequest: createVideoKeyframeOfflineEncoderRequest(
		options, frameSource, renderer,
	) });
}

async function encodeVisualPicture(
	profile: unknown,
	authority: ExportAuthorityFinishing,
	request: ProductVideoExportStrategyEncodeRequest,
	assetStore: FramescaperVideoExportVisualAssetStoreFinishing | undefined,
	encoders: PictureEncodersFinishing,
	exactDependencies: ExactExecutionDependenciesFinishing,
): Promise<ProductVideoExportEncodedOutput> {
	const execution = await createVisualExecution(profile, authority, request, assetStore, exactDependencies);
	try {
		const encoded = await encoders.encodePicture(request.editorFfmpeg, execution.encoderRequest);
		const result = framescaperPictureBrowserResultFinishing(
			encoded, request.plan as FramescaperVideoVisualPlanFinishing,
		);
		DISPOSITIONS.set(request.plan, execution.exact.disposition());
		return result;
	} finally { await execution.exact.dispose(); }
}

async function encodeVisualPictureToSink<Output>(
	profile: unknown,
	authority: ExportAuthorityFinishing,
	request: ProductVideoExportStrategyEncodeRequest,
	assetStore: FramescaperVideoExportVisualAssetStoreFinishing | undefined,
	encoders: PictureEncodersFinishing,
	sink: FfmpegOutputSink<Output>,
	exactDependencies: ExactExecutionDependenciesFinishing,
): Promise<ProductVideoExportSinkOutput<Output>> {
	const execution = await createVisualExecution(profile, authority, request, assetStore, exactDependencies);
	try {
		const encoded = await encoders.encodePictureToSink(
			request.editorFfmpeg, execution.encoderRequest, sink,
		);
		const result = framescaperPictureSinkResultFinishing(
			encoded, request.plan as FramescaperVideoVisualPlanFinishing,
		);
		DISPOSITIONS.set(request.plan, execution.exact.disposition());
		return result;
	} finally { await execution.exact.dispose(); }
}

function snapshotPictureEncoders(
	value: FramescaperVideoExportStrategyFinishingDependencies | undefined,
): PictureEncodersFinishing {
	const owner: object = value ?? DEFAULT_PICTURE_ENCODERS;
	const encodePicture = optionalPictureFunction(owner, 'encodePicture')
		?? DEFAULT_PICTURE_ENCODERS.encodePicture;
	const encodePictureToSink = optionalPictureFunction(owner, 'encodePictureToSink')
		?? DEFAULT_PICTURE_ENCODERS.encodePictureToSink;
	return Object.freeze({
		encodePicture(editorFfmpeg: unknown, request: VideoKeyframeVideoEncoderRequest) {
			return Promise.resolve(Reflect.apply(encodePicture, owner, [editorFfmpeg, request]) as (
				PromiseLike<VideoKeyframeVideoEncoderResult> | VideoKeyframeVideoEncoderResult
			));
		},
		encodePictureToSink<Output>(
			editorFfmpeg: unknown,
			request: VideoKeyframeVideoEncoderRequest,
			sink: FfmpegOutputSink<Output>,
		) {
			return Promise.resolve(Reflect.apply(encodePictureToSink, owner, [editorFfmpeg, request, sink]) as (
				PromiseLike<VideoKeyframeVideoSinkEncoderResult<Output>>
				| VideoKeyframeVideoSinkEncoderResult<Output>
			));
		},
	});
}

function snapshotExactExecutionDependencies(
	value: FramescaperVideoExportStrategyFinishingDependencies | undefined,
	createOpenFxExecution?: CreateFramescaperOpenFxExactExecutionNativeMedia,
	createSupplementalPictureExecution?: CreateFramescaperVideoExportSupplementalPictureExecutionFinishing,
): ExactExecutionDependenciesFinishing {
	if (!value) return Object.freeze({
		...(createOpenFxExecution ? { createOpenFxExecution } : {}),
		...(createSupplementalPictureExecution ? { createSupplementalPictureExecution } : {}),
	});
	const captureFrame = optionalExactFunction(value, 'captureExactFrame');
	const createAcceleratorCanvas = optionalExactFunction(value, 'createExactAcceleratorCanvas');
	return Object.freeze({
		...(captureFrame ? { captureFrame: captureFrame as CaptureFrameFinishing } : {}),
		...(createAcceleratorCanvas ? {
			createAcceleratorCanvas: createAcceleratorCanvas as () => unknown,
		} : {}),
		...(createOpenFxExecution ? { createOpenFxExecution } : {}),
		...(createSupplementalPictureExecution ? { createSupplementalPictureExecution } : {}),
	});
}

function optionalExactFunction(
	value: object,
	key: 'captureExactFrame' | 'createExactAcceleratorCanvas',
): ((...arguments_: never[]) => unknown) | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
		|| typeof descriptor.value !== 'function') {
		throw new TypeError(`finishing picture export dependencies.${key} must be an own function.`);
	}
	return descriptor.value as (...arguments_: never[]) => unknown;
}

function optionalPictureFunction(
	value: object,
	key: 'encodePicture' | 'encodePictureToSink',
): ((...arguments_: never[]) => unknown) | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
		|| typeof descriptor.value !== 'function') {
		throw new TypeError(`finishing picture export dependencies.${key} must be an own function.`);
	}
	return descriptor.value as (...arguments_: never[]) => unknown;
}

function currentAuthority(
	profile: unknown,
	request: Readonly<{
		readonly canonicalProject: Readonly<Record<string, unknown>>;
		readonly exportProject: Readonly<Record<string, unknown>>;
	}>,
	exports: WeakMap<object, ExportAuthorityFinishing>,
): ExportAuthorityFinishing {
	const authority = exports.get(request.exportProject);
	if (!authority || authority.canonicalProject !== request.canonicalProject) {
		throw new TypeError('The browser export projection is not owned by this exact finishing project.');
	}
	const current = executableFoundation(profile, request.canonicalProject);
	if (!sameProjectSnapshot(current, authority.retimeProject)) {
		throw new Error('The selected finishing browser export projection is stale.');
	}
	return authority;
}

function ownedPlanAuthority(
	profile: unknown,
	request: ProductVideoExportStrategyEncodeRequest,
	exports: WeakMap<object, ExportAuthorityFinishing>,
	plans: WeakMap<object, ExportAuthorityFinishing>,
): ExportAuthorityFinishing {
	const authority = currentAuthority(profile, request, exports);
	if (plans.get(request.plan) !== authority) {
		throw new TypeError('The finishing export plan is not owned by this exact project snapshot.');
	}
	return authority;
}

function executableFoundation(
	profile: unknown,
	projectValue: unknown,
): Readonly<Record<string, unknown>> {
	validateFramescaperProjectFinishing(profile, projectValue);
	const project = projectValue as FramescaperProjectFinishing;
	assertSupportedBrowserFinishingState(project);
	return framescaperProjectRetimeFoundationFinishing(profile, project) as unknown as Readonly<Record<string, unknown>>;
}

function assertSupportedBrowserFinishingState(project: FramescaperProjectFinishing): void {
	for (const interpretation of project.videoSourceColorInterpretations) {
		assertManagedVideoColorRenderAdmissionV1(interpretation);
	}
}

function hasVisibleVideoPicture(project: Readonly<Record<string, unknown>>): boolean {
	return hasVisiblePictureKind(project, new Set(['video']));
}

function hasVisibleVisualPicture(project: Readonly<Record<string, unknown>>): boolean {
	return hasVisiblePictureKind(project, new Set(['still', 'generator']));
}

function hasVisiblePictureKind(
	project: Readonly<Record<string, unknown>>,
	kinds: ReadonlySet<string>,
): boolean {
	const sequences = records(project.sequences, 'finishing picture sequences');
	const primary = sequences.find(({ id }) => id === project.primarySequenceId);
	if (!primary) throw new ReferenceError('finishing picture primary sequence is unavailable.');
	const trackIds = new Set(array(primary.trackIds, 'finishing picture sequence track IDs').map(String));
	const clips = new Map(records(project.clips, 'finishing picture clips').map((clip) => [String(clip.id), clip]));
	const tracks = records(project.tracks, 'finishing picture tracks');
	const visible = createVisibleVideoTrackPredicate(tracks);
	return tracks.some((track) => trackIds.has(String(track.id)) && visible(track)
		&& array(track.clipIds, 'finishing picture track clip IDs').some((id) => (
			kinds.has(String(clips.get(String(id))?.kind))
		)));
}

function allVideoSourceIds(projectValue: Readonly<Record<string, unknown>>): readonly string[] {
	return Object.freeze(records(projectValue.sources, 'finishing browser export timing sources')
		.filter(({ kind }) => kind === 'video')
		.map((source) => stableId(source.id, 'finishing browser export timing source'))
		.sort((left, right) => left.localeCompare(right)));
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} must have an identity.`);
	return value;
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function records(value: unknown, name: string): Readonly<Record<string, unknown>>[] {
	return array(value, name).map((item, index) => dataRecord(item, `${name}[${String(index)}]`));
}

function array(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}
