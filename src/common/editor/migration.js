import { validateAudioEditorProject } from './project.js';
import { normalizeEffect } from './effects.js';
import {
	createAudioClipV2,
	createAudioEditorProjectV2,
	createAudioSourceV2,
	createAudioTrackV2,
	loadAudioEditorProjectV2,
	validateAudioEditorProjectV2,
} from './project-v2.js';
import {
	createAudioEditorProjectV3,
	loadAudioEditorProjectV3,
	validateAudioEditorProjectV3,
} from './project-v3.js';
import {
	createAudioEditorProjectV4,
	loadAudioEditorProjectV4,
	validateAudioEditorProjectV4,
} from './project-v4.js';
import {
	createAudioEditorProjectV5,
	loadAudioEditorProjectV5,
	validateAudioEditorProjectV5,
} from './project-v5.js';
import {
	createAudioEditorProjectV6,
	loadAudioEditorProjectV6,
	validateAudioEditorProjectV6,
} from './project-v6.ts';
import {
	createAudioEditorProjectV7,
	loadAudioEditorProjectV7,
	validateAudioEditorProjectV7,
} from './project-v7.ts';
import {
	createAudioEditorProjectV8,
	loadAudioEditorProjectV8,
	validateAudioEditorProjectV8,
} from './project-v8.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	createAudioEditorProjectV9,
	loadAudioEditorProjectV9,
	validateAudioEditorProjectV9,
} from './project-v9.ts';

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

export function migrateAudioEditorProjectV2ToV3(value) {
	if (!value || typeof value !== 'object' || value.schemaVersion !== 2) {
		throw new RangeError('An AudioEditorProjectV2 project is required.');
	}
	const loaded = loadAudioEditorProjectV2(value);
	if (loaded.readOnly) throw new RangeError('An AudioEditorProjectV2 project is required.');
	const project = createAudioEditorProjectV3({
		...loaded.project,
		now: loaded.project.createdAt,
		projectBin: { clips: [] },
	});
	validateAudioEditorProjectV3(project);
	return project;
}

export function migrateAudioEditorProjectV1ToV3(value) {
	return migrateAudioEditorProjectV2ToV3(migrateAudioEditorProjectV1ToV2(value));
}

export function migrateAudioEditorProjectV3ToV4(value) {
	if (!value || typeof value !== 'object' || value.schemaVersion !== 3) {
		throw new RangeError('An AudioEditorProjectV3 project is required.');
	}
	const loaded = loadAudioEditorProjectV3(value);
	if (loaded.readOnly) throw new RangeError('An AudioEditorProjectV3 project is required.');
	const project = createAudioEditorProjectV4({
		...loaded.project,
		now: loaded.project.createdAt,
		sources: loaded.project.sources.map((source) => ({
			...source,
			kind: 'audio',
		})),
		clips: loaded.project.clips.map((clip) => ({
			...clip,
			kind: 'audio',
			avLinkId: null,
			binItemId: null,
		})),
		tracks: loaded.project.tracks.map((track) => ({
			...track,
			laneGroupId: null,
		})),
		projectBin: {
			...loaded.project.projectBin,
			clips: loaded.project.projectBin.clips.map((clip) => ({
				...clip,
				kind: 'audio',
				avLinkId: null,
				binItemId: clip.id,
			})),
		},
	});
	validateAudioEditorProjectV4(project);
	return project;
}

export function migrateAudioEditorProjectV2ToV4(value) {
	return migrateAudioEditorProjectV3ToV4(migrateAudioEditorProjectV2ToV3(value));
}

export function migrateAudioEditorProjectV1ToV4(value) {
	return migrateAudioEditorProjectV3ToV4(migrateAudioEditorProjectV1ToV3(value));
}

export function migrateAudioEditorProjectV4ToV5(value) {
	if (!value || typeof value !== 'object' || value.schemaVersion !== 4) {
		throw new RangeError('An AudioEditorProjectV4 project is required.');
	}
	const loaded = loadAudioEditorProjectV4(value);
	if (loaded.readOnly) throw new RangeError('An AudioEditorProjectV4 project is required.');
	const addVideoEffectStack = (clip) => clip.kind === 'video'
		? { ...clip, videoEffects: [] }
		: clip;
	const project = createAudioEditorProjectV5({
		...loaded.project,
		now: loaded.project.createdAt,
		clips: loaded.project.clips.map(addVideoEffectStack),
		projectBin: {
			...loaded.project.projectBin,
			clips: loaded.project.projectBin.clips.map(addVideoEffectStack),
		},
	});
	validateAudioEditorProjectV5(project);
	return project;
}

