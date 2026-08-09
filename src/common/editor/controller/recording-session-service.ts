/* SPDX-License-Identifier: AGPL-3.0-only */

type MaybePromise<T> = T | PromiseLike<T>;

function invokeAsPromise<T>(operation: () => MaybePromise<T>): Promise<T> {
	try {
		return Promise.resolve(operation());
	} catch (error) {
		return Promise.reject(error);
	}
}

export interface RecordingControllerLike {
	readonly state?: string;
	pause?(): boolean | void;
	resume?(): boolean | void;
	stop(): MaybePromise<void>;
	dispose?(options?: Readonly<{ stopTracks?: boolean }>): MaybePromise<void>;
	setMonitoring?(enabled: boolean): void;
	setInputGain?(value: number): void;
}

export interface RecordingCaptureControllerLike extends RecordingControllerLike {
	start(options?: Readonly<{ startFrame?: number; stopFrame?: number }>): void;
	pause(): boolean | void;
	resume(): boolean | void;
	setMonitoring(enabled: boolean): void;
	setInputGain(value: number): void;
}

export interface RoutedRecordingSourceSession {
	readonly kind: 'device' | 'display';
	readonly controller: RecordingCaptureControllerLike;
	disconnected: boolean;
	stopped: boolean;
	startFrame?: number;
	stopFrame?: number;
}

export interface RoutedRecordingController extends RecordingControllerLike {
	readonly state: 'ready' | 'recording' | 'paused' | 'stopping' | 'stopped' | 'disposed';
	start(): void;
	pause(): boolean;
	resume(): boolean;
	stop(): Promise<void>;
	dispose(): Promise<void>;
	setMonitoring(enabled: boolean): void;
	setInputGain(value: number): void;
}

export interface RecordingStartOptions {
	readonly trackId?: string;
	readonly timedStartTimeMs?: number;
	readonly timedGeneration?: number;
	readonly reusePreparedInputsOnly?: boolean;
}

export interface RecordingStartScope {
	readonly generation: number;
	readonly projectId: string | null;
	assertCurrent(): void;
}

export interface RecordingSessionMutableState {
	readOnly: boolean;
	disposed: boolean;
	projectBinPreview: unknown | null;
	recorder: RecordingControllerLike | null;
	recordingStarting: boolean;
	recordingStartGeneration: number;
	recordingStartPromise: Promise<void> | null;
	timedRecordingPreparing: boolean;
	timedRecording: Readonly<{ generation: number }> | null;
	recordingPaused: boolean;
	leadInRecording: boolean;
	recordingEntries: readonly unknown[] | null;
	recordingWriter: unknown | null;
	recordingStream: unknown | null;
	recordingSourceId: string | null;
	recordingTrackId: string | null;
	recordingStartFrame: number;
	recordingSelection: unknown | null;
	recordingResampler: unknown | null;
	recordingSampleRate: number | null;
	recordingSourceOffsetFrames: number;
	recordingPreview: unknown | null;
	recordingPreviews: unknown[];
	recordingPreviewLastPublishedAt: number;
	recordingCleanup: (() => void) | null;
	recordingFinishing: boolean;
	recordingFinalizePromise: Promise<void> | null;
	recordingFatalError: unknown;
	recordingDiscardRequested: boolean;
	recordingReleaseAfterStop: boolean;
	inputMeterDb: number;
	inputMeters: Record<string, number>;
}

export interface RecordingFinalizationSnapshot {
	readonly recorder: RecordingControllerLike;
	readonly entries: readonly unknown[] | null;
	readonly writer: unknown | null;
	readonly sourceId: string | null;
	readonly trackId: string | null;
	readonly startFrame: number;
	readonly sourceOffsetFrames: number;
	readonly selection: unknown | null;
	readonly resampler: unknown | null;
	readonly sampleRate: number | null;
	readonly preview: unknown | null;
	readonly discardRequested: boolean;
	readonly fatalError: unknown;
}

