import {
	assertFrame,
	assertPositiveFrame,
	clipEndFrame,
	clipsOverlap,
	commitProject,
	createStableId,
	findClip,
	findClipTrack,
	findSource,
	findTrack,
	normalizeFrameRange,
} from './project.js';
import { createEffect, normalizeEffect, updateEffect } from './effects.js';
import {
	createAudioClipV2,
	createAudioMixerBusV2,
	createAudioSourceV2,
	createAudioTrackV2,
	createLabelTrackV2,
	createLabelV2,
} from './project-v2.js';
import { normalizeAudioEditorSnapSettings } from './snap-grid.js';

/**
 * A JSON-safe command. Commands that create clips carry their generated stable
 * IDs so replay never depends on random state.
 *
 * @typedef {Object} AudioEditorCommand
 * @property {string} type
 * @property {*} [commands]
 * @property {*} [source]
 * @property {*} [track]
 * @property {*} [clip]
 */

/**
 * @typedef {Object} AudioEditorClipboardV1
 * @property {1} schemaVersion
 * @property {number} sampleRate
 * @property {number} durationFrames
 * @property {Array<{sourceTrackId: string, sourceTrackName: string, clips: Object[]}>} tracks
 */

/**
 * @param {import('./project.js').AudioEditorProjectV1} project
 * @param {AudioEditorCommand} command
 * @returns {import('./project.js').AudioEditorProjectV1}
 */
export function applyEditorCommand(project, command, options = {}) {
	if (project?.schemaVersion !== 2) throw new RangeError('Editor commands require an AudioEditorProjectV2 project.');
	if (!command || typeof command.type !== 'string') throw new TypeError('A serializable editor command is required.');
	return commitProject(project, (draft) => mutateCommand(draft, command), options);
}

function mutateCommand(project, command) {
	switch (command.type) {
		case 'batch':
			if (!Array.isArray(command.commands) || !command.commands.length) throw new TypeError('A command batch cannot be empty.');
			for (const child of command.commands) mutateCommand(project, child);
			break;
		case 'project/rename':
			project.title = String(command.title || '').trim();
			if (!project.title) throw new RangeError('A project title is required.');
			break;
		case 'selection/set':
			setSelection(project, command);
			break;
		case 'loop/set':
			setLoop(project, command);
			break;
		case 'snap/set':
			setSnap(project, command);
			break;
		case 'tempo/set':
			setTempo(project, command);
			break;
		case 'time-display/set':
			setTimeDisplay(project, command);
			break;
		case 'metadata/update':
			updateMetadata(project, command.changes);
			break;
		case 'source/add':
			addSource(project, command.source);
			break;
		case 'source/remove':
			removeSource(project, command.sourceId);
			break;
		case 'source/update':
			updateSource(project, command.sourceId, command.changes);
			break;
		case 'track/add':
			addTrack(project, command.track, command.index);
			break;
		case 'track/remove':
			removeTrack(project, command.trackId);
			break;
		case 'track/update':
			updateTrack(project, command.trackId, command.changes);
			break;
		case 'track/reorder':
			reorderTrack(project, command.trackId, command.index);
			break;
		case 'label/add':
			addLabel(project, command.trackId, command.label);
			break;
		case 'label/update':
			updateLabel(project, command.trackId, command.labelId, command.changes);
			break;
		case 'label/remove':
			removeLabel(project, command.trackId, command.labelId);
			break;
		case 'master/update':
			updateMaster(project, command.changes);
			break;
		case 'mixer/bus-add':
			addMixerBus(project, command);
			break;
		case 'mixer/bus-update':
			updateMixerBus(project, command);
			break;
		case 'mixer/bus-remove':
			removeMixerBus(project, command);
			break;
		case 'mixer/route-update':
			updateMixerRoute(project, command);
			break;
		case 'clip/add':
			addClip(project, command.trackId, command.clip);
			break;
		case 'clip/remove':
			removeClip(project, command.clipId);
			break;
		case 'clip/update':
			updateClip(project, command.clipId, command.changes);
			break;
		case 'clip/replace-source':
			replaceClipSource(project, command.clipId, command.sourceId);
			break;
		case 'clip/move':
			moveClip(project, command);
			break;
		case 'clip/transform-many':
			transformClips(project, command);
			break;
		case 'clip/overwrite':
			overwriteClip(project, command);
			break;
		case 'clip/trim':
			trimClip(project, command);
			break;
		case 'clip/split':
			splitClip(project, command);
			break;
		case 'clip/group':
			groupClips(project, command.clipIds, command.groupId);
			break;
		case 'clip/ungroup':
			ungroupClips(project, command.clipIds);
			break;
		case 'clip/join':
			joinClips(project, command.clipIds);
			break;
		case 'range/lift-delete':
			deleteRange(project, command, 'none');
			break;
		case 'range/ripple-delete':
			deleteRange(project, command, 'track');
			break;
		case 'range/per-clip-ripple-delete':
			deleteRange(project, command, 'clip');
			break;
		case 'range/keep':
			keepRange(project, command);
			break;
		case 'range/replace':
			replaceRange(project, command);
			break;
		case 'clipboard/paste':
			pasteClipboard(project, command);
			break;
		case 'punch/replace':
			punchReplace(project, command);
			break;
		case 'effect/add':
			addEffect(project, command);
			break;
		case 'effect/update':
			updateRackEffect(project, command);
			break;
		case 'effect/remove':
			removeEffect(project, command);
			break;
		case 'effect/reorder':
			reorderEffect(project, command);
			break;
		default:
			throw new RangeError(`Unsupported editor command: ${command.type}.`);
	}
}

function setSelection(project, command) {
	const startFrame = assertFrame(command.startFrame, 'selection.startFrame');
	const endFrame = assertFrame(command.endFrame, 'selection.endFrame');
	const range = startFrame <= endFrame
		? { startFrame, endFrame }
		: { startFrame: endFrame, endFrame: startFrame };
	if (!['trackIds', 'clipIds', 'frequencyRange'].some((key) => Object.hasOwn(command, key))) {
		project.selection = range;
		return;
	}
	const trackIds = normalizeSelectionIds(command.trackIds ?? project.selection?.trackIds ?? [], 'selection.trackIds');
	const clipIds = normalizeSelectionIds(command.clipIds ?? project.selection?.clipIds ?? [], 'selection.clipIds');
	for (const trackId of trackIds) requireTrack(project, trackId);
	for (const clipId of clipIds) requireClip(project, clipId);
	project.selection = {
		...range,
		trackIds,
		clipIds,
		frequencyRange: normalizeFrequencyRange(command.frequencyRange, project.sampleRate),
	};
}

function setLoop(project, command) {
	if (!command.enabled) {
		project.loop = { ...project.loop, enabled: false };
		return;
	}
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'loop');
	project.loop = { enabled: true, startFrame: range.startFrame, endFrame: range.endFrame };
}

function setSnap(project, command) {
	if (project.schemaVersion !== 2) throw new RangeError('Snap settings require an AudioEditorProjectV2 project.');
	const settings = command.settings || {};
	const next = {
		...project.snap,
		...settings,
	};
	if (Object.hasOwn(settings, 'unit') && !Object.hasOwn(settings, 'division')) next.division = settings.unit;
	if (Object.hasOwn(settings, 'division') && !Object.hasOwn(settings, 'unit')) next.unit = settings.division;
	if (!Object.hasOwn(settings, 'unit') && !Object.hasOwn(settings, 'division')
		&& ['upstreamType', 'opaqueType', 'type'].some((key) => Object.hasOwn(settings, key))) {
		delete next.unit;
		delete next.division;
	}
	project.snap = normalizeAudioEditorSnapSettings(next);
}

function setTempo(project, command) {
	if (project.schemaVersion !== 2) throw new RangeError('Tempo settings require an AudioEditorProjectV2 project.');
	const bpm = command.bpm == null ? project.tempo.bpm : Number(command.bpm);
	if (!Number.isFinite(bpm) || bpm < 1 || bpm > 1_000) throw new RangeError('tempo.bpm must be between 1 and 1000.');
	const numerator = command.numerator == null
		? project.tempo.timeSignature.numerator
		: Number(command.numerator);
	const denominator = command.denominator == null
		? project.tempo.timeSignature.denominator
		: Number(command.denominator);
	if (!Number.isSafeInteger(numerator) || numerator < 1 || numerator > 32) {
		throw new RangeError('tempo.timeSignature.numerator must be between 1 and 32.');
	}
	if (!Number.isSafeInteger(denominator) || denominator < 1 || denominator > 32 || (denominator & (denominator - 1)) !== 0) {
		throw new RangeError('tempo.timeSignature.denominator must be a power of two up to 32.');
	}
	project.tempo = { bpm, timeSignature: { numerator, denominator }, detected: false };
}

