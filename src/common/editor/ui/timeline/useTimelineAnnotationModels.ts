/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo } from 'react';
import { createTimelineAnnotationUiModel, type TimelineAnnotationUiModelInput } from './timeline-annotation-ui-model.ts';

/** Timing labels and annotation order do not depend on selection or keyboard focus. */
export function useTimelineAnnotationModels(input: TimelineAnnotationUiModelInput) {
	const { annotations, primarySequenceId, sampleRate, locale, secondsUnit, selectedAnnotationIds, focusedAnnotationId } = input;
	const prepared = useMemo(() => createTimelineAnnotationUiModel({ annotations, primarySequenceId, sampleRate, locale, secondsUnit,
		selectedAnnotationIds: [], focusedAnnotationId: null }), [annotations, primarySequenceId, sampleRate, locale, secondsUnit]);
	const byId = useMemo(() => new Map(prepared.rows.map(row => [row.id, row])), [prepared]);
	const projected = useMemo(() => prepared.rows.map(row => row.annotation), [prepared]);
	const model = useMemo(() => {
		if (!Array.isArray(selectedAnnotationIds)) throw new TypeError('Selected annotation IDs must be an array.');
		const selectedSet = new Set(selectedAnnotationIds.map(id => canonicalId(id, 'Selected annotation ID')));
		const requestedFocus = focusedAnnotationId === null ? null : canonicalId(focusedAnnotationId, 'Focused annotation ID');
		const selectedIds = Object.freeze(prepared.rows.filter(row => selectedSet.has(row.id)).map(row => row.id));
		const focusedId = requestedFocus !== null && byId.has(requestedFocus)
			? requestedFocus : selectedIds.at(-1) ?? prepared.rows[0]?.id ?? null;
		const rows = Object.freeze(prepared.rows.map(row => {
			const selected = selectedSet.has(row.id);
			const focused = row.id === focusedId;
			return selected === row.selected && focused === row.focused ? row : Object.freeze({ ...row, selected, focused });
		}));
		return Object.freeze({ rows, selectedIds, focusedId });
	}, [byId, focusedAnnotationId, prepared, selectedAnnotationIds]);
	return { model, projected };
}

function canonicalId(value: string, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()) throw new TypeError(`${name} must be a canonical non-empty string.`);
	return value;
}
