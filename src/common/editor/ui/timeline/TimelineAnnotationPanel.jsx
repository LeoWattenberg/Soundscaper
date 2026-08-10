/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useRef, useState } from 'react';

import { AUDIO_EDITOR_TIMELINE_ANNOTATION_COLORS } from '../../timeline-annotation.ts';
import {
	consumeTimelineAnnotationRenameKey,
	createTimelineAnnotationUiModel,
	resolveTimelineAnnotationFrameBlur,
	resolveTimelineAnnotationKeyboardIntent,
	timelineAnnotationConversionRequest,
	timelineAnnotationCreateKind,
	timelineAnnotationEditBounds,
	timelineAnnotationEditIds,
	timelineAnnotationPointerSelectionIds,
} from './timeline-annotation-ui-model.ts';

export function TimelineAnnotationPanel({
	controller,
	project,
	annotations,
	selectedAnnotationId,
	copy,
	locale,
	sampleRate,
	blocked,
	run,
	createAnnotation,
}) {
	const model = React.useMemo(() => createTimelineAnnotationUiModel({
		annotations,
		primarySequenceId: project.primarySequenceId,
		selectedAnnotationIds: project.selection?.annotationIds || [],
		focusedAnnotationId: selectedAnnotationId,
		sampleRate,
		locale,
		secondsUnit: copy.annotationSecondsUnit,
	}), [annotations, copy.annotationSecondsUnit, locale, project.primarySequenceId, project.selection?.annotationIds, sampleRate, selectedAnnotationId]);
	const actions = controller.actions.timelineAnnotations;
	const itemRefs = useRef(new Map());
	const addMarkerRef = useRef(null);
	const renameCompletionRef = useRef(null);
	const [editingId, setEditingId] = useState(null);
	const [draftName, setDraftName] = useState('');
	const [status, setStatus] = useState('');
	const titleId = React.useId();
	const projected = model.rows.map(({ annotation }) => annotation);
	const focusCreated = (annotationId) => {
		const item = itemRefs.current.get(annotationId);
		item?.focus({ preventScroll: true });
		item?.scrollIntoView?.({ block: 'nearest' });
	};

	const select = (event, annotation) => {
		if (blocked) return;
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
			itemRefs.current.get(annotation.id) || addMarkerRef.current
		)?.focus({ preventScroll: true }));
	};
	const selectedEditIds = (annotationId) => timelineAnnotationEditIds(annotationId, model.selectedIds);
	const remove = (annotation) => {
		if (blocked) return;
		const ids = selectedEditIds(annotation.id);
		const index = model.rows.findIndex(({ id }) => id === annotation.id);
		const removed = new Set(ids);
		const targetId = model.rows.slice(index + 1).find(({ id }) => !removed.has(id))?.id
			|| [...model.rows.slice(0, index)].reverse().find(({ id }) => !removed.has(id))?.id
			|| null;
		run(() => {
			const result = actions.remove(ids);
			setStatus(message(copy.timelineAnnotationRemoved, { count: ids.length }));
			requestAnimationFrame(() => (
				targetId ? itemRefs.current.get(targetId) : addMarkerRef.current
			)?.focus({ preventScroll: true }));
			return result;
		});
	};
	const moveTo = (annotation, requestedFrame) => {
		if (blocked) return;
		run(() => {
			const frame = integerFrame(requestedFrame);
			const deltaFrames = frame - annotation.timelineStartFrame;
			if (!deltaFrames) return null;
			const result = actions.move(selectedEditIds(annotation.id), deltaFrames, annotation.id);
			setStatus(message(copy.timelineAnnotationMoved, {
				name: annotation.name || copy.unnamedTimelineAnnotation, frames: deltaFrames,
			}));
			return result;
		});
	};
	const resizeTo = (annotation, edge, requestedFrame) => {
		if (blocked) return;
		run(() => {
			const frame = integerFrame(requestedFrame);
			const currentFrame = edge === 'start'
				? annotation.timelineStartFrame
				: annotation.timelineEndFrame;
			if (frame === currentFrame) return null;
			const result = actions.resize(annotation.id, edge, frame);
			setStatus(message(copy.timelineAnnotationResized, {
				name: annotation.name || copy.unnamedTimelineAnnotation, frame,
			}));
			return result;
		});
	};
	const moveBy = (annotation, bounds, deltaFrames) => {
		if (blocked || !deltaFrames) return;
		run(() => {
			const result = actions.move(bounds.ids, deltaFrames, annotation.id);
			setStatus(message(copy.timelineAnnotationMoved, {
				name: annotation.name || copy.unnamedTimelineAnnotation, frames: deltaFrames,
			}));
			return result;
		});
	};
	const convert = (annotation, changes) => {
		if (blocked) return;
		run(() => actions.convert(
			annotation.id,
			timelineAnnotationConversionRequest(annotation, changes, sampleRate),
		));
	};
	const handleKeyDown = (event, row, index) => {
		const annotation = row.annotation;
		if (event.key.toLowerCase() === 'b' && !event.altKey && !event.ctrlKey && !event.metaKey
			&& (event.shiftKey ? model.selectedIds.length > 0 : model.selectedIds.length > 1)) {
			event.preventDefault();
			event.stopPropagation();
			if (!blocked) batchSelected(!event.shiftKey);
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
			itemRefs.current.get(target.id)?.focus({ preventScroll: true });
		} else if (blocked) {
			return;
		} else if (intent.type === 'rename') beginRename(annotation);
		else if (intent.type === 'remove') remove(annotation);
		else if (intent.type === 'toggle') {
			run(() => {
				const result = actions.toggle(annotation.id);
				setStatus(message(
					row.selected ? copy.timelineAnnotationDeselected : copy.timelineAnnotationSelected,
					{ name: annotation.name || copy.unnamedTimelineAnnotation },
				));
				return result;
			});
		} else if (intent.type === 'resize') resizeTo(annotation, intent.edge, intent.frame);
		else moveBy(annotation, bounds, intent.deltaFrames);
	};
	const batchSelected = (batch) => {
		if (blocked || !model.selectedIds.length || (batch && model.selectedIds.length < 2)) return;
		run(() => {
			const result = batch ? actions.batch(model.selectedIds) : actions.unbatch(model.selectedIds);
			setStatus(message(
				batch ? copy.timelineAnnotationBatched : copy.timelineAnnotationUnbatched,
				{ count: model.selectedIds.length },
			));
			return result;
		});
	};
	const navigate = (direction) => {
		const target = run(() => direction < 0
			? actions.previous(project.primarySequenceId)
			: actions.next(project.primarySequenceId));
		completeTimelineAnnotationNavigation(
			target, model.rows, copy, itemRefs.current, setStatus,
		);
	};
	const expandedId = editingId ?? model.focusedId;

	return (
		<section className="audio-editor-timeline-annotation-panel" data-timeline-annotation-panel aria-labelledby={titleId}>
			<header className="audio-editor-timeline-annotation-panel__header">
				<div>
					<strong id={titleId}>{copy.timelineAnnotations}</strong>
					<small>{copy.timelineAnnotationKeyboardHelp}</small>
				</div>
				<div className="audio-editor-timeline-annotation-panel__actions">
					<button ref={addMarkerRef} type="button" disabled={blocked} onClick={() => createAnnotation('marker', focusCreated)}>
						{copy.addTimelineMarker}
					</button>
					<button
						type="button"
						disabled={blocked || !(project.selection?.endFrame > project.selection?.startFrame)}
						onClick={() => createAnnotation('region', focusCreated)}
					>{copy.addTimelineRegion}</button>
					<button type="button" disabled={!model.rows.length} onClick={() => navigate(-1)}>
						{copy.previousTimelineAnnotation}
					</button>
					<button type="button" disabled={!model.rows.length} onClick={() => navigate(1)}>
						{copy.nextTimelineAnnotation}
					</button>
				</div>
			</header>

			{model.rows.length ? <ul className="audio-editor-timeline-annotation-list" aria-label={copy.timelineAnnotationList}>
				{model.rows.map((row, index) => {
					const annotation = row.annotation;
					const expanded = expandedId === annotation.id;
					return <li key={annotation.id} data-annotation-color={annotation.color} data-selected={row.selected ? 'true' : 'false'}>
						<button
							ref={(node) => node ? itemRefs.current.set(annotation.id, node) : itemRefs.current.delete(annotation.id)}
							type="button"
							className="audio-editor-timeline-annotation-list__item"
							data-timeline-annotation
							data-annotation-id={annotation.id}
							aria-pressed={row.selected}
							aria-disabled={blocked}
							aria-label={`${annotation.name || copy.unnamedTimelineAnnotation}, ${annotation.kind === 'marker' ? copy.timelineMarker : copy.timelineRegion}, ${row.timingLabel}`}
							tabIndex={row.focused ? 0 : -1}
							onClick={(event) => select(event, annotation)}
							onDoubleClick={() => {
								if (!blocked) beginRename(annotation);
							}}
							onFocus={() => run(() => actions.focus(annotation.id))}
							onKeyDown={(event) => handleKeyDown(event, row, index)}
						>
							<span className="audio-editor-timeline-annotation-list__swatch" aria-hidden="true" />
							<span>{annotation.name || copy.unnamedTimelineAnnotation}</span>
							<small>{annotation.kind === 'marker' ? copy.timelineMarker : copy.timelineRegion}</small>
							<small>{row.timingLabel}</small>
							<small>{annotation.anchor === 'sample' ? copy.sampleAnchor : copy.musicalAnchor}</small>
						</button>
						{expanded && <div className="audio-editor-timeline-annotation-list__editor" role="group" aria-label={copy.editTimelineAnnotation}>
							<label>{copy.annotationName}<input
								disabled={blocked}
								value={editingId === annotation.id ? draftName : annotation.name}
								onFocus={() => {
									if (editingId !== annotation.id) beginRename(annotation);
								}}
								onChange={(event) => setDraftName(event.target.value)}
								onBlur={() => {
									const intent = renameCompletionRef.current;
									renameCompletionRef.current = null;
									if (editingId === annotation.id) finishRename(
										annotation, intent?.save ?? true, intent?.restoreFocus === true,
									);
								}}
								onKeyDown={(event) => {
									const intent = consumeTimelineAnnotationRenameKey(event);
									if (!intent) return;
									renameCompletionRef.current = intent;
									event.currentTarget.blur();
								}}
							/></label>
							<label>{copy.annotationColor}<select disabled={blocked} value={annotation.color} onChange={(event) => run(() => actions.setColor(selectedEditIds(annotation.id), event.target.value))}>
								{AUDIO_EDITOR_TIMELINE_ANNOTATION_COLORS.map((color) => <option key={color} value={color}>{colorLabel(copy, color)}</option>)}
							</select></label>
							<label>{copy.annotationKind}<select disabled={blocked} value={annotation.kind} onChange={(event) => convert(annotation, { kind: event.target.value, anchor: annotation.anchor })}>
								<option value="marker">{copy.timelineMarker}</option><option value="region">{copy.timelineRegion}</option>
							</select></label>
							<label>{copy.annotationAnchor}<select disabled={blocked} value={annotation.anchor} onChange={(event) => convert(annotation, { kind: annotation.kind, anchor: event.target.value })}>
								<option value="sample">{copy.sampleAnchor}</option><option value="musical">{copy.musicalAnchor}</option>
							</select></label>
							<label>{copy.annotationStartFrame}<TimelineAnnotationFrameInput
								key={`start-${annotation.timelineStartFrame}`}
								disabled={blocked}
								value={annotation.timelineStartFrame}
								minimum={0}
								maximum={annotation.kind === 'region' ? annotation.timelineEndFrame - 1 : Number.MAX_SAFE_INTEGER}
								onCommit={(frame) => annotation.kind === 'region'
									? resizeTo(annotation, 'start', frame)
									: moveTo(annotation, frame)}
							/></label>
							{annotation.kind === 'region' && <label>{copy.annotationEndFrame}<TimelineAnnotationFrameInput
								key={`end-${annotation.timelineEndFrame}`}
								disabled={blocked}
								value={annotation.timelineEndFrame}
								minimum={annotation.timelineStartFrame + 1}
								maximum={Number.MAX_SAFE_INTEGER}
								onCommit={(frame) => resizeTo(annotation, 'end', frame)}
							/></label>}
							<div className="audio-editor-timeline-annotation-list__editor-actions">
								<button type="button" disabled={blocked || model.selectedIds.length < 2} onClick={() => batchSelected(true)}>{copy.batchTimelineAnnotations}</button>
								<button type="button" disabled={blocked || !model.selectedIds.length} onClick={() => batchSelected(false)}>{copy.unbatchTimelineAnnotations}</button>
								<button type="button" disabled={blocked} onClick={() => remove(annotation)}>{copy.removeTimelineAnnotations}</button>
							</div>
						</div>}
					</li>;
				})}
			</ul> : <p className="audio-editor-timeline-annotation-panel__empty">{copy.noTimelineAnnotations}</p>}
			<p className="audio-editor-timeline-annotation-panel__status" role="status" aria-live="polite">{status}</p>
		</section>
	);
}

