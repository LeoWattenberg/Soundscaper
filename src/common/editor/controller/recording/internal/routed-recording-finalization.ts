/* SPDX-License-Identifier: AGPL-3.0-only */

import { readRecordingSourceMetadata } from './recording-source-metadata.ts';
import {
	RECORDING_DISPLAY_ROUTE_LABEL,
} from '../../../recording-routing.js';
import type { RecordingPreview } from '../recording-model.ts';
import type {
	RecordedAudioSource,
	RecordingFinalizationInput,
	RecordingSegmentPunch,
	RoutedRecordingFinalizationRuntime,
	RoutedRecordingFinalizationTransaction,
} from './recording-finalization-types.ts';
import type {
	RecordingPreviewResampler,
	RecordingRoute,
	RecordingSelection,
	RecordingSourceWriter,
	RoutedRecordingEntry,
} from '../recording-transaction-types.ts';
import {
	cleanupCommittedRecordingSource,
	throwRecordingFinalizationFailure,
} from './recording-finalization-cleanup.ts';
import { recordedSourceProvenance } from './recording-source-provenance.ts';
import { finishRecordingSegments } from './recording-finalization-segments.ts';
import { createSoundActivationTimestampCommands, type RecordingActivationTimestamp } from './sound-activation/sound-activation-timestamp-labels.ts';

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
	const channelStart = requireNumber(value.channelStart, 'route channel start');
	const channelCount = requireNumber(value.channelCount, 'route channel count');
	if (value.kind === 'display') {
		return Object.freeze({
			kind: 'display',
			channelStart,
			channelCount,
			label: typeof value.label === 'string' ? value.label : RECORDING_DISPLAY_ROUTE_LABEL,
		});
	}
	return Object.freeze({
		kind: 'device',
		deviceId: String(value.deviceId || ''),
		deviceLabel: String(value.deviceLabel || ''),
		channelStart,
		channelCount,
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
				for (const entry of transaction.entries) {
					await entry.writer.abort().catch(() => undefined);
					for (const checkpoint of entry.writer.checkpoints ?? []) {
						committedSourceIds.add(checkpoint.sourceId);
					}
				}
				for (const sourceId of committedSourceIds) {
					await cleanupCommittedRecordingSource({
						sourceId,
						deactivateSource: runtime.deactivateSource,
						deleteAnalysis: runtime.deleteSourceAnalysis,
						deleteStoredSource: runtime.deleteStoredSource,
					});
				}
				return;
			}
			for (const entry of transaction.entries) {
				try {
					runtime.appendPreview(entry.preview, entry.previewResampler.finish?.());
				} catch (error) {
					completionError ??= error;
				}
			}
			const projectRate = runtime.projectSampleRate(projectScope.project);
			const commands: unknown[] = [];
			const clipIds: string[] = [];
			let firstPublishedTrackId: string | undefined;
			const activationCoverage = new Map<string, {
				readonly recordingStartFrame: number;
				readonly sampleRate: number;
				readonly offsets: readonly number[];
				readonly spans: Array<Readonly<{ startFrame: number; endFrame: number }>>;
			}>();
			let compactedEndFrame: number | null = null;
			for (const entry of transaction.entries) {
				const frames = entry.writer.framesWritten;
				if (frames <= entry.sourceOffsetFrames && !entry.writer.checkpoints?.length) {
					await entry.writer.abort();
					projectScope.assertCurrent();
					runtime.setRouteHealth(entry.trackId, 'skipped');
					if (entry.preview.timelineMode === 'compacted') {
						compactedEndFrame = Math.max(compactedEndFrame ?? 0, entry.recordingStartFrame);
					}
					continue;
				}
				const finished = await finishRecordingSegments(entry.writer, entry.sourceId, {
					sampleRate: entry.sampleRate,
					channelCount: entry.route.channelCount,
				});
				if (finished.failure && !completionError) completionError = finished.failure;
				for (const segment of finished.segments) committedSourceIds.add(segment.sourceId);
				projectScope.assertCurrent();
				const punches: RecordingSegmentPunch[] = [];
				const publishedSourceSpans: Array<Readonly<{ startFrame: number; endFrame: number }>> = [];
				for (const segment of finished.segments) {
					const sourceEnd = segment.frameStart + segment.frameCount;
					const visibleStart = Math.max(segment.frameStart, entry.sourceOffsetFrames);
					const startFrame = entry.recordingStartFrame + runtime.scaleFrames(
						visibleStart - entry.sourceOffsetFrames, entry.sampleRate, projectRate,
					);
					const endFrame = Math.min(
						entry.recordingStartFrame + runtime.scaleFrames(
							Math.max(0, sourceEnd - entry.sourceOffsetFrames), entry.sampleRate, projectRate,
						),
						entry.selection
							? entry.recordingStartFrame + entry.selection.endFrame - entry.selection.startFrame
							: Infinity,
					);
					if (sourceEnd <= visibleStart || endFrame <= startFrame) {
						const cleanupFailures = await cleanupCommittedRecordingSource({
							sourceId: segment.sourceId,
							deactivateSource: runtime.deactivateSource,
							deleteAnalysis: runtime.deleteSourceAnalysis,
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
						sampleRate: entry.sampleRate,
						originalSampleRate: entry.sampleRate,
						sampleFormat: 'float32',
						chunkFrames: runtime.sourceChunkFrames,
						id: segment.sourceId,
						storageKey: segment.sourceId,
						name: metadata.name,
						mimeType: 'audio/wav',
						frameCount: segment.frameCount,
						channelCount: metadata.channelCount || entry.route.channelCount,
						provenance: recordedSourceProvenance(entry.route),
					});
					await runtime.activateStoredSource(source, metadata);
					projectScope.assertCurrent();
					const sourceStartFrame = visibleStart - segment.frameStart;
					const availableFrames = segment.frameCount - sourceStartFrame;
					const durationFrames = endFrame - startFrame;
					const sourceDurationFrames = entry.selection
						? Math.min(availableFrames, Math.max(1, runtime.scaleFrames(
							durationFrames, projectRate, entry.sampleRate,
						)))
						: availableFrames;
					publishedSourceSpans.push({
						startFrame: segment.frameStart + sourceStartFrame,
						endFrame: segment.frameStart + sourceStartFrame + sourceDurationFrames,
					});
					const clipId = runtime.createStableId('clip');
					punches.push({ source, punch: {
						trackId: entry.trackId,
						startFrame,
						endFrame,
						sourceId: segment.sourceId,
						sourceStartFrame,
						sourceDurationFrames,
						clipId,
					} });
					clipIds.push(clipId);
					firstPublishedTrackId ??= entry.trackId;
					if (entry.preview.timelineMode === 'compacted') {
						compactedEndFrame = Math.max(compactedEndFrame ?? 0, endFrame);
					}
				}
				if (!punches.length) {
					runtime.setRouteHealth(entry.trackId, 'skipped');
					continue;
				}
				if (punches.length === 1) {
					const only = punches[0]!;
					commands.push(runtime.createAddSourceCommand(only.source), runtime.preparePunchCommand(
						projectScope.project, only.punch,
					));
				} else {
					const prepared = await runtime.preparePunchSequence(projectScope.project, punches);
					projectScope.assertCurrent();
					commands.push(...prepared);
				}
				const coverage = activationCoverage.get(entry.sourceKey);
				if (coverage) {
					coverage.spans.push(...publishedSourceSpans);
				} else activationCoverage.set(entry.sourceKey, {
					recordingStartFrame: entry.recordingStartFrame,
					sampleRate: entry.sampleRate,
					offsets: entry.preview.activationFrameOffsets ?? [],
					spans: publishedSourceSpans,
				});
			}
			projectScope.assertCurrent();
			if (commands.length) {
				const timestamps: RecordingActivationTimestamp[] = [];
				for (const coverage of activationCoverage.values()) {
					for (const offsetFrames of coverage.offsets) {
						if (!coverage.spans.some((span) => (
							offsetFrames >= span.startFrame && offsetFrames < span.endFrame
						))) continue;
						timestamps.push({
							startFrame: coverage.recordingStartFrame,
							offsetFrames,
							sampleRate: coverage.sampleRate,
						});
					}
				}
				commands.push(...createSoundActivationTimestampCommands({
					project: projectScope.project,
					labelTrackName: runtime.labelTrackName ?? 'Labels',
					projectSampleRate: projectRate,
					createId: runtime.createStableId,
					timestamps,
				}));
				runtime.commitBatch(projectScope.project, commands, {
					selectTrackId: firstPublishedTrackId,
					selectClipId: clipIds[0],
				});
				projectPublished = true;
				if (!completionError) runtime.setStatusDone();
			}
			if (compactedEndFrame !== null) runtime.setTransportPosition(compactedEndFrame);
		} catch (error) {
			if (projectPublished) throw error;
			for (const entry of transaction.entries) {
				await entry.writer.abort().catch(() => undefined);
				for (const checkpoint of entry.writer.checkpoints ?? []) {
					committedSourceIds.add(checkpoint.sourceId);
				}
			}
			const cleanupFailures: unknown[] = [];
			for (const sourceId of committedSourceIds) {
				cleanupFailures.push(...await cleanupCommittedRecordingSource({
					sourceId,
					deactivateSource: runtime.deactivateSource,
					deleteAnalysis: runtime.deleteSourceAnalysis,
					deleteStoredSource: runtime.deleteStoredSource,
				}));
			}
			throwRecordingFinalizationFailure(error, cleanupFailures);
		}
		if (completionError) throw completionError;
	}

	return Object.freeze({ finalize });
}