export function migrateAudioEditorProjectV3ToV5(value) {
	return migrateAudioEditorProjectV4ToV5(migrateAudioEditorProjectV3ToV4(value));
}

export function migrateAudioEditorProjectV2ToV5(value) {
	return migrateAudioEditorProjectV3ToV5(migrateAudioEditorProjectV2ToV3(value));
}

export function migrateAudioEditorProjectV1ToV5(value) {
	return migrateAudioEditorProjectV3ToV5(migrateAudioEditorProjectV1ToV3(value));
}

export function migrateAudioEditorProjectV5ToV6(value) {
	if (!value || typeof value !== 'object' || value.schemaVersion !== 5) {
		throw new RangeError('An AudioEditorProjectV5 project is required.');
	}
	const loaded = loadAudioEditorProjectV5(value);
	if (loaded.readOnly) throw new RangeError('An AudioEditorProjectV5 project is required.');
	const project = createAudioEditorProjectV6({
		...loaded.project,
		now: loaded.project.createdAt,
		metadata: {
			...loaded.project.metadata,
			bext: null,
		},
	});
	validateAudioEditorProjectV6(project);
	return project;
}

export function migrateAudioEditorProjectV4ToV6(value) {
	return migrateAudioEditorProjectV5ToV6(migrateAudioEditorProjectV4ToV5(value));
}

export function migrateAudioEditorProjectV3ToV6(value) {
	return migrateAudioEditorProjectV5ToV6(migrateAudioEditorProjectV3ToV5(value));
}

export function migrateAudioEditorProjectV2ToV6(value) {
	return migrateAudioEditorProjectV5ToV6(migrateAudioEditorProjectV2ToV5(value));
}

export function migrateAudioEditorProjectV1ToV6(value) {
	return migrateAudioEditorProjectV5ToV6(migrateAudioEditorProjectV1ToV5(value));
}

export function migrateAudioEditorProjectV6ToV7(value) {
	if (!value || typeof value !== 'object' || value.schemaVersion !== 6) {
		throw new RangeError('An AudioEditorProjectV6 project is required.');
	}
	const loaded = loadAudioEditorProjectV6(value);
	if (loaded.readOnly) throw new RangeError('An AudioEditorProjectV6 project is required.');
	const project = createAudioEditorProjectV7({
		...loaded.project,
		now: loaded.project.createdAt,
		metadata: {
			...loaded.project.metadata,
			adm: null,
		},
	});
	validateAudioEditorProjectV7(project);
	return project;
}

export function migrateAudioEditorProjectV5ToV7(value) {
	return migrateAudioEditorProjectV6ToV7(migrateAudioEditorProjectV5ToV6(value));
}

export function migrateAudioEditorProjectV4ToV7(value) {
	return migrateAudioEditorProjectV6ToV7(migrateAudioEditorProjectV4ToV6(value));
}

export function migrateAudioEditorProjectV3ToV7(value) {
	return migrateAudioEditorProjectV6ToV7(migrateAudioEditorProjectV3ToV6(value));
}

export function migrateAudioEditorProjectV2ToV7(value) {
	return migrateAudioEditorProjectV6ToV7(migrateAudioEditorProjectV2ToV6(value));
}

export function migrateAudioEditorProjectV1ToV7(value) {
	return migrateAudioEditorProjectV6ToV7(migrateAudioEditorProjectV1ToV6(value));
}

export function migrateAudioEditorProjectV7ToV8(value) {
	if (!value || typeof value !== 'object' || value.schemaVersion !== 7) {
		throw new RangeError('An AudioEditorProjectV7 project is required.');
	}
	const loaded = loadAudioEditorProjectV7(value);
	if (loaded.readOnly) throw new RangeError('An AudioEditorProjectV7 project is required.');
	const project = createAudioEditorProjectV8({
		...loaded.project,
		now: loaded.project.createdAt,
	});
	validateAudioEditorProjectV8(project);
	return project;
}

export function migrateAudioEditorProjectV6ToV8(value) {
	return migrateAudioEditorProjectV7ToV8(migrateAudioEditorProjectV6ToV7(value));
}

export function migrateAudioEditorProjectV5ToV8(value) {
	return migrateAudioEditorProjectV7ToV8(migrateAudioEditorProjectV5ToV7(value));
}

export function migrateAudioEditorProjectV4ToV8(value) {
	return migrateAudioEditorProjectV7ToV8(migrateAudioEditorProjectV4ToV7(value));
}

export function migrateAudioEditorProjectV3ToV8(value) {
	return migrateAudioEditorProjectV7ToV8(migrateAudioEditorProjectV3ToV7(value));
}

