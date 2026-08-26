/* SPDX-License-Identifier: AGPL-3.0-only */

import { deriveFolderBusOwnershipV13 } from '../folder-bus-v13.ts';
import { insertTrackNodeV12 } from '../track-hierarchy-mutation-v12.ts';
import {
	folderAwareInsertTrackNode,
	folderAwareRemoveTrackNodes,
	folderAwareReorderTrack,
	hasNonemptyFolderHierarchy,
} from './track-structure-folder-adapter.ts';
import {
	normalizeEffect,
	updateEffect,
} from '../effects.js';
import {
	createAudioMaster,
	createAudioMixerBus,
} from '../project-audio-factory.js';
import { createLabel } from '../project-media-factory.ts';
import {
	allEffects,
} from './effects-video-runtime.js';
import {
	assertUnusedId,
	ensureMixer,
	insertionIndex,
	mixerBusCollection,
	normalizeTrackForProject,
	requireLabelTrack,
	requireMixerBus,
	requireTrack,
} from './shared-runtime.js';

function addTrack(project, value, requestedIndex, placement = {}) {
	if (value?.type === 'label') {
		const labelTrack = normalizeTrackForProject(project, value);
		assertUnusedId(project.tracks, labelTrack.id, 'track');
		const labelIndex = requestedIndex == null ? project.tracks.length : insertionIndex(requestedIndex, project.tracks.length);
		insertTrackStructure(project, labelTrack.id, requestedIndex, placement);
		project.tracks.splice(labelIndex, 0, labelTrack);
		return;
	}
	if (value?.type === 'video') {
		const track = normalizeTrackForProject(project, value);
		assertUnusedId(project.tracks, track.id, 'track');
		if (track.clipIds.length) throw new RangeError('Add clips after adding a track.');
		const index = requestedIndex == null ? project.tracks.length : insertionIndex(requestedIndex, project.tracks.length);
		insertTrackStructure(project, track.id, requestedIndex, placement);
		project.tracks.splice(index, 0, track);
		return;
	}
	const effects = Array.isArray(value?.effects) ? value.effects.map(normalizeEffect) : [];
	const track = normalizeTrackForProject(project, { ...value, effects });
	assertUnusedId(project.tracks, track.id, 'track');
	if (track.clipIds.length) throw new RangeError('Add clips after adding a track.');
	const effectIds = new Set(allEffects(project).map((effect) => effect.id));
	for (const effect of track.effects) {
		if (effectIds.has(effect.id)) throw new RangeError(`Duplicate effect ID: ${effect.id}.`);
		effectIds.add(effect.id);
	}
	const index = requestedIndex == null ? project.tracks.length : insertionIndex(requestedIndex, project.tracks.length);
	insertTrackStructure(project, track.id, requestedIndex, placement);
	project.tracks.splice(index, 0, track);
}

function insertTrackStructure(project, trackId, requestedIndex, placement) {
	if (hasNonemptyFolderHierarchy(project)) {
		folderAwareInsertTrackNode(project, trackId, requestedIndex, placement);
		return;
	}
	if (placement.sequenceId === undefined) return;
	insertTrackNodeV12(project.sequences, {
		sequenceId: placement.sequenceId,
		node: { kind: 'track', id: trackId, parentFolderId: null },
		parentFolderId: placement.parentFolderId ?? null,
		index: placement.parentIndex ?? Number.MAX_SAFE_INTEGER,
	});
}

function removeTrack(project, trackId) {
	const index = project.tracks.findIndex((track) => track.id === trackId);
	if (index < 0) throw new ReferenceError(`Unknown track: ${trackId}.`);
	const requestedTrack = project.tracks[index];
	const laneGroupId = requestedTrack.laneGroupId;
	const removedTracks = laneGroupId
		? project.tracks.filter((track) => track.laneGroupId === laneGroupId)
		: [requestedTrack];
	if (hasNonemptyFolderHierarchy(project)) {
		folderAwareRemoveTrackNodes(project, removedTracks.map((track) => String(track.id)));
	}
	removeTracksAndDependents(project, removedTracks.map((track) => track.id));
}