function addSource(project, value) {
	const source = normalizeSourceForProject(project, value);
	assertUnusedId(project.sources, source.id, 'source');
	project.sources.push(source);
}

function removeSource(project, sourceId) {
	if (project.clips.some((clip) => clip.sourceId === sourceId)) throw new RangeError('A source in use cannot be removed.');
	const index = project.sources.findIndex((source) => source.id === sourceId);
	if (index < 0) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	project.sources.splice(index, 1);
}

function updateSource(project, sourceId, changes = {}) {
	const index = project.sources.findIndex((source) => source.id === sourceId);
	if (index < 0) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	const allowed = new Set(['name', 'mimeType', 'originalSampleRate', 'sampleFormat', 'opaqueExtensions']);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Source field cannot be updated: ${key}.`);
	project.sources[index] = createAudioSourceV2({ ...project.sources[index], ...changes, id: sourceId });
}

function addTrack(project, value, requestedIndex) {
	if (value?.type === 'label') {
		if (project.schemaVersion !== 2) throw new RangeError('Label tracks require an AudioEditorProjectV2 project.');
		const labelTrack = createLabelTrackV2(value);
		assertUnusedId(project.tracks, labelTrack.id, 'track');
		const labelIndex = requestedIndex == null ? project.tracks.length : insertionIndex(requestedIndex, project.tracks.length);
		project.tracks.splice(labelIndex, 0, labelTrack);
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
	project.tracks.splice(index, 0, track);
}

function removeTrack(project, trackId) {
	const index = project.tracks.findIndex((track) => track.id === trackId);
	if (index < 0) throw new ReferenceError(`Unknown track: ${trackId}.`);
	const clipIds = new Set(project.tracks[index].clipIds || []);
	project.clips = project.clips.filter((clip) => !clipIds.has(clip.id));
	project.tracks.splice(index, 1);
	if (project.mixer?.routes) delete project.mixer.routes[trackId];
	disableAutoDuckForRemovedControlTrack(project, trackId);
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
		const allowed = new Set(['name', 'collapsed', 'height']);
		for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Label track field cannot be updated: ${key}.`);
		Object.assign(track, createLabelTrackV2({ ...track, ...changes, labels: track.labels }));
		return;
	}
	const allowed = new Set(['name', 'gain', 'pan', 'mute', 'solo', 'armed']);
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
	const [track] = project.tracks.splice(fromIndex, 1);
	project.tracks.splice(index, 0, track);
}

function addLabel(project, trackId, value) {
	const track = requireLabelTrack(project, trackId);
	const label = createLabelV2(value);
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
	track.labels[index] = createLabelV2({ ...track.labels[index], ...changes, id: labelId });
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
	if (keys.some((key) => !['gain', 'pan', 'mute', 'solo'].includes(key))) throw new RangeError('Unsupported master mixer field.');
	if (Object.hasOwn(changes, 'gain')) {
		const gain = Number(changes.gain);
		if (!Number.isFinite(gain) || gain < 0 || gain > 4) throw new RangeError('Master gain must be between 0 and 4.');
		project.master.gain = gain;
	}
	if (Object.hasOwn(changes, 'pan')) {
		const pan = Number(changes.pan);
		if (!Number.isFinite(pan) || pan < -1 || pan > 1) throw new RangeError('Master pan must be between -1 and 1.');
		project.master.pan = pan;
	}
	if (Object.hasOwn(changes, 'mute')) project.master.mute = Boolean(changes.mute);
	if (Object.hasOwn(changes, 'solo')) project.master.solo = Boolean(changes.solo);
}

function ensureMixer(project) {
	if (!project.mixer) project.mixer = { groups: [], sends: [], routes: {} };
	project.mixer.groups ||= [];
	project.mixer.sends ||= [];
	project.mixer.routes ||= {};
	return project.mixer;
}

function mixerBusCollection(project, type) {
	const mixer = ensureMixer(project);
	if (type === 'group') return mixer.groups;
	if (type === 'send') return mixer.sends;
	throw new RangeError('Mixer bus type must be group or send.');
}

function requireMixerBus(project, type, busId) {
	const bus = mixerBusCollection(project, type).find((candidate) => candidate.id === busId);
	if (!bus) throw new ReferenceError(`Unknown ${type} bus: ${busId}.`);
	return bus;
}

function addMixerBus(project, command) {
	const collection = mixerBusCollection(project, command.busType);
	const bus = createAudioMixerBusV2(command.bus, command.busType, collection.length);
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
	const allowed = new Set(['name', 'color', 'gain', 'pan', 'mute', 'solo']);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Mixer bus field cannot be updated: ${key}.`);
	const collection = mixerBusCollection(project, command.busType);
	const normalized = createAudioMixerBusV2({ ...bus, ...changes, effects: bus.effects }, command.busType, collection.indexOf(bus));
	Object.assign(bus, normalized);
}

function removeMixerBus(project, command) {
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

function updateMetadata(project, changes = {}) {
	if (project.schemaVersion !== 2) throw new RangeError('Metadata editing requires an AudioEditorProjectV2 project.');
	if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('Metadata changes must be an object.');
	const allowed = new Set(['title', 'artist', 'album', 'trackNumber', 'year', 'comments', 'tags']);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Metadata field cannot be updated: ${key}.`);
	const next = { ...project.metadata };
	for (const key of allowed) {
		if (!Object.hasOwn(changes, key)) continue;
		if (key === 'tags') {
			if (!changes.tags || typeof changes.tags !== 'object' || Array.isArray(changes.tags)) {
				throw new TypeError('metadata.tags must be an object.');
			}
			next.tags = Object.fromEntries(Object.entries(changes.tags).map(([name, value]) => {
				const normalizedName = String(name).trim();
				if (!normalizedName) throw new RangeError('A metadata tag name is required.');
				return [normalizedName, String(value ?? '')];
			}));
		} else next[key] = String(changes[key] ?? '');
	}
	project.metadata = next;
}

function setTimeDisplay(project, command) {
	if (project.schemaVersion !== 2) throw new RangeError('Time-display settings require an AudioEditorProjectV2 project.');
	if (typeof command.format !== 'string' || !command.format.trim()) throw new TypeError('A time-display format is required.');
	project.timeDisplay = { ...project.timeDisplay, format: command.format };
}

function addClip(project, trackId, value) {
	const track = requireTrack(project, trackId);
	if (!Array.isArray(track.clipIds)) throw new RangeError('Audio clips can only be added to audio tracks.');
	const clip = normalizeClipForProject(project, value);
	assertUnusedId(project.clips, clip.id, 'clip');
	assertClipSourceBounds(project, clip);
	assertClipSpace(project, track, clip);
	project.clips.push(clip);
	track.clipIds.push(clip.id);
	sortTrack(project, track);
}

function removeClip(project, clipId) {
	const track = requireClipTrack(project, clipId);
	track.clipIds = track.clipIds.filter((id) => id !== clipId);
	project.clips = project.clips.filter((clip) => clip.id !== clipId);
}

