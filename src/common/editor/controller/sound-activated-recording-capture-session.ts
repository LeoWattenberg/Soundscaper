/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RecordingCaptureControllerLike } from './recording-session-service.ts';
import type {
	RecordingCaptureChunk,
	RecordingSoundActivationPort,
	RecordingSoundActivationSource,
} from './recording-transaction-types.ts';
import {
	filterSoundActivatedRecordingChunk,
	type SoundActivationAudioSegment,
	validateSoundActivationRecorderChunk,
} from './sound-activated-recording-chunk.ts';
import {
	createSoundActivatedRecordingGate,
	type SoundActivationGateState,
} from './sound-activated-recording-gate.ts';

export interface SoundActivatedRecordingCaptureSession {
	readonly enabled: boolean;
	readonly state: SoundActivationGateState | null;
	process(chunk: RecordingCaptureChunk): readonly SoundActivationAudioSegment[];
	wrapController(controller: RecordingCaptureControllerLike): RecordingCaptureControllerLike;
	cancel(): boolean;
}

export interface SoundActivatedRecordingCaptureOptions {
	/** Raw capture frames which precede project frame zero after latency compensation. */
	readonly sourceOffsetFrames?: number;
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
	const settings = port ? port.getSettings(source) : null;
	const gate = settings === null ? null : createSoundActivatedRecordingGate(settings);
	let scheduledStartFrame: number | null = null;
	let expectedNextFrame: number | null = null;

	const session: SoundActivatedRecordingCaptureSession = {
		get enabled() { return gate !== null; },
		get state() { return gate?.state ?? null; },
		process,
		wrapController,
		cancel,
	};
	return Object.freeze(session);

	function publishState(previous: SoundActivationGateState): void {
		if (!gate || gate.state === previous || !isCurrent()) return;
		publishDecisionState(gate.state);
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
		const previous = gate.state;
		const filtered = filterSoundActivatedRecordingChunk(gate, eligibleChunk);
		expectedNextFrame = chunkEndFrame;
		publishState(previous);
		return filtered.segments;
	}

	function cancel(): boolean {
		if (!gate) return false;
		const previous = gate.state;
		const changed = gate.cancel();
		publishState(previous);
		return changed;
	}

	function wrapController(
		controller: RecordingCaptureControllerLike,
	): RecordingCaptureControllerLike {
		if (!gate) return controller;
		return Object.freeze({
			get state() { return controller.state; },
			start(options?: Readonly<{ startFrame?: number; stopFrame?: number }>) {
				const startFrame = normalizeScheduledStartFrame(options?.startFrame, sourceOffsetFrames);
				if (startFrame !== null && startFrame > Number.MAX_SAFE_INTEGER - sourceOffsetFrames) {
					throw new RangeError('The sound activation latency cutoff exceeds the safe frame domain.');
				}
				const previous = gate.state;
				if (!gate.arm()) throw new Error('The sound activation gate could not be armed.');
				scheduledStartFrame = startFrame;
				expectedNextFrame = startFrame;
				publishState(previous);
				try {
					controller.start(options);
				} catch (error) {
					scheduledStartFrame = null;
					expectedNextFrame = null;
					cancel();
					throw error;
				}
			},
			pause() {
				if (gate.state !== 'armed' && gate.state !== 'capturing') return false;
				const result = controller.pause();
				if (result === false) return false;
				const previous = gate.state;
				if (!gate.pause()) return false;
				publishState(previous);
				return result;
			},
			resume() {
				if (gate.state !== 'paused') return false;
				const result = controller.resume();
				if (result === false) return false;
				const previous = gate.state;
				if (!gate.resume()) return false;
				// A worklet pause intentionally advances AudioContext time without
				// producing PCM. The first resumed chunk begins a new contiguous epoch.
				expectedNextFrame = null;
				publishState(previous);
				return result;
			},
			stop() {
				cancel();
				return controller.stop();
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
