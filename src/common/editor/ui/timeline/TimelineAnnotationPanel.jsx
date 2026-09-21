/* SPDX-License-Identifier: AGPL-3.0-only */

import { formatPresentationMessage } from '../../../i18n/presentation-message.ts'; import { timelineAnnotationNavigationMessage } from './timeline-annotation-presentation.ts'; import React, { useRef } from 'react';

import { AUDIO_EDITOR_TIMELINE_ANNOTATION_COLORS } from '../../timeline-annotation.ts';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import { useTimelineAnnotationInteractions } from './useTimelineAnnotationInteractions.js';

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
	const addMarkerRef = useRef(null);
	const titleId = React.useId();
	const {
		actions,
		batchSelected,
		beginRename,
		convert,
		draftName,
		editingId,
		focusCreated,
		handleKeyDown,
		handleRenameBlur,
		handleRenameKeyDown,
		itemRefs,
		model,
		moveTo,
		remove,
		resizeTo,
		select,
		selectedEditIds,
		setDraftName,
		setStatus,
		status,
	} = useTimelineAnnotationInteractions({
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
		focusFallbackRef: addMarkerRef,
	});
	const navigate = (direction) => {
		const target = run(() => direction < 0
			? actions.previous(project.primarySequenceId)
			: actions.next(project.primarySequenceId));
		completeTimelineAnnotationNavigation(
			target, model.rows, copy, itemRefs.current, (message, identity) => setStatus(identity ?? message),
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
								onBlur={() => handleRenameBlur(annotation)}
								onKeyDown={handleRenameKeyDown}
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
								label={copy.annotationStartFrame}
								sampleRate={sampleRate}
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
								label={copy.annotationEndFrame}
								sampleRate={sampleRate}
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
	const identity = timelineAnnotationNavigationMessage(target, row.timingLabel, copy.annotationSecondsUnit);
	setStatus(formatPresentationMessage(copy, identity), identity);
	schedule(() => {
		const item = itemRefs.get(target.id);
		item?.focus({ preventScroll: true });
		item?.scrollIntoView?.({ block: 'nearest' });
	});
	return target.id;
}

function TimelineAnnotationFrameInput({ disabled, value, minimum, maximum,
	label, sampleRate, onCommit }) {
	return <AudioEditorTimeCodeInput label={label} value={value} unit="samples"
		rate={sampleRate} format="hh:mm:ss+milliseconds" disabled={disabled}
		minimum={minimum} maximum={maximum} onCommit={onCommit} />;
}

function colorLabel(copy, color) {
	return copy[`annotationColor${color[0].toUpperCase()}${color.slice(1)}`] || color;
}
