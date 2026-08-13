/* SPDX-License-Identifier: AGPL-3.0-only */
import type { TakeCycleRecordingOptions } from './take-cycle-recording-service.ts';
import type {
	TakeCycleLiveCaptureSession,
	TakeCycleLiveLaneCapture,
} from './take-cycle-live-capture-session.ts';
import { selectRoutedRecordingChannels } from './recording-capture-channels.ts';
import { planRoutedRecordingSources } from './routed-recording-capture-service.ts';
import {
	createTakeCycleRoutedPcmStream,
	type TakeCycleRoutedPcmStream,
} from './take-cycle-routed-pcm-stream.ts';
import {
	assertTakeCycleRoutedStartRequest,
	assertTakeCycleRoutedStartScope,
	assertTakeCycleRoutedTracksUnlocked,
	finiteTakeCycleRoutedGain,
	normalizeTakeCycleRoutedChunk,
	normalizeTakeCycleRoutedProject,
	positiveTakeCycleRoutedInteger,
	snapshotTakeCycleRoutedRoutes,
	stableTakeCycleRoutedName,
	takeCycleRoutedGroupId,
	takeCycleRoutedLaneChunkFrames,
	takeCycleRoutedOwningSequence,
	takeCycleRoutedPassCapacity,
	takeCycleRoutedStaleProjectError,
} from './take-cycle-routed-capture-validation.ts';
import type {
	TakeCycleRoutedCaptureResult,
	TakeCycleRoutedCaptureRuntime,
	TakeCycleRoutedCaptureService,
	TakeCycleRoutedCaptureStarted,
	TakeCycleRoutedCaptureStartRequest,
	TakeCycleRoutedLaneResult,
} from './take-cycle-routed-capture-types.ts';
import type {
	RecordingCaptureChunk,
	RecordingMediaStream,
	RecordingRoute,
	RecordingTrack,
} from './recording-transaction-types.ts';
import type {
	RecordingCaptureControllerLike,
	RecordingStartScope,
} from './recording-session-service.ts';
import {
	pauseTakeCycleCaptureTransport,
	reportTakeCycleCaptureError,
	settleTakeCycleCaptureControllers,
} from './take-cycle-routed-capture-settlement.ts';
import { acquireTakeCycleRoutedSources } from './take-cycle-routed-source-acquisition.ts';
export type {
	TakeCycleRoutedCaptureEngine,
	TakeCycleRoutedCaptureProject,
	TakeCycleRoutedCaptureResult,
	TakeCycleRoutedCaptureRuntime,
	TakeCycleRoutedCaptureService,
	TakeCycleRoutedCaptureStarted,
	TakeCycleRoutedCaptureStartRequest,
	TakeCycleRoutedLaneResult,
	TakeCycleRoutedStartedLane,
} from './take-cycle-routed-capture-types.ts';
interface PlannedLane {
	readonly track: RecordingTrack;
	readonly route: RecordingRoute;
	readonly sourceKey: string;
	readonly groupId: string;
	readonly sequenceId: string;
}
interface LiveLane extends PlannedLane {
	capture: TakeCycleLiveLaneCapture | null;
	pcm: TakeCycleRoutedPcmStream | null;
	status: 'capturing' | 'sealed' | 'failed';
	error: unknown | null;
}

interface LiveSource {
	readonly sourceKey: string;
	readonly kind: 'device' | 'display';
	readonly stream: RecordingMediaStream;
	readonly channelCount: number;
	readonly lanes: LiveLane[];
	controller: RecordingCaptureControllerLike | null;
	tail: Promise<void>;
	accepting: boolean;
	expectedFrameStart: number | null;
}

interface ActiveCapture {
	readonly projectId: string;
	readonly publicationGeneration: number;
	readonly scope: RecordingStartScope;
	readonly session: TakeCycleLiveCaptureSession;
	readonly lanes: LiveLane[];
	readonly sources: LiveSource[];
	abortReason: unknown | null;
	abortPromise: Promise<void> | null;
}

