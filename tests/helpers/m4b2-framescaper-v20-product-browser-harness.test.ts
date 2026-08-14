/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorFileService } from '../../src/common/editor/file-service.js';
import type { FfmpegOutputSink } from '../../src/common/editor/ffmpeg-output-stream.ts';
import { createVideoSourceV10, createVideoTrackV10 } from '../../src/common/editor/project-v10.ts';
import type { VideoKeyframeOfflineVideoExportRequest } from '../../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import { registeredVideoTimingIndex, type RuntimeVideoTimingIndex } from '../../src/common/editor/video-source-time.ts';
import { boundVideoSourceTimingViewInfo } from '../../src/common/editor/video-source-timing-view.ts';
import { createVideoTimingAssetPublication } from '../../src/common/editor/video-timing-asset.ts';
import { isVideoExportTimingMap, videoExportTimingMapEntries } from '../../src/common/editor/video-export-timing-map.ts';
import { createFramescaperAudioEditorControllerV20 } from '../../src/framescaper/editor-controller-v20.ts';
import { createFramescaperEditorProjectEnvironmentV20, type FramescaperEditorProjectEnvironmentV20 } from '../../src/framescaper/editor-project-environment-v20.ts';
import { reconcileFramescaperProjectFeatureRequirementsV20 } from '../../src/framescaper/editor-project-feature-requirements-v20.ts';
import type { FramescaperProjectCommandV20 } from '../../src/framescaper/editor-project-v20-commands.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../../src/framescaper/editor-project-v20-profile.ts';
import { createFramescaperProjectV20 } from '../../src/framescaper/editor-project-v20.ts';
import type { FramescaperProjectV20 } from '../../src/framescaper/editor-project-v20-validation.ts';
import { FRAMESCAPER_PROFILE } from '../../src/framescaper/product.js';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;
const PROJECT_ID = 'm4b2-v20-product-browser';
const SOURCE_ID = 'm4b2-v20-product-video-source';
const CLIP_ID = 'm4b2-v20-product-video-clip';
const SOURCE_BYTES = Uint8Array.of(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70);
const ENCODED_BYTES = Uint8Array.of(0x00, 0x00, 0x00, 0x18, 0x6d, 0x64, 0x61, 0x74);

type ProductControllerV20 = ReturnType<typeof createFramescaperAudioEditorControllerV20>;
type ExportRequest = VideoKeyframeOfflineVideoExportRequest;

interface EncoderState {
	mode: 'blob' | 'direct' | 'cancel' | 'direct-cancel';
	started: number; aborted: { blob: number; direct: number };
	cancelReady: { blob: boolean; direct: boolean };
	timingMapAndBoundViewExact: number; exportLeaseDistinctFromPlayback: number;
	canvasExact: number; projectKeyframesExact: number; sourceBlobAuthenticated: number;
	expectedKeyframes: Readonly<Record<string, unknown>>;
	baselineTimingIndex: RuntimeVideoTimingIndex | null; lastTimingSource: Readonly<Record<string, unknown>> | null;
}

interface DirectSession {
	mode: 'direct' | 'direct-cancel'; bytes: number[]; closed: number; aborted: number;
}

interface HarnessFileScope {
	window: Window; document: Document;
	URL: Readonly<{ createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void }>;
	fetch: typeof globalThis.fetch; setTimeout: typeof globalThis.setTimeout; File: typeof globalThis.File;
	showSaveFilePicker?: () => Promise<Readonly<Record<string, unknown>>>;
}

declare global {
	// Bound only inside the esbuild qualification bundle's virtual strategy adapter.
	var __m4b2FramescaperV20EncoderDependencies: Readonly<{
		encodeOffline(request: ExportRequest): Promise<Readonly<Record<string, unknown>>>;
		encodeOfflineToSink(request: ExportRequest, sink: FfmpegOutputSink<unknown>): Promise<Readonly<Record<string, unknown>>>;
	}>;
}

