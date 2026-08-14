/* SPDX-License-Identifier: AGPL-3.0-only */

import { validatePersistedAudioEffects } from './persisted-audio-effect-validation.ts';
import {
	validateProjectV9Media,
	type ProjectV9MediaCollections,
} from './project-v9-media-validation.ts';
import {
	projectArray,
	projectBoolean,
	projectFiniteInRange,
	projectRecord,
	projectSafeInteger,
	projectString,
	projectTimestamp,
	projectUniqueIds,
	projectUniqueStrings,
	type ProjectDataRecord,
	validateProjectEnvelope,
} from './project-v9-validation-primitives.ts';

export interface ValidatedProjectV9Document {
	readonly project: ProjectDataRecord;
	readonly metadata: ProjectDataRecord;
	readonly media: ProjectV9MediaCollections;
}

export interface ProjectV9AudioAuthorityValidation {
	readonly stripEnvelopeAuthority?: 'required' | 'forbidden';
	readonly validateMixer?: (
		value: unknown,
		tracks: readonly ProjectDataRecord[],
	) => void;
}

export function validateProjectV9Document(
	value: unknown,
	audioAuthority: ProjectV9AudioAuthorityValidation = {},
): ValidatedProjectV9Document {
	const project = projectRecord(value, 'project');
	projectString(project.id, 'project.id');
	projectString(project.title, 'project.title');
	projectSafeInteger(project.revision, 0, 'project.revision');
	projectTimestamp(project.createdAt, 'project.createdAt');
	projectTimestamp(project.updatedAt, 'project.updatedAt');
	const sampleRate = projectSafeInteger(project.sampleRate, 1, 'project.sampleRate');
	projectSafeInteger(project.masterChannels, 1, 'project.masterChannels');
	validateTempo(project.tempo);
	validateSnap(project.snap);
	validateTimeDisplay(project.timeDisplay);
	const metadata = validateMetadata(project.metadata);
	validateSelection(project.selection, sampleRate);
	validateLoop(project.loop);
	validateView(project.view);
	const stripEnvelopeAuthority = audioAuthority.stripEnvelopeAuthority ?? 'required';
	const media = validateProjectV9Media(project, sampleRate, { stripEnvelopeAuthority });
	validateMaster(project.master, stripEnvelopeAuthority);
	(audioAuthority.validateMixer ?? validateMixer)(project.mixer, media.tracks);
	return { project, metadata, media };
}

function validateTempo(value: unknown): void {
	const tempo = projectRecord(value, 'project.tempo');
	projectFiniteInRange(tempo.bpm, 1, 1_000, 'tempo.bpm');
	const signature = projectRecord(tempo.timeSignature, 'tempo.timeSignature');
	projectSafeInteger(signature.numerator, 1, 'tempo.timeSignature.numerator');
	const denominator = projectSafeInteger(signature.denominator, 1, 'tempo.timeSignature.denominator');
	if ((denominator & (denominator - 1)) !== 0) {
		throw new RangeError('tempo.timeSignature.denominator must be a power of two.');
	}
	projectBoolean(tempo.detected, 'tempo.detected');
}

function validateSnap(value: unknown): void {
	const snap = projectRecord(value, 'project.snap');
	projectBoolean(snap.enabled, 'snap.enabled');
	projectString(snap.unit, 'snap.unit');
	projectString(snap.mode, 'snap.mode');
	projectBoolean(snap.triplets, 'snap.triplets');
	projectString(snap.division, 'snap.division');
	projectSafeInteger(snap.opaqueType, 0, 'snap.opaqueType');
}

function validateTimeDisplay(value: unknown): void {
	const display = projectRecord(value, 'project.timeDisplay');
	projectString(display.format, 'timeDisplay.format');
}

function validateMetadata(value: unknown): ProjectDataRecord {
	const metadata = projectRecord(value, 'project.metadata');
	for (const name of ['title', 'artist', 'album', 'trackNumber', 'year', 'comments']) {
		projectString(metadata[name], `metadata.${name}`, true);
	}
	const tags = projectRecord(metadata.tags, 'metadata.tags');
	for (const [name, tag] of Object.entries(tags)) {
		projectString(name, 'metadata tag name');
		projectString(tag, `metadata.tags.${name}`, true);
	}
	return metadata;
}

function validateSelection(value: unknown, sampleRate: number): void {
	const selection = projectRecord(value, 'project.selection');
	const start = projectSafeInteger(selection.startFrame, 0, 'selection.startFrame');
	const end = projectSafeInteger(selection.endFrame, 0, 'selection.endFrame');
	if (end < start) throw new RangeError('selection.endFrame cannot precede selection.startFrame.');
	if (selection.trackIds !== undefined) projectUniqueStrings(selection.trackIds, 'selection.trackIds');
	if (selection.clipIds !== undefined) projectUniqueStrings(selection.clipIds, 'selection.clipIds');
	if (selection.frequencyRange == null) return;
	const frequencyRange = projectRecord(selection.frequencyRange, 'selection.frequencyRange');
	const minimum = projectFiniteInRange(
		frequencyRange.minimumFrequency,
		0,
		sampleRate / 2,
		'selection.frequencyRange.minimumFrequency',
	);
	const maximum = projectFiniteInRange(
		frequencyRange.maximumFrequency,
		0,
		sampleRate / 2,
		'selection.frequencyRange.maximumFrequency',
	);
	if (maximum <= minimum) throw new RangeError('Selection frequency range must have a positive width.');
}