/** Dedicated continuous-loop capture over the existing routed input/controller ports. */
export function createTakeCycleRoutedCaptureService(
	runtime: TakeCycleRoutedCaptureRuntime,
): Readonly<TakeCycleRoutedCaptureService> {
	let phase: 'idle' | 'starting' | 'active' | 'stopping' = 'idle';
	let activeCapture: ActiveCapture | null = null;
	let stopPromise: Promise<TakeCycleRoutedCaptureResult> | null = null;
	let lastResult: TakeCycleRoutedCaptureResult | null = null;
	let inputsOwned = false;
	return Object.freeze({
		get active() { return phase === 'active'; },
		start,
		stop,
		pause() { throw new Error('Take cycle routed capture cannot be paused.'); },
	});

	async function start(
		requestValue: TakeCycleRoutedCaptureStartRequest,
		scope: RecordingStartScope,
	): Promise<TakeCycleRoutedCaptureStarted> {
		if (phase !== 'idle') throw new Error('Take cycle routed capture is already active.');
		assertTakeCycleRoutedStartRequest(requestValue);
		assertTakeCycleRoutedStartScope(scope);
		phase = 'starting';
		lastResult = null;
		inputsOwned = false;
		let pending: ActiveCapture | null = null;
		try {
			pending = await prepareCapture(scope);
			assertCaptureCurrent(pending);
			activeCapture = pending;
			phase = 'active';
			return Object.freeze({
				kind: 'take-cycle-routed-capture-started',
				projectId: pending.projectId,
				publicationGeneration: pending.publicationGeneration,
				lanes: Object.freeze(pending.lanes.filter(isCapturingLane).map((lane) => Object.freeze({
					trackId: lane.track.id,
					groupId: lane.groupId,
					laneId: lane.capture!.laneId,
				}))),
			});
		} catch (error) {
			if (pending) await rollbackCaptureOnce(pending, error);
			releaseInputs();
			phase = 'idle';
			throw error;
		}
	}

	function stop(options: TakeCycleRecordingOptions = {}): Promise<TakeCycleRoutedCaptureResult> {
		if (stopPromise) return stopPromise;
		if (phase === 'idle' && lastResult) return Promise.resolve(lastResult);
		if (phase !== 'active' || !activeCapture) {
			return Promise.reject(new Error('Take cycle routed capture is not active.'));
		}
		phase = 'stopping';
		const capture = activeCapture;
		try {
			assertCaptureCurrent(capture);
		} catch (error) {
			return rejectAfterRollback(capture, error);
		}
		stopPromise = settleCapture(capture, options).catch(async (error: unknown) => {
			await rollbackCaptureOnce(capture, error);
			throw error;
		}).finally(() => {
			releaseInputs();
			activeCapture = null;
			stopPromise = null;
			phase = 'idle';
		});
		return stopPromise;
	}

	async function prepareCapture(scope: RecordingStartScope): Promise<ActiveCapture> {
		scope.assertCurrent();
		const project = normalizeTakeCycleRoutedProject(runtime.getProject());
		if (scope.projectId !== project.id) throw takeCycleRoutedStaleProjectError();
		if (runtime.activeSelection(project) !== null) {
			throw new Error('Take cycle routed capture cannot own a punch selection.');
		}
		if (runtime.soundActivationEnabled()) {
			throw new Error('Take cycle routed capture cannot use sound activation.');
		}
		const tracks = project.tracks.filter((track) => track.type === 'audio' && track.armed);
		if (!tracks.length) throw new Error('Take cycle routed capture requires an armed audio track.');
		assertTakeCycleRoutedTracksUnlocked(tracks);
		const routes = snapshotTakeCycleRoutedRoutes(runtime.getRoutes(), tracks);
		const plan = planRoutedRecordingSources(tracks, routes, runtime.recordingRouteSourceKey);
		if (plan.skippedTrackIds.length || !plan.assigned.length) {
			throw new Error('Every take cycle track requires one routed input.');
		}
		const targets = plan.assigned.map(({ track }) => ({
			trackId: track.id,
			sequenceId: takeCycleRoutedOwningSequence(project, track.id),
		}));
		const maximumPasses = takeCycleRoutedPassCapacity(
			project,
			targets,
			project.loop.startFrame,
			project.loop.endFrame,
		);
		const groupIds = new Set<string>();
		const lanes = plan.assigned.map(({ track, route, sourceKey }, index): LiveLane => {
			const sequenceId = targets[index]!.sequenceId;
			const groupId = takeCycleRoutedGroupId(
				project,
				sequenceId,
				track.id,
				project.loop.startFrame,
				project.loop.endFrame,
				() => runtime.createGroupId(track.id),
			);
			if (groupIds.has(groupId)) throw new Error(`Duplicate take cycle routed group ${groupId}.`);
			groupIds.add(groupId);
			return {
				track, route, sourceKey, groupId,
				sequenceId,
				capture: null, pcm: null, status: 'capturing', error: null,
			};
		});
		inputsOwned = true;
		const sources = await acquireSources(plan.groups, lanes, project.sampleRate);
		assertScopeCurrent(scope, project.id);
		if (!sources.some(({ lanes: sourceLanes }) => sourceLanes.length)) {
			throw new Error('No routed take cycle inputs are available.');
		}
		await runtime.beginPlaybackCachePreparation(project);
		assertScopeCurrent(scope, project.id);
		const context = await runtime.engine.getAudioContext();
		assertScopeCurrent(scope, project.id);
		await context.resume();
		assertScopeCurrent(scope, project.id);
		const captureSampleRate = positiveTakeCycleRoutedInteger(context.sampleRate, 768_000, 'capture sample rate');
		const channelCount = sources.reduce((total, source) => (
			total + source.lanes.reduce((sum, lane) => sum + lane.route.channelCount, 0)
		), 0);
		await runtime.preflightStorage(
			project.sampleRate * channelCount * Float32Array.BYTES_PER_ELEMENT * 60,
			'take-cycle-recording',
		);
		assertScopeCurrent(scope, project.id);
		const session = await runtime.orchestrator.beginLiveSession({
			projectId: project.id,
			loopStartSample: project.loop.startFrame,
			loopEndSample: project.loop.endFrame,
		});
		assertScopeCurrent(scope, project.id);
		const pending: ActiveCapture = {
			projectId: project.id,
			publicationGeneration: session.publicationGeneration,
			scope, session, lanes, sources, abortReason: null, abortPromise: null,
		};
		try {
			for (const source of sources) for (const lane of source.lanes) {
				try {
					const chunkFrames = takeCycleRoutedLaneChunkFrames(runtime.sourceChunkFrames, lane.route.channelCount);
					lane.capture = await session.beginLane({
						groupId: lane.groupId,
						trackId: lane.track.id,
						sequenceId: lane.sequenceId,
						name: stableTakeCycleRoutedName(runtime.createRecordingName(lane.track.id)),
						sampleRate: project.sampleRate,
						channelCount: lane.route.channelCount,
						chunkFrames,
					});
					assertCaptureCurrent(pending);
					lane.pcm = createTakeCycleRoutedPcmStream({
						inputSampleRate: captureSampleRate,
						projectSampleRate: project.sampleRate,
						channelCount: lane.route.channelCount,
						chunkFrames,
						loopStartSample: project.loop.startFrame,
						loopEndSample: project.loop.endFrame,
						maximumPasses,
						append: lane.capture.append,
						...(runtime.createResampler ? { createResampler: runtime.createResampler } : {}),
					});
				} catch (error) {
					assertCaptureCurrent(pending);
					await failLane(lane, error);
					assertCaptureCurrent(pending);
				}
			}
			for (const source of sources) {
				if (!source.lanes.some(isCapturingLane)) continue;
				try {
					source.controller = await runtime.createRecorder({
						context,
						stream: source.stream,
						channelCount: source.channelCount,
						discreteChannels: true,
						monitor: source.kind === 'device' && runtime.monitor === true,
						inputGain: source.kind === 'device' ? finiteTakeCycleRoutedGain(runtime.inputGain ?? 1) : 1,
						onChunk: (chunk) => enqueueChunk(pending, source, chunk),
						onError: (error) => { enqueueSourceFailure(pending, source, error); },
						onState() {},
					});
					assertCaptureCurrent(pending);
				} catch (error) {
					assertCaptureCurrent(pending);
					for (const lane of source.lanes) await failLane(lane, error);
					assertCaptureCurrent(pending);
				}
			}
			const controlled = sources.filter((source) => source.controller !== null);
			if (!controlled.length) throw new Error('No routed take cycle recorders are available.');
			const scheduledTime = context.currentTime + 0.08;
			runtime.engine.setLoop({
				enabled: true,
				startFrame: project.loop.startFrame,
				endFrame: project.loop.endFrame,
			});
			runtime.engine.seek(project.loop.startFrame);
			const playbackStartTime = await runtime.engine.playAt(scheduledTime, project.loop.startFrame);
			assertCaptureCurrent(pending);
			const startFrame = Math.ceil(captureSampleRate * (
				typeof playbackStartTime === 'number' && Number.isFinite(playbackStartTime)
					? playbackStartTime
					: scheduledTime
			));
			for (const source of controlled) {
				source.controller!.start({ startFrame });
				assertCaptureCurrent(pending);
			}
			return pending;
		} catch (error) {
			await rollbackCaptureOnce(pending, error);
			throw error;
		}
	}

	async function acquireSources(
		groups: readonly Readonly<{ readonly sourceKey: string; readonly routes: readonly Readonly<{
			readonly track: RecordingTrack; readonly route: RecordingRoute;
		}>[] }>[],
		lanes: LiveLane[],
		projectSampleRate: number,
	): Promise<LiveSource[]> {
		const laneFor = (trackId: string) => lanes.find((lane) => lane.track.id === trackId)!;
		const acquired = await acquireTakeCycleRoutedSources(
			groups,
			projectSampleRate,
			runtime,
			async ({ track }, error) => failLane(laneFor(track.id), error),
		);
		return acquired.map((source) => ({
			...source,
			lanes: source.lanes.map(({ track }) => laneFor(track.id)),
			controller: null, tail: Promise.resolve(), accepting: true, expectedFrameStart: null,
		}));
	}

	function enqueueChunk(
		capture: ActiveCapture,
		source: LiveSource,
		chunk: RecordingCaptureChunk,
	): Promise<void> {
		if (!source.accepting) return Promise.reject(new Error('Take cycle routed source is stopping.'));
		const stale = captureCurrentError(capture);
		if (stale) {
			scheduleStaleAbort(capture, stale);
			return Promise.reject(stale);
		}
		const operation = source.tail.then(() => processChunk(capture, source, chunk));
		source.tail = operation.catch(async (error: unknown) => {
			const lifetimeError = captureCurrentError(capture);
			if (lifetimeError) {
				scheduleStaleAbort(capture, lifetimeError);
				reportError(lifetimeError);
				return;
			}
			for (const lane of source.lanes) await failLane(lane, error);
			reportError(error);
		});
		return source.tail;
	}

	function enqueueSourceFailure(capture: ActiveCapture, source: LiveSource, error: unknown): void {
		if (!source.accepting) return;
		const stale = captureCurrentError(capture);
		if (stale) {
			scheduleStaleAbort(capture, stale);
			return;
		}
		source.tail = source.tail.then(async () => {
			assertCaptureCurrent(capture);
			for (const lane of source.lanes) await failLane(lane, error);
			assertCaptureCurrent(capture);
			reportError(error);
		}).catch((failure: unknown) => {
			const lifetimeError = captureCurrentError(capture);
			if (lifetimeError) scheduleStaleAbort(capture, lifetimeError);
			reportError(failure);
		});
	}

	async function processChunk(
		capture: ActiveCapture,
		source: LiveSource,
		chunkValue: RecordingCaptureChunk,
	): Promise<void> {
		assertCaptureCurrent(capture);
		const chunk = normalizeTakeCycleRoutedChunk(chunkValue, source.channelCount, source.expectedFrameStart);
		source.expectedFrameStart = chunk.frameStart + chunk.frames;
		for (const lane of source.lanes) {
			if (!isCapturingLane(lane)) continue;
			try {
				assertCaptureCurrent(capture);
				const channels = selectRoutedRecordingChannels(chunk.channels, lane.route, source.kind);
				await lane.pcm!.push(channels);
				assertCaptureCurrent(capture);
			} catch (error) {
				const lifetimeError = captureCurrentError(capture);
				if (lifetimeError) throw lifetimeError;
				await failLane(lane, error);
			}
		}
	}

	async function failLane(lane: LiveLane, error: unknown): Promise<void> {
		if (!lane || lane.status !== 'capturing') return;
		lane.status = 'failed';
		lane.error = error;
		if (!lane.capture) return;
		try {
			await lane.capture.discard();
		} catch (cleanupError) {
			lane.error = new AggregateError([error, cleanupError], 'Take cycle lane failure could not settle exactly.');
			reportError(lane.error);
		}
	}

	async function settleCapture(capture: ActiveCapture, options: TakeCycleRecordingOptions): Promise<
		TakeCycleRoutedCaptureResult
	> {
		pauseTransport();
		await settleControllerOperations(capture.sources, (controller) => controller?.stop());
		assertCaptureCurrent(capture);
		for (const source of capture.sources) source.accepting = false;
		await Promise.all(capture.sources.map((source) => source.tail));
		assertCaptureCurrent(capture);
		await settleControllerOperations(
			capture.sources,
			(controller) => controller?.dispose?.({ stopTracks: false }),
		);
		assertCaptureCurrent(capture);
		for (const lane of capture.lanes) {
			if (!isCapturingLane(lane)) continue;
			try {
				await lane.pcm!.finish();
				assertCaptureCurrent(capture);
				if (lane.pcm!.frameCount < 1) throw new Error(`Take cycle lane ${lane.track.id} captured no PCM.`);
				await lane.capture!.seal(options.signal ? { signal: options.signal } : {});
				assertCaptureCurrent(capture);
				lane.status = 'sealed';
			} catch (error) {
				const lifetimeError = captureCurrentError(capture);
				if (lifetimeError) throw lifetimeError;
				await failLane(lane, error);
			}
		}
		assertCaptureCurrent(capture);
		const sealed = capture.lanes.filter((lane) => lane.status === 'sealed');
		const finalization = sealed.length ? await capture.session.finalize(options) : null;
		assertCaptureCurrent(capture);
		const finalized = new Map(finalization?.lanes.map((lane) => [lane.laneId, lane]) ?? []);
		const result = Object.freeze({
			kind: 'take-cycle-routed-capture-result' as const,
			projectId: capture.projectId,
			publicationGeneration: capture.publicationGeneration,
			lanes: Object.freeze(capture.lanes.map((lane): TakeCycleRoutedLaneResult => {
				const laneResult = lane.capture ? finalized.get(lane.capture.laneId) : undefined;
				if (lane.status === 'sealed' && !laneResult) {
					return Object.freeze({
						trackId: lane.track.id, groupId: lane.groupId, laneId: lane.capture?.laneId ?? null,
						status: 'failed', error: new Error('Take cycle finalization omitted a sealed routed lane.'),
					});
				}
				return Object.freeze({
					trackId: lane.track.id, groupId: lane.groupId, laneId: lane.capture?.laneId ?? null,
					status: laneResult?.status ?? 'failed', error: laneResult?.error ?? lane.error,
				});
			})),
			finalization,
		});
		lastResult = result;
		return result;
	}

	async function rollbackCapture(capture: ActiveCapture, reason: unknown): Promise<void> {
		pauseTransport();
		await settleControllerOperations(capture.sources, (controller) => controller?.stop());
		for (const source of capture.sources) source.accepting = false;
		await Promise.allSettled(capture.sources.map((source) => source.tail));
		await settleControllerOperations(
			capture.sources,
			(controller) => controller?.dispose?.({ stopTracks: false }),
		);
		for (const lane of capture.lanes) await failLane(lane, reason);
	}

	function rollbackCaptureOnce(capture: ActiveCapture, reason: unknown): Promise<void> {
		capture.abortReason ??= reason;
		capture.abortPromise ??= rollbackCapture(capture, capture.abortReason);
		return capture.abortPromise;
	}

	function rejectAfterRollback(
		capture: ActiveCapture,
		reason: unknown,
	): Promise<TakeCycleRoutedCaptureResult> {
		stopPromise = rollbackCaptureOnce(capture, reason).then(() => { throw reason; }).finally(() => {
			releaseInputs();
			if (activeCapture === capture) activeCapture = null;
			stopPromise = null;
			phase = 'idle';
		});
		return stopPromise;
	}

	function scheduleStaleAbort(capture: ActiveCapture, reason: unknown): void {
		capture.abortReason ??= reason;
		queueMicrotask(() => {
			if (capture.abortPromise) return;
			if (activeCapture === capture) phase = 'stopping';
			void rollbackCaptureOnce(capture, capture.abortReason).catch(reportError).finally(() => {
				releaseInputs();
				if (activeCapture === capture) activeCapture = null;
				if (!activeCapture) phase = 'idle';
			});
		});
	}

	function assertCaptureCurrent(capture: ActiveCapture): void {
		assertScopeCurrent(capture.scope, capture.projectId);
	}

	function captureCurrentError(capture: ActiveCapture): unknown | null {
		try {
			assertCaptureCurrent(capture);
			return null;
		} catch (error) {
			return error;
		}
	}

	function assertScopeCurrent(scope: RecordingStartScope, projectId: string): void {
		scope.assertCurrent();
		if (scope.projectId !== projectId || runtime.getProject().id !== projectId) {
			throw takeCycleRoutedStaleProjectError();
		}
	}

	async function settleControllerOperations(
		sources: readonly LiveSource[],
		operation: (controller: RecordingCaptureControllerLike | null) => unknown,
	): Promise<void> {
		await settleTakeCycleCaptureControllers(sources.map(({ controller }) => controller), operation, reportError);
	}

	function pauseTransport(): void {
		pauseTakeCycleCaptureTransport(() => runtime.engine.pause(), reportError);
	}

	function releaseInputs(): void {
		if (!inputsOwned) return;
		inputsOwned = false;
		try {
			runtime.releaseInputs?.();
		} catch (error) {
			reportError(error);
		}
	}

	function reportError(error: unknown): void {
		reportTakeCycleCaptureError(error, runtime.handleError);
	}
}
function isCapturingLane(lane: LiveLane): boolean {
	return lane.status === 'capturing' && lane.capture !== null && lane.pcm !== null;
}
