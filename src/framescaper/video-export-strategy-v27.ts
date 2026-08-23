/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../common/editor/ffmpeg-output-stream.ts';
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
import type {
	VideoKeyframeOfflineRgbaPostprocessor,
	VideoKeyframeOfflineRgbaRenderer,
} from '../common/editor/ui/video-keyframe-offline-rgba-renderer.ts';
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
	type VideoKeyframeExportPlanV7,
} from '../common/editor/video-keyframe-export-plan-v7.ts';
import { framescaperProjectV20FoundationV27 } from './editor-project-v27-runtime.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';
import {
	validateFramescaperProjectV27,
	type FramescaperProjectV27,
} from './editor-project-v27.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v20.ts';
import {
	createFramescaperVideoExportStrategyV20,
	type FramescaperVideoExportStrategyV20Dependencies,
} from './video-export-strategy-v20.ts';
import {
	createFramescaperVideoExportFinishingV27,
} from './video-export-finishing-v27.ts';
import {
	createFramescaperVideoExportVisualExecutionV27,
	type FramescaperVideoExportPictureDispositionV27,
	type FramescaperVideoExportVisualAssetStoreV27,
} from './video-export-visual-execution-v27.ts';
import {
	createFramescaperVideoVisualPlanV27,
	isFramescaperVideoVisualPlanV27,
	type FramescaperVideoVisualPlanV27,
} from './video-export-visual-plan-v27.ts';

interface ExportAuthorityV27 {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly v20Project: Readonly<Record<string, unknown>>;
	readonly v20ExportProject: Readonly<Record<string, unknown>>;
}

type PictureSinkEncoderV27 = <Output>(
	editorFfmpeg: unknown,
	request: VideoKeyframeVideoEncoderRequest,
	sink: FfmpegOutputSink<Output>,
) => Promise<VideoKeyframeVideoSinkEncoderResult<Output>>;

interface PictureEncodersV27 {
	readonly encodePicture: (
		editorFfmpeg: unknown, request: VideoKeyframeVideoEncoderRequest,
	) => Promise<VideoKeyframeVideoEncoderResult>;
	readonly encodePictureToSink: PictureSinkEncoderV27;
}

export interface FramescaperVideoExportStrategyV27Dependencies
	extends FramescaperVideoExportStrategyV20Dependencies {
	readonly encodePicture?: typeof encodeVideoKeyframeVideo;
	readonly encodePictureToSink?: PictureSinkEncoderV27;
}

const DEFAULT_PICTURE_ENCODERS = Object.freeze({
	encodePicture: encodeVideoKeyframeVideo,
	encodePictureToSink: encodeVideoKeyframeVideoToSink as PictureSinkEncoderV27,
});

const DISPOSITIONS = new WeakMap<object, FramescaperVideoExportPictureDispositionV27>();

/** Read the exact post-encode node ledger retained for acceptance and reports. */
export function framescaperVideoExportDispositionV27For(
	plan: ProductVideoExportPlan,
): FramescaperVideoExportPictureDispositionV27 {
	const result = DISPOSITIONS.get(plan);
	if (!result) throw new ReferenceError('The V27 picture export plan has no completed disposition.');
	return result;
}

/**
 * Authenticate V27, then delegate only the state the maintained V20 browser
 * encoder represents exactly. Selected V13 finishing is never silently lost.
 */