/**
 * Remove exactly the named tracks together with their dependent state: owned
 * clips, mixer routes, and auto-duck control references. Callers own any lane
 * or folder expansion; the folder removal path passes an already-complete
 * structural block.
 */
export function removeTracksAndDependents(project, trackIds) {
	const removedTrackIds = new Set(trackIds.map(String));
	const removedTracks = project.tracks.filter((track) => removedTrackIds.has(String(track.id)));
	const clipIds = new Set(removedTracks.flatMap((track) => track.clipIds || []));
	project.clips = project.clips.filter((clip) => !clipIds.has(clip.id));
	project.tracks = project.tracks.filter((track) => !removedTrackIds.has(String(track.id)));
	// A take graph is owned by one track, and the document refuses a group whose
	// track is gone. Leaving them behind made a cycle-recorded track impossible to
	// delete at all: the commit failed on the validator rather than on anything the
	// operator could see.
	if (Array.isArray(project.takeGroups)) {
		project.takeGroups = project.takeGroups
			.filter((group) => !removedTrackIds.has(String(group?.trackId)));
	}
	for (const removedTrackId of removedTrackIds) {
		if (project.mixer?.routes) delete project.mixer.routes[removedTrackId];
		disableAutoDuckForRemovedControlTrack(project, removedTrackId);
	}
}

/** Group buses owned by timeline folders; every set is empty on folder-free documents. */
function folderBusGuards(project) {
	const ownership = deriveFolderBusOwnershipV13(project.sequences || [], project.tracks || []);
	return {
		ownedBusIds: new Set(ownership.busFolderIds),
		ownerByTrackId: ownership.busFolderIdByAudioTrackId,
	};
}

function disableAutoDuckForRemovedControlTrack(project, controlTrackId) {
	const racks = [
		project.master.effects,
		...project.tracks.filter((track) => Array.isArray(track.effects)).map((track) => track.effects),
		...(project.mixer?.groups || []).map((bus) => bus.effects),
		...(project.mixer?.sends || []).map((bus) => bus.effects),
	];
	for (const rack of racks) {
		for (let index = 0; index < rack.length; index += 1) {
			const effect = rack[index];
			if (effect.type !== 'audacity-auto-duck' || effect.context?.controlTrackId !== controlTrackId) continue;
			rack[index] = updateEffect(effect, {
				enabled: false,
				context: { controlTrackId: null },
			});
		}
	}
}

