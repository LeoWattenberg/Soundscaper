/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createTimelineAnnotationService } from './internal/annotations/timeline-annotation-service.ts';
import type { createRegularIntervalAnnotationController } from './internal/annotations/regular-interval-annotation-controller.ts';
import type { RestrictToCapability } from '../composition/action-facade-runtime.ts';

type Service = ReturnType<typeof createTimelineAnnotationService>;

export interface TimelineAnnotationActionFacadeDependencies {
	readonly service: Service;
	readonly regularInterval: ReturnType<typeof createRegularIntervalAnnotationController>['create'];
	readonly restricted: RestrictToCapability;
	createId(prefix: string): string;
}

/** Keep annotation commands typed from their owner through their menu-facing API. */
export function createTimelineAnnotationActionFacade(d: TimelineAnnotationActionFacadeDependencies) {
	const { service, restricted } = d;
	return Object.freeze({
		createMarkerAtPlayhead: restricted('timelineAnnotations', service.createMarker),
		createRegionFromSelection: restricted('timelineAnnotations', service.createRegion),
		focus: restricted('timelineAnnotations', service.focusAnnotation),
		clearFocus: restricted('timelineAnnotations', service.clearFocus),
		select: restricted('timelineAnnotations', service.selectAnnotation),
		selectMany: restricted('timelineAnnotations', service.selectAnnotations),
		toggle: restricted('timelineAnnotations', service.toggleAnnotation),
		rename: restricted('timelineAnnotations', service.renameAnnotations),
		setColor: restricted('timelineAnnotations', service.setAnnotationColor),
		move: restricted('timelineAnnotations', service.moveAnnotations),
		resize: restricted('timelineAnnotations', service.resizeAnnotation),
		convert: restricted('timelineAnnotations', service.convertAnnotation),
		batch: restricted('timelineAnnotations', (
			annotationIds: Parameters<Service['setAnnotationBatch']>[0], batchId: Parameters<Service['setAnnotationBatch']>[1] = d.createId('annotation-batch'),
		) => service.setAnnotationBatch(annotationIds, batchId)),
		unbatch: restricted('timelineAnnotations', (annotationIds: Parameters<Service['setAnnotationBatch']>[0]) => service.setAnnotationBatch(annotationIds, null)),
		remove: restricted('timelineAnnotations', service.removeAnnotations),
		previous: restricted('timelineAnnotations', service.navigatePreviousAnnotation),
		next: restricted('timelineAnnotations', service.navigateNextAnnotation),
		regularInterval: restricted('timelineAnnotations', d.regularInterval),
	});
}