export function createFramescaperVideoExportStrategyV27(
	profile: unknown,
	dependencies?: FramescaperVideoExportStrategyV27Dependencies,
	assetStore?: FramescaperVideoExportVisualAssetStoreV27,
): ProductVideoExportStrategy {
	assertFramescaperProjectV27Profile(profile);
	const pictureEncoders = snapshotPictureEncoders(dependencies);
	const delegate = createFramescaperVideoExportStrategyV20(
		FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, dependencies,
		{ forceKeyed: true },
	);
	const exports = new WeakMap<object, ExportAuthorityV27>();
	const plans = new WeakMap<object, ExportAuthorityV27>();
	const timingSources = new WeakMap<object, readonly string[]>();
	return Object.freeze({
		createExportProject(request: ProductVideoExportProjectRequest) {
			const v20Project = executableFoundation(profile, request.canonicalProject);
			const v20ExportProject = delegate.createExportProject({
				canonicalProject: v20Project,
				delivery: request.delivery,
			});
			const exportProject = dataRecord(
				request.delivery.project, 'Selected V27 browser delivery project',
			);
			exports.set(exportProject, Object.freeze({
				canonicalProject: request.canonicalProject,
				v20Project,
				v20ExportProject,
			}));
			return exportProject;
		},
		hasPicture(exportProject: Readonly<Record<string, unknown>>) {
			const authority = exports.get(exportProject);
			if (!authority) throw new TypeError('Selected V27 picture authority requires an owned export project.');
			return hasVisibleVisualPicture(authority.canonicalProject);
		},
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			const authority = currentAuthority(profile, request, exports);
			const plan = hasVisibleVideoPicture(authority.canonicalProject)
				? delegate.createPlan({
					...request,
					canonicalProject: authority.v20Project,
					exportProject: authority.v20ExportProject,
					// V27 captions are accounted and delivered as explicit sidecars;
					// they are not a keyed picture mux/burn request for the V20 core.
					captions: undefined,
				})
				: createFramescaperVideoVisualPlanV27(
					authority.canonicalProject as unknown as FramescaperProjectV27, request,
				);
			if (!plan) throw new Error('Selected V27 browser export requires an exact RGBA route.');
			plans.set(plan, authority);
			timingSources.set(plan, allVideoSourceIds(authority.canonicalProject));
			return plan;
		},
		async encode(
			request: ProductVideoExportStrategyEncodeRequest,
		): Promise<ProductVideoExportEncodedOutput> {
			const authority = ownedPlanAuthority(profile, request, exports, plans);
			if (isFramescaperVideoVisualPlanV27(request.plan)) {
				return encodeVisualPicture(profile, authority, request, assetStore, pictureEncoders);
			}
			return encodeKeyedPicture(profile, authority, request, assetStore, delegate);
		},
		async encodeToSink<Output>(
			request: ProductVideoExportStrategyEncodeRequest,
			sink: FfmpegOutputSink<Output>,
		): Promise<ProductVideoExportSinkOutput<Output>> {
			const authority = ownedPlanAuthority(profile, request, exports, plans);
			if (isFramescaperVideoVisualPlanV27(request.plan)) {
				return encodeVisualPictureToSink(
					profile, authority, request, assetStore, pictureEncoders, sink,
				);
			}
			return encodeKeyedPictureToSink(profile, authority, request, assetStore, delegate, sink);
		},
		captureTimingSourceIds(plan: ProductVideoExportPlan) {
			const sourceIds = timingSources.get(plan);
			if (!sourceIds) throw new TypeError('Selected V27 timing closure requires an owned export plan.');
			return sourceIds;
		},
	});
}

async function createKeyedExecution(
	profile: unknown,
	authority: ExportAuthorityV27,
	request: ProductVideoExportStrategyEncodeRequest,
	assetStore: FramescaperVideoExportVisualAssetStoreV27 | undefined,
) {
	assertVideoKeyframeExportPlanV7(request.plan);
	const timingViewsBySourceId = rawTiming(request);
	const finishing = await createFramescaperVideoExportFinishingV27({
		profile,
		project: authority.canonicalProject as unknown as FramescaperProjectV27,
		plan: request.plan as VideoKeyframeExportPlanV7,
		timingViewsBySourceId,
		...(assetStore === undefined ? {} : { store: assetStore }),
		signal: request.signal,
		assertCurrent: request.assertCurrent,
	});
	const visual = await createFramescaperVideoExportVisualExecutionV27({
		profile, project: authority.canonicalProject as unknown as FramescaperProjectV27,
		plan: request.plan, timingViewsBySourceId,
		...(assetStore === undefined ? {} : { store: assetStore }),
		signal: request.signal, assertCurrent: request.assertCurrent,
	});
	const postprocess: VideoKeyframeOfflineRgbaPostprocessor = async (frame) => {
		await finishing(frame);
		await visual.postprocess(frame);
	};
	return Object.freeze({ visual, postprocess });
}