function updateTrack(project, trackId, changes = {}) {
	const track = requireTrack(project, trackId);
	if (track.type === 'label') {
		const allowed = new Set(['name', 'collapsed', 'height', 'locked']);
		for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Label track field cannot be updated: ${key}.`);
		Object.assign(track, normalizeTrackForProject(project, { ...track, ...changes, labels: track.labels }));
		return;
	}
	if (track.type === 'video') {
		const allowed = new Set(['name', 'mute', 'solo', 'hidden', 'collapsed', 'height', 'locked']);
		for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Video track field cannot be updated: ${key}.`);
		Object.assign(track, normalizeTrackForProject(project, { ...track, ...changes, clipIds: track.clipIds }));
		return;
	}
	const allowed = new Set(['name', 'gain', 'pan', 'mute', 'solo', 'armed', 'effectsActive', 'locked']);
	for (const key of ['displayMode', 'color', 'spectrogram', 'envelope', 'collapsed', 'height']) allowed.add(key);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Track field cannot be updated: ${key}.`);
	const updated = normalizeTrackForProject(project, { ...track, ...changes, effects: track.effects, clipIds: track.clipIds });
	Object.assign(track, updated);
}

function reorderTrack(project, trackId, requestedIndex) {
	const fromIndex = project.tracks.findIndex((track) => track.id === trackId);
	if (fromIndex < 0) throw new ReferenceError(`Unknown track: ${trackId}.`);
	const index = Number(requestedIndex);
	if (!Number.isInteger(index) || index < 0 || index >= project.tracks.length) {
		throw new RangeError('Track destination is out of bounds.');
	}
	if (index === fromIndex) return;
	if (hasNonemptyFolderHierarchy(project)) {
		folderAwareReorderTrack(project, trackId, index);
		return;
	}
	if (project.tracks.some((track) => track.laneGroupId)) {
		const blocks = [];
		const consumedLaneGroups = new Set();
		for (const track of project.tracks) {
			if (!track.laneGroupId) {
				blocks.push([track]);
				continue;
			}
			if (consumedLaneGroups.has(track.laneGroupId)) continue;
			consumedLaneGroups.add(track.laneGroupId);
			blocks.push(project.tracks.filter((candidate) => candidate.laneGroupId === track.laneGroupId));
		}
		const sourceBlockIndex = blocks.findIndex((block) => block.some((track) => track.id === trackId));
		const destinationTrackId = project.tracks[index].id;
		const destinationBlockIndex = blocks.findIndex((block) => (
			block.some((track) => track.id === destinationTrackId)
		));
		if (sourceBlockIndex === destinationBlockIndex) return;
		const [sourceBlock] = blocks.splice(sourceBlockIndex, 1);
		const adjustedDestination = blocks.findIndex((block) => (
			block.some((track) => track.id === destinationTrackId)
		));
		blocks.splice(
			index < fromIndex ? adjustedDestination : adjustedDestination + 1,
			0,
			sourceBlock,
		);
		project.tracks = blocks.flat();
		return;
	}
	const [track] = project.tracks.splice(fromIndex, 1);
	project.tracks.splice(index, 0, track);
}

function addLabel(project, trackId, value) {
	const track = requireLabelTrack(project, trackId);
	const label = createLabel(value);
	assertUnusedId(track.labels, label.id, 'label');
	track.labels.push(label);
	track.labels.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame || left.id.localeCompare(right.id));
}

function updateLabel(project, trackId, labelId, changes = {}) {
	const track = requireLabelTrack(project, trackId);
	const index = track.labels.findIndex((label) => label.id === labelId);
	if (index < 0) throw new ReferenceError(`Unknown label: ${labelId}.`);
	const allowed = new Set(['title', 'startFrame', 'endFrame', 'color', 'opaqueExtensions']);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Label field cannot be updated: ${key}.`);
	track.labels[index] = createLabel({ ...track.labels[index], ...changes, id: labelId });
	track.labels.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame || left.id.localeCompare(right.id));
}

function removeLabel(project, trackId, labelId) {
	const track = requireLabelTrack(project, trackId);
	const index = track.labels.findIndex((label) => label.id === labelId);
	if (index < 0) throw new ReferenceError(`Unknown label: ${labelId}.`);
	track.labels.splice(index, 1);
}

function updateMaster(project, changes = {}) {
	const keys = Object.keys(changes);
	const allowed = new Set(['gain', 'pan', 'mute', 'solo', 'envelope', 'collapsed', 'effectsActive']);
	if (keys.some((key) => !allowed.has(key))) throw new RangeError('Unsupported master mixer field.');
	const normalized = createAudioMaster({ ...project.master, ...changes, effects: project.master.effects });
	for (const key of keys) project.master[key] = normalized[key];
}

function addMixerBus(project, command) {
	const collection = mixerBusCollection(project, command.busType);
	const bus = createAudioMixerBus(command.bus, command.busType, collection.length);
	const allBuses = [...ensureMixer(project).groups, ...ensureMixer(project).sends];
	if (allBuses.some((candidate) => candidate.id === bus.id)) throw new RangeError(`Duplicate mixer bus ID: ${bus.id}.`);
	for (const effect of bus.effects) {
		if (allEffects(project).some((candidate) => candidate.id === effect.id)) throw new RangeError(`Duplicate effect ID: ${effect.id}.`);
	}
	collection.push(bus);
}

