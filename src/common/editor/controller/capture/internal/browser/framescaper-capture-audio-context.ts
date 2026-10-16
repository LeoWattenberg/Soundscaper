/* SPDX-License-Identifier: AGPL-3.0-only */

export interface FramescaperOwnedCaptureAudioContext {
	readonly sampleRate: number;
	setSinkId?(sinkId: string): PromiseLike<void> | void;
	resume(): PromiseLike<void> | void;
	close(): PromiseLike<void> | void;
}

export type FramescaperCaptureAudioContextFactory = (sampleRate: number) => FramescaperOwnedCaptureAudioContext;

/** A worklet must write PCM on the selected track's actual sample grid. */
export async function acquireFramescaperCaptureAudioContext(
	shared: Readonly<{ sampleRate: number; sinkId?: string }>,
	sampleRate: number,
	createContext: FramescaperCaptureAudioContextFactory = createRuntimeContext,
): Promise<Readonly<{
	context: Readonly<{ sampleRate: number }>;
	dispose(): Promise<void>;
}>> {
	if (shared.sampleRate === sampleRate) return { context: shared, dispose: async () => undefined };
	const context = createContext(sampleRate);
	let disposed = false;
	const dispose = async (): Promise<void> => {
		if (disposed) return;
		disposed = true;
		await context.close();
	};
	try {
		if (context.sampleRate !== sampleRate) {
			throw new Error('Capture AudioWorklet context must retain the source track sample rate.');
		}
		if (shared.sinkId && shared.sinkId !== 'default') {
			if (!context.setSinkId) throw new Error('Capture monitoring cannot retain the selected output device.');
			await context.setSinkId(shared.sinkId);
		}
		await context.resume();
		return { context, dispose };
	} catch (error) {
		await dispose();
		throw error;
	}
}

function createRuntimeContext(sampleRate: number): FramescaperOwnedCaptureAudioContext {
	if (typeof globalThis.AudioContext !== 'function') {
		throw new Error('Capture AudioWorklet context must retain the source track sample rate.');
	}
	return new globalThis.AudioContext({ sampleRate });
}