function updateClip(project, clipId, changes = {}) {
	const clip = requireClip(project, clipId);
	const track = requireClipTrack(project, clipId);
	const allowed = new Set(['gain', 'fadeInFrames', 'fadeOutFrames', 'reversed']);
	for (const key of ['title', 'envelope', 'groupId', 'color', 'pitchCents', 'speedRatio', 'preserveFormants', 'stretchToTempo', 'renderCacheRevision']) allowed.add(key);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Clip field cannot be updated: ${key}.`);
	const updated = normalizeClipForProject(project, { ...clip, ...changes, id: clip.id });
	assertClipSpace(project, track, updated, clip.id);
	replaceClip(project, updated);
}

function replaceClipSource(project, clipId, sourceId) {
	if (project.schemaVersion !== 2) throw new RangeError('Immutable sample editing requires an AudioEditorProjectV2 project.');
	const clip = requireClip(project, clipId);
	const track = requireClipTrack(project, clipId);
	const source = project.sources.find((candidate) => candidate.id === sourceId);
	if (!source) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	const updated = normalizeClipForProject(project, {
		...clip,
		sourceId: source.id,
		renderCacheRevision: clip.renderCacheRevision + 1,
		id: clip.id,
	});
	assertClipSourceBounds(project, updated);
	assertClipSpace(project, track, updated, clip.id);
	replaceClip(project, updated);
}

function moveClip(project, command) {
	const clip = requireClip(project, command.clipId);
	const oldTrack = requireClipTrack(project, clip.id);
	const targetTrack = requireTrack(project, command.trackId || oldTrack.id);
	const updated = normalizeClipForProject(project, {
		...clip,
		timelineStartFrame: command.timelineStartFrame,
		id: clip.id,
	});
	assertClipSpace(project, targetTrack, updated, clip.id);
	replaceClip(project, updated);
	if (targetTrack.id !== oldTrack.id) {
		oldTrack.clipIds = oldTrack.clipIds.filter((id) => id !== clip.id);
		targetTrack.clipIds.push(clip.id);
	}
	sortTrack(project, oldTrack);
	sortTrack(project, targetTrack);
}

/**
 * Returns the clips that participate when an edit begins on activeClipId.
 * An existing multi-selection is honored only when it contains the active
 * clip; grouped companions of every participating clip are then included.
 */
export function collectClipTransformIds(project, activeClipId) {
	const activeClip = findClip(project, activeClipId);
	if (!activeClip) return [];
	const ids = new Set([activeClip.id]);
	const selectedIds = project.selection?.clipIds || [];
	if (selectedIds.includes(activeClip.id)) {
		for (const clipId of selectedIds) if (findClip(project, clipId)) ids.add(clipId);
	}
	const groupIds = new Set([...ids]
		.map((clipId) => findClip(project, clipId)?.groupId)
		.filter(Boolean));
	if (groupIds.size) {
		for (const clip of project.clips) if (clip.groupId && groupIds.has(clip.groupId)) ids.add(clip.id);
	}
	return project.clips.filter((clip) => ids.has(clip.id)).map((clip) => clip.id);
}

/**
 * Prepares an atomic transform for selected/grouped clips. When overwrite is
 * enabled, stable IDs are reserved for any inactive clip that is split into
 * multiple surviving segments.
 */
export function prepareTransformClipsCommand(project, transforms, options = {}, idFactory = createStableId) {
	const state = buildClipTransformState(project, transforms);
	const overwrite = Boolean(options.overwrite);
	validateClipTransformState(project, state, overwrite);
	const splitClipIds = {};
	if (overwrite) {
		const movingIds = new Set(state.map((item) => item.clip.id));
		for (const track of project.tracks.filter((item) => Array.isArray(item.clipIds))) {
			const activeClips = state.filter((item) => item.track.id === track.id).map((item) => item.updated);
			if (!activeClips.length) continue;
			for (const clipId of track.clipIds) {
				if (movingIds.has(clipId)) continue;
				const clip = requireClip(project, clipId);
				const ranges = remainingClipRanges(clip, activeClips);
				if (ranges.length <= 1) continue;
				splitClipIds[clip.id] = Array.from(
					{ length: ranges.length - 1 },
					() => idFactory('clip'),
				);
			}
		}
	}
	return {
		type: 'clip/transform-many',
		transforms: state.map((item) => ({
			clipId: item.clip.id,
			trackId: item.track.id,
			changes: { ...item.changes },
		})),
		overwrite,
		splitClipIds,
	};
}

function transformClips(project, command) {
	const state = buildClipTransformState(project, command.transforms);
	const overwrite = Boolean(command.overwrite);
	validateClipTransformState(project, state, overwrite);
	const movingIds = new Set(state.map((item) => item.clip.id));
	const replacementsById = new Map();
	const reservedIds = new Set();

	if (overwrite) {
		for (const track of project.tracks.filter((item) => Array.isArray(item.clipIds))) {
			const activeClips = state.filter((item) => item.track.id === track.id).map((item) => item.updated);
			if (!activeClips.length) continue;
			for (const clipId of track.clipIds) {
				if (movingIds.has(clipId)) continue;
				const clip = requireClip(project, clipId);
				const ranges = remainingClipRanges(clip, activeClips);
				if (ranges.length === 1 && ranges[0][0] === clip.timelineStartFrame && ranges[0][1] === clipEndFrame(clip)) continue;
				const splitIds = command.splitClipIds?.[clip.id] || [];
				if (!Array.isArray(splitIds) || splitIds.length !== Math.max(0, ranges.length - 1)) {
					throw new TypeError(`Stable split clip IDs are required for ${clip.id}.`);
				}
				for (const splitId of splitIds) {
					const stableId = requireStableCommandId(splitId, 'split clip');
					reserveReplacementClipId(project, stableId, reservedIds);
				}
				const ids = [clip.id, ...splitIds];
				replacementsById.set(clip.id, ranges.map(([startFrame, endFrame], index) => (
					segmentOfClip(clip, startFrame, endFrame, startFrame, ids[index])
				)));
			}
		}
	}

	const updatedById = new Map(state.map((item) => [item.clip.id, item.updated]));
	project.clips = project.clips.flatMap((clip) => {
		if (updatedById.has(clip.id)) return [updatedById.get(clip.id)];
		if (replacementsById.has(clip.id)) return replacementsById.get(clip.id);
		return [clip];
	});

	for (const track of project.tracks.filter((item) => Array.isArray(item.clipIds))) {
		const clips = track.clipIds
			.filter((clipId) => !movingIds.has(clipId))
			.flatMap((clipId) => replacementsById.has(clipId)
				? replacementsById.get(clipId)
				: [requireClip(project, clipId)])
			.concat(state.filter((item) => item.track.id === track.id).map((item) => item.updated))
			.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id));
		track.clipIds = clips.map((clip) => clip.id);
	}
}

function buildClipTransformState(project, transforms) {
	if (!Array.isArray(transforms) || !transforms.length) throw new TypeError('Clip transforms must be a non-empty array.');
	const ids = normalizeCommandIds(transforms.map((transform) => transform?.clipId), 'transforms.clipIds');
	const allowed = new Set([
		'timelineStartFrame', 'sourceStartFrame', 'sourceDurationFrames', 'durationFrames',
		'trimStartFrames', 'trimEndFrames', 'fadeInFrames', 'fadeOutFrames',
		'envelope', 'pitchCents', 'speedRatio', 'preserveFormants', 'stretchToTempo',
		'renderCacheRevision',
	]);
	return transforms.map((transform, index) => {
		const clip = requireClip(project, ids[index]);
		const oldTrack = requireClipTrack(project, clip.id);
		const track = requireTrack(project, transform.trackId || oldTrack.id);
		if (!Array.isArray(track.clipIds)) throw new RangeError(`Audio clips cannot be transformed onto track ${track.id}.`);
		const changes = transform.changes || {};
		if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('Clip transform changes must be an object.');
		for (const key of Object.keys(changes)) {
			if (!allowed.has(key)) throw new RangeError(`Clip field cannot be transformed: ${key}.`);
		}
		const durationFrames = changes.durationFrames ?? clip.durationFrames;
		const timelineStartFrame = changes.timelineStartFrame ?? clip.timelineStartFrame;
		const updated = normalizeClipForProject(project, {
			...clip,
			...changes,
			...(!Object.hasOwn(changes, 'envelope') && durationFrames !== clip.durationFrames ? {
				envelope: envelopeForTrimmedBounds(clip, timelineStartFrame, durationFrames),
			} : {}),
			id: clip.id,
		});
		assertClipSourceBounds(project, updated);
		return { clip, oldTrack, track, updated, changes: { ...changes } };
	});
}

function validateClipTransformState(project, state, overwrite) {
	if (project.schemaVersion === 2) return;
	const movingIds = new Set(state.map((item) => item.clip.id));
	for (const track of project.tracks.filter((item) => Array.isArray(item.clipIds))) {
		const activeClips = state.filter((item) => item.track.id === track.id).map((item) => item.updated);
		assertNonOverlappingClips(track.id, activeClips);
		if (overwrite) continue;
		const inactiveClips = track.clipIds
			.filter((clipId) => !movingIds.has(clipId))
			.map((clipId) => requireClip(project, clipId));
		assertNonOverlappingClips(track.id, [...inactiveClips, ...activeClips]);
	}
}

function assertNonOverlappingClips(trackId, clips) {
	const ordered = [...clips].sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id));
	for (let index = 1; index < ordered.length; index += 1) {
		if (clipsOverlap(ordered[index - 1], ordered[index])) {
			throw new RangeError(`Clip overlaps existing material on track ${trackId}.`);
		}
	}
}

function remainingClipRanges(clip, activeClips) {
	let ranges = [[clip.timelineStartFrame, clipEndFrame(clip)]];
	for (const activeClip of [...activeClips].sort((left, right) => left.timelineStartFrame - right.timelineStartFrame)) {
		const activeStart = activeClip.timelineStartFrame;
		const activeEnd = clipEndFrame(activeClip);
		ranges = ranges.flatMap(([startFrame, endFrame]) => {
			if (activeEnd <= startFrame || activeStart >= endFrame) return [[startFrame, endFrame]];
			const result = [];
			if (startFrame < activeStart) result.push([startFrame, activeStart]);
			if (endFrame > activeEnd) result.push([activeEnd, endFrame]);
			return result;
		});
		if (!ranges.length) break;
	}
	return ranges;
}

function overwriteClip(project, command) {
	const clip = requireClip(project, command.clipId);
	const oldTrack = requireClipTrack(project, clip.id);
	const targetTrack = requireTrack(project, command.trackId || oldTrack.id);
	const requestedChanges = command.changes || {};
	const timelineStartFrame = requestedChanges.timelineStartFrame ?? clip.timelineStartFrame;
	const durationFrames = requestedChanges.durationFrames ?? clip.durationFrames;
	const updated = normalizeClipForProject(project, {
		...clip,
		...requestedChanges,
		...(!Object.hasOwn(requestedChanges, 'envelope') && durationFrames !== clip.durationFrames ? {
			envelope: envelopeForTrimmedBounds(clip, timelineStartFrame, durationFrames),
		} : {}),
		id: clip.id,
	});
	assertClipSourceBounds(project, updated);

	const replacements = [];
	const removedIds = new Set();
	for (const clipId of targetTrack.clipIds) {
		if (clipId === clip.id) continue;
		const inactiveClip = requireClip(project, clipId);
		if (!clipsOverlap(inactiveClip, updated)) {
			replacements.push(inactiveClip);
			continue;
		}
		removedIds.add(inactiveClip.id);
		const inactiveStart = inactiveClip.timelineStartFrame;
		const inactiveEnd = clipEndFrame(inactiveClip);
		const activeStart = updated.timelineStartFrame;
		const activeEnd = clipEndFrame(updated);
		const hasLeadingSegment = inactiveStart < activeStart;
		const hasTrailingSegment = inactiveEnd > activeEnd;
		if (hasLeadingSegment) {
			replacements.push(segmentOfClip(inactiveClip, inactiveStart, activeStart, inactiveStart, inactiveClip.id));
		}
		if (hasTrailingSegment) {
			const id = hasLeadingSegment ? command.splitClipIds?.[inactiveClip.id] : inactiveClip.id;
			if (!id) throw new TypeError(`A stable split clip ID is required for ${inactiveClip.id}.`);
			if (hasLeadingSegment) assertUnusedId(project.clips, id, 'clip');
			replacements.push(segmentOfClip(inactiveClip, activeEnd, inactiveEnd, activeEnd, id));
		}
	}

	project.clips = project.clips.filter((item) => item.id !== updated.id && !removedIds.has(item.id));
	project.clips.push(updated, ...replacements);
	if (targetTrack.id !== oldTrack.id) {
		oldTrack.clipIds = oldTrack.clipIds.filter((clipId) => clipId !== clip.id);
	}
	targetTrack.clipIds = [...replacements.map((item) => item.id), updated.id];
	sortTrack(project, oldTrack);
	sortTrack(project, targetTrack);
}

export function prepareOverwriteClipCommand(project, clipId, options = {}, idFactory = createStableId) {
	const clip = findClip(project, clipId);
	if (!clip) throw new ReferenceError(`Unknown clip ${clipId}.`);
	const targetTrack = findTrack(project, options.trackId) || findClipTrack(project, clipId);
	if (!targetTrack) throw new ReferenceError(`Unknown target track for clip ${clipId}.`);
	const candidate = normalizeClipForProject(project, { ...clip, ...(options.changes || {}), id: clip.id });
	const splitClipIds = {};
	for (const targetClipId of targetTrack.clipIds) {
		if (targetClipId === clip.id) continue;
		const inactiveClip = requireClip(project, targetClipId);
		if (
			clipsOverlap(inactiveClip, candidate)
			&& inactiveClip.timelineStartFrame < candidate.timelineStartFrame
			&& clipEndFrame(inactiveClip) > clipEndFrame(candidate)
		) {
			splitClipIds[inactiveClip.id] = idFactory('clip');
		}
	}
	return {
		type: 'clip/overwrite',
		clipId,
		trackId: targetTrack.id,
		changes: { ...(options.changes || {}) },
		splitClipIds,
	};
}

function trimClip(project, command) {
	const clip = requireClip(project, command.clipId);
	const track = requireClipTrack(project, clip.id);
	const timelineStartFrame = command.timelineStartFrame ?? clip.timelineStartFrame;
	const durationFrames = command.durationFrames ?? clip.durationFrames;
	const sourceDurationFrames = command.sourceDurationFrames ?? Math.max(
		1,
		Math.round((clip.sourceDurationFrames ?? clip.durationFrames) * durationFrames / clip.durationFrames),
	);
	const updated = normalizeClipForProject(project, {
		...clip,
		timelineStartFrame,
		sourceStartFrame: command.sourceStartFrame ?? clip.sourceStartFrame,
		sourceDurationFrames,
		durationFrames,
		trimStartFrames: command.trimStartFrames ?? clip.trimStartFrames,
		trimEndFrames: command.trimEndFrames ?? clip.trimEndFrames,
		envelope: envelopeForTrimmedBounds(clip, timelineStartFrame, durationFrames),
		fadeInFrames: command.fadeInFrames ?? Math.min(clip.fadeInFrames, command.durationFrames ?? clip.durationFrames),
		fadeOutFrames: command.fadeOutFrames ?? Math.min(clip.fadeOutFrames, command.durationFrames ?? clip.durationFrames),
		id: clip.id,
	});
	assertClipSourceBounds(project, updated);
	assertClipSpace(project, track, updated, clip.id);
	replaceClip(project, updated);
	sortTrack(project, track);
}

function splitClip(project, command) {
	const clip = requireClip(project, command.clipId);
	const track = requireClipTrack(project, clip.id);
	const atFrame = assertFrame(command.atFrame, 'split.atFrame');
	if (atFrame <= clip.timelineStartFrame || atFrame >= clipEndFrame(clip)) {
		throw new RangeError('A split must be inside the clip.');
	}
	if (!command.rightClipId) throw new TypeError('A stable rightClipId is required for a replayable split.');
	assertUnusedId(project.clips, command.rightClipId, 'clip');
	const left = segmentOfClip(clip, clip.timelineStartFrame, atFrame, clip.timelineStartFrame, clip.id);
	const right = segmentOfClip(clip, atFrame, clipEndFrame(clip), atFrame, command.rightClipId);
	replaceClip(project, left);
	project.clips.push(right);
	const index = track.clipIds.indexOf(clip.id);
	track.clipIds.splice(index + 1, 0, right.id);
	sortTrack(project, track);
}

export function prepareSplitCommand(clipId, atFrame, idFactory = createStableId) {
	return { type: 'clip/split', clipId, atFrame, rightClipId: idFactory('clip') };
}

export function prepareGroupClipsCommand(clipIds, idFactory = createStableId) {
	const normalizedIds = normalizeCommandIds(clipIds, 'clipIds');
	return { type: 'clip/group', clipIds: normalizedIds, groupId: idFactory('clip-group') };
}

function groupClips(project, clipIds, groupId) {
	if (project.schemaVersion !== 2) throw new RangeError('Clip grouping requires an AudioEditorProjectV2 project.');
	const ids = normalizeCommandIds(clipIds, 'clipIds');
	if (ids.length < 2) throw new RangeError('At least two clips are required to create a group.');
	const stableGroupId = requireStableCommandId(groupId, 'clip group');
	for (const clipId of ids) {
		const clip = requireClip(project, clipId);
		replaceClip(project, normalizeClipForProject(project, { ...clip, groupId: stableGroupId, id: clip.id }));
	}
}

function ungroupClips(project, clipIds) {
	if (project.schemaVersion !== 2) throw new RangeError('Clip grouping requires an AudioEditorProjectV2 project.');
	const ids = normalizeCommandIds(clipIds, 'clipIds');
	for (const clipId of ids) {
		const clip = requireClip(project, clipId);
		replaceClip(project, normalizeClipForProject(project, { ...clip, groupId: null, id: clip.id }));
	}
}

function joinClips(project, clipIds) {
	const ids = normalizeCommandIds(clipIds, 'clipIds');
	if (ids.length < 2) throw new RangeError('At least two clips are required to join.');
	const clips = ids.map((clipId) => requireClip(project, clipId))
		.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id));
	const track = requireClipTrack(project, clips[0].id);
	if (clips.some((clip) => requireClipTrack(project, clip.id).id !== track.id)) {
		throw new RangeError('Joined clips must belong to the same track.');
	}
	for (let index = 1; index < clips.length; index += 1) {
		const previous = clips[index - 1];
		const current = clips[index];
		if (clipEndFrame(previous) !== current.timelineStartFrame) {
			throw new RangeError('Only adjacent clips can be joined without rendering.');
		}
		if (!clipsHaveContiguousSource(previous, current)) {
			throw new RangeError('Clips with different processing or source regions must be rendered before joining.');
		}
	}
	const first = clips[0];
	const last = clips.at(-1);
	const joinedDurationFrames = clipEndFrame(last) - first.timelineStartFrame;
	const joinedSourceDurationFrames = clips.reduce((sum, clip) => sum + (clip.sourceDurationFrames ?? clip.durationFrames), 0);
	const joined = normalizeClipForProject(project, {
		...first,
		durationFrames: joinedDurationFrames,
		sourceDurationFrames: joinedSourceDurationFrames,
		trimEndFrames: last.trimEndFrames,
		fadeOutFrames: last.fadeOutFrames,
		envelope: joinClipEnvelopes(clips),
		id: first.id,
	});
	const removedIds = new Set(clips.slice(1).map((clip) => clip.id));
	project.clips = project.clips
		.filter((clip) => !removedIds.has(clip.id))
		.map((clip) => clip.id === joined.id ? joined : clip);
	track.clipIds = track.clipIds.filter((clipId) => !removedIds.has(clipId));
	sortTrack(project, track);
}

function clipsHaveContiguousSource(left, right) {
	if (
		left.sourceId !== right.sourceId
		|| left.reversed !== right.reversed
		|| left.gain !== right.gain
		|| (left.pitchCents ?? 0) !== (right.pitchCents ?? 0)
		|| (left.speedRatio ?? 1) !== (right.speedRatio ?? 1)
		|| Boolean(left.preserveFormants) !== Boolean(right.preserveFormants)
		|| Boolean(left.stretchToTempo) !== Boolean(right.stretchToTempo)
	) return false;
	const leftDuration = left.sourceDurationFrames ?? left.durationFrames;
	const rightDuration = right.sourceDurationFrames ?? right.durationFrames;
	return left.reversed
		? right.sourceStartFrame + rightDuration === left.sourceStartFrame
		: left.sourceStartFrame + leftDuration === right.sourceStartFrame;
}

function joinClipEnvelopes(clips) {
	const result = [];
	let offset = 0;
	for (const clip of clips) {
		for (const point of clip.envelope || []) {
			const frame = offset + point.frame;
			const previous = result.at(-1);
			if (previous?.frame === frame) result[result.length - 1] = { ...point, frame };
			else result.push({ ...point, frame });
		}
		offset += clip.durationFrames;
	}
	return result;
}

function deleteRange(project, command, rippleMode) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'delete range');
	const trackIds = command.trackIds || project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
	for (const trackId of trackIds) {
		const track = requireTrack(project, trackId);
		if (!Array.isArray(track.clipIds)) continue;
		processTrackRange(project, track, range, rippleMode, command.splitClipIds || {});
	}
}

function processTrackRange(project, track, range, rippleMode, splitClipIds) {
	const originals = track.clipIds.map((clipId) => requireClip(project, clipId));
	const replacements = [];
	const deletedIds = new Set(track.clipIds);
	for (const clip of originals) {
		const start = clip.timelineStartFrame;
		const end = clipEndFrame(clip);
		if (end <= range.startFrame) {
			replacements.push(clip);
			continue;
		}
		if (start >= range.endFrame) {
			replacements.push({
				...clip,
				timelineStartFrame: rippleMode === 'track' ? start - range.durationFrames : start,
			});
			continue;
		}

		const hasLeft = start < range.startFrame;
		const hasRight = end > range.endFrame;
		if (hasLeft) replacements.push(segmentOfClip(clip, start, range.startFrame, start, clip.id));
		if (hasRight) {
			const rightId = hasLeft ? splitClipIds[clip.id] : clip.id;
			if (!rightId) throw new TypeError(`A stable split clip ID is required for ${clip.id}.`);
			if (hasLeft) assertUnusedId(project.clips, rightId, 'clip');
			const timelineStartFrame = rippleMode === 'track'
				? range.startFrame
				: rippleMode === 'clip'
					? Math.max(start, range.startFrame)
					: range.endFrame;
			replacements.push(segmentOfClip(clip, range.endFrame, end, timelineStartFrame, rightId));
		}
	}

	project.clips = project.clips.filter((clip) => !deletedIds.has(clip.id));
	project.clips.push(...replacements);
	track.clipIds = replacements
		.sort((first, second) => first.timelineStartFrame - second.timelineStartFrame)
		.map((clip) => clip.id);
}

function keepRange(project, command) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'kept range');
	const trackIds = command.trackIds || project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
	for (const trackId of trackIds) {
		const track = requireTrack(project, trackId);
		if (!Array.isArray(track.clipIds)) continue;
		const originals = track.clipIds.map((clipId) => requireClip(project, clipId));
		const deletedIds = new Set(track.clipIds);
		const replacements = [];
		for (const clip of originals) {
			const start = Math.max(range.startFrame, clip.timelineStartFrame);
			const end = Math.min(range.endFrame, clipEndFrame(clip));
			if (end <= start) continue;
			replacements.push(segmentOfClip(clip, start, end, start, clip.id));
		}
		project.clips = project.clips.filter((clip) => !deletedIds.has(clip.id));
		project.clips.push(...replacements);
		track.clipIds = replacements
			.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id))
			.map((clip) => clip.id);
	}
}

export function prepareRangeDeleteCommand(project, options = {}, idFactory = createStableId) {
	const rippleMode = options.rippleMode || (options.ripple ? 'track' : 'none');
	if (!['none', 'clip', 'track'].includes(rippleMode)) throw new RangeError(`Unsupported ripple mode: ${rippleMode}.`);
	const type = rippleMode === 'clip'
		? 'range/per-clip-ripple-delete'
		: rippleMode === 'track'
			? 'range/ripple-delete'
			: 'range/lift-delete';
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'delete range');
	const trackIds = options.trackIds || project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
	const splitClipIds = {};
	for (const trackId of trackIds) {
		for (const clipId of requireTrack(project, trackId).clipIds) {
			const clip = requireClip(project, clipId);
			if (clip.timelineStartFrame < range.startFrame && clipEndFrame(clip) > range.endFrame) {
				splitClipIds[clip.id] = idFactory('clip');
			}
		}
	}
	return { type, trackIds: [...trackIds], ...range, splitClipIds };
}

export function prepareKeepRangeCommand(project, options = {}) {
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'kept range');
	const trackIds = options.trackIds || project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
	for (const trackId of trackIds) requireTrack(project, trackId);
	return { type: 'range/keep', trackIds: [...trackIds], ...range };
}

/** @returns {AudioEditorClipboardV1} */
export function createClipboardDescriptor(project, options = {}) {
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'clipboard range');
	const trackIds = options.trackIds || project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
	return {
		schemaVersion: 1,
		sampleRate: project.sampleRate,
		durationFrames: range.durationFrames,
		tracks: trackIds.map((trackId) => {
			const track = requireTrack(project, trackId);
			const clips = track.clipIds.flatMap((clipId) => {
				const clip = requireClip(project, clipId);
				const startFrame = Math.max(range.startFrame, clip.timelineStartFrame);
				const endFrame = Math.min(range.endFrame, clipEndFrame(clip));
				if (endFrame <= startFrame) return [];
				const segment = segmentOfClip(clip, startFrame, endFrame, startFrame - range.startFrame, clip.id);
				return [{
					key: `${clip.id}:${startFrame}:${endFrame}`,
					sourceId: segment.sourceId,
					offsetFrame: segment.timelineStartFrame,
					sourceStartFrame: segment.sourceStartFrame,
					durationFrames: segment.durationFrames,
					gain: segment.gain,
					fadeInFrames: segment.fadeInFrames,
					fadeOutFrames: segment.fadeOutFrames,
					reversed: segment.reversed,
					title: segment.title,
					sourceDurationFrames: segment.sourceDurationFrames,
					trimStartFrames: segment.trimStartFrames,
					trimEndFrames: segment.trimEndFrames,
					envelope: segment.envelope,
					groupId: segment.groupId,
					color: segment.color,
					pitchCents: segment.pitchCents,
					speedRatio: segment.speedRatio,
					preserveFormants: segment.preserveFormants,
					stretchToTempo: segment.stretchToTempo,
					renderCacheRevision: segment.renderCacheRevision,
				}];
			});
			return { sourceTrackId: track.id, sourceTrackName: track.name, clips };
		}),
	};
}

export function preparePasteCommand(clipboard, options = {}, idFactory = createStableId) {
	if (!clipboard || clipboard.schemaVersion !== 1) throw new TypeError('A compatible editor clipboard is required.');
	const mode = options.mode || 'reject';
	if (!['reject', 'overlap', 'insert-track', 'insert-all'].includes(mode)) throw new RangeError(`Unsupported paste mode: ${mode}.`);
	const clipIds = {};
	for (const track of clipboard.tracks || []) {
		for (const clip of track.clips || []) clipIds[clip.key] = idFactory('clip');
	}
	const command = {
		type: 'clipboard/paste',
		clipboard,
		atFrame: assertFrame(options.atFrame ?? 0, 'paste.atFrame'),
		trackMap: { ...(options.trackMap || {}) },
		clipIds,
		mode,
		splitClipIds: {},
	};
	if (options.project) preparePasteCollisionIds(options.project, command, idFactory);
	return command;
}

export function prepareCut(project, options = {}, idFactory = createStableId) {
	return {
		clipboard: createClipboardDescriptor(project, options),
		command: prepareRangeDeleteCommand(project, { ...options, ripple: Boolean(options.ripple) }, idFactory),
	};
}

function pasteClipboard(project, command) {
	const clipboard = command.clipboard;
	if (!clipboard || clipboard.schemaVersion !== 1) {
		throw new RangeError('The clipboard is incompatible with this project.');
	}
	const atFrame = assertFrame(command.atFrame, 'paste.atFrame');
	const scale = project.sampleRate / clipboard.sampleRate;
	if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('The clipboard sample rate is invalid.');
	const pastedDurationFrames = Math.max(1, Math.round(clipboard.durationFrames * scale));
	const mode = command.mode || 'reject';
	const targetTracks = new Set();
	for (const clipboardTrack of clipboard.tracks || []) {
		targetTracks.add(requireTrack(project, command.trackMap?.[clipboardTrack.sourceTrackId] || clipboardTrack.sourceTrackId));
	}
	if (mode === 'overlap' && project.schemaVersion !== 2) {
		const range = normalizeFrameRange(atFrame, atFrame + pastedDurationFrames, 'paste overlap range');
		for (const track of targetTracks) processTrackRange(project, track, range, 'none', command.splitClipIds || {});
	} else if (mode === 'insert-track' || mode === 'insert-all') {
		const tracks = mode === 'insert-all'
			? project.tracks.filter((track) => Array.isArray(track.clipIds))
			: [...targetTracks];
		for (const track of tracks) insertSpaceOnTrack(project, track, atFrame, pastedDurationFrames, command.splitClipIds || {});
	}
	const additions = [];
	for (const clipboardTrack of clipboard.tracks || []) {
		const targetTrack = requireTrack(project, command.trackMap?.[clipboardTrack.sourceTrackId] || clipboardTrack.sourceTrackId);
		for (const descriptor of clipboardTrack.clips || []) {
			const id = command.clipIds?.[descriptor.key];
			if (!id) throw new TypeError(`A stable pasted clip ID is required for ${descriptor.key}.`);
			assertUnusedId(project.clips, id, 'clip');
			const clip = normalizeClipForProject(project, scaleClipboardClip(descriptor, scale, atFrame, id));
			assertClipSourceBounds(project, clip);
			if (mode === 'reject') {
				const existing = targetTrack.clipIds.map((clipId) => requireClip(project, clipId));
				const pending = additions.filter((addition) => addition.track.id === targetTrack.id).map((addition) => addition.clip);
				if ([...existing, ...pending].some((candidate) => clipsOverlap(candidate, clip))) {
					throw new RangeError(`Clip overlaps existing material on track ${targetTrack.id}.`);
				}
			}
			assertClipSpace(project, targetTrack, clip, null, additions.filter((addition) => addition.track.id === targetTrack.id).map((addition) => addition.clip));
			additions.push({ track: targetTrack, clip });
		}
	}
	for (const { track, clip } of additions) {
		project.clips.push(clip);
		track.clipIds.push(clip.id);
	}
	for (const track of new Set(additions.map((addition) => addition.track))) sortTrack(project, track);
}

function preparePasteCollisionIds(project, command, idFactory) {
	const scale = project.sampleRate / command.clipboard.sampleRate;
	const durationFrames = Math.max(1, Math.round(command.clipboard.durationFrames * scale));
	const targetIds = new Set((command.clipboard.tracks || []).map((track) => command.trackMap?.[track.sourceTrackId] || track.sourceTrackId));
	const tracks = command.mode === 'insert-all'
		? project.tracks.filter((track) => Array.isArray(track.clipIds))
		: project.tracks.filter((track) => targetIds.has(track.id) && Array.isArray(track.clipIds));
	for (const track of tracks) {
		for (const clipId of track.clipIds) {
			const clip = requireClip(project, clipId);
			const spansBoundary = command.mode === 'overlap'
				? clip.timelineStartFrame < command.atFrame && clipEndFrame(clip) > command.atFrame + durationFrames
				: (command.mode === 'insert-track' || command.mode === 'insert-all')
					&& clip.timelineStartFrame < command.atFrame && clipEndFrame(clip) > command.atFrame;
			if (spansBoundary) command.splitClipIds[clip.id] = idFactory('clip');
		}
	}
}

function insertSpaceOnTrack(project, track, atFrame, durationFrames, splitClipIds) {
	const originals = track.clipIds.map((clipId) => requireClip(project, clipId));
	const replacements = [];
	const deletedIds = new Set(track.clipIds);
	for (const clip of originals) {
		if (clip.timelineStartFrame >= atFrame) {
			replacements.push(normalizeClipForProject(project, {
				...clip,
				timelineStartFrame: clip.timelineStartFrame + durationFrames,
				id: clip.id,
			}));
			continue;
		}
		if (clipEndFrame(clip) <= atFrame) {
			replacements.push(clip);
			continue;
		}
		const rightId = splitClipIds[clip.id];
		if (!rightId) throw new TypeError(`A stable split clip ID is required for ${clip.id}.`);
		assertUnusedId(project.clips, rightId, 'clip');
		replacements.push(segmentOfClip(clip, clip.timelineStartFrame, atFrame, clip.timelineStartFrame, clip.id));
		replacements.push(segmentOfClip(clip, atFrame, clipEndFrame(clip), atFrame + durationFrames, rightId));
	}
	project.clips = project.clips.filter((clip) => !deletedIds.has(clip.id));
	project.clips.push(...replacements);
	track.clipIds = replacements
		.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || left.id.localeCompare(right.id))
		.map((clip) => clip.id);
}

function scaleClipboardClip(descriptor, scale, atFrame, id) {
	const durationFrames = Math.max(1, Math.round(descriptor.durationFrames * scale));
	return {
		...descriptor,
		id,
		timelineStartFrame: atFrame + Math.round(descriptor.offsetFrame * scale),
		durationFrames,
		fadeInFrames: Math.min(durationFrames, Math.round((descriptor.fadeInFrames || 0) * scale)),
		fadeOutFrames: Math.min(durationFrames, Math.round((descriptor.fadeOutFrames || 0) * scale)),
		...(Array.isArray(descriptor.envelope) ? {
			envelope: descriptor.envelope.map((point) => ({
				...point,
				frame: Math.min(durationFrames, Math.max(0, Math.round(point.frame * scale))),
			})).filter((point, index, values) => !index || point.frame > values[index - 1].frame),
		} : {}),
	};
}

export function preparePunchCommand(project, options = {}, idFactory = createStableId) {
	const rangeCommand = prepareRangeDeleteCommand(project, {
		startFrame: options.startFrame,
		endFrame: options.endFrame,
		trackIds: [options.trackId],
	}, idFactory);
	return {
		type: 'punch/replace',
		trackId: options.trackId,
		startFrame: options.startFrame,
		endFrame: options.endFrame,
		sourceId: options.sourceId,
		sourceStartFrame: options.sourceStartFrame ?? 0,
		...(options.sourceDurationFrames == null ? {} : { sourceDurationFrames: options.sourceDurationFrames }),
		clipId: options.clipId || idFactory('clip'),
		splitClipIds: rangeCommand.splitClipIds,
	};
}

/**
 * Prepare an Audacity-style replacement of one track range with an immutable
 * source. The source's complete frame range becomes the replacement clip, and
 * later material on that track ripples by outputFrames - inputFrames.
 */
export function prepareRangeReplacementCommand(project, options = {}, idFactory = createStableId) {
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'replacement range');
	const track = requireTrack(project, options.trackId);
	const sourceId = options.source?.id || idFactory('source');
	const source = normalizeRangeReplacementSource(project, { ...(options.source || {}), id: sourceId });
	assertUnusedId(project.sources, source.id, 'source');
	const clipId = requireStableCommandId(options.clipId || idFactory('clip'), 'replacement clip');
	const generatedClipIds = new Set();
	reserveReplacementClipId(project, clipId, generatedClipIds);
	const splitClipIds = {};
	for (const existingClipId of track.clipIds) {
		const clip = requireClip(project, existingClipId);
		if (clip.timelineStartFrame < range.startFrame && clipEndFrame(clip) > range.endFrame) {
			const rightId = requireStableCommandId(idFactory('clip'), `right segment for ${clip.id}`);
			reserveReplacementClipId(project, rightId, generatedClipIds);
			splitClipIds[clip.id] = rightId;
		}
	}
	return {
		type: 'range/replace',
		trackId: track.id,
		...range,
		source,
		clipId,
		splitClipIds,
	};
}

function replaceRange(project, command) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'replacement range');
	const track = requireTrack(project, command.trackId);
	const source = normalizeRangeReplacementSource(project, command.source);
	const clipId = requireStableCommandId(command.clipId, 'replacement clip');
	assertUnusedId(project.sources, source.id, 'source');
	const generatedClipIds = new Set();
	reserveReplacementClipId(project, clipId, generatedClipIds);

	const originals = track.clipIds.map((id) => requireClip(project, id));
	const deletedIds = new Set(track.clipIds);
	const replacements = [];
	const timelineDelta = source.frameCount - range.durationFrames;
	for (const clip of originals) {
		const startFrame = clip.timelineStartFrame;
		const endFrame = clipEndFrame(clip);
		if (endFrame <= range.startFrame) {
			replacements.push(clip);
			continue;
		}
		if (startFrame >= range.endFrame) {
			replacements.push(normalizeClipForProject(project, {
				...clip,
				timelineStartFrame: startFrame + timelineDelta,
				id: clip.id,
			}));
			continue;
		}

		const hasLeft = startFrame < range.startFrame;
		const hasRight = endFrame > range.endFrame;
		if (hasLeft) replacements.push(segmentOfClip(clip, startFrame, range.startFrame, startFrame, clip.id));
		if (hasRight) {
			const rightId = hasLeft
				? requireStableCommandId(command.splitClipIds?.[clip.id], `right segment for ${clip.id}`)
				: clip.id;
			if (hasLeft) reserveReplacementClipId(project, rightId, generatedClipIds);
			replacements.push(segmentOfClip(
				clip,
				range.endFrame,
				endFrame,
				range.startFrame + source.frameCount,
				rightId,
			));
		}
	}

	const replacement = normalizeClipForProject(project, {
		id: clipId,
		sourceId: source.id,
		timelineStartFrame: range.startFrame,
		sourceStartFrame: 0,
		sourceDurationFrames: source.frameCount,
		durationFrames: source.frameCount,
	});
	const nextTrackClips = [...replacements, replacement]
		.sort((first, second) => first.timelineStartFrame - second.timelineStartFrame || first.id.localeCompare(second.id));
	project.sources.push(source);
	validateTrackReplacement(project, track, deletedIds, nextTrackClips);
	project.clips = project.clips.filter((clip) => !deletedIds.has(clip.id));
	project.clips.push(...nextTrackClips);
	track.clipIds = nextTrackClips.map((clip) => clip.id);
}

function punchReplace(project, command) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'punch range');
	const track = requireTrack(project, command.trackId);
	processTrackRange(project, track, range, false, command.splitClipIds || {});
	addClip(project, track.id, {
		id: command.clipId,
		sourceId: command.sourceId,
		timelineStartFrame: range.startFrame,
		sourceStartFrame: command.sourceStartFrame ?? 0,
		...(command.sourceDurationFrames == null ? {} : { sourceDurationFrames: command.sourceDurationFrames }),
		durationFrames: range.durationFrames,
	});
}

function addEffect(project, command) {
	const rack = getRack(project, command);
	const effect = command.effect?.type ? normalizeEffect(command.effect) : createEffect(command.effectType, command.effect || {});
	if (allEffects(project).some((item) => item.id === effect.id)) throw new RangeError(`Duplicate effect ID: ${effect.id}.`);
	const index = command.index == null ? rack.length : insertionIndex(command.index, rack.length);
	rack.splice(index, 0, effect);
}

function updateRackEffect(project, command) {
	const rack = getRack(project, command);
	const index = rack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown effect: ${command.effectId}.`);
	rack[index] = updateEffect(rack[index], command.changes || {});
}

