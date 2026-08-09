/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	RecordingControllerLike,
	RecordingStartOptions,
} from './recording-session-service.ts';

type MaybePromise<T> = T | PromiseLike<T>;

function invokeAsPromise<T>(operation: () => MaybePromise<T>): Promise<T> {
	try {
		return Promise.resolve(operation());
	} catch (error) {
		return Promise.reject(error);
	}
}

export interface TimedRecordingOptions {
	readonly trackId?: string;
}

export interface PreparedTimedRecordingInputs {
	readonly inputKeys: readonly string[];
}

export interface TimedRecordingPreparationScope {
	assertCurrent(): void;
}

export interface TimedRecordingDescriptor {
	readonly generation: number;
	readonly projectId: string | null;
	readonly startTimeMs: number;
	readonly options: Readonly<TimedRecordingOptions>;
	readonly inputKeys: readonly string[];
}

export interface TimedRecordingResult {
	readonly startTimeMs: number;
	readonly startTime: string;
	readonly trackId: string | null;
}

export interface TimedRecordingMutableState<TimerHandle = unknown> {
	readOnly: boolean;
	disposed: boolean;
	recorder: RecordingControllerLike | null;
	recordingStarting: boolean;
	recordingStartPromise: Promise<void> | null;
	recordingDiscardRequested: boolean;
	recordingReleaseAfterStop: boolean;
	timedRecording: TimedRecordingDescriptor | null;
	timedRecordingTimer: TimerHandle | null;
	timedRecordingGeneration: number;
	timedRecordingPreparing: boolean;
	timedRecordingCancelling: boolean;
}

export interface TimedRecordingMessages {
	readonly projectReadOnly: string;
	readonly past: string;
	readonly preparing: string;
	readonly missed: string;
	readonly scheduled: (formattedTime: string) => string;
	readonly cancelled: string;
}

export interface CancelTimedRecordingOptions {
	readonly releaseInputs?: boolean;
	readonly status?: boolean;
	readonly publish?: boolean;
}

export interface TimedRecordingServiceRuntime<TimerHandle = unknown> {
	readonly state: TimedRecordingMutableState<TimerHandle>;
	readonly getProjectId: () => string | null;
	readonly normalizeStartTime: (value: unknown) => number;
	readonly currentTimeMs: () => number;
	readonly prepareInputs: (
		options: Readonly<TimedRecordingOptions>,
		scope: TimedRecordingPreparationScope,
	) => MaybePromise<PreparedTimedRecordingInputs>;
	readonly prepareContext: () => MaybePromise<void>;
	readonly startRecording: (options: RecordingStartOptions) => Promise<void> | undefined;
	readonly cancelRecordingStart: () => boolean;
	readonly finalizeRecording: () => Promise<void>;
	readonly activatePreparedRecording: (
		scheduled: TimedRecordingDescriptor,
	) => MaybePromise<void>;
	readonly scheduleTimer: (callback: () => unknown, delayMs: number) => TimerHandle;
	readonly clearTimer: (handle: TimerHandle) => void;
	readonly messages: TimedRecordingMessages;
	readonly formatScheduledTime?: (startTimeMs: number) => string;
	readonly maximumTimerDelayMs?: number;
	readonly retainInputs?: () => boolean;
	readonly releaseUnretainedRecordingInputs?: (
		options?: Readonly<{ force?: boolean }>,
	) => void;
	readonly syncRecordingPoolSnapshot?: () => void;
	readonly publishDocumentSnapshot?: () => void;
	readonly setStatus?: (message: string, state?: 'info' | 'success' | 'error') => void;
	readonly handleError?: (error: unknown) => void;
	readonly abortError?: () => Error;
}

/**
 * Own timer preparation, generation invalidation, and prepared-recorder
 * disposal. Input capture and AudioContext resume are launched in parallel so
 * browser permission prompts remain attached to the confirming user action.
 */
