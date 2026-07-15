import { validateAudioEditorProject } from './project.js';
import {
	AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
	createAudioClipV2,
	createAudioEditorProjectV2,
	createAudioSourceV2,
	createAudioTrackV2,
	loadAudioEditorProjectV2,
	validateAudioEditorProjectV2,
} from './project-v2.js';

const PROJECT_V1_KEYS = new Set([
	'schemaVersion', 'id', 'title', 'revision', 'createdAt', 'updatedAt', 'sampleRate', 'masterChannels',
	'selection', 'loop', 'sources', 'clips', 'tracks', 'master', 'tempo', 'snap', 'timeDisplay', 'metadata',
	'view', 'opaqueExtensions',
]);
const SOURCE_V1_KEYS = new Set([
	'id', 'name', 'mimeType', 'storageKey', 'frameCount', 'channelCount', 'sampleRate', 'originalSampleRate',
	'sampleFormat', 'chunkFrames', 'opaqueExtensions',
]);
const CLIP_V1_KEYS = new Set([
	'id', 'sourceId', 'timelineStartFrame', 'sourceStartFrame', 'durationFrames', 'gain', 'fadeInFrames',
	'fadeOutFrames', 'reversed', 'title', 'sourceDurationFrames', 'trimStartFrames', 'trimEndFrames', 'envelope', 'groupId', 'color',
	'pitchCents', 'speedRatio', 'preserveFormants', 'stretchToTempo', 'renderCacheRevision', 'opaqueExtensions',
]);
const TRACK_V1_KEYS = new Set([
	'id', 'name', 'gain', 'pan', 'mute', 'solo', 'armed', 'effects', 'clipIds', 'type', 'channelCount',
	'channelLayout', 'sampleRate', 'sampleFormat',
	'displayMode', 'spectrogram', 'envelope', 'collapsed', 'height',
	'opaqueExtensions',
]);

function clone(value) {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function legacyOpaque(value, knownKeys) {
	const unknown = {};
	for (const [key, field] of Object.entries(value || {})) {
		if (!knownKeys.has(key)) unknown[key] = clone(field);
	}
	return Object.keys(unknown).length ? { legacyV1: unknown } : {};
}

function mergeOpaque(value, knownKeys) {
	const existing = clone(value?.opaqueExtensions || {});
	const legacy = legacyOpaque(value, knownKeys).legacyV1;
	if (!legacy) return existing;
	return {
		...existing,
		legacyV1: { ...clone(existing.legacyV1 || {}), ...legacy },
	};
}

function sourceForClip(sourceById, clip) {
	const source = sourceById.get(clip.sourceId);
	if (!source) throw new ReferenceError(`Clip ${clip.id} references a missing source.`);
	return source;
}

/**
 * Build and validate a complete V2 draft before returning it. The V1 input is
 * never modified, so callers can commit the returned document to persistence
 * only after this transaction succeeds.
 */
export function migrateAudioEditorProjectV1ToV2(value) {
	validateAudioEditorProject(value);
	const sourceById = new Map(value.sources.map((source) => [source.id, source]));
	const sources = value.sources.map((source) => createAudioSourceV2({
		...source,
		sampleRate: source.sampleRate || value.sampleRate,
		originalSampleRate: source.originalSampleRate || source.sampleRate || value.sampleRate,
		sampleFormat: source.sampleFormat || 'float32',
		opaqueExtensions: mergeOpaque(source, SOURCE_V1_KEYS),
	}));
	const clips = value.clips.map((clip) => {
		const source = sourceForClip(sourceById, clip);
		return createAudioClipV2({
			...clip,
			title: clip.title || source.name || 'Audio clip',
			sourceDurationFrames: clip.sourceDurationFrames ?? clip.durationFrames,
			trimStartFrames: clip.trimStartFrames ?? clip.sourceStartFrame,
			trimEndFrames: clip.trimEndFrames ?? Math.max(0, source.frameCount - clip.sourceStartFrame - clip.durationFrames),
			envelope: clip.envelope || [],
			groupId: clip.groupId ?? null,
			color: clip.color || 'auto',
			pitchCents: clip.pitchCents ?? 0,
			speedRatio: clip.speedRatio ?? 1,
			preserveFormants: clip.preserveFormants ?? false,
			stretchToTempo: clip.stretchToTempo ?? false,
			renderCacheRevision: clip.renderCacheRevision ?? 0,
			opaqueExtensions: mergeOpaque(clip, CLIP_V1_KEYS),
		});
	});
	const tracks = value.tracks.map((track) => (
		createAudioTrackV2({
			...track,
			type: 'audio',
			displayMode: track.displayMode || 'waveform',
			spectrogram: track.spectrogram || {},
			envelope: track.envelope || [],
			opaqueExtensions: mergeOpaque(track, TRACK_V1_KEYS),
		}, value.sampleRate)
	));
	const project = createAudioEditorProjectV2({
		id: value.id,
		title: value.title,
		revision: value.revision,
		now: value.createdAt,
		updatedAt: value.updatedAt,
		sampleRate: value.sampleRate,
		masterChannels: value.masterChannels,
		tempo: value.tempo || { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, detected: false },
		snap: value.snap || { enabled: false, unit: 'seconds', mode: 'nearest' },
		timeDisplay: value.timeDisplay || { format: 'hh:mm:ss+milliseconds' },
		metadata: value.metadata || { title: value.title },
		selection: {
			startFrame: value.selection.startFrame,
			endFrame: value.selection.endFrame,
			trackIds: value.selection.trackIds || [],
			clipIds: value.selection.clipIds || [],
			frequencyRange: value.selection.frequencyRange || null,
		},
		loop: value.loop,
		view: value.view || {},
		sources,
		clips,
		tracks,
		master: {
			gain: value.master.gain,
			pan: value.master.pan ?? 0,
			effects: value.master.effects,
		},
		opaqueExtensions: mergeOpaque(value, PROJECT_V1_KEYS),
	});
	validateAudioEditorProjectV2(project);
	return project;
}

/**
 * Version-aware load/migration boundary. Future documents are returned intact
 * and read-only; V1 is migrated atomically; V2 is validated and cloned.
 */
export function migrateAudioEditorProject(value) {
	if (!value || typeof value !== 'object') throw new TypeError('A saved project is required.');
	const schemaVersion = Number(value.schemaVersion);
	if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
		throw new RangeError(`Unsupported audio editor schema version: ${value.schemaVersion}.`);
	}
	if (schemaVersion > AUDIO_EDITOR_PROJECT_SCHEMA_VERSION) {
		return {
			project: clone(value),
			migrated: false,
			fromVersion: schemaVersion,
			readOnly: true,
			reason: 'newer-schema',
		};
	}
	if (schemaVersion === AUDIO_EDITOR_PROJECT_SCHEMA_VERSION) {
		const loaded = loadAudioEditorProjectV2(value);
		const migrated = (value.tracks || []).some((track) => track?.type !== 'label' && (
			Object.hasOwn(track, 'channelCount')
			|| Object.hasOwn(track, 'channelLayout')
			|| Object.hasOwn(track, 'sampleRate')
			|| Object.hasOwn(track, 'sampleFormat')
		));
		return {
			project: loaded.project,
			migrated,
			fromVersion: schemaVersion,
			readOnly: false,
			reason: null,
		};
	}
	const project = migrateAudioEditorProjectV1ToV2(value);
	return {
		project,
		migrated: true,
		fromVersion: schemaVersion,
		readOnly: false,
		reason: null,
	};
}

