/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createLabeledAudioEditService,
	isLabeledAudioEditAction,
} from './labeled-audio-edit-service.ts';
import { prepareSplitRangeIntoNewTrackCommand } from './split-into-new-track-plan.ts';

export interface EditServiceRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

type RuntimeValue = EditServiceRuntime[string];
export type HandleEditorEdit = (action: string) => RuntimeValue;

// foundation-edit-matrix: duplicate

export function createEditorEditService(runtime: EditServiceRuntime): HandleEditorEdit {
	const {
		activeSelection, commit, commitSplitAtFrames, compactLiveSourceState,
		copy, createAddTrackCommand, createClipboardDescriptor, createStableId,
		editingBlocked, engine, findClip, findClipTrack,
		findTrack, garbageCollectSources, handleError, normalizeTimelineFrame,
		prepareControllerPaste, prepareDisjointRangeDeleteCommand, prepareGroupClipsCommand, prepareKeepRangeCommand,
		prepareLinkedSplitCommand, prepareRangeDeleteCommand, getProject, projectChanged,
		publishDocumentSnapshot, redoEditorCommand, resolveEditingSelection, setSessionClipboard,
		state, undoEditorCommand,
	} = runtime;
	const executeLabeledAudioEdit = createLabeledAudioEditService(runtime);

	/**
	 * Undo or redo, document and playhead together.
	 *
	 * The stack keeps the position each command was run from, so stepping back
	 * hands the person the timeline as they left it — the same cursor, not just
	 * the same audio. Where the playhead is now goes onto the stack in exchange,
	 * so stepping forward again restores that in turn.
	 */
	function travel(step: RuntimeValue) {
		state.videoEffectGestures.clear();
		const previousHistory = state.history;
		state.history = step(previousHistory, { playheadFrame: playheadFrame() });
		if (state.history === previousHistory) return;
		projectChanged({ restorePlayheadFrame: state.history.playheadFrame });
	}

	/** Where the transport's playhead sits, for a runtime that has a transport. */
	function playheadFrame(): number | undefined {
		if (typeof engine?.getPositionFrames !== 'function') return undefined;
		const frame = engine.getPositionFrames();
		if (typeof frame !== 'number' || !Number.isFinite(frame) || frame < 0) return undefined;
		return Math.round(frame);
	}

	/**
	 * The ranges a trim removes: everything on the given tracks that the kept
	 * ranges leave over. The last kept range's tail runs to the end of the audio
	 * those tracks hold, so a trim never has to ask the document how long it is.
	 */
	function discardedRanges(
		kept: readonly RuntimeValue[],
		trackIds: readonly string[],
	): RuntimeValue[] {
		const trackIdSet = new Set(trackIds);
		const clipIds = getProject().tracks
			.filter((track: RuntimeValue) => trackIdSet.has(track.id) && Array.isArray(track.clipIds))
			.flatMap((track: RuntimeValue) => track.clipIds as string[]);
		const endFrame = clipIds.reduce((furthest: number, clipId: string) => {
			const clip = findClip(getProject(), clipId);
			return clip ? Math.max(furthest, clip.timelineStartFrame + clip.durationFrames) : furthest;
		}, 0);
		const ranges: RuntimeValue[] = [];
		let cursor = 0;
		for (const range of kept) {
			if (range.startFrame > cursor) ranges.push({ startFrame: cursor, endFrame: range.startFrame });
			cursor = Math.max(cursor, range.endFrame);
		}
		if (endFrame > cursor) ranges.push({ startFrame: cursor, endFrame });
		return ranges;
	}

	function handleEdit(action: string) {
		if (!state.history || editingBlocked()) return;
		if (isLabeledAudioEditAction(action)) return executeLabeledAudioEdit(action);
		try {
			if (action === 'undo') return travel(undoEditorCommand);
			if (action === 'redo') return travel(redoEditorCommand);
			const audioTrackIds = getProject().tracks.filter((track: RuntimeValue) => Array.isArray(track.clipIds)).map((track: RuntimeValue) => track.id);
			const selectedTrack = findTrack(getProject(), state.selectedTrackId);
			const baseSelection = activeSelection();
			const editingSelection = resolveEditingSelection(getProject(), { selectedClipId: state.selectedClipId });
			const selectedClipCandidates = editingSelection?.kind === 'clips' ? editingSelection.clipIds : [];
			const selectedClips = selectedClipCandidates
				.map((clipId: RuntimeValue) => findClip(getProject(), clipId))
				.filter(Boolean);
			const selectedClipIds = selectedClips.map((clip: RuntimeValue) => clip.id);
			const selectedClipRange = editingSelection?.kind === 'clips'
				? {
					startFrame: editingSelection.startFrame,
					endFrame: editingSelection.endFrame,
					clipIds: selectedClipIds,
				}
				: null;
			const selection = baseSelection || (selectedClipRange && selectedClipRange.endFrame > selectedClipRange.startFrame ? selectedClipRange : null);
			const selectedClipTrackIds = [...new Set(selectedClips
				.map((clip: RuntimeValue) => findClipTrack(getProject(), clip.id)?.id)
				.filter(Boolean))];
			const rangeTrackIds = getProject().selection?.trackIds?.filter((trackId: RuntimeValue) => audioTrackIds.includes(trackId)) || selectedClipTrackIds;
			const trackIds = rangeTrackIds.length
				? rangeTrackIds
				: selectedTrack && Array.isArray(selectedTrack.clipIds) ? [selectedTrack.id] : audioTrackIds;
			const cutModes: Readonly<Record<string, string>> = {
				cut: 'none',
				'cut-leave-gap': 'none',
				'cut-per-clip-ripple': 'clip',
				'cut-per-track-ripple': 'track',
				'cut-all-tracks-ripple': 'track',
			};
			if (action === 'copy' || Object.hasOwn(cutModes, action)) {
				if (!selection) throw new Error(copy.timeSelectionRequired);
				const exactClipSelection = !baseSelection && selectedClipIds.length > 0;
				const exactClipEdit = exactClipSelection && action !== 'cut-all-tracks-ripple';
				const affectedTrackIds = action === 'cut-all-tracks-ripple' ? audioTrackIds : trackIds;
				const clipboardOptions = {
					...selection,
					trackIds: exactClipSelection ? selectedClipTrackIds : affectedTrackIds,
					...(exactClipSelection ? { clipIds: selectedClipIds } : {}),
				};
				if (action === 'copy') {
					setSessionClipboard(createClipboardDescriptor(getProject(), clipboardOptions));
					compactLiveSourceState();
					void garbageCollectSources().catch(handleError);
				}
				else {
					setSessionClipboard(createClipboardDescriptor(getProject(), clipboardOptions));
					commit(exactClipEdit
						? {
							type: 'clip/remove-many',
							clipIds: selectedClipIds,
							rippleMode: cutModes[action],
						}
						: !baseSelection && action === 'cut-all-tracks-ripple'
							? prepareDisjointRangeDeleteCommand(getProject(), {
								ranges: editingSelection.ranges,
								trackIds: audioTrackIds,
								rippleMode: 'track',
							})
						: prepareRangeDeleteCommand(getProject(), {
							...selection,
							trackIds: affectedTrackIds,
							rippleMode: cutModes[action],
						}));
					if (!baseSelection) state.selectedClipId = null;
				}
				publishDocumentSnapshot();
				return;
			}
			if (['paste', 'paste-overlap', 'paste-insert', 'paste-all-tracks-ripple'].includes(action)) {
				if (!state.clipboard) return;
				const mode = action === 'paste-insert'
					? 'insert-track'
					: action === 'paste-all-tracks-ripple'
						? 'insert-all'
						: 'overlap';
				commit(prepareControllerPaste(mode));
				return;
			}
			if (action === 'duplicate') {
				if (!selection) throw new Error(copy.timeSelectionRequired);
				const exactClipEdit = !baseSelection && selectedClipIds.length > 0;
				setSessionClipboard(createClipboardDescriptor(getProject(), {
					...selection,
					trackIds: exactClipEdit ? selectedClipTrackIds : trackIds,
					...(exactClipEdit ? { clipIds: selectedClipIds } : {}),
				}));
				const duplicateCommand = prepareControllerPaste('overlap', selection.endFrame);
				if (exactClipEdit) {
					const pasteCommand = duplicateCommand.type === 'clipboard/paste'
						? duplicateCommand
						: duplicateCommand.commands.find((command: RuntimeValue) => command.type === 'clipboard/paste');
					const pastedClipIds = Object.values(pasteCommand?.clipIds || {});
					const pastedTrackIds = [...new Set(Object.values(pasteCommand?.trackMap || {}))];
					commit({
						type: 'batch',
						commands: [
							...(duplicateCommand.type === 'batch' ? duplicateCommand.commands : [duplicateCommand]),
							{
								type: 'selection/set',
								startFrame: 0,
								endFrame: 0,
								trackIds: pastedTrackIds,
								clipIds: pastedClipIds,
								frequencyRange: null,
							},
						],
					}, { selectClipId: pastedClipIds[0] || null });
				} else commit(duplicateCommand);
				return;
			}
			if (action === 'split') {
				const boundaries = baseSelection
					? [baseSelection.startFrame, baseSelection.endFrame]
					: [normalizeTimelineFrame(engine.getPositionFrames())];
				commitSplitAtFrames(boundaries);
				return;
			}
			if (action === 'split-new-track') {
				// A drawn range lifts what it covers onto a copy of every track it
				// covers, the way upstream's own command does; a selected clip
				// still parts at the playhead, which is what this editor has
				// always done with one.
				if (baseSelection) {
					const plan = prepareSplitRangeIntoNewTrackCommand({
						getProject, findClip, createStableId, createAddTrackCommand, prepareLinkedSplitCommand,
					}, { startFrame: baseSelection.startFrame, endFrame: baseSelection.endFrame, trackIds });
					if (!plan) return;
					commit(plan.command, { selectTrackId: plan.selectTrackId, selectClipId: plan.selectClipId });
					return;
				}
				const clip = state.selectedClipId ? findClip(getProject(), state.selectedClipId) : null;
				const sourceTrack = clip ? findClipTrack(getProject(), clip.id) : null;
				if (!clip || !sourceTrack) return;
				if (clip.avLinkId || clip.kind === 'video') return;
				const split = prepareLinkedSplitCommand(
					getProject(),
					clip.id,
					engine.getPositionFrames(),
					createStableId,
				);
				const trackId = createStableId('track');
				commit({
					type: 'batch',
					commands: [
						createAddTrackCommand({ ...sourceTrack, id: trackId, name: `${sourceTrack.name} 2`, clipIds: [], effects: [] }),
						split,
						{ type: 'clip/move', clipId: split.rightClipId, trackId, timelineStartFrame: split.atFrame },
					],
				}, { selectTrackId: trackId, selectClipId: split.rightClipId });
				return;
			}
			if (action === 'join' && selectedClipIds.length > 1) {
				commit({ type: 'clip/join', clipIds: selectedClipIds }, { selectClipId: selectedClipIds[0] });
				return;
			}
			if (action === 'group' && selectedClipIds.length > 1) {
				commit(prepareGroupClipsCommand(selectedClipIds));
				return;
			}
			if (action === 'ungroup' && selectedClipIds.length) {
				commit({ type: 'clip/ungroup', clipIds: selectedClipIds });
				return;
			}
			if (action === 'trim-outside-selection') {
				if (baseSelection) {
					commit(prepareKeepRangeCommand(getProject(), { ...baseSelection, trackIds }));
					return;
				}
				// Selected clips are a selection too, and they may be disjoint, so
				// the trim keeps each of them rather than the span they bracket:
				// what falls between two selected clips was not selected.
				if (!editingSelection || editingSelection.kind !== 'clips') return;
				const keptTrackIds = selectedClipTrackIds.length ? selectedClipTrackIds : trackIds;
				const discarded = discardedRanges(editingSelection.ranges, keptTrackIds);
				if (!discarded.length) return;
				commit(prepareDisjointRangeDeleteCommand(getProject(), {
					ranges: discarded,
					trackIds: keptTrackIds,
					rippleMode: 'none',
				}));
				return;
			}
			const deleteModes: Readonly<Record<string, string>> = {
				delete: 'none',
				'delete-leave-gap': 'none',
				'ripple-delete': 'track',
				'delete-per-clip-ripple': 'clip',
				'delete-per-track-ripple': 'track',
				'delete-all-tracks-ripple': 'track',
			};
			if (
				!baseSelection
				&& selectedClipIds.length
				&& Object.hasOwn(deleteModes, action)
				&& action !== 'delete-all-tracks-ripple'
			) {
				commit({
					type: 'clip/remove-many',
					clipIds: selectedClipIds,
					rippleMode: deleteModes[action],
				});
				state.selectedClipId = null;
				return;
			}
			if (selection && Object.hasOwn(deleteModes, action)) {
				commit(!baseSelection && action === 'delete-all-tracks-ripple'
					? prepareDisjointRangeDeleteCommand(getProject(), {
						ranges: editingSelection.ranges,
						trackIds: audioTrackIds,
						rippleMode: 'track',
					})
					: prepareRangeDeleteCommand(getProject(), {
						...selection,
						trackIds: action === 'delete-all-tracks-ripple' ? audioTrackIds : trackIds,
						rippleMode: deleteModes[action],
					}));
				if (!baseSelection) state.selectedClipId = null;
			}
		} catch (error) {
			handleError(error);
		}
	}
	return handleEdit;
}