export interface RecordingSessionServiceRuntime {
	readonly state: RecordingSessionMutableState;
	readonly getProjectId: () => string | null;
	readonly beginRecording: (
		options: RecordingStartOptions,
		scope: RecordingStartScope,
	) => MaybePromise<void>;
	readonly performLegacyFinalization: (
		snapshot: RecordingFinalizationSnapshot,
	) => MaybePromise<void>;
	readonly performRoutedFinalization: (
		snapshot: RecordingFinalizationSnapshot & { readonly entries: readonly unknown[] },
	) => MaybePromise<void>;
	readonly abortError?: () => Error;
	readonly addTrack?: (options: Readonly<{ armed: true }>) => string | null;
	readonly stopProjectBinPreview?: () => MaybePromise<unknown>;
	readonly cancelTimedRecording?: () => MaybePromise<unknown>;
	readonly releaseUnretainedRecordingInputs?: (
		options?: Readonly<{ force?: boolean }>,
	) => void;
	readonly retainInputs?: () => boolean;
	readonly playTransport?: () => MaybePromise<unknown>;
	readonly pauseTransport?: () => void;
	readonly getTransportState?: () => string;
	readonly updateTransportState?: (state: string) => void;
	readonly persistLeadIn?: (enabled: boolean) => MaybePromise<unknown>;
	readonly publishDocumentSnapshot?: () => void;
	readonly publishTelemetrySnapshot?: () => void;
	readonly syncRecordingPoolSnapshot?: () => void;
	readonly resetSoundActivationSources?: () => boolean;
	readonly handleError?: (error: unknown) => void;
}

/** Coordinate multiple capture controllers behind the legacy recorder port. */
export function createRoutedRecordingController(
	sourceSessions: readonly RoutedRecordingSourceSession[],
): RoutedRecordingController {
	let controllerState: RoutedRecordingController['state'] = 'ready';
	let stopPromise: Promise<void> | null = null;
	let disposePromise: Promise<void> | null = null;
	return {
		get state() { return controllerState; },
		start() {
			controllerState = 'recording';
			for (const session of sourceSessions) {
				if (session.disconnected) {
					session.stopped = true;
					continue;
				}
				session.controller.start({
					startFrame: session.startFrame,
					stopFrame: session.stopFrame,
				});
			}
		},
		pause() {
			if (controllerState !== 'recording') return false;
			return transitionSources('pause');
		},
		resume() {
			if (controllerState !== 'paused') return false;
			return transitionSources('resume');
		},
		stop() {
			if (stopPromise) return stopPromise;
			if (controllerState === 'stopped' || controllerState === 'disposed') return Promise.resolve();
			return beginStop();
		},
		setMonitoring(enabled) {
			for (const session of sourceSessions) {
				if (session.kind === 'device') session.controller.setMonitoring(enabled);
			}
		},
		setInputGain(value) {
			for (const session of sourceSessions) {
				if (session.kind === 'device') session.controller.setInputGain(value);
			}
		},
		dispose() {
			if (disposePromise) return disposePromise;
			disposePromise = Promise.allSettled(sourceSessions.map((session) => (
				invokeAsPromise(() => session.controller.dispose?.({ stopTracks: false }))
			))).then(() => { controllerState = 'disposed'; });
			return disposePromise;
		},
	};

	function transitionSources(direction: 'pause' | 'resume'): boolean {
		const previousControllerState = direction === 'pause' ? 'recording' : 'paused';
		const nextControllerState = direction === 'pause' ? 'paused' : 'recording';
		const rollbackDirection = direction === 'pause' ? 'resume' : 'pause';
		const transitioned: RoutedRecordingSourceSession[] = [];
		let transitionFailure: unknown = null;
		let rejected = false;
		let uncertainFailure = false;
		for (const session of sourceSessions) {
			if (session.stopped || session.disconnected) continue;
			try {
				const result = session.controller[direction]();
				if (result === false) {
					rejected = true;
					transitionFailure = new Error(`A routed recording source rejected ${direction}.`);
					if (session.controller.state === nextControllerState) transitioned.push(session);
					else if (session.controller.state !== undefined
						&& session.controller.state !== previousControllerState) uncertainFailure = true;
					break;
				}
				transitioned.push(session);
			} catch (error) {
				transitionFailure = error;
				if (session.controller.state === nextControllerState) transitioned.push(session);
				else if (session.controller.state === undefined
					|| session.controller.state !== previousControllerState) uncertainFailure = true;
				break;
			}
		}
		if (transitionFailure === null) {
			controllerState = nextControllerState;
			return true;
		}

		const rollbackFailures: unknown[] = [];
		for (const session of transitioned.reverse()) {
			try {
				const result = session.controller[rollbackDirection]();
				if (result === false || (session.controller.state !== undefined
					&& session.controller.state !== previousControllerState)) {
					rollbackFailures.push(new Error(
						`A routed recording source rejected the ${direction} rollback.`,
					));
				}
			} catch (error) {
				rollbackFailures.push(error);
			}
		}
		if (uncertainFailure || rollbackFailures.length) {
			void beginStop();
			throw new AggregateError(
				[transitionFailure, ...rollbackFailures],
				`Routed recording ${direction} rollback failed; capture is stopping.`,
			);
		}
		if (rejected) return false;
		throw transitionFailure;
	}

	function beginStop(): Promise<void> {
		if (stopPromise) return stopPromise;
		controllerState = 'stopping';
		stopPromise = Promise.allSettled(sourceSessions.map((session) => (
			session.stopped ? Promise.resolve() : invokeAsPromise(() => session.controller.stop())
		))).then(() => {
			for (const session of sourceSessions) session.stopped = true;
			if (controllerState !== 'disposed') controllerState = 'stopped';
		});
		return stopPromise;
	}
}