function removeEffect(project, command) {
	const rack = getRack(project, command);
	const index = rack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown effect: ${command.effectId}.`);
	rack.splice(index, 1);
}

function reorderEffect(project, command) {
	const rack = getRack(project, command);
	const index = rack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown effect: ${command.effectId}.`);
	const toIndex = Number(command.toIndex);
	if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= rack.length) throw new RangeError('Effect destination is out of bounds.');
	const [effect] = rack.splice(index, 1);
	rack.splice(toIndex, 0, effect);
}

function getRack(project, command) {
	if (command.scope === 'master') return project.master.effects;
	if (command.scope === 'track') return requireTrack(project, command.trackId).effects;
	if (command.scope === 'group' || command.scope === 'send') {
		return requireMixerBus(project, command.scope, command.busId || command.trackId).effects;
	}
	throw new RangeError('Effect scope must be track, group, send, or master.');
}

function allEffects(project) {
	return [
		...project.master.effects,
		...project.tracks.flatMap((track) => track.effects || []),
		...(project.mixer?.groups || []).flatMap((bus) => bus.effects || []),
		...(project.mixer?.sends || []).flatMap((bus) => bus.effects || []),
	];
}

function segmentOfClip(clip, segmentStartFrame, segmentEndFrame, timelineStartFrame, id) {
	const offsetFrames = segmentStartFrame - clip.timelineStartFrame;
	const durationFrames = segmentEndFrame - segmentStartFrame;
	const sourceDuration = clip.sourceDurationFrames ?? clip.durationFrames;
	const sourceOffsetFrames = Math.round(offsetFrames * sourceDuration / clip.durationFrames);
	const segmentSourceDuration = segmentEndFrame === clipEndFrame(clip)
		? sourceDuration - sourceOffsetFrames
		: Math.max(1, Math.round(durationFrames * sourceDuration / clip.durationFrames));
	const sourceStartFrame = clip.reversed
		? clip.sourceStartFrame + sourceDuration - sourceOffsetFrames - segmentSourceDuration
		: clip.sourceStartFrame + sourceOffsetFrames;
	const envelope = Array.isArray(clip.envelope)
		? clip.envelope
			.filter((point) => point.frame >= offsetFrames && point.frame <= offsetFrames + durationFrames)
			.map((point) => ({ ...point, frame: point.frame - offsetFrames }))
		: undefined;
	return normalizeClipValue({
		...clip,
		id,
		timelineStartFrame,
		sourceStartFrame,
		durationFrames,
		sourceDurationFrames: segmentSourceDuration,
		trimStartFrames: segmentStartFrame === clip.timelineStartFrame ? clip.trimStartFrames : 0,
		trimEndFrames: segmentEndFrame === clipEndFrame(clip) ? clip.trimEndFrames : 0,
		...(envelope ? { envelope } : {}),
		fadeInFrames: segmentStartFrame === clip.timelineStartFrame ? Math.min(clip.fadeInFrames, durationFrames) : 0,
		fadeOutFrames: segmentEndFrame === clipEndFrame(clip) ? Math.min(clip.fadeOutFrames, durationFrames) : 0,
	});
}

