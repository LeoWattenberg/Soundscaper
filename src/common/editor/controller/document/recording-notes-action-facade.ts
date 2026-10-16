/* SPDX-License-Identifier: AGPL-3.0-only */

import { readProjectRecordingNotes, recordingNotesValue } from '../../recording-notes.ts';
import type { CommitSelection, ProjectChangedOptions } from './project-mutation-service.ts';

export interface RecordingNotesActionFacadeDependencies {
	getProject(): unknown;
	commit(
		command: Readonly<{ type: 'project/recording-notes-set'; notes: string }>,
		selection: CommitSelection,
		options: ProjectChangedOptions,
	): unknown;
}

/** Read the active project on each edit so switching projects changes the notebook. */
export function createRecordingNotesActionFacade(dependencies: RecordingNotesActionFacadeDependencies) {
	return Object.freeze({
		update(notes: string): void {
			recordingNotesValue(notes);
			if (notes === readProjectRecordingNotes(dependencies.getProject())) return;
			dependencies.commit({ type: 'project/recording-notes-set', notes }, {}, { skipPlaybackEngine: true });
		},
	});
}