/** Exercise dormant exact-V20 persistence and real controller export publication in Chromium. */
export async function runM4B2FramescaperV20ProductLifecycle(): Promise<Readonly<Record<string, unknown>>> {
	const encoder = encoderState();
	const objectUrls = { created: [] as string[], revoked: [] as string[] };
	const directSessions: DirectSession[] = [];
	const fileScope = qualificationFileScope(objectUrls);
	globalThis.__m4b2FramescaperV20EncoderDependencies = encoderDependencies(encoder);
	let environment: Readonly<FramescaperEditorProjectEnvironmentV20> | null = null;
	let controller: ProductControllerV20 | null = null;
	let diagnostic: Readonly<Record<string, unknown>> | null = null;
	let runtimeDisposed = false;
	let timingSourceForCleanup: Readonly<Record<string, unknown>> | null = null;
	try {
		environment = await createFramescaperEditorProjectEnvironmentV20({ storeOptions: { preferOpfs: false } });
		const prepared = await prepareExactProject(environment);
		const fileService = createAudioEditorFileService({ scope: fileScope, urlApi: fileScope.URL });
		controller = createFramescaperAudioEditorControllerV20(environment, { locale: 'en', copy: {}, fileService });
		const ready = await controller.ready;
		if (ready.phase !== 'ready') throw new Error('The exact V20 product controller did not become ready.');

		await controller.actions.project.openById(PROJECT_ID);
		assertActiveExactProject(controller, prepared.originalKeyframes);
		const openedReadOnly = controller.getSnapshot().readOnly === true;
		const initialRevision = projectRevision(controller.project);
		let staleRefused = false;
		try {
			controller.actions.edit.commit(keyframeCommand(prepared.staleExpectedKeyframes, prepared.editedKeyframes));
		} catch (error) {
			staleRefused = /stale|expected|changed/iu.test(error instanceof Error ? error.message : String(error));
		}
		controller.actions.edit.commit(keyframeCommand(prepared.originalKeyframes, prepared.editedKeyframes));
		const committedRevision = projectRevision(controller.project);
		const autosaveScheduled = controller.getSnapshot().save.state === 'saving';
		const autosaved = await waitForStoredProject(environment, committedRevision, prepared.editedKeyframes);
		controller.actions.edit.undo();
		const undoneRevision = projectRevision(controller.project);
		const undoRestoredOriginal = exactProjectHasKeyframes(controller.project, prepared.originalKeyframes);
		await controller.actions.project.save();
		const savedUndo = await environment.store.loadProject(PROJECT_ID);
		controller.actions.edit.redo();
		const redoneRevision = projectRevision(controller.project);
		const redoRestoredEdit = exactProjectHasKeyframes(controller.project, prepared.editedKeyframes);
		await controller.actions.project.flush();
		const flushedRedo = await environment.store.loadProject(PROJECT_ID);
		await controller.actions.project.close(PROJECT_ID, { discard: true });
		await controller.actions.project.openById(PROJECT_ID);
		const reopenedExact = exactProjectHasKeyframes(controller.project, prepared.editedKeyframes);
		const reopenedRevision = projectRevision(controller.project);
		const savedExact = exactProjectHasKeyframes(flushedRedo, prepared.editedKeyframes);
		encoder.expectedKeyframes = prepared.editedKeyframes;
		encoder.baselineTimingIndex = registeredVideoTimingIndex(videoSource(controller.project)) ?? null;
		timingSourceForCleanup = videoSource(controller.project);
		if (!encoder.baselineTimingIndex) throw new Error('V20 playback did not retain exact timing registration.');

		encoder.mode = 'blob';
		fileScope.showSaveFilePicker = undefined;
		const blobResult = await controller.actions.video.export(exportSettings());
		const timingAfterBlob = timingLeaseCount(encoder, encoder.lastTimingSource);

		encoder.mode = 'direct';
		fileScope.showSaveFilePicker = directPicker(directSessions);
		const directResult = await controller.actions.video.export(exportSettings());
		const timingAfterDirect = timingLeaseCount(encoder, encoder.lastTimingSource);

		encoder.mode = 'cancel';
		fileScope.showSaveFilePicker = undefined;
		const publicationsBeforeCancel = objectUrls.created.length + directCommitCount(directSessions);
		const cancellation = controller.actions.video.export(exportSettings());
		await waitFor(() => encoder.cancelReady.blob);
		await controller.actions.export.cancel();
		const cancellationResult = await cancellation;
		const timingAfterCancellation = timingLeaseCount(encoder, encoder.lastTimingSource);
		const publicationsAfterCancel = objectUrls.created.length + directCommitCount(directSessions);

		encoder.mode = 'direct-cancel';
		fileScope.showSaveFilePicker = directPicker(directSessions, 'direct-cancel');
		const publicationsBeforeDirectCancel = objectUrls.created.length + directCommitCount(directSessions);
		const directCancellation = controller.actions.video.export(exportSettings());
		await waitFor(() => directSessions.some(({ mode, bytes }) => mode === 'direct-cancel' && bytes.length === 4));
		await controller.actions.export.cancel();
		const directCancellationResult = await directCancellation;
		const timingAfterDirectCancellation = timingLeaseCount(encoder, encoder.lastTimingSource);
		const publicationsAfterDirectCancel = objectUrls.created.length + directCommitCount(directSessions);
		const cancelledDirect = directSessions.find(({ mode }) => mode === 'direct-cancel');
		if (!cancelledDirect) throw new Error('The cancellable direct V20 sink was not opened.');

		diagnostic = Object.freeze({
			profile: 'dormant-exact-v20-product-browser-v2',
			availability: Object.freeze({
				testOnlyFeatureRequirementAvailable: environment.runtime.compatibility.evaluate(controller.project)?.compatible === true,
				testOnlyProductCapabilityAvailable: FRAMESCAPER_PROFILE.capabilities.videoKeyframes === true,
			}),
			project: Object.freeze({
				schemaVersion: controller.project?.schemaVersion,
				staleRefused, undoRestoredOriginal, redoRestoredEdit, autosaveScheduled,
				autosavePersistedEdit: exactProjectHasKeyframes(autosaved, prepared.editedKeyframes),
				savePersistedUndo: exactProjectHasKeyframes(savedUndo, prepared.originalKeyframes),
				flushPersistedRedo: exactProjectHasKeyframes(flushedRedo, prepared.editedKeyframes),
				savedExact, reopenedExact, openedReadOnly,
				revisions: Object.freeze({
					initial: initialRevision, committed: committedRevision,
					autosavePersisted: projectRevision(autosaved),
					undone: undoneRevision, savePersisted: projectRevision(savedUndo),
					redone: redoneRevision, flushPersisted: projectRevision(flushedRedo),
					reopened: reopenedRevision,
				}),
			}),
			blob: exportDiagnostic(blobResult, objectUrls.created.length === 1),
			direct: Object.freeze({
				...exportDiagnostic(directResult, directCommitCount(directSessions) === 1),
				writtenBytes: directSessions.filter(({ mode }) => mode === 'direct')
					.reduce((total, session) => total + session.bytes.length, 0),
				committed: directCommitCount(directSessions) === 1,
			}),
			cancellation: Object.freeze({
				result: cancellationResult,
				published: publicationsAfterCancel !== publicationsBeforeCancel,
				encoderObservedAbort: encoder.aborted.blob === 1,
			}),
			directCancellation: Object.freeze({
				result: directCancellationResult,
				published: publicationsAfterDirectCancel !== publicationsBeforeDirectCancel,
				partialBytes: cancelledDirect.bytes.length,
				sinkAborted: cancelledDirect.aborted === 1,
				sinkClosed: cancelledDirect.closed !== 0,
				encoderObservedAbort: encoder.aborted.direct === 1,
			}),
			encoder: Object.freeze({
				observations: encoder.started,
				blobAborts: encoder.aborted.blob,
				directAborts: encoder.aborted.direct,
				timingMapAndBoundViewExact: encoder.timingMapAndBoundViewExact,
				exportLeaseDistinctFromPlayback: encoder.exportLeaseDistinctFromPlayback,
				canvasExact: encoder.canvasExact,
				projectKeyframesExact: encoder.projectKeyframesExact,
				sourceBlobAuthenticated: encoder.sourceBlobAuthenticated,
			}),
			cleanup: Object.freeze({
				timingLeasesAfterEachExport: Object.freeze([
					timingAfterBlob, timingAfterDirect, timingAfterCancellation,
					timingAfterDirectCancellation,
				]),
				directAborts: directSessions.reduce((total, session) => total + session.aborted, 0),
				directCloses: directSessions.reduce((total, session) => total + session.closed, 0),
				objectUrlsCreated: objectUrls.created.length,
				objectUrlsRevoked: objectUrls.revoked.length,
			}),
		});
	} finally {
		if (controller) { await controller.dispose(); runtimeDisposed = controller.getSnapshot().phase === 'disposed'; }
		if (environment) await environment.close();
		Reflect.deleteProperty(globalThis, '__m4b2FramescaperV20EncoderDependencies');
	}
	if (!diagnostic) throw new Error('The exact V20 product diagnostic was not produced.');
	return Object.freeze({
		...diagnostic,
		cleanup: Object.freeze({
			...(diagnostic.cleanup as Readonly<Record<string, unknown>>),
			runtimeDisposed,
			timingRegistryClearedAfterDispose: timingSourceForCleanup
				? registeredVideoTimingIndex(timingSourceForCleanup) === undefined : false,
			injectedEncoderRemoved: !Object.hasOwn(globalThis, '__m4b2FramescaperV20EncoderDependencies'),
		}),
	});
}