function validateLoop(value: unknown): void {
	const loop = projectRecord(value, 'project.loop');
	const enabled = projectBoolean(loop.enabled, 'loop.enabled');
	const start = projectSafeInteger(loop.startFrame, 0, 'loop.startFrame');
	const end = projectSafeInteger(loop.endFrame, 0, 'loop.endFrame');
	if (end < start) throw new RangeError('loop.endFrame cannot precede loop.startFrame.');
	if (enabled && end === start) throw new RangeError('An enabled loop must have a positive duration.');
}

function validateView(value: unknown): void {
	const view = projectRecord(value, 'project.view');
	projectSafeInteger(view.scrollFrame, 0, 'view.scrollFrame');
	projectFiniteInRange(view.pixelsPerSecond, 0.001, 1_000_000, 'view.pixelsPerSecond');
	projectSafeInteger(view.playheadFrame, 0, 'view.playheadFrame');
	projectFiniteInRange(view.zoom, 0.001, 1_000_000, 'view.zoom');
	projectFiniteInRange(view.horizontalPosition, 0, Number.MAX_SAFE_INTEGER, 'view.horizontalPosition');
	projectSafeInteger(view.verticalPosition, 0, 'view.verticalPosition');
	projectUniqueStrings(view.selectedTrackIds, 'view.selectedTrackIds');
	projectRecord(view.panelState, 'view.panelState');
}

function validateMaster(value: unknown, stripEnvelopeAuthority: 'required' | 'forbidden'): void {
	const master = projectRecord(value, 'project.master');
	projectFiniteInRange(master.gain, 0, 4, 'master.gain');
	projectFiniteInRange(master.pan, -1, 1, 'master.pan');
	projectBoolean(master.mute, 'master.mute');
	projectBoolean(master.solo, 'master.solo');
	if (stripEnvelopeAuthority === 'required') validateProjectEnvelope(master.envelope, 'master.envelope');
	else if (Object.hasOwn(master, 'envelope')) {
		throw new RangeError('master.envelope is forbidden by the current strip authority.');
	}
	projectBoolean(master.collapsed, 'master.collapsed');
	projectBoolean(master.effectsActive, 'master.effectsActive');
	validatePersistedAudioEffects(master.effects, 'master.effects');
}

function validateMixer(value: unknown, tracks: readonly ProjectDataRecord[]): void {
	const mixer = projectRecord(value, 'project.mixer');
	const groups = recordArray(mixer.groups, 'mixer.groups');
	const sends = recordArray(mixer.sends, 'mixer.sends');
	projectUniqueIds([...groups, ...sends], 'mixer buses');
	for (const bus of groups) validateMixerBus(bus, 'group');
	for (const bus of sends) validateMixerBus(bus, 'send');
	const groupIds = new Set(groups.map((bus) => String(bus.id)));
	const sendIds = new Set(sends.map((bus) => String(bus.id)));
	const audioTrackIds = new Set(tracks.filter(({ type }) => type === 'audio').map(({ id }) => String(id)));
	const routes = projectRecord(mixer.routes, 'mixer.routes');
	for (const [trackId, value] of Object.entries(routes)) {
		projectString(trackId, 'mixer route track ID');
		if (!audioTrackIds.has(trackId)) throw new ReferenceError(`Mixer route references missing audio track ${trackId}.`);
		const route = projectRecord(value, `mixer.routes.${trackId}`);
		if (route.groupId !== null) {
			const groupId = projectString(route.groupId, `mixer.routes.${trackId}.groupId`);
			if (!groupIds.has(groupId)) throw new ReferenceError(`Mixer route references missing group bus ${groupId}.`);
		}
		const routeSends = projectRecord(route.sends, `mixer.routes.${trackId}.sends`);
		for (const [sendId, gain] of Object.entries(routeSends)) {
			if (!sendIds.has(sendId)) throw new ReferenceError(`Mixer route references missing send bus ${sendId}.`);
			projectFiniteInRange(gain, 0, 4, `mixer.routes.${trackId}.sends.${sendId}`);
		}
	}
}

function validateMixerBus(bus: ProjectDataRecord, type: 'group' | 'send'): void {
	const prefix = `mixer.${type} ${String(bus.id)}`;
	projectString(bus.id, `${prefix}.id`);
	projectString(bus.name, `${prefix}.name`);
	projectString(bus.color, `${prefix}.color`);
	projectFiniteInRange(bus.gain, 0, 4, `${prefix}.gain`);
	projectFiniteInRange(bus.pan, -1, 1, `${prefix}.pan`);
	projectBoolean(bus.mute, `${prefix}.mute`);
	projectBoolean(bus.solo, `${prefix}.solo`);
	validateProjectEnvelope(bus.envelope, `${prefix}.envelope`);
	projectBoolean(bus.collapsed, `${prefix}.collapsed`);
	projectBoolean(bus.effectsActive, `${prefix}.effectsActive`);
	validatePersistedAudioEffects(bus.effects, `${prefix}.effects`);
}

function recordArray(value: unknown, name: string): readonly ProjectDataRecord[] {
	return projectArray(value, name).map((item, index) => projectRecord(item, `${name}[${String(index)}]`));
}
