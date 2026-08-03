/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RecordingPreview } from './recording-model.ts';
import type {
	RecordedAudioSource,
	RecordingFinalizationInput,
	RoutedRecordingFinalizationRuntime,
	RoutedRecordingFinalizationTransaction,
} from './recording-finalization-types.ts';
import type {
	RecordingPreviewResampler,
	RecordingRoute,
	RecordingSelection,
	RecordingSourceWriter,
	RoutedRecordingEntry,
} from './recording-transaction-types.ts';
import {
	cleanupCommittedRecordingSource,
	throwRecordingFinalizationFailure,
} from './recording-finalization-cleanup.ts';

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
	return Boolean(value) && typeof value === 'object';
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`Recording entry ${field} is invalid.`);
	return value;
}

function requireNumber(value: unknown, field: string): number {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new TypeError(`Recording entry ${field} is invalid.`);
	return number;
}

function requireWriter(value: unknown): RecordingSourceWriter {
	if (!isObject(value)
		|| typeof value.framesWritten !== 'number'
		|| typeof value.write !== 'function'
		|| typeof value.commit !== 'function'
		|| typeof value.abort !== 'function') {
		throw new TypeError('The routed recording writer is invalid.');
	}
	return value as unknown as RecordingSourceWriter;
}

function requireRoute(value: unknown): RecordingRoute {
	if (!isObject(value) || (value.kind !== 'device' && value.kind !== 'display')) {
		throw new TypeError('The routed recording route is invalid.');
	}
	return Object.freeze({
		kind: value.kind,
		deviceId: String(value.deviceId || ''),
		channelStart: requireNumber(value.channelStart, 'route channel start'),
		channelCount: requireNumber(value.channelCount, 'route channel count'),
	});
}

function optionalSelection(value: unknown): RecordingSelection | null {
	if (value == null) return null;
	if (!isObject(value)) throw new TypeError('The routed recording selection is invalid.');
	return Object.freeze({
		startFrame: requireNumber(value.startFrame, 'selection start'),
		endFrame: requireNumber(value.endFrame, 'selection end'),
	});
}

function requireEntry(value: unknown): RoutedRecordingEntry {
	if (!isObject(value) || !isObject(value.preview) || !isObject(value.previewResampler)
		|| typeof value.previewResampler.push !== 'function') {
		throw new TypeError('The routed recording entry is invalid.');
	}
	return Object.freeze({
		trackId: requireString(value.trackId, 'track id'),
		route: requireRoute(value.route),
		sourceKey: requireString(value.sourceKey, 'source key'),
		sourceId: requireString(value.sourceId, 'source id'),
		writer: requireWriter(value.writer),
		previewResampler: value.previewResampler as unknown as RecordingPreviewResampler,
		preview: value.preview as unknown as RecordingPreview,
		sampleRate: requireNumber(value.sampleRate, 'sample rate'),
		selection: optionalSelection(value.selection),
		recordingStartFrame: requireNumber(value.recordingStartFrame, 'start frame'),
		sourceOffsetFrames: requireNumber(value.sourceOffsetFrames, 'source offset'),
		sourceOffsetProjectFrames: requireNumber(value.sourceOffsetProjectFrames, 'project source offset'),
	});
}

/** Validate and copy the entry inventory before any asynchronous work begins. */
export function snapshotRoutedRecordingFinalization(
	input: RecordingFinalizationInput & { readonly entries: readonly unknown[] },
): RoutedRecordingFinalizationTransaction {
	return Object.freeze({
		recorder: input.recorder,
		entries: Object.freeze(input.entries.map(requireEntry)),
		discardRequested: input.discardRequested,
		fatalError: input.fatalError,
	});
}