function updateMixerBus(project, command) {
	const bus = requireMixerBus(project, command.busType, command.busId);
	const changes = command.changes || {};
	if (command.busType === 'group' && folderBusGuards(project).ownedBusIds.has(command.busId)) {
		for (const key of ['name', 'mute', 'solo']) {
			if (Object.hasOwn(changes, key)) {
				throw new RangeError(`A track folder bus mirrors its folder; edit the folder ${key} instead.`);
			}
		}
	}
	const allowed = new Set(['name', 'color', 'gain', 'pan', 'mute', 'solo', 'envelope', 'collapsed', 'effectsActive']);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Mixer bus field cannot be updated: ${key}.`);
	const collection = mixerBusCollection(project, command.busType);
	const normalized = createAudioMixerBus({ ...bus, ...changes, effects: bus.effects }, command.busType, collection.indexOf(bus));
	Object.assign(bus, normalized);
}

function removeMixerBus(project, command) {
	if (command.busType === 'group' && folderBusGuards(project).ownedBusIds.has(command.busId)) {
		throw new RangeError('A track folder owns this group bus; remove or empty the folder instead.');
	}
	const collection = mixerBusCollection(project, command.busType);
	const index = collection.findIndex((candidate) => candidate.id === command.busId);
	if (index < 0) throw new ReferenceError(`Unknown ${command.busType} bus: ${command.busId}.`);
	collection.splice(index, 1);
	for (const route of Object.values(ensureMixer(project).routes)) {
		if (command.busType === 'group' && route.groupId === command.busId) route.groupId = null;
		if (command.busType === 'send' && route.sends) delete route.sends[command.busId];
	}
}

function updateMixerRoute(project, command) {
	const track = requireTrack(project, command.trackId);
	if (track.type !== 'audio') throw new RangeError('Only audio tracks can be routed through the mixer.');
	const mixer = ensureMixer(project);
	const current = mixer.routes[track.id] || { groupId: null, sends: {} };
	const changes = command.changes || {};
	const allowed = new Set(['groupId', 'sends']);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Mixer route field cannot be updated: ${key}.`);
	let groupId = Object.hasOwn(changes, 'groupId') ? changes.groupId : current.groupId;
	if (groupId === '') groupId = null;
	if (groupId != null) requireMixerBus(project, 'group', groupId);
	const owner = folderBusGuards(project).ownerByTrackId.get(String(track.id));
	if (owner !== undefined && groupId !== owner) {
		throw new RangeError('A track inside a folder routes through its folder bus; move the track out of the folder instead.');
	}
	const sends = { ...(current.sends || {}) };
	if (Object.hasOwn(changes, 'sends')) {
		if (!changes.sends || typeof changes.sends !== 'object' || Array.isArray(changes.sends)) throw new TypeError('Mixer route sends must be an object.');
		for (const [sendId, requestedGain] of Object.entries(changes.sends)) {
			requireMixerBus(project, 'send', sendId);
			if (requestedGain == null) delete sends[sendId];
			else {
				const gain = Number(requestedGain);
				if (!Number.isFinite(gain) || gain < 0 || gain > 4) throw new RangeError('Mixer send gain must be between 0 and 4.');
				sends[sendId] = gain;
			}
		}
	}
	mixer.routes[track.id] = { groupId, sends };
}
export function createTrackMixerLabelRuntimeHandlers() {
	return {
		'track/add': (project, command) => addTrack(project, command.track, command.index, command),
		'track/remove': (project, command) => removeTrack(project, command.trackId),
		'track/update': (project, command) => updateTrack(project, command.trackId, command.changes),
		'track/reorder': (project, command) => reorderTrack(project, command.trackId, command.index),
		'label/add': (project, command) => addLabel(project, command.trackId, command.label),
		'label/update': (project, command) => updateLabel(project, command.trackId, command.labelId, command.changes),
		'label/remove': (project, command) => removeLabel(project, command.trackId, command.labelId),
		'master/update': (project, command) => updateMaster(project, command.changes),
		'mixer/bus-add': addMixerBus,
		'mixer/bus-update': updateMixerBus,
		'mixer/bus-remove': removeMixerBus,
		'mixer/route-update': updateMixerRoute,
	};
}
