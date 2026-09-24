/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react'; import { usePresentationFeedback } from '../presentation-feedback.ts';

export function TimelineAnnotationLaneActions({
	controller, project, annotations, copy, blocked, run, createAnnotation, focusCreated,
}) {
	const [status, setStatus] = usePresentationFeedback(copy);
	const statusId = React.useId();
	const actions = controller.actions.timelineAnnotations;
	const requestedIds = Array.isArray(project.selection?.annotationIds)
		? project.selection.annotationIds
		: [];
	const selectedIds = primarySequenceSelectionIds(
		annotations, project.primarySequenceId, requestedIds,
	);
	const batch = (enabled) => run(() => {
		const result = enabled ? actions.batch(selectedIds) : actions.unbatch(selectedIds);
		setStatus(message(
			enabled ? 'timelineAnnotationBatched' : 'timelineAnnotationUnbatched',
			{ count: selectedIds.length },
		));
		return result;
	});

	return <>
		<div
			className="audio-editor-timeline-annotation-lane-actions"
			data-timeline-annotation-interactive
			data-timeline-annotation-create-actions
			role="group"
			aria-label={copy.timelineAnnotations}
			aria-describedby={statusId}
		>
			<button type="button" aria-label={copy.addTimelineMarker}
				disabled={blocked} onClick={() => createAnnotation('marker', focusCreated)}>+M</button>
			<button type="button" aria-label={copy.addTimelineRegion}
				disabled={blocked || !(project.selection?.endFrame > project.selection?.startFrame)}
				onClick={() => createAnnotation('region', focusCreated)}>+R</button>
			<button type="button" aria-label={copy.batchTimelineAnnotations}
				disabled={blocked || selectedIds.length < 2} onClick={() => batch(true)}>B</button>
			<button type="button" aria-label={copy.unbatchTimelineAnnotations}
				disabled={blocked || !selectedIds.length} onClick={() => batch(false)}>⇧B</button>
		</div>
		<span id={statusId} className="kw-audio-editor-sr-only" role="status" aria-live="polite">{status}</span>
	</>;
}

export function primarySequenceSelectionIds(annotations, primarySequenceId, selectedIds) {
	const selected = new Set(selectedIds);
	return annotations
		.filter((annotation) => annotation.sequenceId === primarySequenceId && selected.has(annotation.id))
		.map(({ id }) => id);
}

function message(key, parameters) { return { key, parameters }; }