async function prepareExactProject(
	environment: Readonly<FramescaperEditorProjectEnvironmentV20>,
): Promise<Readonly<{
	originalKeyframes: Readonly<Record<string, unknown>>;
	editedKeyframes: Readonly<Record<string, unknown>>;
	staleExpectedKeyframes: Readonly<Record<string, unknown>>;
}>> {
	const digest = await sha256(SOURCE_BYTES);
	const timing = createVideoTimingAssetPublication(digest, {
		timescale: 10,
		presentationTicks: [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n],
		finalFrameDurationTicks: 1n,
	});
	const project = keyedProject(digest, timing.reference);
	const originalKeyframes = clipKeyframes(project);
	const editedKeyframes = opacityKeyframes(0.1, 0.9);
	const staleExpected = structuredClone(originalKeyframes) as Record<string, unknown>;
	curveAnchors(staleExpected)[0]!.value = 0.123;
	await environment.store.writeMediaAsset(
		SOURCE_ID,
		new Blob([ownedArrayBuffer(SOURCE_BYTES)], { type: 'video/mp4' }),
	);
	await environment.store.writeMediaAsset(
		timing.reference.storageKey,
		new Blob([ownedArrayBuffer(timing.bytes)], { type: 'application/octet-stream' }),
	);
	const created = await environment.createProjectIfAbsent(project);
	if (!created) throw new Error('The exact V20 create-only project publication was occupied.');
	return Object.freeze({
		originalKeyframes,
		editedKeyframes,
		staleExpectedKeyframes: staleExpected,
	});
}

