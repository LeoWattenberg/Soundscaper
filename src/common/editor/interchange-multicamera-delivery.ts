/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem, createDeliveryReport, sealDeliveryReport, type DeliveryReport } from './delivery-report.ts';
import { createInterchangeVisibility } from './interchange-track-visibility.ts';
import type { RuntimeClipProject } from './runtime-clip-projection.ts';

type DataRecord = Readonly<Record<string, unknown>>;
export type InterchangeProductProjection = (project: RuntimeClipProject) => DataRecord;

/** The product owns exact active-angle source timing; exchange profiles carry its resolved edit. */
export function projectInterchangeMulticamera(project: DataRecord, projectForRuntimeConsumers?: InterchangeProductProjection): DataRecord {
	if (!records(project.multicameraGroups).length) return project;
	if (!projectForRuntimeConsumers) throw new Error('The active camera export projection is unavailable.');
	return projectForRuntimeConsumers(project);
}

/** A selected angle survives exchange, while its editable camera-group relationship does not. */
export function reportInterchangeMulticameraConversion(report: DeliveryReport, original: DataRecord,
	delivered: DataRecord, sequenceId?: string): DeliveryReport {
	const groups = records(original.multicameraGroups);
	if (!groups.length) return report;
	const visibility = createInterchangeVisibility(records(delivered.tracks), delivered);
	const omittedTracks = new Set(report.items.filter(item => item.disposition === 'omitted' && item.scope.kind === 'track')
		.map(item => String(item.scope.id)));
	const omittedClips = new Set(report.items.filter(item => item.code.endsWith('.sub-frame-clip-omitted'))
		.map(item => String(item.scope.id)));
	const trackClipIds = new Set(records(delivered.tracks).filter(track => !omittedTracks.has(String(track.id))
		&& (report.subject.format === 'dawproject' || visibility.contributes(track)))
		.flatMap(track => Array.isArray(track.clipIds) ? track.clipIds.map(String) : []));
	const deliveredClipIds = new Set(records(delivered.clips).filter(clip => trackClipIds.has(String(clip.id))
		&& !omittedClips.has(String(clip.id))).map(clip => String(clip.id)));
	const exportedSequenceId = sequenceId ?? original.primarySequenceId;
	const converted = groups.filter(group => group.sequenceId === exportedSequenceId && deliveredClipIds.has(String(group.outputClipId)));
	if (!converted.length) return report;
	const draft = createDeliveryReport(report.subject);
	for (const item of report.items) addDeliveryReportItem(draft, item);
	for (const group of converted) {
		const members = records(group.members);
		const active = members.find(member => member.id === group.activeMemberId);
		if (!active) throw new Error('The exported camera group has no active member.');
		addDeliveryReportItem(draft, {
			code: `${report.subject.format}.multicamera-flattened`, disposition: 'converted', severity: 'warning',
			scope: { kind: 'multicamera-group', id: String(group.id) },
			data: { activeSourceId: String(active.sourceId), memberCount: members.length, outputClipId: String(group.outputClipId) },
			message: 'The active camera is delivered as a source edit; the editable multicamera group is not carried.',
		});
	}
	return sealDeliveryReport(draft);
}

function records(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.filter((item): item is DataRecord => item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
}