async function encodeKeyedPicture(
	profile: unknown,
	authority: ExportAuthorityV27,
	request: ProductVideoExportStrategyEncodeRequest,
	assetStore: FramescaperVideoExportVisualAssetStoreV27 | undefined,
	delegate: ProductVideoExportStrategy,
): Promise<ProductVideoExportEncodedOutput> {
	const execution = await createKeyedExecution(profile, authority, request, assetStore);
	try {
		const result = await delegate.encode({
			...request, canonicalProject: authority.v20Project,
			exportProject: authority.v20ExportProject, rgbaPostprocessor: execution.postprocess,
		});
		DISPOSITIONS.set(request.plan, execution.visual.disposition());
		return result;
	} finally { execution.visual.dispose(); }
}

async function encodeKeyedPictureToSink<Output>(
	profile: unknown,
	authority: ExportAuthorityV27,
	request: ProductVideoExportStrategyEncodeRequest,
	assetStore: FramescaperVideoExportVisualAssetStoreV27 | undefined,
	delegate: ProductVideoExportStrategy,
	sink: FfmpegOutputSink<Output>,
): Promise<ProductVideoExportSinkOutput<Output>> {
	const execution = await createKeyedExecution(profile, authority, request, assetStore);
	try {
		const result = await delegate.encodeToSink({
			...request, canonicalProject: authority.v20Project,
			exportProject: authority.v20ExportProject, rgbaPostprocessor: execution.postprocess,
		}, sink);
		DISPOSITIONS.set(request.plan, execution.visual.disposition());
		return result;
	} finally { execution.visual.dispose(); }
}

