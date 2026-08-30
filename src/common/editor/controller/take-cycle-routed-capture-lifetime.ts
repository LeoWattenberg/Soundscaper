/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	RecordingAudioContext,
	RecordingMediaStream,
} from './recording-transaction-types.ts';

interface ObservedSource {
	readonly sourceKey: string;
	readonly kind: 'device' | 'display';
	readonly stream: RecordingMediaStream;
}

/** Own every browser lifetime signal that can invalidate continuous cycle PCM. */
export function observeTakeCycleRoutedCaptureLifetime<Source extends ObservedSource>(options: Readonly<{
	readonly context: RecordingAudioContext;
	readonly sources: readonly Source[];
	isLive(stream: RecordingMediaStream, kind: ObservedSource['kind']): boolean;
	onInterrupted(error: Error, source: Source | null): void;
}>): () => void {
	const removers: Array<() => void> = [];
	let interrupted = false;
	let disposed = false;
	const interrupt = (error: Error, source: Source | null) => {
		if (interrupted || disposed) return;
		interrupted = true;
		options.onInterrupted(error, source);
	};
	for (const source of options.sources) {
		const ended = () => interrupt(new Error(
			`Take cycle routed input ${source.sourceKey} ended unexpectedly.`,
		), source);
		for (const track of source.stream.getTracks?.() ?? []) {
			track.addEventListener?.('ended', ended, { once: true });
			removers.push(() => track.removeEventListener?.('ended', ended));
		}
		if (!options.isLive(source.stream, source.kind)) ended();
	}
	const contextStateChange = () => {
		const state = options.context.state;
		if (state === 'suspended' || state === 'closed' || state === 'interrupted') {
			interrupt(new Error(`Take cycle routed audio context became ${state}.`), null);
		}
	};
	options.context.addEventListener?.('statechange', contextStateChange);
	removers.push(() => options.context.removeEventListener?.('statechange', contextStateChange));
	contextStateChange();
	return () => {
		if (disposed) return;
		disposed = true;
		for (const remove of removers.splice(0)) remove();
	};
}
