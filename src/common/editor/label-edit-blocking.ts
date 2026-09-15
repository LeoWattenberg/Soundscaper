/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	selectAudioEditorControllerEditBlock,
	selectAudioEditorEditBlock,
	type AudioEditorControllerEditState,
	type AudioEditorEditBlockingSnapshot,
} from './edit-blocking.ts';

/** Labels annotate a live capture without changing its audio. */
export function selectAudioEditorLabelEditBlock(snapshot: AudioEditorEditBlockingSnapshot) {
	return selectAudioEditorEditBlock({ ...snapshot, recording: false });
}

export function selectAudioEditorControllerLabelEditBlock(state: AudioEditorControllerEditState) {
	return selectAudioEditorControllerEditBlock({ ...state, recorder: null });
}