function envelopeForTrimmedBounds(clip, timelineStartFrame, durationFrames) {
	const offsetFrames = timelineStartFrame - clip.timelineStartFrame;
	return (clip.envelope || [])
		.filter((point) => point.frame >= offsetFrames && point.frame <= offsetFrames + durationFrames)
		.map((point) => ({ ...point, frame: point.frame - offsetFrames }));
}

function assertClipSourceBounds(project, clip) {
	const source = findSource(project, clip.sourceId);
	if (!source) throw new ReferenceError(`Unknown source: ${clip.sourceId}.`);
	if (clip.sourceStartFrame + (clip.sourceDurationFrames ?? clip.durationFrames) > source.frameCount) throw new RangeError('Clip exceeds its source bounds.');
}

function assertClipSpace(project, track, candidate, excludedClipId = null, additionalClips = []) {
	if (project.schemaVersion === 2) return;
	const clips = track.clipIds
		.filter((clipId) => clipId !== excludedClipId)
		.map((clipId) => requireClip(project, clipId));
	if ([...clips, ...additionalClips].some((clip) => clipsOverlap(clip, candidate))) {
		throw new RangeError(`Clip overlaps existing material on track ${track.id}.`);
	}
}

function validateTrackReplacement(project, track, deletedIds, clips) {
	const ids = new Set(project.clips.filter((clip) => !deletedIds.has(clip.id)).map((clip) => clip.id));
	for (const clip of clips) {
		if (ids.has(clip.id)) throw new RangeError(`Duplicate clip ID: ${clip.id}.`);
		ids.add(clip.id);
		assertClipSourceBounds(project, clip);
	}
	if (project.schemaVersion !== 2) for (let index = 1; index < clips.length; index += 1) {
		if (clipsOverlap(clips[index - 1], clips[index])) throw new RangeError(`Range replacement overlaps existing material on track ${track.id}.`);
	}
}

