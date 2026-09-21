/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useRef, useState } from 'react';

import { usePresentationFeedback } from '../presentation-feedback.ts';
import {
	consumeTimelineAnnotationRenameKey,
	createTimelineAnnotationUiModel,
	resolveTimelineAnnotationKeyboardIntent,
	timelineAnnotationConversionRequest,
	timelineAnnotationCreateKind,
	timelineAnnotationEditBounds,
	timelineAnnotationEditIds,
	timelineAnnotationPointerSelectionIds,
} from './timeline-annotation-ui-model.ts';

const EMPTY_SELECTION = Object.freeze([]);

export function useTimelineAnnotationInteractions({
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
	focusFallbackRef,
	deferKeyboardFocus = false,
	revealKeyboardFocus = false,
}) {
	const model = useMemo(() => createTimelineAnnotationUiModel({
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
	const renameCompletionRef = useRef(null);
	const [editingId, setEditingId] = useState(null);
	const [draftName, setDraftName] = useState('');
	const [status, setStatus] = usePresentationFeedback(copy);
	const projected = useMemo(() => model.rows.map(({ annotation }) => annotation), [model.rows]);

	const focusCreated = (annotationId) => {
		const item = itemRefs.current.get(annotationId);
		item?.focus({ preventScroll: true });
		item?.scrollIntoView?.({ block: 'nearest' });
	};
	const select = (event, annotation) => {
		if (blocked) return EMPTY_SELECTION;
		const ids = timelineAnnotationPointerSelectionIds(annotation.id, model.selectedIds, {
			additive: event.shiftKey,
			toggle: event.metaKey || event.ctrlKey,
		});
		run(() => {
			const result = event.metaKey || event.ctrlKey
				? actions.toggle(annotation.id)
				: actions.select(annotation.id, event.shiftKey);
			setStatus(message(
				ids.includes(annotation.id) ? 'timelineAnnotationSelected' : 'timelineAnnotationDeselected',
				{ name: annotation.name || { key: 'unnamedTimelineAnnotation' } },
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
				setStatus(message('timelineAnnotationRenamed', {
					name: draftName || { key: 'unnamedTimelineAnnotation' },
				}));
				return result;
			});
		}
		setEditingId(null);
		if (restoreFocus) requestAnimationFrame(() => (
			itemRefs.current.get(annotation.id) || focusFallbackRef.current
		)?.focus({ preventScroll: true }));
	};
	const handleRenameBlur = (annotation) => {
		const intent = renameCompletionRef.current;
		renameCompletionRef.current = null;
		if (editingId === annotation.id) {
			finishRename(annotation, intent?.save ?? true, intent?.restoreFocus === true);
		}
	};
	const handleRenameKeyDown = (event) => {
		const intent = consumeTimelineAnnotationRenameKey(event);
		if (!intent) return;
		renameCompletionRef.current = intent;
		event.currentTarget.blur();
	};
	const selectedEditIds = (annotationId) => timelineAnnotationEditIds(annotationId, model.selectedIds);
	const remove = (annotation, rowIndex) => {
		if (blocked) return;
		const ids = selectedEditIds(annotation.id);
		const index = rowIndex ?? model.rows.findIndex(({ id }) => id === annotation.id);
		const removed = new Set(ids);
		const targetId = model.rows.slice(index + 1).find(({ id }) => !removed.has(id))?.id
			|| [...model.rows.slice(0, index)].reverse().find(({ id }) => !removed.has(id))?.id
			|| null;
		run(() => {
			const result = actions.remove(ids);
			setStatus(message('timelineAnnotationRemoved', { count: ids.length }));
			requestAnimationFrame(() => (
				targetId ? itemRefs.current.get(targetId) : focusFallbackRef.current
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
			setStatus(message('timelineAnnotationMoved', {
				name: annotation.name || { key: 'unnamedTimelineAnnotation' }, frames: deltaFrames,
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
			setStatus(message('timelineAnnotationResized', {
				name: annotation.name || { key: 'unnamedTimelineAnnotation' }, frame,
			}));
			return result;
		});
	};
	const moveBy = (annotation, bounds, deltaFrames) => {
		if (blocked || !deltaFrames) return;
		run(() => {
			const result = actions.move(bounds.ids, deltaFrames, annotation.id);
			setStatus(message('timelineAnnotationMoved', {
				name: annotation.name || { key: 'unnamedTimelineAnnotation' }, frames: deltaFrames,
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
	const batchSelected = (batch) => {
		if (blocked || !model.selectedIds.length || (batch && model.selectedIds.length < 2)) return;
		run(() => {
			const result = batch ? actions.batch(model.selectedIds) : actions.unbatch(model.selectedIds);
			setStatus(message(
				batch ? 'timelineAnnotationBatched' : 'timelineAnnotationUnbatched',
				{ count: model.selectedIds.length },
			));
			return result;
		});
	};
	const focusKeyboardTarget = (annotationId) => {
		const focus = () => {
			const item = itemRefs.current.get(annotationId);
			item?.focus({ preventScroll: true });
			if (revealKeyboardFocus) item?.scrollIntoView?.({ block: 'nearest' });
		};
		if (deferKeyboardFocus) requestAnimationFrame(focus);
		else focus();
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
			focusKeyboardTarget(target.id);
		} else if (blocked) {
			return;
		} else if (intent.type === 'rename') beginRename(annotation);
		else if (intent.type === 'remove') remove(annotation, index);
		else if (intent.type === 'toggle') {
			run(() => {
				const result = actions.toggle(annotation.id);
				setStatus(message(
					row.selected ? 'timelineAnnotationDeselected' : 'timelineAnnotationSelected',
					{ name: annotation.name || { key: 'unnamedTimelineAnnotation' } },
				));
				return result;
			});
		} else if (intent.type === 'resize') resizeTo(annotation, intent.edge, intent.frame);
		else moveBy(annotation, bounds, intent.deltaFrames);
	};

	return {
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
		moveBy,
		moveTo,
		projected,
		remove,
		resizeTo,
		select,
		selectedEditIds,
		setDraftName,
		setStatus,
		status,
	};
}

function integerFrame(value) {
	const frame = Number(value);
	if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('Annotation frame must be a non-negative safe integer.');
	return frame;
}

function message(key, parameters) { return { key, parameters }; }
