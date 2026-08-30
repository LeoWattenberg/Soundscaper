/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AdmAuthoredObject } from '../adm-authored-objects.ts';
import {
	ADM_BED_CHANNEL_ORDER,
	admBedChannelCount,
	listAdmTerminalStrips,
	normalizeAdmProjectMetadata,
	type AdmAuthoredMetadata,
	type AdmBedChannel,
	type AdmBedLayout,
	type AdmProjectMetadata,
	type AdmTerminalStripKind,
	type RoutingProject,
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

/**
 * The layout a project's master width suggests when ADM is first enabled.
 *
 * Eight channels are 7.1 rather than 5.1.2 because a bare eight-channel master
 * is far more often a surround bed than a height one, and either way this only
 * picks the starting point — the operator changes it in one control.
 */
const LAYOUT_BY_MASTER_CHANNELS: Readonly<Record<number, AdmBedLayout>> = Object.freeze({
	1: 'mono', 2: 'stereo', 6: '5.1', 8: '7.1', 10: '5.1.4', 12: '7.1.4',
});

function projectLayout(project: UnknownRecord): AdmBedLayout {
	return LAYOUT_BY_MASTER_CHANNELS[Number(project.masterChannels)] ?? 'stereo';
}

export function listAdmEditorSourceChannels(
	projectValue: unknown,
): readonly AdmEditorSourceChannel[] {
	const project = record(projectValue);
	const mixer = record(project.mixer);
	const channels: AdmEditorSourceChannel[] = [];
	const stripsByKind = {
		track: records(project.tracks),
		group: records(mixer.groups),
		send: records(mixer.sends),
	};
	for (const terminal of listAdmTerminalStrips(project as unknown as RoutingProject)) {
		const strip = stripsByKind[terminal.kind].find(({ id }) => id === terminal.id);
		appendStripChannels(
			channels,
			terminal.kind,
			terminal.id,
			String(strip?.name || terminal.id),
			terminal.channelCount,
		);
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
	return listAdmEditorSourceChannels(project).flatMap((source) => {
		const bedChannel = defaultBedChannel(bedChannels, source.sourceChannel);
		return bedChannel === null ? [] : [{
			stripKind: source.stripKind,
			stripId: source.stripId,
			sourceChannel: source.sourceChannel,
			bedChannel,
			gain: 1,
		}];
	});
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
	const assignments = listAdmEditorSourceChannels(project).flatMap((source) => {
		const current = value.bed.assignments.find((assignment) => (
			assignment.stripKind === source.stripKind
			&& assignment.stripId === source.stripId
			&& assignment.sourceChannel === source.sourceChannel
		));
		const bedChannel = current && bedChannels.includes(current.bedChannel as never)
			? current.bedChannel
			: defaultBedChannel(bedChannels, source.sourceChannel);
		return bedChannel === null ? [] : [{
			...source,
			label: undefined,
			bedChannel,
			gain: current?.gain ?? 1,
		}];
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
	return admBedChannelCount(value.bed.layout) + (value.objects?.length ?? 0);
}

/**
 * Turn a source channel into a positioned object.
 *
 * The object is created in front of the listener, because an object has to start
 * somewhere and "straight ahead" is the position an operator can hear as wrong.
 * The same channel keeps whatever bed assignment it had: sending one signal to
 * both the bed and an object is a choice ADM allows, and it is not this
 * function's place to undo it.
 */
export function addAdmEditorObject(
	value: AdmAuthoredMetadata,
	source: AdmEditorSourceChannel,
	createId: () => string,
): AdmAuthoredMetadata {
	return normalizeAdmProjectMetadata({
		...value,
		objects: [...value.objects ?? [], {
			id: createId(),
			name: source.label,
			stripKind: source.stripKind,
			stripId: source.stripId,
			sourceChannel: source.sourceChannel,
			gain: 1,
			position: { azimuth: 0, elevation: 0, distance: 1 },
		}],
	}) as AdmAuthoredMetadata;
}

export function removeAdmEditorObject(value: AdmAuthoredMetadata, objectId: string): AdmAuthoredMetadata {
	return normalizeAdmProjectMetadata({
		...value,
		objects: (value.objects ?? []).filter((object) => object.id !== objectId),
	}) as AdmAuthoredMetadata;
}

export function setAdmEditorObject(
	value: AdmAuthoredMetadata,
	objectId: string,
	changes: Partial<Omit<AdmAuthoredObject, 'id'>>,
): AdmAuthoredMetadata {
	return normalizeAdmProjectMetadata({
		...value,
		objects: (value.objects ?? []).map((object) => (object.id === objectId ? {
			...object,
			...changes,
			position: { ...object.position, ...changes.position },
		} : object)),
	}) as AdmAuthoredMetadata;
}

function defaultBedChannel(
	bedChannels: readonly AdmBedChannel[],
	sourceChannel: number,
): AdmBedChannel | null {
	if (bedChannels.length === 1) return bedChannels[0] ?? null;
	return bedChannels[sourceChannel] ?? null;
}
