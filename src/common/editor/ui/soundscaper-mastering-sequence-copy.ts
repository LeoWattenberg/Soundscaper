/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveCopyCatalogOverrides } from './copy-catalog-overrides.ts';

export const SOUNDSCAPER_MASTERING_SEQUENCE_COPY = Object.freeze({
	masteringSequences: 'Mastering sequences…',
	masteringSequencesTitle: 'Mastering sequences',
	masteringSequenceEditor: 'Mastering sequence editor',
	masteringSequence: 'Sequence',
	newMasteringSequence: 'New sequence',
	removeMasteringSequence: 'Remove sequence',
	masteringSequenceName: 'Sequence name',
	noMasteringSequences: 'This project has no mastering sequence yet.',
	noMasteringRegions: 'Mark a region on the timeline to add it to a sequence.',
	masteringDeliveredLength: 'Delivered length',
	masteringUndeliverable: 'This sequence cannot be delivered until every issue below is resolved.',
	masteringEntries: 'Entries',
	masteringAddEntry: 'Add region',
	masteringRemoveEntry: 'Remove entry',
	masteringMoveEntryUp: 'Move entry up',
	masteringMoveEntryDown: 'Move entry down',
	masteringEntryTitle: 'Title',
	masteringEntryTitleFromRegion: 'Titled from the region unless you override it.',
	masteringGapBefore: 'Gap before (frames)',
	masteringFadeIn: 'Fade in (frames)',
	masteringFadeOut: 'Fade out (frames)',
	masteringEntryMetadata: 'Delivery metadata (JSON object of text values)',
	masteringEntryMetadataInvalid: 'Delivery metadata must be a JSON object whose values are all text.',
	masteringEntryTimingInvalid: 'Gap and fade values must be whole non-negative frame counts.',
	masteringIssues: 'Issues',
	masteringMissingRegion: 'Region unavailable',
	readOnly: 'Read-only projects can be inspected, but changes are disabled.',
	busy: 'Wait for the current editor task to finish.',
	unsupported: 'Mastering sequences are unavailable for this project.',
	applyLane: 'Apply changes',
	operationComplete: 'Mastering sequence updated.',
	close: 'Close',
	helpMenu: 'Help',
});

export type SoundscaperMasteringSequenceCopy = Readonly<{
	[Key in keyof typeof SOUNDSCAPER_MASTERING_SEQUENCE_COPY]: string;
}>;

export function resolveSoundscaperMasteringSequenceCopy(
	copy: Readonly<Record<string, string | undefined>> = {},
): SoundscaperMasteringSequenceCopy {
	return resolveCopyCatalogOverrides(SOUNDSCAPER_MASTERING_SEQUENCE_COPY, copy);
}