export function migrateAudioEditorProjectV2ToV8(value) {
	return migrateAudioEditorProjectV7ToV8(migrateAudioEditorProjectV2ToV7(value));
}

export function migrateAudioEditorProjectV1ToV8(value) {
	return migrateAudioEditorProjectV7ToV8(migrateAudioEditorProjectV1ToV7(value));
}

export function migrateAudioEditorProjectV8ToV9(value) {
	if (!value || typeof value !== 'object' || value.schemaVersion !== 8) {
		throw new RangeError('An AudioEditorProjectV8 project is required.');
	}
	const loaded = loadAudioEditorProjectV8(value);
	if (loaded.readOnly) throw new RangeError('An AudioEditorProjectV8 project is required.');
	const project = createAudioEditorProjectV9({
		...loaded.project,
		now: loaded.project.createdAt,
	});
	validateAudioEditorProjectV9(project);
	return project;
}

/**
 * Version-aware load/migration boundary. Future documents are returned intact
 * and read-only; V1-V8 are migrated atomically; V9 is validated and cloned.
 */
export function migrateAudioEditorProject(value) {
	if (!value || typeof value !== 'object') throw new TypeError('A saved project is required.');
	const schemaVersion = Number(value.schemaVersion);
	if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
		throw new RangeError(`Unsupported audio editor schema version: ${value.schemaVersion}.`);
	}
	if (schemaVersion > AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		return {
			project: clone(value),
			migrated: false,
			fromVersion: schemaVersion,
			readOnly: true,
			reason: 'newer-schema',
		};
	}
	if (schemaVersion === AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		const loaded = loadAudioEditorProjectV9(value);
		const migrated = (value.tracks || []).some((track) => track?.type !== 'label' && (
			Object.hasOwn(track, 'channelCount')
			|| Object.hasOwn(track, 'channelLayout')
			|| Object.hasOwn(track, 'sampleRate')
			|| Object.hasOwn(track, 'sampleFormat')
		)) || projectHasLegacyParametricEq(value);
		return {
			project: loaded.project,
			migrated,
			fromVersion: schemaVersion,
			readOnly: false,
			reason: null,
		};
	}
	const v8Project = schemaVersion === 8
		? value
		: schemaVersion === 7
		? migrateAudioEditorProjectV7ToV8(value)
		: schemaVersion === 6
			? migrateAudioEditorProjectV6ToV8(value)
			: schemaVersion === 5
				? migrateAudioEditorProjectV5ToV8(value)
				: schemaVersion === 4
					? migrateAudioEditorProjectV4ToV8(value)
					: schemaVersion === 3
						? migrateAudioEditorProjectV3ToV8(value)
						: schemaVersion === 2
							? migrateAudioEditorProjectV2ToV8(value)
							: migrateAudioEditorProjectV1ToV8(value);
	const project = migrateAudioEditorProjectV8ToV9(v8Project);
	return {
		project,
		migrated: true,
		fromVersion: schemaVersion,
		readOnly: false,
		reason: null,
	};
}

function projectHasLegacyParametricEq(project) {
	const racks = [
		project?.master?.effects,
		...(project?.tracks || []).map((track) => track?.effects),
		...(project?.mixer?.groups || []).map((group) => group?.effects),
		...(project?.mixer?.sends || []).map((send) => send?.effects),
	];
	for (const effects of racks) {
		for (const effect of effects || []) {
			if (!['eq', 'parametric-eq', 'parametric_eq'].includes(effect?.type)) continue;
			if (effect.type !== 'eq') return true;
			const normalized = normalizeEffect(effect);
			if (!canonicalParametricEqParamsEqual(normalized.params, effect.params)) return true;
		}
	}
	return false;
}

function canonicalParametricEqParamsEqual(expected, actual) {
	if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
	if (!sameKeys(actual, ['bands', 'outputGain']) || actual.outputGain !== expected.outputGain) return false;
	if (!Array.isArray(actual.bands) || actual.bands.length !== expected.bands.length) return false;
	const bandKeys = ['enabled', 'frequency', 'gain', 'id', 'q', 'slope', 'type'];
	return actual.bands.every((band, index) => {
		const canonical = expected.bands[index];
		return band && typeof band === 'object' && !Array.isArray(band)
			&& sameKeys(band, bandKeys)
			&& band.id === canonical.id
			&& band.enabled === canonical.enabled
			&& band.type === canonical.type
			&& band.frequency === canonical.frequency
			&& band.gain === canonical.gain
			&& band.q === canonical.q
			&& band.slope === canonical.slope;
	});
}

function sameKeys(value, expected) {
	const keys = Object.keys(value).sort();
	return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
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