function keyedProject(
	digest: string,
	timingAsset: Readonly<Record<string, unknown>>,
): FramescaperProjectV20 {
	const source = createVideoSourceV10({
		id: SOURCE_ID, name: 'M4B2 keyed video', storageKey: SOURCE_ID,
		mimeType: 'video/mp4', contentSha256: digest,
		frameCount: 48_000, sampleFrameCount: 48_000, sourceFrameCount: 10,
		frameRate: { num: 10, den: 1 }, width: 64, height: 32,
		timingAsset,
		timingDecision: { mode: 'exact', rate: { num: 10, den: 1 } },
	});
	const project = createFramescaperProjectV20(PROFILE, {
		id: PROJECT_ID, title: 'M4B2 V20 keyed product',
		now: '2026-08-14T12:00:00.000Z',
		sources: [source],
		clips: [{
			kind: 'video', id: CLIP_ID, sourceId: SOURCE_ID, title: 'Keyed video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		projectBin: { clips: [] },
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: [CLIP_ID], locked: false,
		})],
		sequences: [{
			id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'],
		}],
		primarySequenceId: 'main-sequence',
	});
	const clip = project.clips.find(({ id }) => id === CLIP_ID)!;
	(clip as unknown as { videoKeyframes: unknown }).videoKeyframes = opacityKeyframes(0.25, 0.75);
	(project as unknown as { featureRequirements: unknown }).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(
		PROFILE, project,
	);
	return project;
}