function migrateHistoryEntry(entry, name) {
	if (!entry || typeof entry !== 'object' || !entry.project) throw new TypeError(`${name} must contain a project snapshot.`);
	const result = migrateAudioEditorProject(entry.project);
	if (result.readOnly) throw new RangeError(`${name} contains a newer project schema.`);
	return {
		...clone(entry),
		project: result.project,
		command: clone(entry.command),
	};
}

/**
 * Transactionally migrate every project snapshot while retaining undo/redo
 * commands and their source IDs. Any invalid snapshot rejects the whole call.
 */
export function migrateAudioEditorHistoryV1ToV2(history) {
	if (!history || typeof history !== 'object' || !history.present) throw new TypeError('Audio editor history is required.');
	if (!Array.isArray(history.undoStack) || !Array.isArray(history.redoStack)) {
		throw new TypeError('Audio editor history stacks must be arrays.');
	}
	const present = migrateAudioEditorProject(history.present);
	if (present.readOnly) throw new RangeError('Audio editor history contains a newer project schema.');
	const migrated = {
		...clone(history),
		present: present.project,
		undoStack: history.undoStack.map((entry, index) => migrateHistoryEntry(entry, `undoStack[${index}]`)),
		redoStack: history.redoStack.map((entry, index) => migrateHistoryEntry(entry, `redoStack[${index}]`)),
	};
	return migrated;
}

/**
 * Migrate a saved project and optional in-memory history as one pure unit. The
 * returned value is the only commit candidate; the input remains a rollback.
 */
export function migrateAudioEditorStateV1ToV2(state) {
	if (!state || typeof state !== 'object' || !state.project) throw new TypeError('Audio editor state is required.');
	const project = migrateAudioEditorProject(state.project);
	if (project.readOnly) {
		return {
			state: clone(state),
			migrated: false,
			readOnly: true,
			reason: project.reason,
		};
	}
	const migratedState = {
		...clone(state),
		project: project.project,
	};
	if (state.history) migratedState.history = migrateAudioEditorHistoryV1ToV2(state.history);
	return {
		state: migratedState,
		migrated: project.migrated || Boolean(state.history),
		readOnly: false,
		reason: null,
	};
}
