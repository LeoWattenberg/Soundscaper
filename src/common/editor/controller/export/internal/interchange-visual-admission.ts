/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem, createDeliveryReport, sealDeliveryReport, type DeliveryReport } from '../../../delivery-report.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export interface InterchangeVisualOmission {
	readonly id: string;
	readonly kind: string;
	readonly title: string;
}

/** Keep unsupported visual owners out of the audio/video projection without losing their report inventory. */
export function admitInterchangeVisualProject(project: DataRecord, original: DataRecord = project): Readonly<{
	project: DataRecord;
	omissions: readonly InterchangeVisualOmission[];
}> {
	const clips = records(project.clips);
	const bin = isRecord(project.projectBin) ? project.projectBin : null;
	const binClips = records(bin?.clips);
	const originalClips = records(original.clips);
	const originalBin = isRecord(original.projectBin) ? original.projectBin : null;
	const unsupported = [...originalClips, ...records(originalBin?.clips)].filter(isUnsupportedVisual);
	if (!unsupported.length) return { project, omissions: [] };
	const omittedIds = new Set(unsupported.map(clip => String(clip.id)));
	const sources = new Map(records(original.sources).map(source => [String(source.id), source]));
	const omissions = originalClips.filter(isUnsupportedVisual).map(clip => Object.freeze({
		id: String(clip.id), kind: String(clip.kind),
		title: String(clip.title ?? sources.get(String(clip.sourceId))?.name ?? clip.id),
	}));
	return Object.freeze({
		project: Object.freeze({
			...project,
			clips: clips.filter(clip => !omittedIds.has(String(clip.id))),
			tracks: records(project.tracks).map(track => Array.isArray(track.clipIds)
				? { ...track, clipIds: track.clipIds.filter(id => !omittedIds.has(String(id))) }
				: track),
			...(bin ? { projectBin: { ...bin, clips: binClips.filter(clip => !omittedIds.has(String(clip.id))) } } : {}),
		}),
		omissions: Object.freeze(omissions),
	});
}

export function reportInterchangeVisualOmissions(
	report: DeliveryReport,
	omissions: readonly InterchangeVisualOmission[],
): DeliveryReport {
	if (!omissions.length) return report;
	const draft = createDeliveryReport(report.subject);
	for (const item of report.items) addDeliveryReportItem(draft, item);
	for (const clip of omissions) {
		addDeliveryReportItem(draft, {
			code: `${report.subject.format}.unsupported-visual-clip-omitted`,
			disposition: 'omitted', severity: 'warning', scope: { kind: 'clip', id: clip.id },
			data: { kind: clip.kind, title: clip.title },
			message: `The profile cannot represent this ${clip.kind} clip; it stays in the project.`,
		});
	}
	return sealDeliveryReport(draft);
}

function isUnsupportedVisual(clip: DataRecord): boolean {
	return clip.kind === 'image' || clip.kind === 'still' || clip.kind === 'generator';
}

function records(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is DataRecord {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