function keyframeCommand(
	expectedKeyframes: Readonly<Record<string, unknown>>,
	keyframes: Readonly<Record<string, unknown>>,
): FramescaperProjectCommandV20 {
	return {
		type: 'video-keyframes/set',
		clipId: CLIP_ID,
		expectedKeyframes,
		keyframes,
	} as FramescaperProjectCommandV20;
}

function opacityKeyframes(startValue: number, endValue: number): Record<string, unknown> {
	return {
		schemaVersion: 1,
		timeDomain: {
			authoredDuration: { num: 10, den: 1 },
			viewStart: { num: 0, den: 1 },
			viewDuration: { num: 10, den: 1 },
		},
		curves: [{
			target: { kind: 'composition', parameterId: 'opacity' },
			curve: {
				anchors: [
					{ position: { num: 0, den: 1 }, value: startValue },
					{ position: { num: 10, den: 1 }, value: endValue },
				],
				segments: [{ kind: 'linear' }],
			},
		}],
	};
}

function encoderState(): EncoderState {
	return {
		mode: 'blob', started: 0, aborted: { blob: 0, direct: 0 }, cancelReady: { blob: false, direct: false },
		timingMapAndBoundViewExact: 0, exportLeaseDistinctFromPlayback: 0,
		canvasExact: 0, projectKeyframesExact: 0, sourceBlobAuthenticated: 0,
		expectedKeyframes: Object.freeze({}), baselineTimingIndex: null, lastTimingSource: null,
	};
}

function encoderDependencies(state: EncoderState) {
	return Object.freeze({
		async encodeOffline(request: ExportRequest) {
			await observeEncoderRequest(state, request);
			if (state.mode === 'cancel') { state.cancelReady.blob = true; await awaitAbort(state, request.signal); }
			return encodedResult(request);
		},
		async encodeOfflineToSink(request: ExportRequest, sink: FfmpegOutputSink<unknown>) {
			await observeEncoderRequest(state, request);
			await sink.open(ENCODED_BYTES.byteLength);
			if (state.mode === 'direct-cancel') {
				await sink.write(ENCODED_BYTES.subarray(0, 4));
				state.cancelReady.direct = true;
				await awaitAbort(state, request.signal);
			}
			await sink.write(ENCODED_BYTES);
			const output = await sink.close();
			return Object.freeze({
				...encodedIdentity(request), output,
				byteLength: ENCODED_BYTES.byteLength,
				outputChunkCount: 1,
			});
		},
	});
}

