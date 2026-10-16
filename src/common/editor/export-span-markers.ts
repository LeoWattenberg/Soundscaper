/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createRiffAnnotationExport,
	type RiffAnnotationExportOptions,
	type RiffAnnotationExportResult,
} from './timeline-annotation-riff-interchange.ts';
import {
	addTimelineAnnotationInterchangeItem,
	createTimelineAnnotationInterchangeReport,
	finalizeTimelineAnnotationInterchangeReport,
	type TimelineAnnotationInterchangeReport,
} from './timeline-annotation-interchange-report.ts';
import type { RuntimeClipProject } from './runtime-clip-projection.ts';
import type { RiffMarkerInput } from './riff-markers.ts';

interface SpanMarkerMetadata {
	readonly markers: readonly RiffMarkerInput[];
	readonly markerInterchangeReport: TimelineAnnotationInterchangeReport;
}
interface SpanMarkerExport extends RiffAnnotationExportResult {
	readonly outputs: readonly SpanMarkerMetadata[];
}

/** Every archived file owns a range, cue clock and honest conversion report. */
export function createExportSpanMarkers(
	project: RuntimeClipProject,
	options: RiffAnnotationExportOptions,
	spans: readonly Readonly<{ startFrame: number; endFrame: number }>[] | null,
): SpanMarkerExport {
	if (spans === null) return Object.freeze({ ...createRiffAnnotationExport(project, options), outputs: Object.freeze([]) });
	const exports = spans.map(range => createRiffAnnotationExport(project, { ...options, range }));
	const report = createTimelineAnnotationInterchangeReport('export', exports[0]?.report.source ?? 'none');
	for (const [outputIndex, result] of exports.entries()) {
		for (const item of result.report.items) {
			addTimelineAnnotationInterchangeItem(report, {
				...item, data: { ...item.data, outputIndex },
			});
		}
	}
	return Object.freeze({
		markers: Object.freeze([]),
		report: finalizeTimelineAnnotationInterchangeReport(report),
		outputs: Object.freeze(exports.map(result => Object.freeze({
			markers: result.markers, markerInterchangeReport: result.report,
		}))),
	});
}
