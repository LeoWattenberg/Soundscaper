/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	BrowserCaptureStream,
	BrowserCaptureTrack,
} from './framescaper-browser-capture-source.ts';

interface CloneableAudioTrack extends BrowserCaptureTrack {
	clone(): CloneableAudioTrack;
}

interface MonitorNode {
	connect(destination: unknown): unknown;
	disconnect(): void;
}

interface MonitorGainNode extends MonitorNode {
	readonly gain: { value: number };
}

interface WebVcrMonitorAudioContext {
	readonly destination: unknown;
	readonly state?: string;
	resume?(): PromiseLike<void> | void;
	createMediaStreamSource(stream: BrowserCaptureStream): MonitorNode;
	createGain(): MonitorGainNode;
}

export interface WebVcrAudioMonitor {
	readonly muted: boolean;
	setMuted(value: boolean): void;
	dispose(): void;
}

/** Monitors an owned clone; the recorder's page-audio track is never gain-mutated. */
export function createWebVcrAudioMonitor(options: Readonly<{
	readonly track: CloneableAudioTrack;
	readonly context: WebVcrMonitorAudioContext;
	readonly createStream: (tracks: readonly BrowserCaptureTrack[]) => BrowserCaptureStream;
	readonly muted?: boolean;
}>): Readonly<WebVcrAudioMonitor> {
	if (!options.track || typeof options.track.clone !== 'function') {
		throw new TypeError('Web VCR monitoring requires a cloneable page-audio track.');
	}
	const clone = options.track.clone();
	let source: MonitorNode | null = null;
	let gain: MonitorGainNode | null = null;
	let muted = options.muted === true;
	let disposed = false;
	try {
		source = options.context.createMediaStreamSource(options.createStream([clone]));
		gain = options.context.createGain();
		gain.gain.value = muted ? 0 : 1;
		source.connect(gain);
		gain.connect(options.context.destination);
	} catch (error) {
		releaseMonitorOwnership(clone, source, gain);
		throw error;
	}
	const connectedSource = source;
	const connectedGain = gain;
	return Object.freeze({
		get muted() { return muted; },
		setMuted(value: boolean) {
			if (disposed) throw new Error('Web VCR audio monitor is disposed.');
			muted = value === true;
			connectedGain.gain.value = muted ? 0 : 1;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			releaseMonitorOwnership(clone, connectedSource, connectedGain);
		},
	});
}

function releaseMonitorOwnership(
	clone: CloneableAudioTrack,
	source: MonitorNode | null,
	gain: MonitorGainNode | null,
): void {
	try { source?.disconnect(); } catch { /* Nodes may already be disconnected. */ }
	try { gain?.disconnect(); } catch { /* Nodes may already be disconnected. */ }
	try { clone.stop(); } catch { /* A revoked clone may already be stopped. */ }
}
