/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useRef, useState } from 'react';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

import {
	consumeTimelineAnnotationRenameKey,
	createTimelineAnnotationUiModel,
	cycleTimelineAnnotationHitId,
	planTimelineAnnotationPointerGesture,
	resolveTimelineAnnotationKeyboardIntent,
	resolveTimelineAnnotationPointerCompletion,
	timelineAnnotationEditBounds,
	timelineAnnotationEditIds,
	timelineAnnotationHitIds,
	timelineAnnotationIsVisible,
	timelineAnnotationPointerDelta,
	timelineAnnotationPointerEdge,
	timelineAnnotationCreateKind,
	timelineAnnotationPointerSelectionIds,
	timelineAnnotationRegionWidth,
} from './timeline-annotation-ui-model.ts';

export function TimelineAnnotationLayer({
	controller,
	project,
	annotations,
	selectedAnnotationId,
	copy,
	locale,
	pixelsPerSecond,
	sampleRate,
	scrollX,
	viewportWidth,
	blocked,
	run,
	createAnnotation,
}) {
	// The lane overlays the ruler, which draws time zero CLIP_CONTENT_OFFSET
	// pixels in from the viewport edge; shifting the lane's scroll origin by the
	// same inset keeps annotations under the ticks and the playhead they name.
	const laneScrollX = scrollX - CLIP_CONTENT_OFFSET;
	const model = React.useMemo(() => createTimelineAnnotationUiModel({
		annotations,
		primarySequenceId: project.primarySequenceId,
		selectedAnnotationIds: project.selection?.annotationIds || [],
		focusedAnnotationId: selectedAnnotationId,
		sampleRate,
		locale,
		secondsUnit: copy.annotationSecondsUnit,
	}), [annotations, copy.annotationSecondsUnit, locale, project.primarySequenceId, project.selection?.annotationIds, sampleRate, selectedAnnotationId]);
	const itemRefs = useRef(new Map());
	const layerRef = useRef(null);
	const dragRef = useRef(null);
	const hitCycleRef = useRef(null);
	const lastPointerTargetRef = useRef(null);
	const renameCompletionRef = useRef(null);
	const [preview, setPreview] = useState(null);
	const [editingId, setEditingId] = useState(null);
	const [draftName, setDraftName] = useState('');
	const [status, setStatus] = useState('');
	const statusId = React.useId();
	const actions = controller.actions.timelineAnnotations;
	const projected = React.useMemo(() => model.rows.map(({ annotation }) => annotation), [model.rows]);
	const rowById = React.useMemo(() => new Map(model.rows.map((row) => [row.id, row])), [model.rows]);
	const visibleRows = React.useMemo(() => model.rows
		.map((row, index) => ({ row, index }))
		.filter(({ row }) => row.focused || row.id === editingId || timelineAnnotationIsVisible(
			row.annotation, pixelsPerSecond, sampleRate, laneScrollX, viewportWidth,
		)), [editingId, laneScrollX, model.rows, pixelsPerSecond, sampleRate, viewportWidth]);
	const editingRow = editingId ? rowById.get(editingId) : null;
	const editingLeft = editingRow
		? editingRow.annotation.timelineStartFrame / sampleRate * pixelsPerSecond - laneScrollX
		: 0;
	const editingWidth = editingRow?.annotation.kind === 'region'
		? timelineAnnotationRegionWidth(editingRow.annotation.durationFrames, pixelsPerSecond, sampleRate)
		: 2;
	const focusCreated = (annotationId) => {
		const item = itemRefs.current.get(annotationId);
		item?.focus({ preventScroll: true });
		item?.scrollIntoView?.({ block: 'nearest' });
	};

	const select = (event, annotation) => {
		if (blocked) return Object.freeze([]);
		const ids = timelineAnnotationPointerSelectionIds(annotation.id, model.selectedIds, {
			additive: event.shiftKey,
			toggle: event.metaKey || event.ctrlKey,
		});
		run(() => {
			const result = event.metaKey || event.ctrlKey
				? actions.toggle(annotation.id)
				: actions.select(annotation.id, event.shiftKey);
			setStatus(message(
				ids.includes(annotation.id) ? copy.timelineAnnotationSelected : copy.timelineAnnotationDeselected,
				{ name: annotation.name || copy.unnamedTimelineAnnotation },
			));
			return result;
		});
		return ids;
	};
	const beginRename = (annotation) => {
		if (blocked) return;
		setEditingId(annotation.id);
		setDraftName(annotation.name);
	};
	const finishRename = (annotation, save, restoreFocus = false) => {
		if (!blocked && save && draftName !== annotation.name) {
			run(() => {
				const result = actions.rename([annotation.id], draftName);
				setStatus(message(copy.timelineAnnotationRenamed, {
					name: draftName || copy.unnamedTimelineAnnotation,
				}));
				return result;
			});
		}
		setEditingId(null);
		if (restoreFocus) requestAnimationFrame(() => (
			itemRefs.current.get(annotation.id) || layerRef.current
		)?.focus({ preventScroll: true }));
	};
	const remove = (annotation, index) => {
		if (blocked) return;
		const ids = timelineAnnotationEditIds(annotation.id, model.selectedIds);
		const removed = new Set(ids);
		const targetId = model.rows.slice(index + 1).find(({ id }) => !removed.has(id))?.id
			|| [...model.rows.slice(0, index)].reverse().find(({ id }) => !removed.has(id))?.id
			|| null;
		run(() => {
			const result = actions.remove(ids);
			setStatus(message(copy.timelineAnnotationRemoved, { count: ids.length }));
			requestAnimationFrame(() => (
				targetId ? itemRefs.current.get(targetId) : layerRef.current
			)?.focus({ preventScroll: true }));
			return result;
		});
	};
	const handleKeyDown = (event, row, index) => {
		const annotation = row.annotation;
		if (event.key.toLowerCase() === 'b' && !event.altKey && !event.ctrlKey && !event.metaKey
			&& (event.shiftKey ? model.selectedIds.length > 0 : model.selectedIds.length > 1)) {
			event.preventDefault();
			event.stopPropagation();
			if (blocked) return;
			run(() => {
				const result = event.shiftKey ? actions.unbatch(model.selectedIds) : actions.batch(model.selectedIds);
				setStatus(message(
					event.shiftKey ? copy.timelineAnnotationUnbatched : copy.timelineAnnotationBatched,
					{ count: model.selectedIds.length },
				));
				return result;
			});
			return;
		}
		const createKind = timelineAnnotationCreateKind(event, project.selection);
		if (createKind) {
			event.preventDefault();
			event.stopPropagation();
			if (!blocked) createAnnotation(createKind, focusCreated);
			return;
		}
		const bounds = timelineAnnotationEditBounds(annotation.id, model.selectedIds, projected);
		const intent = resolveTimelineAnnotationKeyboardIntent(annotation, event, sampleRate, bounds);
		if (!intent) return;
		event.preventDefault();
		event.stopPropagation();
		if (intent.type === 'focus') {
			const target = model.rows[index + intent.offset];
			if (!target) return;
			run(() => actions.focus(target.id));
			requestAnimationFrame(() => {
				const item = itemRefs.current.get(target.id);
				item?.focus({ preventScroll: true });
				item?.scrollIntoView?.({ block: 'nearest' });
			});
		} else if (blocked) {
			return;
		} else if (intent.type === 'rename') beginRename(annotation);
		else if (intent.type === 'remove') remove(annotation, index);
		else if (intent.type === 'toggle') {
			run(() => {
				const result = actions.toggle(annotation.id);
				setStatus(message(
					row.selected ? copy.timelineAnnotationDeselected : copy.timelineAnnotationSelected,
					{ name: annotation.name || copy.unnamedTimelineAnnotation },
				));
				return result;
			});
		} else if (intent.type === 'resize') {
			const currentFrame = intent.edge === 'start'
				? annotation.timelineStartFrame
				: annotation.timelineEndFrame;
			if (intent.frame === currentFrame) return;
			run(() => {
				const result = actions.resize(annotation.id, intent.edge, intent.frame);
				setStatus(message(copy.timelineAnnotationResized, {
					name: annotation.name || copy.unnamedTimelineAnnotation, frame: intent.frame,
				}));
				return result;
			});
		} else {
			if (!intent.deltaFrames) return;
			run(() => {
				const result = actions.move(bounds.ids, intent.deltaFrames, annotation.id);
				setStatus(message(copy.timelineAnnotationMoved, {
					name: annotation.name || copy.unnamedTimelineAnnotation, frames: intent.deltaFrames,
				}));
				return result;
			});
		}
	};
	const pointerDown = (event, eventRow) => {
		if (blocked || event.button !== 0 || event.target.closest?.('input')) return;
		const edge = timelineAnnotationPointerEdge(event.target.dataset?.annotationEdge);
		let row = eventRow;
		if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
			const bounds = layerRef.current?.getBoundingClientRect();
			const offsetX = event.clientX - (bounds?.left || 0);
			const hitIds = timelineAnnotationHitIds(
				projected, offsetX, pixelsPerSecond, sampleRate, laneScrollX, edge,
			);
			if (hitIds.length > 1 && hitIds.includes(eventRow.id)) {
				const signature = `${edge || 'body'}:${Math.round(offsetX)}:${hitIds.join('\u0000')}`;
				const previousId = hitCycleRef.current?.signature === signature
					? hitCycleRef.current.id
					: null;
				const targetId = cycleTimelineAnnotationHitId(hitIds, eventRow.id, previousId);
				hitCycleRef.current = { signature, id: targetId };
				row = rowById.get(targetId) || eventRow;
			} else hitCycleRef.current = null;
		} else hitCycleRef.current = null;
		lastPointerTargetRef.current = { id: row.id, eventRowId: eventRow.id, edge };
		const selectionOptions = {
			additive: event.shiftKey,
			toggle: event.metaKey || event.ctrlKey,
		};
		const gesture = planTimelineAnnotationPointerGesture(row.id, model.selectedIds, selectionOptions);
		const selectedIds = gesture.selectOnPointerDown
			? select(event, row.annotation)
			: gesture.dragIds;
		if (!gesture.selectOnPointerDown) run(() => actions.focus(row.id));
		if (!selectedIds.includes(row.id)) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		const bounds = edge
			? timelineAnnotationEditBounds(row.id, [], projected)
			: timelineAnnotationEditBounds(row.id, selectedIds, projected);
		dragRef.current = {
			annotation: row.annotation,
			gesture: { ...gesture, dragIds: bounds.ids },
			idSet: new Set(bounds.ids),
			edge,
			startX: event.clientX,
			minimumStartFrame: bounds.minimumStartFrame,
			maximumEndFrame: bounds.maximumEndFrame,
		};
		event.currentTarget.setPointerCapture?.(event.pointerId);
		event.preventDefault();
		event.stopPropagation();
	};
	const pointerMove = (event) => {
		const drag = dragRef.current;
		if (!drag) return;
		const deltaFrames = timelineAnnotationPointerDelta(
			drag.startX, event.clientX, pixelsPerSecond, sampleRate,
			drag.minimumStartFrame, drag.maximumEndFrame,
		);
		drag.deltaFrames = deltaFrames;
		setPreview({ idSet: drag.idSet, annotationId: drag.annotation.id, edge: drag.edge, deltaFrames });
		event.preventDefault();
	};
	const pointerUp = (event, cancelled = false) => {
		const drag = dragRef.current;
		dragRef.current = null;
		setPreview(null);
		if (!drag) return;
		event.preventDefault();
		event.stopPropagation();
		if (drag.edge) {
			if (cancelled || !drag.deltaFrames) return;
			const original = drag.edge === 'start'
				? drag.annotation.timelineStartFrame
				: drag.annotation.timelineEndFrame;
			const opposite = drag.edge === 'start'
				? drag.annotation.timelineEndFrame - 1
				: drag.annotation.timelineStartFrame + 1;
			const frame = drag.edge === 'start'
				? Math.min(opposite, Math.max(0, original + drag.deltaFrames))
				: Math.max(opposite, original + drag.deltaFrames);
			run(() => {
				const result = actions.resize(drag.annotation.id, drag.edge, frame);
				setStatus(message(copy.timelineAnnotationResized, {
					name: drag.annotation.name || copy.unnamedTimelineAnnotation, frame,
				}));
				return result;
			});
		} else {
			const completion = resolveTimelineAnnotationPointerCompletion(
				drag.gesture, drag.deltaFrames || 0, cancelled,
			);
			if (!completion) return;
			if (completion.type === 'select') {
				select({ shiftKey: false, metaKey: false, ctrlKey: false }, drag.annotation);
				return;
			}
			run(() => {
				const result = actions.move(completion.ids, completion.deltaFrames, drag.annotation.id);
				setStatus(message(copy.timelineAnnotationMoved, {
					name: drag.annotation.name || copy.unnamedTimelineAnnotation, frames: completion.deltaFrames,
				}));
				return result;
			});
		}
	};

	return <>
		<div
			ref={layerRef}
			className="audio-editor-timeline-annotations"
			data-timeline-annotation-interactive
			data-timeline-annotation-layer
			role={model.rows.length ? 'listbox' : undefined}
			aria-label={model.rows.length ? copy.timelineAnnotations : undefined}
			aria-describedby={model.rows.length ? statusId : undefined}
			aria-multiselectable={model.rows.length ? 'true' : undefined}
			aria-disabled={blocked}
			tabIndex={model.rows.length && !visibleRows.some(({ row }) => row.focused) ? 0 : -1}
			style={{ width: viewportWidth }}
		>
			{visibleRows.map(({ row, index }) => {
				const annotation = row.annotation;
				const movingDelta = preview?.idSet.has(annotation.id) && !preview.edge ? preview.deltaFrames : 0;
				const resizing = preview?.annotationId === annotation.id ? preview : null;
				const startFrame = resizing?.edge === 'start'
					? Math.min(annotation.timelineEndFrame - 1, Math.max(0, annotation.timelineStartFrame + resizing.deltaFrames))
					: annotation.timelineStartFrame + movingDelta;
				const endFrame = resizing?.edge === 'end'
					? Math.max(annotation.timelineStartFrame + 1, annotation.timelineEndFrame + resizing.deltaFrames)
					: annotation.timelineEndFrame + movingDelta;
				const left = startFrame / sampleRate * pixelsPerSecond - laneScrollX;
				const width = annotation.kind === 'region'
					? timelineAnnotationRegionWidth(endFrame - startFrame, pixelsPerSecond, sampleRate)
					: 2;
				return (
					<div
						key={annotation.id}
						ref={(node) => node ? itemRefs.current.set(annotation.id, node) : itemRefs.current.delete(annotation.id)}
						className={`audio-editor-timeline-annotation audio-editor-timeline-annotation--${annotation.kind}`}
						data-timeline-annotation
						data-annotation-id={annotation.id}
						data-annotation-color={annotation.color}
						data-selected={row.selected ? 'true' : 'false'}
						role="option"
						aria-selected={row.selected}
						aria-disabled={blocked}
						aria-posinset={index + 1}
						aria-setsize={model.rows.length}
						aria-label={`${annotation.name || copy.unnamedTimelineAnnotation}, ${annotation.kind === 'marker' ? copy.timelineMarker : copy.timelineRegion}, ${row.timingLabel}`}
						tabIndex={row.focused ? 0 : -1}
						style={{ left, width }}
						onFocus={() => run(() => actions.focus(annotation.id))}
							onDoubleClick={() => {
							const target = lastPointerTargetRef.current?.edge === null
								&& lastPointerTargetRef.current.eventRowId === row.id
								? rowById.get(lastPointerTargetRef.current.id)
								: row;
							if (!blocked) beginRename(target?.annotation || annotation);
						}}
						onKeyDown={(event) => handleKeyDown(event, row, index)}
						onPointerDown={(event) => pointerDown(event, row)}
						onPointerMove={pointerMove}
						onPointerUp={pointerUp}
						onPointerCancel={(event) => pointerUp(event, true)}
					>
						{annotation.kind === 'region' && <span className="audio-editor-timeline-annotation__handle" data-annotation-edge="start" aria-hidden="true" />}
						{annotation.kind === 'region' && <span className="audio-editor-timeline-annotation__name" aria-hidden="true">
							{annotation.name || copy.unnamedTimelineAnnotation}
						</span>}
						{annotation.kind === 'region' && <span className="audio-editor-timeline-annotation__handle" data-annotation-edge="end" aria-hidden="true" />}
					</div>
				);
			})}
		</div>
		{editingRow && <input
			className="audio-editor-timeline-annotation__rename audio-editor-timeline-annotation__rename--overlay"
			data-timeline-annotation-interactive
			aria-label={copy.annotationName}
			value={draftName}
			autoFocus
			disabled={blocked}
			style={{ left: editingLeft, width: Math.max(90, editingWidth) }}
			onChange={(event) => setDraftName(event.target.value)}
			onBlur={() => {
				const intent = renameCompletionRef.current;
				renameCompletionRef.current = null;
				finishRename(editingRow.annotation, intent?.save ?? true, intent?.restoreFocus === true);
			}}
			onKeyDown={(event) => {
				const intent = consumeTimelineAnnotationRenameKey(event);
				if (!intent) return;
				renameCompletionRef.current = intent;
				event.currentTarget.blur();
			}}
		/>}
		<span id={statusId} className="kw-audio-editor-sr-only" role="status" aria-live="polite">{status}</span>
	</>;
}

function message(template, values) {
	return Object.entries(values).reduce(
		(output, [key, value]) => output.replace(`{${key}}`, String(value)),
		String(template || ''),
	);
}
