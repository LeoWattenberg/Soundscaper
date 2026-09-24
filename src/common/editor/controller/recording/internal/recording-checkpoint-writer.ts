/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	RecordingSourceSegment,
	RecordingSourceWriter,
	RecordingWriterFinish,
} from '../recording-transaction-types.ts';

interface CheckpointWriterOptions {
	readonly firstSourceId: string;
	readonly initialWriter: RecordingSourceWriter;
	readonly metadata: Readonly<Record<string, unknown>>;
	readonly checkpointFrames: number;
	readonly createSourceId: () => string;
	readonly openWriter: (sourceId: string) => Promise<RecordingSourceWriter>;
}

/** Commit short immutable source segments while capture is still running. */
export function createRecordingCheckpointWriter(options: CheckpointWriterOptions): RecordingSourceWriter {
	if (!Number.isSafeInteger(options.checkpointFrames) || options.checkpointFrames < 1) {
		throw new RangeError('Recording checkpoint length must be a positive frame count.');
	}
	const committed: RecordingSourceSegment[] = [];
	let active: RecordingSourceWriter | null = options.initialWriter;
	let activeSourceId = options.firstSourceId;
	let committedFrames = 0;
	let failure: unknown = null;
	let closed = false;
	let finishing: Promise<RecordingWriterFinish> | null = null;

	const snapshot = (): readonly RecordingSourceSegment[] => Object.freeze([...committed]);
	const commitActive = async (metadata: Readonly<Record<string, unknown>>): Promise<void> => {
		const writer = active;
		if (!writer || writer.framesWritten <= 0) return;
		const frameCount = writer.framesWritten;
		const storedMetadata = await writer.commit(metadata);
		committed.push(Object.freeze({
			sourceId: activeSourceId,
			frameStart: committedFrames,
			frameCount,
			metadata: storedMetadata,
		}));
		committedFrames += frameCount;
		active = null;
	};
	const failActive = async (error: unknown): Promise<void> => {
		failure = error;
		closed = true;
		const writer = active;
		active = null;
		await writer?.abort().catch(() => undefined);
	};

	return Object.freeze({
		get framesWritten() { return committedFrames + (active?.framesWritten ?? 0); },
		get checkpoints() { return snapshot(); },
		async write(channels: readonly Float32Array[]) {
			if (closed) throw failure ?? new Error('The recording writer is closed.');
			try {
				if (!active) {
					activeSourceId = options.createSourceId();
					active = await options.openWriter(activeSourceId);
				}
				await active.write(channels);
				if (active.framesWritten >= options.checkpointFrames) await commitActive(options.metadata);
			} catch (error) {
				await failActive(error);
				throw error;
			}
		},
		async commit(metadata: Readonly<Record<string, unknown>> = {}) {
			const result = await this.finishRecording(metadata);
			if (result.failure) throw result.failure;
			return result.segments.at(-1)?.metadata;
		},
		finishRecording(metadata: Readonly<Record<string, unknown>> = {}) {
			if (finishing) return finishing;
			closed = true;
			finishing = (async (): Promise<RecordingWriterFinish> => {
				if (!failure && active?.framesWritten) {
					try {
						await commitActive(metadata);
					} catch (error) {
						await failActive(error);
					}
				} else if (active) {
					await active.abort().catch(() => undefined);
					active = null;
				}
				return Object.freeze({ segments: snapshot(), ...(failure ? { failure } : {}) });
			})();
			return finishing;
		},
		async abort() {
			closed = true;
			const writer = active;
			active = null;
			await writer?.abort();
		},
	});
}
