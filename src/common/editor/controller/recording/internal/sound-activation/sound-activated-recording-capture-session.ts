/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RecordingCaptureControllerLike } from '../recording-session-service.ts';
import type { RecordingActivationTimestamp } from '../../recording-model.ts';
import type {
	RecordingCaptureChunk,
	RecordingSoundActivationPort,
	RecordingSoundActivationSource,
} from '../../recording-transaction-types.ts';
import {
	filterSoundActivatedRecordingChunk,
	type SoundActivationAudioSegment,
	validateSoundActivationRecorderChunk,
} from './sound-activated-recording-chunk.ts';
import {
	createSoundActivatedRecordingGate,
	type SoundActivationGateState,
} from '../../sound-activated-recording-gate.ts';

export interface SoundActivatedRecordingCaptureSession {
	readonly enabled: boolean;
	readonly state: SoundActivationGateState | null;
	readonly activationTimestamps: readonly RecordingActivationTimestamp[];
	process(chunk: RecordingCaptureChunk): readonly SoundActivationAudioSegment[];
	wrapController(controller: RecordingCaptureControllerLike): RecordingCaptureControllerLike;
	cancel(): boolean;
}

export interface SoundActivatedRecordingCaptureOptions {
	/** Raw capture frames which precede project frame zero after latency compensation. */
	readonly sourceOffsetFrames?: number;
	readonly now?: () => number;
}

/**
 * Own one sound-activation gate for one physical or display input. Routed
 * destinations deliberately consume the resulting segments after this layer.
 */