/**
 * Own the concurrency and terminal cleanup around controller-supplied capture
 * and commit operations. Browser capture and project mutation remain ports, so
 * neither can accidentally bypass the shared start/finalize promise guards.
 */
export function createRecordingSessionService(runtime: RecordingSessionServiceRuntime) {
	const { state } = runtime;
	const publishDocumentSnapshot = runtime.publishDocumentSnapshot || (() => {});
	const releaseInputs = runtime.releaseUnretainedRecordingInputs || (() => {});
	const handleError = runtime.handleError || (() => {});

	function startBlocked(): boolean {
		return state.readOnly
			|| state.recordingStarting
			|| Boolean(state.recordingStartPromise)
			|| Boolean(state.recorder);
	}

	function isTimedStart(options: RecordingStartOptions): boolean {
		return Number.isFinite(Number(options.timedStartTimeMs))
			&& state.timedRecording?.generation === options.timedGeneration;
	}

	function createStartScope(): RecordingStartScope {
		const generation = ++state.recordingStartGeneration;
		const projectId = runtime.getProjectId();
		const assertCurrent = () => {
			if (state.disposed
				|| generation !== state.recordingStartGeneration
				|| projectId !== runtime.getProjectId()) {
				throw runtime.abortError?.() || new DOMException('The recording start was superseded.', 'AbortError');
			}
		};
		return Object.freeze({ generation, projectId, assertCurrent });
	}

	function startRecording(options: RecordingStartOptions = {}): Promise<void> | undefined {
		const timedStart = isTimedStart(options);
		if (startBlocked() || (!timedStart && (state.timedRecordingPreparing || state.timedRecording))) {
			return undefined;
		}
		if (state.projectBinPreview) void runtime.stopProjectBinPreview?.();
		const scope = createStartScope();
		const operation = invokeAsPromise(() => runtime.beginRecording(options, scope));
		const tracked = operation.finally(() => {
			if (state.recordingStartPromise === tracked) {
				state.recordingStartPromise = null;
				publishDocumentSnapshot();
			}
		});
		state.recordingStartPromise = tracked;
		return tracked;
	}

	async function startRecordingOnNewTrack(options: RecordingStartOptions = {}): Promise<string | null> {
		if (state.readOnly || state.recordingStarting || state.recordingStartPromise
			|| state.timedRecordingPreparing
			|| state.timedRecording || state.recorder) return null;
		const trackId = runtime.addTrack?.({ armed: true }) || null;
		if (!trackId) return null;
		await startRecording({ ...options, trackId });
		return trackId;
	}

	function cancelRecordingStart(): boolean {
		if (!state.recordingStarting && !state.recordingStartPromise) return false;
		state.recordingStartGeneration += 1;
		state.recordingStarting = false;
		runtime.resetSoundActivationSources?.();
		if (!state.recorder) releaseInputs();
		return true;
	}

	function toggleRecordingPause(): boolean {
		if (!state.recorder) return false;
		if (state.recordingPaused) {
			const resumed = state.recorder.resume?.();
			if (resumed !== false) {
				state.recordingPaused = false;
				void runtime.playTransport?.();
				runtime.updateTransportState?.('recording');
			}
		} else {
			const paused = state.recorder.pause?.();
			if (paused !== false) {
				state.recordingPaused = true;
				runtime.pauseTransport?.();
				runtime.updateTransportState?.('paused-recording');
			}
		}
		publishDocumentSnapshot();
		return state.recordingPaused;
	}

	function toggleLeadInRecording(): boolean {
		if (state.recorder || state.recordingStarting || state.timedRecordingPreparing || state.timedRecording) {
			return state.leadInRecording;
		}
		state.leadInRecording = !state.leadInRecording;
		void runtime.persistLeadIn?.(state.leadInRecording);
		publishDocumentSnapshot();
		return state.leadInRecording;
	}

	function finalizationSnapshot(): RecordingFinalizationSnapshot | null {
		if (!state.recorder) return null;
		return Object.freeze({
			recorder: state.recorder,
			entries: state.recordingEntries,
			writer: state.recordingWriter,
			sourceId: state.recordingSourceId,
			trackId: state.recordingTrackId,
			startFrame: state.recordingStartFrame,
			sourceOffsetFrames: state.recordingSourceOffsetFrames,
			selection: state.recordingSelection,
			resampler: state.recordingResampler,
			sampleRate: state.recordingSampleRate,
			preview: state.recordingPreview,
			discardRequested: state.recordingDiscardRequested,
			fatalError: state.recordingFatalError,
		});
	}

	function resetFinalizedState(): void {
		try {
			state.recordingCleanup?.();
		} catch (error) {
			handleError(error);
		}
		state.recordingCleanup = null;
		state.recorder = null;
		state.recordingEntries = null;
		state.recordingWriter = null;
		state.recordingStream = null;
		state.recordingSourceId = null;
		state.recordingTrackId = null;
		state.recordingSelection = null;
		state.recordingResampler = null;
		state.recordingSampleRate = null;
		state.recordingSourceOffsetFrames = 0;
		state.recordingPreview = null;
		state.recordingPreviews = [];
		state.recordingPreviewLastPublishedAt = 0;
		state.recordingPaused = false;
		state.recordingFinishing = false;
		state.recordingFatalError = null;
		state.recordingDiscardRequested = false;
		state.inputMeterDb = -60;
		state.inputMeters = {};
		if (!runtime.retainInputs?.() || state.recordingReleaseAfterStop) {
			releaseInputs({ force: state.recordingReleaseAfterStop });
		}
		state.recordingReleaseAfterStop = false;
		runtime.resetSoundActivationSources?.();
		runtime.syncRecordingPoolSnapshot?.();
		runtime.publishTelemetrySnapshot?.();
		runtime.updateTransportState?.(runtime.getTransportState?.() || 'stopped');
		publishDocumentSnapshot();
	}

	async function performFinalizeRecording(): Promise<void> {
		if (!state.recorder || state.recordingFinishing) return;
		const snapshot = finalizationSnapshot();
		if (!snapshot) return;
		state.recordingFinishing = true;
		publishDocumentSnapshot();
		try {
			if (snapshot.entries) {
				await runtime.performRoutedFinalization({ ...snapshot, entries: snapshot.entries });
			} else await runtime.performLegacyFinalization(snapshot);
		} catch (error) {
			handleError(error);
		} finally {
			resetFinalizedState();
		}
	}

	function finalizeRecording(): Promise<void> {
		if (state.recordingFinalizePromise) return state.recordingFinalizePromise;
		if (!state.recorder || state.recordingFinishing) return Promise.resolve();
		const operation = performFinalizeRecording();
		const tracked = operation.finally(() => {
			if (state.recordingFinalizePromise === tracked) state.recordingFinalizePromise = null;
		});
		state.recordingFinalizePromise = tracked;
		return tracked;
	}

	async function stopRecording(): Promise<unknown> {
		if (state.timedRecording || state.timedRecordingPreparing) return runtime.cancelTimedRecording?.();
		if (state.recordingStarting) {
			cancelRecordingStart();
			publishDocumentSnapshot();
		}
		if (state.recordingFinalizePromise) return state.recordingFinalizePromise;
		if (!state.recorder) return undefined;
		let stopError: unknown = null;
		try {
			await state.recorder.stop();
		} catch (error) {
			stopError = error;
		}
		await finalizeRecording();
		if (stopError) throw stopError;
		return undefined;
	}

	return Object.freeze({
		cancelRecordingStart,
		finalizeRecording,
		startRecording,
		startRecordingOnNewTrack,
		stopRecording,
		toggleLeadInRecording,
		toggleRecordingPause,
	});
}
