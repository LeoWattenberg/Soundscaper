/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem, createDeliveryReport, sealDeliveryReport, type DeliveryReport } from '../../../delivery-report.ts';
import { createInterchangeVisibility } from '../../../interchange-track-visibility.ts';
import { isDefaultVideoClipComposition } from '../../../video-clip-composition.ts';

type DataRecord = Readonly<Record<string, unknown>>;

/** The cut-only profiles serialize source edits without composition, effects or animation. */
export function reportInterchangePictureOmissions(report: DeliveryReport, project: DataRecord): DeliveryReport {
	if (!['edl', 'otio', 'fcpxml'].includes(report.subject.format)) return report;
	const tracks = records(project.tracks);
	const visibility = createInterchangeVisibility(tracks, project);
	const omittedTracks = new Set(report.items.filter(item => item.disposition === 'omitted' && item.scope.kind === 'track')
		.map(item => String(item.scope.id)));
	const omittedClips = new Set(report.items.filter(item => item.code.endsWith('.sub-frame-clip-omitted'))
		.map(item => String(item.scope.id)));
	const clipIds = new Set(tracks.filter(track => track.type === 'video' && visibility.contributes(track)
		&& !omittedTracks.has(String(track.id)))
		.flatMap(track => Array.isArray(track.clipIds) ? track.clipIds.map(String) : []));
	const omissions = records(project.clips).filter(clip => clip.kind === 'video'
		&& clipIds.has(String(clip.id)) && !omittedClips.has(String(clip.id)))
		.map(clip => ({ clip, fields: processingFields(clip) }))
		.filter(({ fields }) => Object.keys(fields).length > 0);
	if (!omissions.length) return report;
	const draft = createDeliveryReport(report.subject);
	for (const item of report.items) addDeliveryReportItem(draft, item);
	for (const { clip, fields } of omissions) {
		const descriptions = [
			...(fields.videoComposition ? ['transform and compositing (including opacity)'] : []),
			...(fields.videoEffects ? ['picture effects'] : []),
			...(fields.videoKeyframes ? ['picture animation'] : []),
		];
		addDeliveryReportItem(draft, {
			code: `${report.subject.format}.picture-processing-omitted`,
			disposition: 'omitted', severity: 'warning', scope: { kind: 'clip', id: String(clip.id) },
			data: fields,
			message: `The profile carries no picture processing; ${descriptions.join(', ')} is omitted.`,
		});
	}
	return sealDeliveryReport(draft);
}

function processingFields(clip: DataRecord): DataRecord {
	const fields: Record<string, unknown> = {};
	if (clip.videoComposition != null && !isDefaultVideoClipComposition(clip.videoComposition)) {
		fields.videoComposition = clip.videoComposition;
	}
	const effects = records(clip.videoEffects).filter(effect => effect.enabled !== false);
	if (effects.length) fields.videoEffects = effects.map(effect => String(effect.type));
	const keyframes = isRecord(clip.videoKeyframes) ? clip.videoKeyframes : null;
	const curves = records(keyframes?.curves);
	if (curves.length) fields.videoKeyframes = curves.map(curve => {
		const target = isRecord(curve.target) ? curve.target : {};
		return target.kind === 'video-effect' ? `${String(target.effectId)}.${String(target.parameterId)}`
			: String(target.parameterId);
	});
	return fields;
}

function records(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is DataRecord {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