export function createSoundActivatedRecordingCaptureSession(
	port: RecordingSoundActivationPort | undefined,
	sourceValue: RecordingSoundActivationSource,
	isCurrent: () => boolean,
	reportError: (error: unknown) => void = () => {},
	options: SoundActivatedRecordingCaptureOptions = {},
): SoundActivatedRecordingCaptureSession {
	const source = freezeSource(sourceValue);
	const sourceOffsetFrames = normalizeSourceOffsetFrames(options.sourceOffsetFrames);
	const now = options.now ?? Date.now;
	const settings = port ? port.getSettings(source) : null;
	const gate = settings === null ? null : createSoundActivatedRecordingGate(settings);
	const addTimestamps = gate !== null && (port?.getAddTimestamps?.(source) ?? false);
	const activationTimestamps: RecordingActivationTimestamp[] = [];
	let admittedFrames = 0;
	let scheduledStartFrame: number | null = null;
	let expectedNextFrame: number | null = null;
	let pendingPause: { resumed: boolean; flushed: boolean } | null = null;
	let phaseGeneration = 0;

	const session: SoundActivatedRecordingCaptureSession = {
		get enabled() { return gate !== null; },
		get state() { return currentState(); },
		activationTimestamps,
		process,
		wrapController,
		cancel,
	};
	return Object.freeze(session);

	function currentState(): SoundActivationGateState | null {
		if (!gate || gate.state === 'disarmed' || gate.state === 'cancelled') return gate?.state ?? null;
		if (pendingPause && !pendingPause.flushed) return pendingPause.resumed ? 'armed' : 'paused';
		return gate.state;
	}

	function publishState(previous: SoundActivationGateState): void {
		const state = currentState();
		if (state === null || state === previous || !isCurrent()) return;
		publishDecisionState(state);
	}

	function publishDecisionState(state: SoundActivationGateState): void {
		if (!isCurrent()) return;
		try {
			port?.setState(source, state);
		} catch (error) {
			// State observation cannot leave the controller and gate disagreeing.
			try { reportError(error); } catch { /* Error reporting is observational. */ }
		}
	}

	function process(chunk: RecordingCaptureChunk): readonly SoundActivationAudioSegment[] {
		if (!gate) {
			if (!chunk.channels[0]?.length) return Object.freeze([]);
			return Object.freeze([Object.freeze({
				frameStart: chunk.frameStart,
				frames: chunk.frames,
				channels: chunk.channels,
			})]);
		}
		const admitted = validateSoundActivationRecorderChunk(chunk);
		if (admitted.channels.length !== source.channelCount) {
			throw new RangeError('The sound activation chunk channel count changed during capture.');
		}
		if (expectedNextFrame !== null && admitted.frameStart !== expectedNextFrame) {
			throw new RangeError(
				`Sound activation chunks must be contiguous; expected frame ${expectedNextFrame}.`,
			);
		}
		const chunkEndFrame = admitted.frameStart + admitted.frames;
		const cutoffFrame = scheduledStartFrame === null
			? null
			: scheduledStartFrame + sourceOffsetFrames;
		const eligibleOffset = cutoffFrame === null
			? 0
			: Math.min(admitted.frames, Math.max(0, cutoffFrame - admitted.frameStart));
		if (eligibleOffset === admitted.frames) {
			expectedNextFrame = chunkEndFrame;
			return Object.freeze([]);
		}
		const eligibleChunk = eligibleOffset === 0 ? admitted : Object.freeze({
			frameStart: admitted.frameStart + eligibleOffset,
			frames: admitted.frames - eligibleOffset,
			channels: Object.freeze(admitted.channels.map((channel) => channel.slice(eligibleOffset))),
		});
		const previous = currentState()!;
		const filtered = filterSoundActivatedRecordingChunk(gate, eligibleChunk);
		const activationFrames = addTimestamps
			? new Set(filtered.transitions.filter((transition) => transition.type === 'activated')
				.map((transition) => transition.frame))
			: null;
		const chunkReceivedAtMs = activationFrames?.size ? now() : null;
		for (const segment of filtered.segments) {
			if (activationFrames?.has(segment.frameStart) && chunkReceivedAtMs !== null) {
				activationTimestamps.push(Object.freeze({
					offsetFrames: admittedFrames,
					occurredAtMs: Math.round(chunkReceivedAtMs - (
						chunkEndFrame - segment.frameStart
					) * 1_000 / source.sampleRate),
				}));
			}
			admittedFrames += segment.frames;
		}
		expectedNextFrame = chunkEndFrame;
		publishState(previous);
		return filtered.segments;
	}

	function cancel(): boolean {
		if (!gate) return false;
		const previous = currentState()!;
		const changed = gate.cancel();
		pendingPause = null;
		phaseGeneration += 1;
		publishState(previous);
		return changed;
	}

	function wrapController(
		controller: RecordingCaptureControllerLike,
	): RecordingCaptureControllerLike {
		if (!gate) return controller;
		const armStart = (options?: Readonly<{ startFrame?: number; stopFrame?: number }>) => {
			const startFrame = normalizeScheduledStartFrame(options?.startFrame, sourceOffsetFrames);
			if (startFrame !== null && startFrame > Number.MAX_SAFE_INTEGER - sourceOffsetFrames) {
				throw new RangeError('The sound activation latency cutoff exceeds the safe frame domain.');
			}
			const previous = gate.state;
			if (!gate.arm()) throw new Error('The sound activation gate could not be armed.');
			pendingPause = null;
			phaseGeneration += 1;
			scheduledStartFrame = startFrame;
			expectedNextFrame = null;
			publishState(previous);
		};
		return Object.freeze({
			get state() { return controller.state; },
			start(options?: Readonly<{ startFrame?: number; stopFrame?: number }>) {
				// The worklet can observe this message after the scheduled frame has
				// passed. Its first delivered chunk establishes the capture epoch;
				// subsequent chunks must still be exactly contiguous.
				armStart(options);
				try {
					controller.start(options);
				} catch (error) {
					scheduledStartFrame = null;
					expectedNextFrame = null;
					cancel();
					throw error;
				}
			},
			async startConfirmed(options: Readonly<{ startFrame: number; stopFrame?: number }>) {
				if (!controller.startConfirmed) throw new Error('The recording input cannot confirm its start.');
				armStart(options);
				try {
					const confirmed = await controller.startConfirmed(options);
					scheduledStartFrame = confirmed.startFrame;
					return confirmed;
				} catch (error) { cancel(); throw error; }
			},
			async rescheduleConfirmed(options: Readonly<{ startFrame: number; stopFrame?: number }>) {
				if (!controller.rescheduleConfirmed) throw new Error('The recording input cannot move its start.');
				const confirmed = await controller.rescheduleConfirmed(options);
				scheduledStartFrame = confirmed.startFrame;
				return confirmed;
			},
			pause() {
				const previous = currentState()!;
				if (previous !== 'armed' && previous !== 'capturing') return false;
				const priorPause = pendingPause;
				const boundary = { resumed: false, flushed: false };
				const generation = phaseGeneration;
				pendingPause = boundary;
				const finishPause = () => {
					if (generation !== phaseGeneration || gate.state === 'cancelled' || gate.state === 'disarmed') return;
					const previous = currentState()!;
					gate.pause();
					boundary.flushed = true;
					if (boundary.resumed) {
						gate.resume();
						expectedNextFrame = null;
					}
					publishState(previous);
				};
				let result: boolean | void;
				try {
					result = controller.pauseAfterFlush ? controller.pauseAfterFlush(finishPause) : controller.pause();
				} catch (error) { pendingPause = priorPause; throw error; }
				if (result === false) { pendingPause = priorPause; return false; }
				// The native worklet posts its partial PCM before paused. Preserve
				// the old gate until those writes drain, including an early Resume.
				if (!controller.pauseAfterFlush) finishPause();
				publishState(previous);
				return result;
			},
			resume() {
				if (currentState() !== 'paused') return false;
				const result = controller.resume();
				if (result === false) return false;
				if (pendingPause) pendingPause.resumed = true;
				if (!pendingPause || pendingPause.flushed) {
					if (!gate.resume()) return false;
					// Paused AudioContext time leaves a gap in the recorder's frame clock.
					expectedNextFrame = null;
				}
				publishState('paused');
				return result;
			},
			async stop() {
				// Stop flushes the worklet's final partial chunk and drains its
				// writes. Keep its gate live until that captured PCM is admitted.
				try { await controller.stop(); }
				finally { cancel(); }
			},
			dispose(options?: Readonly<{ stopTracks?: boolean }>) {
				cancel();
				return controller.dispose?.(options);
			},
			setMonitoring(enabled: boolean) { controller.setMonitoring(enabled); },
			setInputGain(value: number) { controller.setInputGain(value); },
		});
	}
}