function normalizeRangeReplacementSource(project, value) {
	if (!value || typeof value.id !== 'string' || !value.id) {
		throw new TypeError('A stable replacement source ID is required.');
	}
	if (!Number.isSafeInteger(value.frameCount) || value.frameCount <= 0) {
		throw new RangeError('Range replacement output must contain at least one frame.');
	}
	return normalizeSourceForProject(project, value);
}

function requireStableCommandId(value, name) {
	if (typeof value !== 'string' || !value) throw new TypeError(`A stable ${name} ID is required.`);
	return value;
}

function reserveReplacementClipId(project, id, reservedIds) {
	assertUnusedId(project.clips, id, 'clip');
	if (reservedIds.has(id)) throw new RangeError(`Duplicate replacement clip ID: ${id}.`);
	reservedIds.add(id);
}

function sortTrack(project, track) {
	track.clipIds.sort((firstId, secondId) => {
		const first = requireClip(project, firstId);
		const second = requireClip(project, secondId);
		return first.timelineStartFrame - second.timelineStartFrame || first.id.localeCompare(second.id);
	});
}

function replaceClip(project, value) {
	const index = project.clips.findIndex((clip) => clip.id === value.id);
	if (index < 0) throw new ReferenceError(`Unknown clip: ${value.id}.`);
	project.clips[index] = value;
}

