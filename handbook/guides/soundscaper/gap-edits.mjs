/* SPDX-License-Identifier: AGPL-3.0-only */

import { check, importAudio, menu, open, selectRange } from '../steps.mjs';

export const GAP_EDIT_GUIDES = Object.freeze([
	{
		id: 'cut-a-passage-and-leave-a-gap',
		title: 'Cut a passage and leave a gap',
		description: 'Remove a passage to the clipboard while keeping later audio in sync.',
		audacity: 'Edit → Remove Special → Cut and leave gap (Audacity 3)',
		intro: 'Cut and leave gap removes the selected passage and keeps a copy on the clipboard. The remaining audio keeps its time positions, so another track or video stays in sync.',
		steps: [
			open(),
			importAudio('music-loop', { what: 'the recording with the passage you want to move' }),
			selectRange(0.25, 0.75, { where: 'the passage to remove', why: 'The later audio will keep its position after the cut.' }),
			menu(['Edit', 'Cut', 'Cut and leave gap']),
			check({ clips: 2 }, { see: 'A gap replaces the passage; the clips before and after it stay at their original positions.' }),
		],
		tips: [
			'Place the cursor at a destination and choose **Edit → Paste → Paste** to insert the clipboard copy.',
			'To discard the passage without copying it, [delete it and leave a gap](guide:delete-a-passage-and-leave-a-gap).',
		],
	},
]);