function normalizeSourceOffsetFrames(value: unknown): number {
	if (value === undefined) return 0;
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Object.is(value, -0)) {
		throw new RangeError('The sound activation source offset is invalid.');
	}
	return Number(value);
}

function normalizeScheduledStartFrame(value: unknown, sourceOffsetFrames: number): number | null {
	if (value === undefined && sourceOffsetFrames === 0) return null;
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Object.is(value, -0)) {
		throw new RangeError('The sound activation scheduled start frame is invalid.');
	}
	return Number(value);
}

function freezeSource(value: RecordingSoundActivationSource): RecordingSoundActivationSource {
	if (!value || typeof value !== 'object') {
		throw new TypeError('A sound activation input source is required.');
	}
	if (typeof value.sourceKey !== 'string' || !value.sourceKey) {
		throw new TypeError('The sound activation input source key is invalid.');
	}
	if (value.kind !== 'device' && value.kind !== 'display') {
		throw new TypeError('The sound activation input kind is invalid.');
	}
	if (!Number.isSafeInteger(value.sampleRate) || value.sampleRate <= 0) {
		throw new RangeError('The sound activation input sample rate is invalid.');
	}
	if (!Number.isSafeInteger(value.channelCount) || value.channelCount <= 0) {
		throw new RangeError('The sound activation input channel count is invalid.');
	}
	return Object.freeze({
		sourceKey: value.sourceKey,
		kind: value.kind,
		sampleRate: value.sampleRate,
		channelCount: value.channelCount,
	});
}