function requireSource(project, sourceId) {
	const source = findSource(project, sourceId);
	if (!source) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	return source;
}

function requireTrack(project, trackId) {
	const track = findTrack(project, trackId);
	if (!track) throw new ReferenceError(`Unknown track: ${trackId}.`);
	return track;
}

function requireLabelTrack(project, trackId) {
	const track = requireTrack(project, trackId);
	if (track.type !== 'label') throw new RangeError(`Track ${trackId} is not a label track.`);
	return track;
}

function requireClip(project, clipId) {
	const clip = findClip(project, clipId);
	if (!clip) throw new ReferenceError(`Unknown clip: ${clipId}.`);
	return clip;
}

function requireClipTrack(project, clipId) {
	const track = findClipTrack(project, clipId);
	if (!track) throw new ReferenceError(`Clip ${clipId} is not assigned to a track.`);
	return track;
}

function assertUnusedId(items, id, type) {
	if (items.some((item) => item.id === id)) throw new RangeError(`Duplicate ${type} ID: ${id}.`);
}

function insertionIndex(value, length) {
	const index = Number(value);
	if (!Number.isInteger(index) || index < 0 || index > length) throw new RangeError('Insertion index is out of bounds.');
	return index;
}

function normalizeCommandIds(values, name) {
	if (!Array.isArray(values) || !values.length) throw new TypeError(`${name} must be a non-empty array.`);
	const result = values.map((value, index) => {
		if (typeof value !== 'string' || !value) throw new TypeError(`${name}[${index}] must be a stable ID.`);
		return value;
	});
	if (new Set(result).size !== result.length) throw new RangeError(`${name} cannot contain duplicate IDs.`);
	return result;
}

