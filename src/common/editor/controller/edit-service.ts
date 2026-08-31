/* SPDX-License-Identifier: AGPL-3.0-only */

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
	function handleEdit(action: string) {
		if (!state.history || editingBlocked()) return;
		try {
			if (action === 'undo') {
				state.videoEffectGestures.clear();
				const previousHistory = state.history;
				state.history = undoEditorCommand(previousHistory);
				if (state.history === previousHistory) return;
				projectChanged();
				return;
			}
			if (action === 'redo') {
				state.videoEffectGestures.clear();
				const previousHistory = state.history;
				state.history = redoEditorCommand(previousHistory);
				if (state.history === previousHistory) return;
				projectChanged();
				return;
			}
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
			if (action === 'trim-outside-selection' && baseSelection) {
				commit(prepareKeepRangeCommand(getProject(), { ...baseSelection, trackIds }));
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
