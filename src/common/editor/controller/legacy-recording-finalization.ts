/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RecordingPreview } from './recording-model.ts';
import type {
	LegacyRecordingFinalizationTransaction,
	RecordedAudioSource,
	RecordingFinalizationCommonRuntime,
	RecordingFinalizationInput,
} from './recording-finalization-types.ts';
import type {
	RecordingPreviewResampler,
	RecordingSelection,
	RecordingSourceWriter,
} from './recording-transaction-types.ts';

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
	return Boolean(value) && typeof value === 'object';
}

function requireWriter(value: unknown): RecordingSourceWriter {
	if (!isObject(value)
		|| typeof value.framesWritten !== 'number'
		|| typeof value.write !== 'function'
		|| typeof value.commit !== 'function'
		|| typeof value.abort !== 'function') {
		throw new TypeError('The recording finalization writer is invalid.');
	}
	return value as unknown as RecordingSourceWriter;
}

function optionalSelection(value: unknown): RecordingSelection | null {
	if (value == null) return null;
	if (!isObject(value)
		|| !Number.isFinite(Number(value.startFrame))
		|| !Number.isFinite(Number(value.endFrame))) {
		throw new TypeError('The recording finalization selection is invalid.');
	}
	return Object.freeze({ startFrame: Number(value.startFrame), endFrame: Number(value.endFrame) });
}

function optionalResampler(value: unknown): RecordingPreviewResampler | null {
	if (value == null) return null;
	if (!isObject(value) || typeof value.push !== 'function') {
		throw new TypeError('The recording finalization resampler is invalid.');
	}
	return value as unknown as RecordingPreviewResampler;
}

function optionalPreview(value: unknown): RecordingPreview | null {
	if (value == null) return null;
	if (!isObject(value)) throw new TypeError('The recording finalization preview is invalid.');
	return value as unknown as RecordingPreview;
}

/** Validate and freeze all mutable controller fields before the first await. */
export function snapshotLegacyRecordingFinalization(
	input: RecordingFinalizationInput,
): LegacyRecordingFinalizationTransaction {
	if (!input.sourceId || !input.trackId) {
		throw new TypeError('The recording finalization source and track are required.');
	}
	return Object.freeze({
		recorder: input.recorder,
		writer: requireWriter(input.writer),
		sourceId: input.sourceId,
		trackId: input.trackId,
		startFrame: input.startFrame,
		sourceOffsetFrames: input.sourceOffsetFrames,
		selection: optionalSelection(input.selection),
		resampler: optionalResampler(input.resampler),
		sampleRate: input.sampleRate,
		preview: optionalPreview(input.preview),
		discardRequested: input.discardRequested,
		fatalError: input.fatalError,
	});
}

/** Commit one default-input take against an explicitly captured project. */
export function createLegacyRecordingFinalization(runtime: RecordingFinalizationCommonRuntime) {
	async function finalize(input: RecordingFinalizationInput): Promise<void> {
		const transaction = snapshotLegacyRecordingFinalization(input);
		let sourceCommitted = false;
		try {
			const projectScope = runtime.captureProjectScope();
			projectScope.assertCurrent();
			runtime.pauseTransport();
			await runtime.disposeRecorder(transaction.recorder);
			projectScope.assertCurrent();
			if (transaction.discardRequested) {
				await transaction.writer.abort().catch(() => undefined);
				return;
			}
			if (transaction.fatalError) throw transaction.fatalError;
			runtime.appendPreview(transaction.preview, transaction.resampler?.finish?.());
			const frames = transaction.writer.framesWritten;
			if (frames <= transaction.sourceOffsetFrames) {
				await transaction.writer.abort();
				return;
			}
			const projectRate = runtime.projectSampleRate(projectScope.project);
			const sampleRate = transaction.sampleRate || projectRate;
			const metadata = await transaction.writer.commit({ sampleRate });
			sourceCommitted = true;
			projectScope.assertCurrent();
			const source: RecordedAudioSource = Object.freeze({
				schemaVersion: 2,
				sampleRate,
				originalSampleRate: sampleRate,
				sampleFormat: 'float32',
				chunkFrames: runtime.sourceChunkFrames,
				id: transaction.sourceId,
				storageKey: transaction.sourceId,
				name: metadata.name,
				mimeType: 'audio/wav',
				frameCount: frames,
				channelCount: metadata.channelCount || 1,
			});
			const sourceCommand = runtime.createAddSourceCommand(source);
			await runtime.activateStoredSource(source, metadata);
			projectScope.assertCurrent();
			const selection = transaction.selection;
			const clipId = runtime.createStableId('clip');
			const sourceStartFrame = Math.min(
				transaction.sourceOffsetFrames,
				Math.max(0, frames - 1),
			);
			const availableFrames = frames - sourceStartFrame;
			const availableProjectFrames = Math.max(
				1,
				runtime.scaleFrames(availableFrames, sampleRate, projectRate),
			);
			const durationFrames = selection
				? Math.min(availableProjectFrames, selection.endFrame - selection.startFrame)
				: availableProjectFrames;
			const sourceDurationFrames = selection
				? Math.min(
					availableFrames,
					Math.max(1, runtime.scaleFrames(durationFrames, projectRate, sampleRate)),
				)
				: availableFrames;
			const clipCommand = runtime.preparePunchCommand(projectScope.project, {
				trackId: transaction.trackId,
				startFrame: transaction.startFrame,
				endFrame: transaction.startFrame + durationFrames,
				sourceId: transaction.sourceId,
				sourceStartFrame,
				sourceDurationFrames,
				clipId,
			});
			projectScope.assertCurrent();
			runtime.commitBatch(projectScope.project, [sourceCommand, clipCommand], {
				selectTrackId: transaction.trackId,
				selectClipId: clipId,
			});
			runtime.setStatusDone();
		} catch (error) {
			await transaction.writer.abort().catch(() => undefined);
			if (sourceCommitted) {
				runtime.deactivateSource(transaction.sourceId);
				await runtime.deleteStoredSource(transaction.sourceId).catch(() => undefined);
			}
			throw error;
		}
	}

	return Object.freeze({ finalize });
}
