/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Audacity 3's Labeled Audio submenu (au3/src/menus/LabelMenus.cpp).
 *
 * Each command turns the labels inside the time selection into regions and
 * applies one ordinary edit to every region on the tracks being edited. Cut
 * and Delete close the gap they leave, their "and leave gap" siblings do not,
 * and Copy only fills the clipboard. Split, Join, Silence audio and Detach at
 * silences reuse the primitives their unlabelled counterparts already use.
 */

import { planLabeledAudioJoinRuns } from '../../../labeled-audio-join-plan.ts';
import { createLocalizedError } from '../../../../i18n/presentation-message.ts'; import {
	labeledAudioSpanRegions,
	selectLabeledAudioTargets,
	type LabeledAudioRegion,
	type LabeledAudioTargets,
} from '../../../labeled-audio-regions.ts';

export const LABELED_AUDIO_EDIT_ACTIONS = Object.freeze([
	'labeled-cut',
	'labeled-delete',
	'labeled-split-cut',
	'labeled-split-delete',
	'labeled-silence',
	'labeled-copy',
	'labeled-split',
	'labeled-join',
	'labeled-disjoin',
] as const);

export type LabeledAudioEditAction = (typeof LABELED_AUDIO_EDIT_ACTIONS)[number];

export interface LabeledAudioEditRuntime {
	// The composition root is still legacy JavaScript; its ports are narrowed
	// as the services around this one migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

export type LabeledAudioEditor = (action: LabeledAudioEditAction) => unknown;

/** True for the actions this service owns, so the edit service can hand them over. */
export function isLabeledAudioEditAction(action: string): action is LabeledAudioEditAction {
	return (LABELED_AUDIO_EDIT_ACTIONS as readonly string[]).includes(action);
}

export function createLabeledAudioEditService(runtime: LabeledAudioEditRuntime): LabeledAudioEditor {
	const {
		activeSelection, commit, commitSplitAtFrames, compactLiveSourceState, copy,
		disjoinLabeledRegions, findClip, garbageCollectSources, generateLabeledSilence,
		getProject, handleError, labeledClipboard, publishDocumentSnapshot,
		setSessionClipboard, state,
	} = runtime;

	return function executeLabeledAudioEdit(action: LabeledAudioEditAction): unknown {
		try {
			const targets = resolveTargets();
			const spans = labeledAudioSpanRegions(targets.regions);
			if (action === 'labeled-silence') return generateLabeledSilence(spans, targets.trackIds);
			if (action === 'labeled-disjoin') return disjoinLabeledRegions(spans, targets.trackIds);
			if (action === 'labeled-split') return splitAtRegionBoundaries(targets);
			if (action === 'labeled-join') return joinWithinRegions(targets);
			const publishClipboard = action !== 'labeled-delete' && action !== 'labeled-split-delete'
				? prepareRegionsClipboard(targets, spans, action !== 'labeled-copy') : null;
			if (action !== 'labeled-copy') removeRegions(action, targets, spans);
			publishClipboard?.();
			publishDocumentSnapshot();
			return undefined;
		} catch (error) {
			handleError(error);
			return undefined;
		}
	};

	/** Resolve the regions and tracks, refusing the edit when there are none. */
	function resolveTargets(): LabeledAudioTargets {
		const project = getProject();
		const selectedTrackIds = [
			...(project?.selection?.trackIds || []),
			...(state.selectedTrackId ? [state.selectedTrackId] : []),
		];
		const targets = selectLabeledAudioTargets(project, activeSelection(), selectedTrackIds);
		if (!targets) throw createLocalizedError(Error, copy, 'labeledAudioRequired');
		return targets;
	}

	/** Capture labelled regions before removal, and publish only after successful admission. */
	function prepareRegionsClipboard(targets: LabeledAudioTargets, spans: readonly LabeledAudioRegion[], deferred: boolean): () => void {
		if (spans.length === 0) throw createLocalizedError(Error, copy, 'labeledAudioRequired');
		const descriptor = labeledClipboard.create(spans, targets.trackIds);
		if (!descriptor) throw createLocalizedError(Error, copy, 'labeledAudioRequired');
		const publish = deferred && typeof runtime.prepareSessionClipboard === 'function'
			? runtime.prepareSessionClipboard(descriptor) : () => setSessionClipboard(descriptor);
		return () => {
			publish();
			compactLiveSourceState();
			void garbageCollectSources().catch(handleError);
		};
	}

	/**
	 * Remove the labelled regions. Cut and Delete close the gap the way
	 * upstream's Clear does and collapse the selection onto its start; the
	 * "leave gap" pair lifts the material out and leaves the timeline alone.
	 */
	function removeRegions(
		action: LabeledAudioEditAction,
		targets: LabeledAudioTargets,
		spans: readonly LabeledAudioRegion[],
	): void {
		if (spans.length === 0) throw createLocalizedError(Error, copy, 'labeledAudioRequired');
		const ripples = action === 'labeled-cut' || action === 'labeled-delete';
		const command = runtime.prepareDisjointRangeDeleteCommand(getProject(), {
			ranges: spans.map((region) => ({ startFrame: region.startFrame, endFrame: region.endFrame })),
			trackIds: targets.trackIds,
			rippleMode: ripples ? 'track' : 'none',
		});
		const selection = activeSelection();
		commit(ripples && selection
			? {
				type: 'batch',
				commands: [
					...(command.type === 'batch' ? command.commands : [command]),
					{
						type: 'selection/set',
						startFrame: selection.startFrame,
						endFrame: selection.startFrame,
						trackIds: targets.trackIds,
						clipIds: [],
						frequencyRange: null,
					},
				],
			}
			: command);
		state.selectedClipId = null;
	}

	/** Split every clip at each labelled boundary, points included. */
	function splitAtRegionBoundaries(targets: LabeledAudioTargets): unknown {
		const boundaries = targets.regions.flatMap((region) => (
			region.endFrame > region.startFrame ? [region.startFrame, region.endFrame] : [region.startFrame]
		));
		return commitSplitAtFrames(boundaries, targets.trackIds);
	}

	/**
	 * Join the clips a label covers. Upstream widens the join by one sample on
	 * each side so that splitting and joining the same label round-trips, and
	 * only clips that already sit edge to edge can be joined without rendering.
	 */
	function joinWithinRegions(targets: LabeledAudioTargets): unknown {
		const project = getProject();
		const commands = [];
		for (const trackId of targets.trackIds) {
			const track = project.tracks.find((candidate: { id: string }) => candidate.id === trackId);
			if (!Array.isArray(track?.clipIds)) continue;
			commands.push(...planLabeledAudioJoinRuns(track.clipIds, targets.regions,
				(clipId) => findClip(project, clipId)));
		}
		if (commands.length === 0) return undefined;
		return commit(commands.length === 1 ? commands[0] : { type: 'batch', commands });
	}

}
