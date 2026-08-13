/* SPDX-License-Identifier: AGPL-3.0-only */

import { createFramescaperNestedSequenceMenuItems } from './framescaper-nested-sequence-menu.ts';

export function createApplicationMenuProductTrackItems({ productId, project, editBlocked, copy, actions }) {
	const nestedSequences = createFramescaperNestedSequenceMenuItems({
		productId, project, editingBlocked: editBlocked, copy: {
			nestedSequences: copy.nestedSequences,
			addNestedSequence: copy.addNestedSequence,
			updateNestedSequence: copy.updateNestedSequence,
			removeNestedSequence: copy.removeNestedSequence,
		},
	}, { execute: actions.executeNestedSequenceCommand });
	return nestedSequences ? [nestedSequences] : [];
}
