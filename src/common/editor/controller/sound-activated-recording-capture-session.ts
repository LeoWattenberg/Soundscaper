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

/**
 * Own one sound-activation gate for one physical or display input. Routed
 * destinations deliberately consume the resulting segments after this layer.
 */
export function createSoundActivatedRecordingCaptureSession(
	port: RecordingSoundActivationPort | undefined,
	sourceValue: RecordingSoundActivationSource,
	isCurrent: () => boolean,
	reportError: (error: unknown) => void = () => {},
): SoundActivatedRecordingCaptureSession {
	const source = freezeSource(sourceValue);
	const settings = port ? port.getSettings(source) : null;
	const gate = settings === null ? null : createSoundActivatedRecordingGate(settings);

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
		const previous = gate.state;
		const filtered = filterSoundActivatedRecordingChunk(gate, chunk);
		if (filtered.transitions.length) {
			for (const transition of filtered.transitions) {
				publishDecisionState(transition.type === 'activated' ? 'capturing' : 'armed');
			}
		} else publishState(previous);
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
				const previous = gate.state;
				if (!gate.arm()) throw new Error('The sound activation gate could not be armed.');
				publishState(previous);
				try {
					controller.start(options);
				} catch (error) {
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
