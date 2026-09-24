/* SPDX-License-Identifier: AGPL-3.0-only */

import { readRecordingSourceMetadata } from './recording-source-metadata.ts';
import { createNonImportedSourceProvenance } from '../../../source-provenance-root.ts';

import type { RecordingPreview } from '../recording-model.ts';
import type {
	LegacyRecordingFinalizationTransaction,
	RecordedAudioSource,
	RecordingFinalizationCommonRuntime,
	RecordingFinalizationInput,
	RecordingSegmentPunch,
} from './recording-finalization-types.ts';
import type {
	RecordingPreviewResampler,
	RecordingSelection,
	RecordingSourceWriter,
} from '../recording-transaction-types.ts';
import {
	cleanupCommittedRecordingSource,
	throwRecordingFinalizationFailure,
} from './recording-finalization-cleanup.ts';
import { createSoundActivationTimestampCommands } from './sound-activation/sound-activation-timestamp-labels.ts';
import { finishRecordingSegments } from './recording-finalization-segments.ts';

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
		const committedSourceIds = new Set<string>();
		let completionError: unknown = transaction.fatalError;
		let projectPublished = false;
		try {
			const projectScope = runtime.captureProjectScope();
			projectScope.assertCurrent();
			runtime.pauseTransport();
			try {
				await runtime.disposeRecorder(transaction.recorder);
			} catch (error) {
				completionError ??= error;
			}
			projectScope.assertCurrent();
			if (transaction.discardRequested) {
				await transaction.writer.abort().catch(() => undefined);
				for (const checkpoint of transaction.writer.checkpoints ?? []) {
					await cleanupCommittedRecordingSource({
						sourceId: checkpoint.sourceId,
						deactivateSource: runtime.deactivateSource,
						deleteStoredSource: runtime.deleteStoredSource,
					});
				}
				return;
			}
			try {
				runtime.appendPreview(transaction.preview, transaction.resampler?.finish?.());
			} catch (error) {
				completionError ??= error;
			}
			const frames = transaction.writer.framesWritten;
			if (frames <= transaction.sourceOffsetFrames && !transaction.writer.checkpoints?.length) {
				await transaction.writer.abort();
				if (transaction.preview?.timelineMode === 'compacted') {
					runtime.setTransportPosition(transaction.startFrame);
				}
				if (completionError) throw completionError;
				return;
			}
			const projectRate = runtime.projectSampleRate(projectScope.project);
			const sampleRate = transaction.sampleRate || projectRate;
			const finished = await finishRecordingSegments(transaction.writer, transaction.sourceId, { sampleRate });
			if (finished.failure && !completionError) completionError = finished.failure;
			for (const segment of finished.segments) committedSourceIds.add(segment.sourceId);
			projectScope.assertCurrent();
			const punches: RecordingSegmentPunch[] = [];
			for (const segment of finished.segments) {
				const sourceEnd = segment.frameStart + segment.frameCount;
				const visibleStart = Math.max(segment.frameStart, transaction.sourceOffsetFrames);
				const startFrame = transaction.startFrame + runtime.scaleFrames(
					visibleStart - transaction.sourceOffsetFrames, sampleRate, projectRate,
				);
				const endFrame = Math.min(
					transaction.startFrame + runtime.scaleFrames(
						Math.max(0, sourceEnd - transaction.sourceOffsetFrames), sampleRate, projectRate,
					),
					transaction.selection
						? transaction.startFrame + transaction.selection.endFrame - transaction.selection.startFrame
						: Infinity,
				);
				if (sourceEnd <= visibleStart || endFrame <= startFrame) {
					const cleanupFailures = await cleanupCommittedRecordingSource({
						sourceId: segment.sourceId,
						deactivateSource: runtime.deactivateSource,
						deleteStoredSource: runtime.deleteStoredSource,
					});
					if (cleanupFailures.length) throwRecordingFinalizationFailure(
						new Error('Unused recording checkpoint cleanup failed.'), cleanupFailures,
					);
					committedSourceIds.delete(segment.sourceId);
					continue;
				}
				const metadata = readRecordingSourceMetadata(segment.metadata);
				const source: RecordedAudioSource = Object.freeze({
					sampleRate,
					originalSampleRate: sampleRate,
					sampleFormat: 'float32',
					chunkFrames: runtime.sourceChunkFrames,
					id: segment.sourceId,
					storageKey: segment.sourceId,
					name: metadata.name,
					mimeType: 'audio/wav',
					frameCount: segment.frameCount,
					channelCount: metadata.channelCount || 1,
					provenance: createNonImportedSourceProvenance('recorded'),
				});
				await runtime.activateStoredSource(source, metadata);
				projectScope.assertCurrent();
				const sourceStartFrame = visibleStart - segment.frameStart;
				const availableFrames = segment.frameCount - sourceStartFrame;
				const durationFrames = endFrame - startFrame;
				const sourceDurationFrames = transaction.selection
					? Math.min(availableFrames, Math.max(1, runtime.scaleFrames(durationFrames, projectRate, sampleRate)))
					: availableFrames;
				punches.push({ source, punch: {
					trackId: transaction.trackId,
					startFrame,
					endFrame,
					sourceId: segment.sourceId,
					sourceStartFrame,
					sourceDurationFrames,
					clipId: runtime.createStableId('clip'),
				} });
			}
			projectScope.assertCurrent();
			if (punches.length) {
				const commands = punches.length === 1
					? [runtime.createAddSourceCommand(punches[0]!.source), runtime.preparePunchCommand(
						projectScope.project, punches[0]!.punch,
					)]
					: runtime.preparePunchSequence(projectScope.project, punches);
				const labelCommands = createSoundActivationTimestampCommands({
					project: projectScope.project,
					labelTrackName: runtime.labelTrackName ?? 'Labels',
					projectSampleRate: projectRate,
					createId: runtime.createStableId,
					timestamps: (transaction.preview?.activationFrameOffsets ?? []).map((offsetFrames) => ({
						startFrame: transaction.startFrame,
						offsetFrames,
						sampleRate,
					})),
				});
				runtime.commitBatch(projectScope.project, [...commands, ...labelCommands], {
					selectTrackId: transaction.trackId,
					selectClipId: punches[0]!.punch.clipId,
				});
				projectPublished = true;
				if (transaction.preview?.timelineMode === 'compacted') {
					runtime.setTransportPosition(punches.at(-1)!.punch.endFrame);
				}
				if (!completionError) runtime.setStatusDone();
			}
		} catch (error) {
			if (projectPublished) throw error;
			await transaction.writer.abort().catch(() => undefined);
			for (const checkpoint of transaction.writer.checkpoints ?? []) {
				committedSourceIds.add(checkpoint.sourceId);
			}
			const cleanupFailures: unknown[] = [];
			for (const sourceId of committedSourceIds) {
				cleanupFailures.push(...await cleanupCommittedRecordingSource({
					sourceId,
					deactivateSource: runtime.deactivateSource,
					deleteStoredSource: runtime.deleteStoredSource,
				}));
			}
			throwRecordingFinalizationFailure(error, cleanupFailures);
		}
		if (completionError) throw completionError;
	}

	return Object.freeze({ finalize });
}
