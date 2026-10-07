/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem, createDeliveryReport, sealDeliveryReport, type DeliveryReport } from '../../../delivery-report.ts';
import { createInterchangeVisibility } from '../../../interchange-track-visibility.ts';

type DataRecord = Readonly<Record<string, unknown>>;

/** These cut-only profiles retain source edits, but serialize no audio-processing vocabulary. */
export function reportInterchangeAudioOmissions(report: DeliveryReport, project: DataRecord): DeliveryReport {
	// EDL already names each complete audio track it omits; none of its audio leaves is delivered.
	if (report.subject.format !== 'otio' && report.subject.format !== 'fcpxml') return report;
	const tracks = records(project.tracks);
	const visibility = createInterchangeVisibility(tracks, project);
	const audioTracks = tracks.filter(track => track.type === 'audio' && visibility.contributes(track));
	const clipIds = new Set(audioTracks.flatMap(track => Array.isArray(track.clipIds) ? track.clipIds.map(String) : []));
	const owners = [
		...records(project.clips).filter(clip => clipIds.has(String(clip.id))).map(clip => ({ kind: 'clip', owner: clip })),
		...audioTracks.filter(track => Array.isArray(track.clipIds) && track.clipIds.length).map(track => ({ kind: 'track', owner: track })),
	];
	const omissions = owners.map(({ kind, owner }) => ({ kind, owner, fields: processingFields(owner, kind === 'clip') }))
		.filter(({ fields }) => Object.keys(fields).length > 0);
	if (!omissions.length) return report;
	const draft = createDeliveryReport(report.subject);
	for (const item of report.items) addDeliveryReportItem(draft, item);
	for (const { kind, owner, fields } of omissions) {
		addDeliveryReportItem(draft, {
			code: `${report.subject.format}.audio-processing-omitted`,
			disposition: 'omitted', severity: 'warning', scope: { kind, id: String(owner.id) },
			data: fields,
			message: `The profile carries no audio processing; ${kind} ${Object.keys(fields).join(', ')} is omitted.`,
		});
	}
	return sealDeliveryReport(draft);
}

function processingFields(owner: DataRecord, clip: boolean): DataRecord {
	const fields: Record<string, unknown> = {};
	if (owner.gain != null && owner.gain !== 1) fields.gain = owner.gain;
	if (!clip && owner.pan != null && owner.pan !== 0) fields.pan = owner.pan;
	if (records(owner.envelope).some(point => point.value !== 1)) fields.envelope = owner.envelope;
	if (clip) {
		for (const name of ['fadeInFrames', 'fadeOutFrames', 'pitchCents'] as const) {
			if (typeof owner[name] === 'number' && owner[name] !== 0) fields[name] = owner[name];
		}
		for (const name of ['reversed', 'inverted'] as const) if (owner[name] === true) fields[name] = true;
	} else if (owner.effectsActive !== false) {
		const effects = records(owner.effects).filter(effect => effect.enabled !== false);
		if (effects.length) fields.effects = effects.map(effect => String(effect.type));
	}
	return fields;
}

function records(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.filter((item): item is DataRecord => item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
}