/** Atomically commit routed takes against an explicitly captured project. */
export function createRoutedRecordingFinalization(runtime: RoutedRecordingFinalizationRuntime) {
	async function finalize(
		input: RecordingFinalizationInput & { readonly entries: readonly unknown[] },
	): Promise<void> {
		const transaction = snapshotRoutedRecordingFinalization(input);
		const committedEntries: RoutedRecordingEntry[] = [];
		try {
			const projectScope = runtime.captureProjectScope();
			projectScope.assertCurrent();
			runtime.pauseTransport();
			await runtime.disposeRecorder(transaction.recorder);
			projectScope.assertCurrent();
			if (transaction.discardRequested) {
				for (const entry of transaction.entries) {
					await entry.writer.abort().catch(() => undefined);
				}
				return;
			}
			if (transaction.fatalError) throw transaction.fatalError;
			for (const entry of transaction.entries) {
				runtime.appendPreview(entry.preview, entry.previewResampler.finish?.());
			}
			const projectRate = runtime.projectSampleRate(projectScope.project);
			const commands: unknown[] = [];
			const clipIds: string[] = [];
			for (const entry of transaction.entries) {
				const frames = entry.writer.framesWritten;
				if (frames <= entry.sourceOffsetFrames) {
					await entry.writer.abort();
					projectScope.assertCurrent();
					runtime.setRouteHealth(entry.trackId, 'skipped');
					continue;
				}
				const metadata = await entry.writer.commit({
					sampleRate: entry.sampleRate,
					channelCount: entry.route.channelCount,
				});
				committedEntries.push(entry);
				projectScope.assertCurrent();
				const source: RecordedAudioSource = Object.freeze({
					schemaVersion: 2,
					sampleRate: entry.sampleRate,
					originalSampleRate: entry.sampleRate,
					sampleFormat: 'float32',
					chunkFrames: runtime.sourceChunkFrames,
					id: entry.sourceId,
					storageKey: entry.sourceId,
					name: metadata.name,
					mimeType: 'audio/wav',
					frameCount: frames,
					channelCount: metadata.channelCount || entry.route.channelCount,
				});
				const sourceCommand = runtime.createAddSourceCommand(source);
				await runtime.activateStoredSource(source, metadata);
				projectScope.assertCurrent();
				const sourceStartFrame = Math.min(entry.sourceOffsetFrames, Math.max(0, frames - 1));
				const availableFrames = frames - sourceStartFrame;
				const availableProjectFrames = Math.max(
					1,
					runtime.scaleFrames(availableFrames, entry.sampleRate, projectRate),
				);
				const durationFrames = entry.selection
					? Math.min(
						availableProjectFrames,
						entry.selection.endFrame - entry.selection.startFrame,
					)
					: availableProjectFrames;
				if (durationFrames <= 0) continue;
				const sourceDurationFrames = entry.selection
					? Math.min(
						availableFrames,
						Math.max(1, runtime.scaleFrames(durationFrames, projectRate, entry.sampleRate)),
					)
					: availableFrames;
				const clipId = runtime.createStableId('clip');
				const clipCommand = runtime.preparePunchCommand(projectScope.project, {
					trackId: entry.trackId,
					startFrame: entry.recordingStartFrame,
					endFrame: entry.recordingStartFrame + durationFrames,
					sourceId: entry.sourceId,
					sourceStartFrame,
					sourceDurationFrames,
					clipId,
				});
				commands.push(sourceCommand, clipCommand);
				clipIds.push(clipId);
			}
			projectScope.assertCurrent();
			if (commands.length) {
				runtime.commitBatch(projectScope.project, commands, {
					selectTrackId: committedEntries[0]?.trackId,
					selectClipId: clipIds[0],
				});
				runtime.setStatusDone();
			}
		} catch (error) {
			for (const entry of transaction.entries) {
				await entry.writer.abort().catch(() => undefined);
			}
			const cleanupFailures: unknown[] = [];
			for (const entry of committedEntries) {
				cleanupFailures.push(...await cleanupCommittedRecordingSource({
					sourceId: entry.sourceId,
					deactivateSource: runtime.deactivateSource,
					deleteAnalysis: runtime.deleteSourceAnalysis,
					deleteStoredSource: runtime.deleteStoredSource,
				}));
			}
			throwRecordingFinalizationFailure(error, cleanupFailures);
		}
	}

	return Object.freeze({ finalize });
}
