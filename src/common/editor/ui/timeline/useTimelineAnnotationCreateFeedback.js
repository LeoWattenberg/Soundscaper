/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';

import { timelineAnnotationCreationAnnouncement } from './timeline-annotation-ui-model.ts';

export function useTimelineAnnotationCreateFeedback({ controller, copy, locale, sampleRate, run }) {
	const [status, setStatus] = useState('');
	const announcementTimerRef = useRef(null);
	const announce = useCallback((message) => {
		globalThis.clearTimeout(announcementTimerRef.current);
		setStatus('');
		announcementTimerRef.current = globalThis.setTimeout(() => {
			announcementTimerRef.current = null;
			setStatus(message);
		}, 0);
	}, []);
	useEffect(() => () => globalThis.clearTimeout(announcementTimerRef.current), []);
	const createAnnotation = useCallback((kind, focusCreated) => {
		const annotationId = run(() => {
			if (kind !== 'marker' && kind !== 'region') throw new RangeError('Annotation creation kind must be marker or region.');
			return kind === 'marker'
				? controller.actions.timelineAnnotations.createMarkerAtPlayhead()
				: controller.actions.timelineAnnotations.createRegionFromSelection();
		});
		if (typeof annotationId !== 'string' || !annotationId.length) return annotationId;
		return completeTimelineAnnotationCreation(annotationId, {
			snapshot: controller.getSnapshot(), copy, locale, sampleRate, setStatus: announce, focusCreated,
		});
	}, [announce, controller, copy, locale, run, sampleRate]);
	return Object.freeze({ createAnnotation, status });
}

export function completeTimelineAnnotationCreation(annotationId, {
	snapshot,
	copy,
	locale,
	sampleRate,
	setStatus,
	focusCreated,
	schedule = (callback) => requestAnimationFrame(callback),
}) {
	if (typeof annotationId !== 'string' || !annotationId.length) return annotationId;
	const annotation = snapshot?.timelineAnnotations?.find(({ id }) => id === annotationId);
	if (!annotation) return annotationId;
	setStatus(timelineAnnotationCreationAnnouncement(annotation, {
		sampleRate,
		locale,
		secondsUnit: copy.annotationSecondsUnit,
		unnamed: copy.unnamedTimelineAnnotation,
		marker: copy.timelineMarker,
		region: copy.timelineRegion,
		template: copy.timelineAnnotationCreated,
	}));
	if (typeof focusCreated === 'function') schedule(() => focusCreated(annotationId));
	return annotationId;
}

export function focusCreatedTimelineAnnotation(root, annotationId, preferredSurface = 'layer') {
	const surfaceOrder = preferredSurface === 'panel'
		? ['[data-timeline-annotation-panel]', '[data-timeline-annotation-layer]']
		: ['[data-timeline-annotation-layer]', '[data-timeline-annotation-panel]'];
	for (const selector of surfaceOrder) {
		const surface = root?.querySelector?.(selector);
		const item = [...(surface?.querySelectorAll?.('[data-annotation-id]') || [])]
			.find((candidate) => candidate.dataset.annotationId === annotationId);
		if (!item) continue;
		item.focus({ preventScroll: true });
		item.scrollIntoView?.({ block: 'nearest' });
		return true;
	}
	return false;
}
