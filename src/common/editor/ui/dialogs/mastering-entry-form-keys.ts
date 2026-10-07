/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from 'react';
import type { DocumentMasteringSequenceEntrySnapshot } from '../../controller/document/document-mastering-sequence-snapshot.ts';
const EMPTY: readonly DocumentMasteringSequenceEntrySnapshot[] = [];

/** Document edits remount affected drafts; picker changes keep their existing keys. */
export function useMasteringEntryKeys(sequenceId: string, entries: readonly DocumentMasteringSequenceEntrySnapshot[] = EMPTY) {
	return useMemo(() => entries.map(entry => JSON.stringify([
		sequenceId, entry.id, entry.annotationId, entry.title, entry.titleOverride, entry.durationFrames,
		entry.gapBeforeFrames, entry.fadeInFrames, entry.fadeOutFrames, entry.metadata,
	])), [sequenceId, entries]);
}