function normalizeSelectionIds(values, name) {
	if (!Array.isArray(values)) throw new TypeError(`${name} must be an array.`);
	if (!values.length) return [];
	return normalizeCommandIds(values, name);
}

function normalizeFrequencyRange(value, sampleRate) {
	if (value == null) return null;
	const minimumFrequency = Number(value.minimumFrequency);
	const maximumFrequency = Number(value.maximumFrequency);
	if (
		!Number.isFinite(minimumFrequency)
		|| !Number.isFinite(maximumFrequency)
		|| minimumFrequency < 0
		|| maximumFrequency <= minimumFrequency
		|| maximumFrequency > sampleRate / 2
	) {
		throw new RangeError('Selection frequency range is outside the project bandwidth.');
	}
	return { minimumFrequency, maximumFrequency };
}

export function createAddSourceCommand(options) {
	return { type: 'source/add', source: normalizeSourceValue(options) };
}

export function createAddTrackCommand(options = {}) {
	return { type: 'track/add', track: normalizeTrackValue(options) };
}

export function createAddClipCommand(trackId, options) {
	return { type: 'clip/add', trackId, clip: normalizeClipValue(options) };
}

export function createReplaceClipSourceCommand(clipId, sourceId) {
	return {
		type: 'clip/replace-source',
		clipId: requireStableCommandId(clipId, 'clip'),
		sourceId: requireStableCommandId(sourceId, 'source'),
	};
}

export function createAddLabelTrackCommand(options = {}) {
	return { type: 'track/add', track: createLabelTrackV2(options) };
}

export function createAddLabelCommand(trackId, options = {}) {
	return { type: 'label/add', trackId, label: createLabelV2(options) };
}

function normalizeSourceValue(value) {
	return createAudioSourceV2(value);
}

function normalizeTrackValue(value) {
	if (value?.type === 'label') return createLabelTrackV2(value);
	return createAudioTrackV2(value);
}

function normalizeClipValue(value) {
	return createAudioClipV2(value);
}

function normalizeSourceForProject(_project, value) {
	return createAudioSourceV2(value);
}

function normalizeTrackForProject(project, value) {
	return createAudioTrackV2(value, project.sampleRate);
}

function normalizeClipForProject(_project, value) {
	return createAudioClipV2(value);
}
