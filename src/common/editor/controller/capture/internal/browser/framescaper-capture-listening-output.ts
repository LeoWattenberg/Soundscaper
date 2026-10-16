/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperWorkletRecordingController,
	FramescaperWorkletRecordingControllerFactory,
} from './framescaper-browser-audio-recorder.ts';

export interface FramescaperCaptureListeningGain {
	getGain(): number;
	subscribe(listener: () => void): () => void;
}

interface MonitoringContext {
	readonly currentTime: number;
	readonly destination: AudioNode;
	createGain(): GainNode;
}

/** A native source-rate context owns its speaker node and follows the editor's listening level. */
export function withFramescaperCaptureListeningOutput(
	factory: FramescaperWorkletRecordingControllerFactory,
	listening: FramescaperCaptureListeningGain,
): FramescaperWorkletRecordingControllerFactory {
	return async request => {
		if (!request.monitor) return factory(request);
		const context = monitoringContext(request.context);
		const output = context.createGain();
		let unsubscribe: (() => void) | null = null;
		let released = false;
		const release = () => {
			if (released) return;
			released = true;
			try { unsubscribe?.(); } finally { output.disconnect(); }
		};
		const update = () => {
			if (released) return;
			const gain = listening.getGain();
			output.gain.setValueAtTime(Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 1, context.currentTime);
		};
		let recorder: FramescaperWorkletRecordingController;
		try {
			update();
			output.connect(context.destination);
			unsubscribe = listening.subscribe(update);
			recorder = await factory({ ...request, monitorDestination: output });
		} catch (error) {
			release();
			throw error;
		}
		let completion: Promise<void> | null = null;
		const dispose = (stopTracks: boolean) => {
			completion ??= (async () => {
				try {
					if (!stopTracks && recorder.detach) await recorder.detach();
					else if (recorder.dispose) await recorder.dispose({ stopTracks });
					else await recorder.stop();
				} finally { release(); }
			})();
			return completion;
		};
		return {
			start: options => recorder.start(options),
			pause: () => recorder.pause(),
			resume: () => recorder.resume(),
			stop: () => recorder.stop(),
			detach: () => dispose(false),
			dispose: options => dispose(options?.stopTracks !== false),
		};
	};
}

function monitoringContext(value: unknown): MonitoringContext {
	if (!value || typeof value !== 'object' || !('currentTime' in value) || typeof value.currentTime !== 'number'
		|| !('createGain' in value) || typeof value.createGain !== 'function'
		|| !('destination' in value) || !value.destination || typeof value.destination !== 'object') {
		throw new TypeError('Capture monitoring requires its own audio context.');
	}
	return value as MonitoringContext;
}
