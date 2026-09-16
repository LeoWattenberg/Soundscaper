/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LocalizedPresentationMessage } from '../../../i18n/presentation-message.ts';
import { TIMELINE_ADDITIONAL_COPY } from '../../../i18n/editor-timeline-additional-copy.ts';

type Annotation = Readonly<{ name: string; kind: string; timelineStartFrame: number; timelineEndFrame: number }>;

function timingMessage(range: string): LocalizedPresentationMessage {
	return { key: 'ui.timeline.timingDescription', fallback: TIMELINE_ADDITIONAL_COPY.timingDescription,
		parameters: { range, unit: { key: 'annotationSecondsUnit' } } };
}

function annotationParameters(annotation: Pick<Annotation, 'name' | 'kind'>) {
	return { name: annotation.name || { key: 'unnamedTimelineAnnotation' },
		kind: { key: annotation.kind === 'marker' ? 'timelineMarker' : 'timelineRegion' } };
}

export function timelineAnnotationNavigationMessage(
	annotation: Pick<Annotation, 'name' | 'kind'>, timing: string, secondsUnit: string,
): LocalizedPresentationMessage {
	const range = timing.endsWith(` ${secondsUnit}`) ? timing.slice(0, -secondsUnit.length - 1) : timing;
	return { key: 'ui.timeline.navigationDescription', fallback: TIMELINE_ADDITIONAL_COPY.navigationDescription,
		parameters: { ...annotationParameters(annotation), timing: timingMessage(range) } };
}

export function timelineAnnotationCreationMessage(annotation: Annotation, sampleRate: number, locale: string): LocalizedPresentationMessage {
	const formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: false });
	const start = formatter.format(annotation.timelineStartFrame / sampleRate);
	const range = annotation.kind === 'marker' ? start : `${start}–${formatter.format(annotation.timelineEndFrame / sampleRate)}`;
	return { key: 'timelineAnnotationCreated', parameters: { ...annotationParameters(annotation), timing: timingMessage(range) } };
}