async function createVisualExecution(
	profile: unknown,
	authority: ExportAuthorityV27,
	request: ProductVideoExportStrategyEncodeRequest,
	assetStore: FramescaperVideoExportVisualAssetStoreV27 | undefined,
) {
	if (!isFramescaperVideoVisualPlanV27(request.plan)) {
		throw new TypeError('Selected V27 picture-only execution requires its exact V13 output plan.');
	}
	if (!(request.videoBlobs instanceof Map) || request.videoBlobs.size !== 0) {
		throw new TypeError('Selected V27 picture-only execution refuses unplanned video inputs.');
	}
	const includesAudio = request.plan.inputs.some(({ kind }) => kind === 'staged-audio-mix');
	if (includesAudio !== (request.audioMix instanceof Blob)) {
		throw new TypeError('Selected V27 picture-only audio must exactly match its detached plan.');
	}
	const visual = await createFramescaperVideoExportVisualExecutionV27({
		profile, project: authority.canonicalProject as unknown as FramescaperProjectV27,
		plan: request.plan, timingViewsBySourceId: rawTiming(request),
		...(assetStore === undefined ? {} : { store: assetStore }),
		signal: request.signal, assertCurrent: request.assertCurrent,
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
	const producer = visual.createProducer(frameSource);
	const renderer: VideoKeyframeOfflineRgbaRenderer = Object.freeze({
		width: producer.width, height: producer.height, byteLength: producer.byteLength,
		async produce(frame: VideoKeyframeExportFrame, target: Uint8Array,
			options: Readonly<{ readonly signal: AbortSignal }>) {
			await producer.produce(frame, target as Uint8Array<ArrayBuffer>, options);
		},
		async dispose() { await producer.dispose(); },
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
	return Object.freeze({ visual, encoderRequest: createVideoKeyframeOfflineEncoderRequest(
		options, frameSource, renderer,
	) });
}

async function encodeVisualPicture(
	profile: unknown,
	authority: ExportAuthorityV27,
	request: ProductVideoExportStrategyEncodeRequest,
	assetStore: FramescaperVideoExportVisualAssetStoreV27 | undefined,
	encoders: PictureEncodersV27,
): Promise<ProductVideoExportEncodedOutput> {
	const execution = await createVisualExecution(profile, authority, request, assetStore);
	try {
		const encoded = await encoders.encodePicture(request.editorFfmpeg, execution.encoderRequest);
		const result = pictureBrowserResult(encoded, request.plan as FramescaperVideoVisualPlanV27);
		DISPOSITIONS.set(request.plan, execution.visual.disposition());
		return result;
	} finally { execution.visual.dispose(); }
}

async function encodeVisualPictureToSink<Output>(
	profile: unknown,
	authority: ExportAuthorityV27,
	request: ProductVideoExportStrategyEncodeRequest,
	assetStore: FramescaperVideoExportVisualAssetStoreV27 | undefined,
	encoders: PictureEncodersV27,
	sink: FfmpegOutputSink<Output>,
): Promise<ProductVideoExportSinkOutput<Output>> {
	const execution = await createVisualExecution(profile, authority, request, assetStore);
	try {
		const encoded = await encoders.encodePictureToSink(
			request.editorFfmpeg, execution.encoderRequest, sink,
		);
		const result = pictureSinkResult(encoded, request.plan as FramescaperVideoVisualPlanV27);
		DISPOSITIONS.set(request.plan, execution.visual.disposition());
		return result;
	} finally { execution.visual.dispose(); }
}

function snapshotPictureEncoders(
	value: FramescaperVideoExportStrategyV27Dependencies | undefined,
): PictureEncodersV27 {
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

function optionalPictureFunction(
	value: object,
	key: 'encodePicture' | 'encodePictureToSink',
): ((...arguments_: never[]) => unknown) | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
		|| typeof descriptor.value !== 'function') {
		throw new TypeError(`V27 picture export dependencies.${key} must be an own function.`);
	}
	return descriptor.value as (...arguments_: never[]) => unknown;
}

function pictureBrowserResult(
	encoded: VideoKeyframeVideoEncoderResult,
	plan: FramescaperVideoVisualPlanV27,
): ProductVideoExportEncodedOutput {
	assertPictureResult(encoded, plan);
	if (!(encoded.bytes instanceof Uint8Array) || encoded.bytes.byteLength !== encoded.byteLength) {
		throw new Error('The V27 picture-only output byte length is inconsistent.');
	}
	return Object.freeze({
		bytes: encoded.bytes, byteLength: encoded.byteLength,
		videoEncoder: encoded.videoEncoder,
		...(encoded.codec === undefined ? {} : { codec: encoded.codec }),
		extension: encoded.extension, mimeType: encoded.mimeType,
	});
}

function pictureSinkResult<Output>(
	encoded: VideoKeyframeVideoSinkEncoderResult<Output>,
	plan: FramescaperVideoVisualPlanV27,
): ProductVideoExportSinkOutput<Output> {
	assertPictureResult(encoded, plan);
	if (!Number.isSafeInteger(encoded.outputChunkCount) || encoded.outputChunkCount < 0) {
		throw new RangeError('The V27 picture-only output chunk count is invalid.');
	}
	return Object.freeze({
		output: encoded.output, byteLength: encoded.byteLength,
		chunkCount: encoded.outputChunkCount, videoEncoder: encoded.videoEncoder,
		...(encoded.codec === undefined ? {} : { codec: encoded.codec }),
		extension: encoded.extension, mimeType: encoded.mimeType,
	});
}

function assertPictureResult(
	encoded: Readonly<{ byteLength: number; format: string; extension: string; mimeType: string }>,
	plan: FramescaperVideoVisualPlanV27,
): void {
	if (!Number.isSafeInteger(encoded.byteLength) || encoded.byteLength < 0
		|| encoded.format !== plan.format || encoded.extension !== `.${plan.extension}`
		|| encoded.mimeType !== plan.mimeType) {
		throw new Error('The V27 picture encoder output does not match its exact plan.');
	}
}

function currentAuthority(
	profile: unknown,
	request: Readonly<{
		readonly canonicalProject: Readonly<Record<string, unknown>>;
		readonly exportProject: Readonly<Record<string, unknown>>;
	}>,
	exports: WeakMap<object, ExportAuthorityV27>,
): ExportAuthorityV27 {
	const authority = exports.get(request.exportProject);
	if (!authority || authority.canonicalProject !== request.canonicalProject) {
		throw new TypeError('The browser export projection is not owned by this exact V27 project.');
	}
	const current = executableFoundation(profile, request.canonicalProject);
	if (!sameProjectSnapshot(current, authority.v20Project)) {
		throw new Error('The selected V27 browser export projection is stale.');
	}
	return authority;
}

function ownedPlanAuthority(
	profile: unknown,
	request: ProductVideoExportStrategyEncodeRequest,
	exports: WeakMap<object, ExportAuthorityV27>,
	plans: WeakMap<object, ExportAuthorityV27>,
): ExportAuthorityV27 {
	const authority = currentAuthority(profile, request, exports);
	if (plans.get(request.plan) !== authority) {
		throw new TypeError('The V27 export plan is not owned by this exact project snapshot.');
	}
	return authority;
}

function rawTiming(
	request: ProductVideoExportStrategyEncodeRequest,
) {
	if (!(request.timingViewsBySourceId instanceof Map)) {
		throw new TypeError('Selected V27 browser export lost its raw exact timing authority.');
	}
	return request.timingViewsBySourceId;
}

function executableFoundation(
	profile: unknown,
	projectValue: unknown,
): Readonly<Record<string, unknown>> {
	validateFramescaperProjectV27(profile, projectValue);
	const project = projectValue as FramescaperProjectV27;
	assertSupportedBrowserFinishingState(project);
	return framescaperProjectV20FoundationV27(profile, project) as unknown as Readonly<Record<string, unknown>>;
}

function assertSupportedBrowserFinishingState(project: FramescaperProjectV27): void {
	const record = project as unknown as Readonly<Record<string, unknown>>;
	for (const interpretation of records(
		record.videoSourceColorInterpretations, 'V27 browser export color interpretations',
	)) {
		if (interpretation.provenance === 'legacy-unmanaged-encoded') {
			refuse('a legacy unmanaged source');
		}
		if (!['srgb', 'bt709'].includes(String(interpretation.primaries))
			|| !['srgb', 'bt709'].includes(String(interpretation.transfer))
			|| !['rgb', 'bt709'].includes(String(interpretation.matrix))) {
			refuse('an HDR or wide-gamut source interpretation');
		}
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
	const sequences = records(project.sequences, 'V27 picture sequences');
	const primary = sequences.find(({ id }) => id === project.primarySequenceId);
	if (!primary) throw new ReferenceError('V27 picture primary sequence is unavailable.');
	const trackIds = new Set(array(primary.trackIds, 'V27 picture sequence track IDs').map(String));
	const clips = new Map(records(project.clips, 'V27 picture clips').map((clip) => [String(clip.id), clip]));
	const tracks = records(project.tracks, 'V27 picture tracks');
	const visible = createVisibleVideoTrackPredicate(tracks);
	return tracks.some((track) => trackIds.has(String(track.id)) && visible(track)
		&& array(track.clipIds, 'V27 picture track clip IDs').some((id) => (
			kinds.has(String(clips.get(String(id))?.kind))
		)));
}

function refuse(feature: string): never {
	throw new Error(
		`Selected V27 browser export refuses ${feature}; it has no exact V13 execution path.`,
	);
}

function allVideoSourceIds(projectValue: Readonly<Record<string, unknown>>): readonly string[] {
	return Object.freeze(records(projectValue.sources, 'V27 browser export timing sources')
		.filter(({ kind }) => kind === 'video')
		.map((source) => stableId(source.id, 'V27 browser export timing source'))
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