export function createTimedRecordingService<TimerHandle>(
	runtime: TimedRecordingServiceRuntime<TimerHandle>,
) {
	const { state } = runtime;
	const maximumTimerDelayMs = runtime.maximumTimerDelayMs ?? 2_147_000_000;
	const publish = runtime.publishDocumentSnapshot || (() => {});
	const syncInputs = runtime.syncRecordingPoolSnapshot || (() => {});
	const releaseInputs = runtime.releaseUnretainedRecordingInputs || (() => {});
	const setStatus = runtime.setStatus || (() => {});
	const handleError = runtime.handleError || (() => {});
	const abortError = runtime.abortError || (() => new DOMException(
		'The timed recording was superseded.',
		'AbortError',
	));

	function isAbortError(error: unknown): boolean {
		return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
	}

	function assertScheduledGeneration(generation: number, projectId: string | null): void {
		if (generation !== state.timedRecordingGeneration
			|| state.disposed
			|| projectId !== runtime.getProjectId()) throw abortError();
	}

	function armTimedRecordingTimer(scheduled: TimedRecordingDescriptor): void {
		if (state.timedRecording !== scheduled) return;
		if (state.timedRecordingTimer !== null) runtime.clearTimer(state.timedRecordingTimer);
		const delay = Math.max(0, Math.min(
			maximumTimerDelayMs,
			scheduled.startTimeMs - runtime.currentTimeMs(),
		));
		state.timedRecordingTimer = runtime.scheduleTimer(() => {
			state.timedRecordingTimer = null;
			if (state.timedRecording !== scheduled) return null;
			if (scheduled.startTimeMs > runtime.currentTimeMs()) {
				armTimedRecordingTimer(scheduled);
				return null;
			}
			return beginTimedRecording(scheduled);
		}, delay);
	}

	async function beginTimedRecording(scheduled: TimedRecordingDescriptor): Promise<true | null> {
		if (state.timedRecording !== scheduled
			|| scheduled.projectId !== runtime.getProjectId()
			|| state.disposed) return null;
		if (!state.recorder) {
			cancelTimedRecording();
			return null;
		}
		state.timedRecording = null;
		state.timedRecordingTimer = null;
		try {
			await runtime.activatePreparedRecording(scheduled);
			return true;
		} catch (error) {
			handleError(error);
			void discardPreparedTimedRecording();
			return null;
		}
	}

	async function discardPreparedTimedRecording(): Promise<void> {
		const recorder = state.recorder;
		try {
			if (recorder && state.recorder === recorder) {
				try {
					await recorder.stop?.();
				} catch (error) {
					handleError(error);
				}
				await runtime.finalizeRecording();
			}
		} catch (error) {
			handleError(error);
		} finally {
			state.timedRecordingCancelling = false;
			if (!state.recorder) {
				syncInputs();
				publish();
			}
		}
	}

	function cancelTimedRecording(options: CancelTimedRecordingOptions = {}): boolean {
		const hadTimer = Boolean(
			state.timedRecording
			|| state.timedRecordingPreparing
			|| state.timedRecordingTimer !== null,
		);
		const hadPreparedRecorder = Boolean(hadTimer && state.recorder);
		state.timedRecordingGeneration += 1;
		if (state.timedRecordingTimer !== null) runtime.clearTimer(state.timedRecordingTimer);
		state.timedRecordingTimer = null;
		state.timedRecording = null;
		state.timedRecordingPreparing = false;
		state.timedRecordingCancelling = hadPreparedRecorder;
		if (hadPreparedRecorder) state.recordingDiscardRequested = true;
		if (state.recordingStarting) runtime.cancelRecordingStart();
		if (hadPreparedRecorder) void discardPreparedTimedRecording();
		if (hadTimer && options.releaseInputs !== false) {
			releaseInputs({ force: true });
			state.recordingReleaseAfterStop = false;
			syncInputs();
		}
		if (options.status !== false && hadTimer) setStatus(runtime.messages.cancelled);
		else if (options.publish !== false) publish();
		return hadTimer;
	}

	async function scheduleTimedRecording(
		startTime: unknown,
		options: TimedRecordingOptions = {},
	): Promise<TimedRecordingResult | null> {
		if (state.readOnly) throw new Error(runtime.messages.projectReadOnly);
		if (state.recordingStarting || state.recordingStartPromise || state.recorder) return null;
		if (state.timedRecordingPreparing) return null;
		const startTimeMs = runtime.normalizeStartTime(startTime);
		if (startTimeMs <= runtime.currentTimeMs()) throw new RangeError(runtime.messages.past);
		const recordingOptions: Readonly<TimedRecordingOptions> = options.trackId
			? Object.freeze({ trackId: String(options.trackId) })
			: Object.freeze({});
		if (state.timedRecording) cancelTimedRecording({ releaseInputs: false, status: false });
		const generation = ++state.timedRecordingGeneration;
		const projectId = runtime.getProjectId();
		state.timedRecordingPreparing = true;
		state.timedRecordingCancelling = false;
		setStatus(runtime.messages.preparing);

		const preparationScope = Object.freeze({
			assertCurrent: () => assertScheduledGeneration(generation, projectId),
		});
		const inputPromise = invokeAsPromise(() => runtime.prepareInputs(recordingOptions, preparationScope));
		const contextPromise = invokeAsPromise(runtime.prepareContext);
		try {
			const [preparedInputs] = await Promise.all([inputPromise, contextPromise]);
			assertScheduledGeneration(generation, projectId);
			syncInputs();
			const scheduled: TimedRecordingDescriptor = Object.freeze({
				generation,
				projectId,
				startTimeMs,
				options: recordingOptions,
				inputKeys: Object.freeze([...preparedInputs.inputKeys]),
			});
			state.timedRecording = scheduled;
			await runtime.startRecording({
				...recordingOptions,
				timedStartTimeMs: startTimeMs,
				timedGeneration: generation,
				reusePreparedInputsOnly: true,
			});
			assertScheduledGeneration(generation, projectId);
			if (state.timedRecording !== scheduled) throw abortError();
			if (!state.recorder) throw new Error(runtime.messages.missed || runtime.messages.past);
			armTimedRecordingTimer(scheduled);
			const formatted = runtime.formatScheduledTime?.(startTimeMs)
				|| new Date(startTimeMs).toLocaleString();
			setStatus(runtime.messages.scheduled(formatted), 'success');
			return Object.freeze({
				startTimeMs,
				startTime: new Date(startTimeMs).toISOString(),
				trackId: recordingOptions.trackId || null,
			});
		} catch (error) {
			if (generation === state.timedRecordingGeneration) state.timedRecording = null;
			if (generation === state.timedRecordingGeneration && !runtime.retainInputs?.()) {
				releaseInputs();
				syncInputs();
			}
			if (generation !== state.timedRecordingGeneration || isAbortError(error)) return null;
			throw error;
		} finally {
			if (generation === state.timedRecordingGeneration) {
				state.timedRecordingPreparing = false;
				publish();
			}
		}
	}

	return Object.freeze({
		cancelTimedRecording,
		scheduleTimedRecording,
	});
}
