/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Silence Labeled Audio, split out of the generator service so the generator
 * keeps to the signals a user asks for by hand.
 */

import { createAddClipCommand, createAddSourceCommand } from '../commands/factories.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import { prepareDisjointRangeDeleteCommand } from '../commands/range-runtime.js';
import { generateAudioEditorSignal } from '../generators.js';
import { normalizeProjectSampleRate } from './app-helpers.ts';
import type {
	AudioGeneratorServiceDependencies,
	AudioGeneratorWriter,
	GeneratedSignal,
	OperationOwnership,
} from './generator-service.ts';
import type { LabeledAudioRegion } from '../labeled-audio-regions.ts';

export interface LabeledAudioSilenceOwnership {
	begin(): OperationOwnership;
	assert(ownership: OperationOwnership): void;
	markProcessing(): true;
	finish(ownership: OperationOwnership, processing: boolean): void;
}

export interface LabeledAudioSilence {
	generateLabeledSilence(
		regions: readonly LabeledAudioRegion[],
		trackIds: readonly string[],
	): Promise<boolean>;
}

export function createLabeledAudioSilence(
	dependencies: AudioGeneratorServiceDependencies,
	ownership: LabeledAudioSilenceOwnership,
): Readonly<LabeledAudioSilence> {
	return Object.freeze({ generateLabeledSilence });

	/**
	 * Silence every labelled region on the tracks being edited, the way
	 * OnSilenceLabels does upstream. Soundscaper models silence as real
	 * material rather than zeroed samples, so one generated source backs a
	 * silent clip per region: the region is lifted out, leaving the timeline
	 * intact, and the clip fills the gap it left.
	 */
	async function generateLabeledSilence(
		regions: readonly LabeledAudioRegion[],
		trackIds: readonly string[],
	): Promise<boolean> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return false;
		const spans = regions.filter((region) => region.endFrame > region.startFrame);
		if (spans.length === 0 || trackIds.length === 0) return false;
		const owned = ownership.begin();
		let processing = false;
		let writer: AudioGeneratorWriter | null = null;
		let sourceId: string | null = null;
		try {
			const project = owned.project;
			const requested = new Set(trackIds);
			const targets = project.tracks.filter((track) => requested.has(track.id) && track.type === 'audio');
			if (targets.length === 0) return false;
			const sampleRate = normalizeProjectSampleRate(project.sampleRate);
			const longestRegionFrames = Math.max(...spans.map((region) => region.endFrame - region.startFrame));
			const channelCount = Number(dependencies.trackChannelCount(project, targets[0]!, project.masterChannels || 2));
			// One frame of headroom keeps every clip inside the source bounds
			// however the requested duration rounds.
			const generated = generateAudioEditorSignal('silence', {
				durationSeconds: (longestRegionFrames + 1) / sampleRate,
				sampleRate,
				channelCount,
			}) as GeneratedSignal;
			await dependencies.preflightStorage(
				generated.frameCount * generated.channelCount * Float32Array.BYTES_PER_ELEMENT,
				'effect',
			);
			ownership.assert(owned);
			processing = ownership.markProcessing();
			const context = await dependencies.getAudioContext();
			ownership.assert(owned);
			const buffer = await dependencies.createBuffer(generated.channels, sampleRate, context);
			ownership.assert(owned);
			sourceId = dependencies.createId('generator');
			const name = dependencies.copy.silenceAudio;
			writer = await dependencies.store.beginSourceWrite(sourceId, {
				name,
				mimeType: 'audio/wav',
				sampleRate,
				channelCount,
				chunkFrames: dependencies.sourceChunkFrames,
			});
			ownership.assert(owned);
			await dependencies.writeBuffer(writer, buffer, owned.task.signal);
			ownership.assert(owned);
			await writer.commit({ sampleRate, channelCount });
			ownership.assert(owned);
			const source = {
				sampleRate,
				sampleFormat: 'float32',
				chunkFrames: dependencies.sourceChunkFrames,
				id: sourceId,
				storageKey: sourceId,
				name,
				mimeType: 'audio/wav',
				frameCount: generated.frameCount,
				channelCount,
				originalSampleRate: sampleRate,
			};
			dependencies.cacheSourceBuffer(sourceId, buffer);
			const peaks = await dependencies.generatePeaks(generated.channels);
			ownership.assert(owned);
			dependencies.sourcePeaks.set(sourceId, peaks);
			await dependencies.store.saveAnalysis(dependencies.peakCacheKey(sourceId), peaks);
			ownership.assert(owned);
			const commandProject = dependencies.getCommandProject?.() ?? project;
			const targetTrackIds = targets.map((track) => track.id);
			dependencies.commit({
				type: 'batch',
				commands: [
					createAddSourceCommand(source),
					prepareDisjointRangeDeleteCommand(commandProject, {
						ranges: spans.map((region) => ({ startFrame: region.startFrame, endFrame: region.endFrame })),
						trackIds: targetTrackIds,
						rippleMode: 'none',
					}) as AudioEditorCommand,
					...targetTrackIds.flatMap((trackId) => spans.map((region) => createAddClipCommand(trackId, {
						id: dependencies.createId('clip'),
						sourceId: sourceId as string,
						title: name,
						timelineStartFrame: region.startFrame,
						sourceStartFrame: 0,
						sourceDurationFrames: region.endFrame - region.startFrame,
						durationFrames: region.endFrame - region.startFrame,
					}))),
				],
			});
			dependencies.setStatus(dependencies.copy.done, 'success');
			return true;
		} catch (error) {
			if (writer) await Promise.resolve(writer.abort(error)).catch(() => undefined);
			if (sourceId) {
				dependencies.sourceBuffers.delete(sourceId);
				dependencies.sourcePeaks.delete(sourceId);
				await dependencies.store.deleteSource(sourceId).catch(() => undefined);
			}
			throw error;
		} finally {
			ownership.finish(owned, processing);
		}
	}
}