async function observeEncoderRequest(state: EncoderState, request: ExportRequest): Promise<void> {
	state.started += 1;
	if (request.format !== 'mp4' || request.startFrame !== 0 || request.endFrame !== 48_000
		|| request.audioMix !== undefined || request.sources.length !== 1
		|| request.sources[0]?.sourceId !== SOURCE_ID) {
		throw new Error('The real product dispatch did not preserve the exact keyed export request.');
	}
	const project = request.project as Readonly<{
		readonly sources: readonly Readonly<Record<string, unknown>>[];
	}>;
	const source = project.sources.find(({ id }) => id === SOURCE_ID);
	if (!source) throw new Error('The exact active V20 video source was not exported.');
	state.lastTimingSource = source;
	const entries = isVideoExportTimingMap(request.timingBySourceId)
		? videoExportTimingMapEntries(request.timingBySourceId)
		: [];
	const timing = entries[0]?.[1];
	if (entries.length === 1 && entries[0]?.[0] === SOURCE_ID
		&& request.timingBySourceId.get(SOURCE_ID) === timing && timing
		&& boundVideoSourceTimingViewInfo(timing) === timing
		&& timing.sourceId === SOURCE_ID && timing.kind === 'vfr' && timing.frameCount === 10) {
		state.timingMapAndBoundViewExact += 1;
	}
	const activeTimingIndex = registeredVideoTimingIndex(source);
	if (activeTimingIndex && activeTimingIndex !== state.baselineTimingIndex) {
		state.exportLeaseDistinctFromPlayback += 1;
	}
	const canvasRate = request.canvas.frameRate as Readonly<{ num?: unknown; den?: unknown }>;
	if (request.canvas.width === 64 && request.canvas.height === 32
		&& canvasRate.num === 10 && canvasRate.den === 1) {
		state.canvasExact += 1;
	}
	if (projectHasKeyframes(request.project, state.expectedKeyframes)) {
		state.projectKeyframesExact += 1;
	}
	const blob = request.sources[0]?.blob;
	if (blob instanceof Blob) {
		const bytes = new Uint8Array(await blob.arrayBuffer());
		if (sameBytes(bytes, SOURCE_BYTES) && await sha256(bytes) === source.contentSha256) {
			state.sourceBlobAuthenticated += 1;
		}
	}
	request.assertCurrent?.();
}

async function awaitAbort(state: EncoderState, signal: AbortSignal): Promise<never> {
	await new Promise<void>((_resolve, reject) => {
		const aborted = () => {
			state.aborted[state.mode === 'direct-cancel' ? 'direct' : 'blob'] += 1;
			reject(signal.reason ?? new DOMException('Export cancelled.', 'AbortError'));
		};
		if (signal.aborted) aborted();
		else signal.addEventListener('abort', aborted, { once: true });
	});
	throw new DOMException('Export cancelled.', 'AbortError');
}

function encodedResult(request: ExportRequest): Readonly<Record<string, unknown>> {
	return Object.freeze({
		...encodedIdentity(request),
		bytes: ENCODED_BYTES.slice(),
		byteLength: ENCODED_BYTES.byteLength,
		outputChunkCount: 1,
	});
}

function encodedIdentity(request: ExportRequest): Readonly<Record<string, unknown>> {
	return Object.freeze({
		format: request.format,
		extension: request.format === 'mp4' ? '.mp4' : '.webm',
		mimeType: request.format === 'mp4' ? 'video/mp4' : 'video/webm',
		frameCount: 10,
		rgbaChunkCount: 1,
		audioByteLength: 0,
		audioChunkCount: 0,
	});
}

function qualificationFileScope(objectUrls: { created: string[]; revoked: string[] }): HarnessFileScope {
	const urlApi = Object.freeze({
		createObjectURL(_blob: Blob) {
			const url = `blob:m4b2-v20-product-${String(objectUrls.created.length + 1)}`;
			objectUrls.created.push(url);
			return url;
		},
		revokeObjectURL(url: string) { objectUrls.revoked.push(url); },
	});
	return {
		window: globalThis.window,
		document: globalThis.document,
		URL: urlApi,
		fetch: globalThis.fetch.bind(globalThis),
		setTimeout: globalThis.setTimeout.bind(globalThis),
		File: globalThis.File,
	};
}

function directPicker(sessions: DirectSession[], mode: DirectSession['mode'] = 'direct') {
	return async () => Object.freeze({
		name: 'm4b2-v20-product.mp4',
		async createWritable() {
			const session: DirectSession = { mode, bytes: [], closed: 0, aborted: 0 };
			sessions.push(session);
			return Object.freeze({
				async write(value: Uint8Array) { session.bytes.push(...value); },
				async close() { session.closed += 1; },
				async abort() { session.aborted += 1; },
			});
		},
	});
}

function exportSettings(): Readonly<Record<string, unknown>> {
	return Object.freeze({
		format: 'video-mp4',
		range: Object.freeze({ startFrame: 0, endFrame: 48_000 }),
		canvas: Object.freeze({ maximumWidth: 64, maximumHeight: 32 }),
		maximumOutputBytes: 1_024,
	});
}

