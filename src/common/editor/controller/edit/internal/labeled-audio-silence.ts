/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Silence Labeled Audio, split out of the generator service so the generator
 * keeps to the signals a user asks for by hand.
 */

import { publishedCopyFor } from '../../shared/presentation-localization.ts'; import { createAddClipCommand, createAddSourceCommand } from '../../../commands/factories.ts'; import { setLocalizedStatus } from '../../../../i18n/presentation-message.ts';
import { projectForAudioGeneratorCommands } from './generator-project-view.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import { prepareDisjointRangeDeleteCommand } from '../../../commands/range-runtime.js';
import { generateAudioEditorSignal } from '../../../generators.js';
import { normalizeProjectSampleRate } from '../../shared/app-helpers.ts';
import { publishGeneratedAudioSource } from './generated-source-publication.ts';
import type {
	AudioGeneratorClip,
	AudioGeneratorEffectTarget,
	AudioGeneratorProject,
	AudioGeneratorServiceDependencies,
	AudioGeneratorTrack,
	GeneratedSignal,
	OperationOwnership,
} from '../generator-service.ts';
import type { LabeledAudioRegion } from '../../../labeled-audio-regions.ts';

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

export function createLabeledAudioSilence<Context, Target extends AudioGeneratorEffectTarget>(
	dependencies: AudioGeneratorServiceDependencies<Context, Target>,
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
		try {
			const persistedProject = owned.project;
			const project = projectForAudioGeneratorCommands(persistedProject, dependencies.getCommandProject);
			const requested = new Set(trackIds);
			const targets = project.tracks.filter((track) => requested.has(track.id) && track.type === 'audio');
			// Upstream silences samples, so a labelled region over a track that
			// holds nothing there silences nothing. Only the stretches that
			// actually cover audio become silent clips.
			const plan = targets
				.map((track) => Object.freeze({ trackId: track.id, spans: coveredSpans(project, track, spans) }))
				.filter((entry) => entry.spans.length > 0);
			if (plan.length === 0) return false;
			const sampleRate = normalizeProjectSampleRate(project.sampleRate);
			const longestRegionFrames = Math.max(...plan.flatMap((entry) => (
				entry.spans.map((region) => region.endFrame - region.startFrame)
			)));
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
			const name = publishedCopyFor(dependencies.copy).silenceAudio;
			return await publishGeneratedAudioSource(dependencies, {
				name,
				sampleRate,
				channelCount,
				frameCount: generated.frameCount,
				channels: generated.channels,
				ownership: {
					signal: owned.task.signal,
					assertCurrent: () => ownership.assert(owned),
				},
				prepare: () => undefined,
				accept: (source) => {
					dependencies.commit({
						type: 'batch',
						commands: [
							createAddSourceCommand(source),
							prepareDisjointRangeDeleteCommand(project, {
								ranges: spans.map((region) => ({
									startFrame: region.startFrame,
									endFrame: region.endFrame,
								})),
								trackIds: plan.map((entry) => entry.trackId),
								rippleMode: 'none',
							}) as AudioEditorCommand,
							...plan.flatMap((entry) => entry.spans.map((region) => createAddClipCommand(entry.trackId, {
								id: dependencies.createId('clip'),
								sourceId: source.id,
								title: name,
								timelineStartFrame: region.startFrame,
								sourceStartFrame: 0,
								sourceDurationFrames: region.endFrame - region.startFrame,
								durationFrames: region.endFrame - region.startFrame,
							}))),
						],
					});
					setLocalizedStatus(dependencies.setStatus, dependencies.copy, "done", undefined, 'success');
					return true;
				},
			});
		} finally {
			ownership.finish(owned, processing);
		}
	}
}

/**
 * The stretches of one track a set of labelled regions actually covers.
 *
 * Each region is intersected with the clips it crosses, and stretches that end
 * where the next begins are merged so a run of abutting clips is silenced as
 * one piece rather than several.
 */
function coveredSpans(
	project: AudioGeneratorProject,
	track: AudioGeneratorTrack,
	regions: readonly LabeledAudioRegion[],
): readonly LabeledAudioRegion[] {
	const clips = (track.clipIds ?? [])
		.map((clipId) => project.clips.find((clip) => clip.id === clipId))
		.filter((clip): clip is AudioGeneratorClip => Boolean(clip));
	const overlaps: LabeledAudioRegion[] = [];
	for (const region of regions) {
		for (const clip of clips) {
			const startFrame = Math.max(region.startFrame, clip.timelineStartFrame);
			const endFrame = Math.min(region.endFrame, clip.timelineStartFrame + clip.durationFrames);
			if (endFrame > startFrame) overlaps.push({ startFrame, endFrame });
		}
	}
	overlaps.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
	const merged: LabeledAudioRegion[] = [];
	for (const span of overlaps) {
		const previous = merged.at(-1);
		if (previous && span.startFrame <= previous.endFrame) {
			merged[merged.length - 1] = {
				startFrame: previous.startFrame,
				endFrame: Math.max(previous.endFrame, span.endFrame),
			};
			continue;
		}
		merged.push(span);
	}
	return Object.freeze(merged);
}
