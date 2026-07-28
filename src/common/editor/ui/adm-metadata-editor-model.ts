/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	ADM_BED_CHANNEL_ORDER,
	admBedChannelCount,
	normalizeAdmProjectMetadata,
	type AdmAuthoredMetadata,
	type AdmBedChannel,
	type AdmBedLayout,
	type AdmProjectMetadata,
	type AdmTerminalStripKind,
} from '../adm-project-metadata.ts';

type UnknownRecord = Readonly<Record<string, unknown>>;

export interface AdmEditorSourceChannel {
	readonly stripKind: AdmTerminalStripKind;
	readonly stripId: string;
	readonly sourceChannel: number;
	readonly label: string;
}

export interface AdmEditorAssignmentChange {
	readonly stripKind: AdmTerminalStripKind;
	readonly stripId: string;
	readonly sourceChannel: number;
	readonly bedChannel: AdmBedChannel | null;
	readonly gain: number;
}

function record(value: unknown): UnknownRecord {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function records(value: unknown): readonly UnknownRecord[] {
	return Array.isArray(value) ? value.map(record) : [];
}

function projectLayout(project: UnknownRecord): AdmBedLayout {
	return Number(project.masterChannels) === 1 ? 'mono' : Number(project.masterChannels) === 6 ? '5.1' : 'stereo';
}

function stripChannels(project: UnknownRecord, track: UnknownRecord, fallbackChannelCount: number): number {
	const clipIds = new Set(Array.isArray(track.clipIds) ? track.clipIds.map(String) : []);
	const sourceIds = new Set(records(project.clips)
		.filter((clip) => clipIds.has(String(clip.id)))
		.map((clip) => String(clip.sourceId)));
	const widths = records(project.sources)
		.filter((source) => sourceIds.has(String(source.id)))
		.map((source) => Number(source.channelCount) || 0);
	return Math.max(0, ...widths) || fallbackChannelCount;
}

export function listAdmEditorSourceChannels(
	projectValue: unknown,
	fallbackChannelCount = Math.max(1, Number(record(projectValue).masterChannels) || 2),
): readonly AdmEditorSourceChannel[] {
	const project = record(projectValue);
	const mixer = record(project.mixer);
	const routes = record(mixer.routes);
	const channels: AdmEditorSourceChannel[] = [];
	for (const track of records(project.tracks)) {
		if (track.type !== 'audio' || typeof track.id !== 'string') continue;
		if (record(routes[track.id]).groupId != null) continue;
		appendStripChannels(channels, 'track', track.id, String(track.name || track.id), stripChannels(project, track, fallbackChannelCount));
	}
	for (const [kind, key] of [['group', 'groups'], ['send', 'sends']] as const) {
		for (const strip of records(mixer[key])) if (typeof strip.id === 'string') {
			appendStripChannels(
				channels,
				kind,
				strip.id,
				String(strip.name || strip.id),
				fallbackChannelCount,
			);
		}
	}
	return Object.freeze(channels.map((channel) => Object.freeze(channel)));
}

function appendStripChannels(
	output: AdmEditorSourceChannel[],
	stripKind: AdmTerminalStripKind,
	stripId: string,
	name: string,
	channelCount: number,
): void {
	for (let sourceChannel = 0; sourceChannel < channelCount; sourceChannel += 1) output.push({
		stripKind,
		stripId,
		sourceChannel,
		label: `${name} — channel ${sourceChannel + 1}`,
	});
}

function defaultAssignments(project: UnknownRecord, layout: AdmBedLayout): AdmAuthoredMetadata['bed']['assignments'] {
	const bedChannels = ADM_BED_CHANNEL_ORDER[layout];
	return listAdmEditorSourceChannels(project, admBedChannelCount(layout)).map((source, index) => ({
		stripKind: source.stripKind,
		stripId: source.stripId,
		sourceChannel: source.sourceChannel,
		bedChannel: bedChannels[Math.min(index, bedChannels.length - 1)],
		gain: 1,
	}));
}

export function createDefaultAdmMetadata(projectValue: unknown, layout?: AdmBedLayout): AdmAuthoredMetadata {
	const project = record(projectValue);
	const selectedLayout = layout ?? projectLayout(project);
	const title = String(record(project.metadata).title || project.title || 'Programme').trim() || 'Programme';
	return normalizeAdmProjectMetadata({
		mode: 'authored',
		programme: { name: title, language: '' },
		content: { name: 'Main content', language: '' },
		bed: { name: 'Main bed', layout: selectedLayout, assignments: defaultAssignments(project, selectedLayout) },
	}) as AdmAuthoredMetadata;
}

export function createProjectAdmEditorValue(projectValue: unknown): AdmProjectMetadata | null {
	const adm = record(record(projectValue).metadata).adm;
	return adm == null ? null : normalizeAdmProjectMetadata(adm as Readonly<Record<string, unknown>> & { mode: 'authored' | 'passthrough' });
}

export function setAdmEditorLayout(
	value: AdmAuthoredMetadata,
	project: unknown,
	layout: AdmBedLayout,
): AdmAuthoredMetadata {
	const bedChannels = ADM_BED_CHANNEL_ORDER[layout];
	const assignments = listAdmEditorSourceChannels(project, admBedChannelCount(layout)).map((source, index) => {
		const current = value.bed.assignments.find((assignment) => (
			assignment.stripKind === source.stripKind
			&& assignment.stripId === source.stripId
			&& assignment.sourceChannel === source.sourceChannel
		));
		return {
			...source,
			label: undefined,
			bedChannel: current && bedChannels.includes(current.bedChannel as never)
				? current.bedChannel
				: bedChannels[Math.min(index, bedChannels.length - 1)],
			gain: current?.gain ?? 1,
		};
	}).map(({ label: _label, ...assignment }) => assignment);
	return normalizeAdmProjectMetadata({
		...value,
		bed: { ...value.bed, layout, assignments },
	}) as AdmAuthoredMetadata;
}

export function setAdmEditorAssignment(
	value: AdmAuthoredMetadata,
	change: AdmEditorAssignmentChange,
): AdmAuthoredMetadata {
	const assignments = value.bed.assignments.filter((assignment) => !(
		assignment.stripKind === change.stripKind
		&& assignment.stripId === change.stripId
		&& assignment.sourceChannel === change.sourceChannel
	));
	if (change.bedChannel != null) assignments.push({ ...change, bedChannel: change.bedChannel });
	return normalizeAdmProjectMetadata({
		...value,
		bed: { ...value.bed, assignments },
	}) as AdmAuthoredMetadata;
}

export function admEditorChannelCount(value: AdmAuthoredMetadata): number {
	return admBedChannelCount(value.bed.layout);
}