function exportDiagnostic(value: unknown, published: boolean): Readonly<Record<string, unknown>> {
	const result = value as Readonly<Record<string, unknown>> | null;
	return Object.freeze({
		method: result?.method,
		mimeType: result?.mimeType,
		size: result?.size,
		published,
	});
}

function assertActiveExactProject(
	controller: ProductControllerV20,
	keyframes: Readonly<Record<string, unknown>>,
): void {
	if (!exactProjectHasKeyframes(controller.project, keyframes)) {
		throw new Error('The real product controller did not activate the exact authored V20 project.');
	}
}

function exactProjectHasKeyframes(value: unknown, keyframes: Readonly<Record<string, unknown>>): boolean {
	if (!value || typeof value !== 'object') return false;
	const project = value as Readonly<Record<string, unknown>>;
	return project.schemaVersion === 20 && projectHasKeyframes(project, keyframes);
}

function projectHasKeyframes(value: unknown, keyframes: Readonly<Record<string, unknown>>): boolean {
	if (!value || typeof value !== 'object') return false;
	const project = value as Readonly<Record<string, unknown>>;
	if (!Array.isArray(project.clips)) return false;
	const clip = project.clips.find((candidate) => (
		candidate && typeof candidate === 'object'
		&& (candidate as Readonly<Record<string, unknown>>).id === CLIP_ID
	)) as Readonly<Record<string, unknown>> | undefined;
	return Boolean(clip && sameKeyframes(clip.videoKeyframes, keyframes));
}

function clipKeyframes(project: FramescaperProjectV20): Readonly<Record<string, unknown>> {
	const clip = project.clips.find(({ id }) => id === CLIP_ID);
	if (!clip || clip.kind !== 'video') throw new Error('The exact V20 keyed clip is missing.');
	return structuredClone(clip.videoKeyframes) as Readonly<Record<string, unknown>>;
}

function curveAnchors(value: Record<string, unknown>): Array<{ value: number }> {
	return (((value.curves as Array<Record<string, unknown>>)[0]!.curve as Record<string, unknown>)
		.anchors as Array<{ value: number }>);
}

function sameKeyframes(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function timingLeaseCount(
	state: EncoderState,
	source: Readonly<Record<string, unknown>> | null,
): number {
	return source && registeredVideoTimingIndex(source) !== state.baselineTimingIndex ? 1 : 0;
}

function videoSource(value: unknown): Readonly<Record<string, unknown>> {
	const project = value as Readonly<{ sources?: readonly Readonly<Record<string, unknown>>[] }>;
	const source = project?.sources?.find(({ id }) => id === SOURCE_ID);
	if (!source) throw new Error('The active V20 video source is missing.');
	return source;
}

function directCommitCount(sessions: readonly DirectSession[]): number {
	return sessions.filter((session) => session.closed === 1 && session.aborted === 0).length;
}

function projectRevision(value: unknown): number {
	const revision = (value as Readonly<{ revision?: unknown }> | null)?.revision;
	if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) {
		throw new Error('The exact V20 project revision is unavailable.');
	}
	return revision;
}

async function waitForStoredProject(
	environment: Readonly<FramescaperEditorProjectEnvironmentV20>,
	revision: number,
	keyframes: Readonly<Record<string, unknown>>,
): Promise<unknown> {
	let stored: unknown = null;
	await waitFor(async () => {
		stored = await environment.store.loadProject(PROJECT_ID);
		return projectRevision(stored) === revision && exactProjectHasKeyframes(stored, keyframes);
	});
	return stored;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

async function sha256(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', ownedArrayBuffer(bytes)));
	return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const owned = new Uint8Array(bytes.byteLength);
	owned.set(bytes);
	return owned.buffer;
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
	const deadline = performance.now() + 5_000;
	while (!await predicate()) {
		if (performance.now() >= deadline) throw new Error('The cancellable V20 encoder did not start.');
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
}
