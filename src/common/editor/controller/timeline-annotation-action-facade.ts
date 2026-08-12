/* SPDX-License-Identifier: AGPL-3.0-only */

type RuntimeAction = (...args: readonly unknown[]) => unknown;
type RestrictedAction = (capability: string, action: RuntimeAction) => RuntimeAction;

export interface TimelineAnnotationActionFacadeDependencies {
	readonly service: Readonly<Record<string, unknown>>;
	readonly regularInterval: RuntimeAction;
	readonly restricted: RestrictedAction;
	createId(prefix: string): string;
}

/** Keep the large annotation action family outside the shared root facade. */
export function createTimelineAnnotationActionFacade(
	dependencies: TimelineAnnotationActionFacadeDependencies,
) {
	const restricted = (name: string): RuntimeAction => dependencies.restricted(
		'timelineAnnotations',
		(...args) => action(dependencies.service, name)(...args),
	);
	return Object.freeze({
		createMarkerAtPlayhead: restricted('createMarker'),
		createRegionFromSelection: restricted('createRegion'),
		focus: restricted('focusAnnotation'),
		clearFocus: restricted('clearFocus'),
		select: restricted('selectAnnotation'),
		selectMany: restricted('selectAnnotations'),
		toggle: restricted('toggleAnnotation'),
		rename: restricted('renameAnnotations'),
		setColor: restricted('setAnnotationColor'),
		move: restricted('moveAnnotations'),
		resize: restricted('resizeAnnotation'),
		convert: restricted('convertAnnotation'),
		batch: dependencies.restricted('timelineAnnotations', (
			annotationIds: unknown,
			batchId: unknown = dependencies.createId('annotation-batch')
		) => action(dependencies.service, 'setAnnotationBatch')(annotationIds, batchId)),
		unbatch: dependencies.restricted('timelineAnnotations', (annotationIds: unknown) => (
			action(dependencies.service, 'setAnnotationBatch')(annotationIds, null)
		)),
		remove: restricted('removeAnnotations'),
		previous: restricted('navigatePreviousAnnotation'),
		next: restricted('navigateNextAnnotation'),
		regularInterval: dependencies.restricted('timelineAnnotations', dependencies.regularInterval),
	});
}

function action(service: Readonly<Record<string, unknown>>, name: string): RuntimeAction {
	const candidate = service[name];
	if (typeof candidate !== 'function') throw new TypeError(`Missing timeline annotation action: ${name}.`);
	return (...args) => Reflect.apply(candidate, service, args);
}