export function completeTimelineAnnotationNavigation(
	target,
	rows,
	copy,
	itemRefs,
	setStatus,
	schedule = (callback) => requestAnimationFrame(callback),
) {
	if (!target) return null;
	const row = rows.find(({ id }) => id === target.id);
	if (!row) return null;
	setStatus(`${target.name || copy.unnamedTimelineAnnotation}, ${
		target.kind === 'marker' ? copy.timelineMarker : copy.timelineRegion
	}, ${row.timingLabel}`);
	schedule(() => {
		const item = itemRefs.get(target.id);
		item?.focus({ preventScroll: true });
		item?.scrollIntoView?.({ block: 'nearest' });
	});
	return target.id;
}

function TimelineAnnotationFrameInput({ disabled, value, minimum, maximum, onCommit }) {
	const [draft, setDraft] = useState(String(value));
	return <input
		type="number"
		disabled={disabled}
		min={minimum}
		max={maximum}
		step="1"
		value={draft}
		onChange={(event) => setDraft(event.target.value)}
		onBlur={() => {
			const result = resolveTimelineAnnotationFrameBlur(draft, value, minimum, maximum);
			setDraft(result.restoredDraft);
			if (result.frame !== null) onCommit(result.frame);
		}}
	/>;
}

function integerFrame(value) {
	const frame = Number(value);
	if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('Annotation frame must be a non-negative safe integer.');
	return frame;
}

function colorLabel(copy, color) {
	return copy[`annotationColor${color[0].toUpperCase()}${color.slice(1)}`] || color;
}

function message(template, values) {
	return Object.entries(values).reduce(
		(output, [key, value]) => output.replace(`{${key}}`, String(value)),
		String(template || ''),
	);
}
