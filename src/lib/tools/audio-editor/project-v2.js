import { createStableId } from './project.js';

export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = 2;
export const AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE = 48_000;
export const AUDIO_EDITOR_PROJECT_DEFAULT_MASTER_CHANNELS = 2;
export const AUDIO_EDITOR_SOURCE_CHUNK_FRAMES = 65_536;

export const AUDIO_EDITOR_TRACK_TYPES = Object.freeze(['audio', 'label']);
export const AUDIO_EDITOR_SAMPLE_FORMATS = Object.freeze(['int16', 'int24', 'int32', 'float32', 'float64', 'unknown']);
export const AUDIO_EDITOR_DISPLAY_MODES = Object.freeze(['waveform', 'spectrogram', 'multiview', 'half-wave']);

const TRACK_TYPE_SET = new Set(AUDIO_EDITOR_TRACK_TYPES);
const SAMPLE_FORMAT_SET = new Set(AUDIO_EDITOR_SAMPLE_FORMATS);
const DISPLAY_MODE_SET = new Set(AUDIO_EDITOR_DISPLAY_MODES);

/**
 * @typedef {Object} AudioEditorSourceV2
 * @property {string} id
 * @property {string} name
 * @property {string} mimeType
 * @property {string} storageKey
 * @property {number} frameCount
 * @property {number} channelCount
 * @property {number} sampleRate
 * @property {number} originalSampleRate
 * @property {'int16'|'int24'|'int32'|'float32'|'float64'|'unknown'} sampleFormat
 * @property {number} chunkFrames
 * @property {*} opaqueExtensions
 */

/**
 * @typedef {Object} AudioEditorClipV2
 * @property {string} id
 * @property {string} sourceId
 * @property {string} title
 * @property {number} timelineStartFrame
 * @property {number} sourceStartFrame
 * @property {number} sourceDurationFrames
 * @property {number} durationFrames
 * @property {number} trimStartFrames
 * @property {number} trimEndFrames
 * @property {number} gain
 * @property {number} fadeInFrames
 * @property {number} fadeOutFrames
 * @property {boolean} reversed
 * @property {Array<{frame: number, value: number}>} envelope
 * @property {string|null} groupId
 * @property {string} color
 * @property {number} pitchCents
 * @property {number} speedRatio
 * @property {boolean} preserveFormants
 * @property {boolean} stretchToTempo
 * @property {number} renderCacheRevision
 * @property {*} opaqueExtensions
 */

/**
 * @typedef {Object} AudioEditorAudioTrackV2
 * @property {'audio'} type
 * @property {string} id
 * @property {string} name
 * @property {number} gain
 * @property {number} pan
 * @property {boolean} mute
 * @property {boolean} solo
 * @property {boolean} armed
 * @property {number} channelCount
 * @property {string} channelLayout
 * @property {number} sampleRate
 * @property {string} sampleFormat
 * @property {'waveform'|'spectrogram'|'multiview'|'half-wave'} displayMode
 * @property {string} color
 * @property {Object} spectrogram
 * @property {Array<{frame: number, value: number}>} envelope
 * @property {Object[]} effects
 * @property {string[]} clipIds
 * @property {boolean} collapsed
 * @property {number} height
 * @property {*} opaqueExtensions
 */

/**
 * @typedef {Object} AudioEditorLabelTrackV2
 * @property {'label'} type
 * @property {string} id
 * @property {string} name
 * @property {Array<{id: string, title: string, startFrame: number, endFrame: number, color: string}>} labels
 * @property {boolean} collapsed
 * @property {number} height
 * @property {*} opaqueExtensions
 */

/**
 * Materialized project document. PCM remains referenced through immutable
 * sources and is never embedded in project snapshots or undo commands.
 *
 * @typedef {Object} AudioEditorProjectV2
 * @property {2} schemaVersion
 * @property {string} id
 * @property {string} title
 * @property {number} revision
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {number} sampleRate
 * @property {number} masterChannels
 * @property {Object} tempo
 * @property {Object} snap
 * @property {Object} timeDisplay
 * @property {Object} metadata
 * @property {Object} selection
 * @property {Object} loop
 * @property {Object} view
 * @property {AudioEditorSourceV2[]} sources
 * @property {AudioEditorClipV2[]} clips
 * @property {(AudioEditorAudioTrackV2|AudioEditorLabelTrackV2)[]} tracks
 * @property {Object} master
 * @property {*} opaqueExtensions
 */

function plainClone(value) {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function isoTimestamp(value = new Date()) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid timestamp is required.');
	return date.toISOString();
}

function nonEmptyString(value, name) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function safeInteger(value, minimum, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum) {
		throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}.`);
	}
	return number;
}

function finiteInRange(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
}

function oneOf(value, allowed, name) {
	if (!allowed.has(value)) throw new RangeError(`${name} has an unsupported value: ${value}.`);
	return value;
}

function uniqueStrings(values, name) {
	if (!Array.isArray(values)) throw new TypeError(`${name} must be an array.`);
	const result = values.map((value, index) => nonEmptyString(value, `${name}[${index}]`));
	if (new Set(result).size !== result.length) throw new RangeError(`${name} cannot contain duplicate IDs.`);
	return result;
}

function normalizeEnvelope(points, name = 'envelope') {
	if (!Array.isArray(points)) throw new TypeError(`${name} must be an array.`);
	const normalized = points.map((point, index) => ({
		...plainClone(point),
		frame: safeInteger(point?.frame, 0, `${name}[${index}].frame`),
		value: finiteInRange(point?.value, 0, 16, `${name}[${index}].value`),
	}));
	for (let index = 1; index < normalized.length; index += 1) {
		if (normalized[index].frame <= normalized[index - 1].frame) {
			throw new RangeError(`${name} points must use strictly increasing frames.`);
		}
	}
	return normalized;
}

function normalizeEffects(effects, name) {
	if (!Array.isArray(effects)) throw new TypeError(`${name} must be an array.`);
	const result = effects.map((effect, index) => {
		if (!effect || typeof effect !== 'object') throw new TypeError(`${name}[${index}] must be an effect.`);
		nonEmptyString(effect.id, `${name}[${index}].id`);
		nonEmptyString(effect.type, `${name}[${index}].type`);
		if (!effect.params || typeof effect.params !== 'object' || Array.isArray(effect.params)) {
			throw new TypeError(`${name}[${index}].params must be an object.`);
		}
		return {
			...plainClone(effect),
			enabled: effect.enabled !== false,
			params: plainClone(effect.params),
		};
	});
	assertUniqueIds(result, name);
	return result;
}

function defaultSpectrogram(sampleRate = AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE) {
	return {
		scale: 'mel',
		minimumFrequency: 0,
		maximumFrequency: Math.min(20_000, sampleRate / 2),
		windowSize: 2048,
		windowType: 'hann',
		gain: 20,
		range: 80,
	};
}

function normalizeSpectrogram(value = {}, sampleRate = AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE, name = 'spectrogram') {
	const defaults = defaultSpectrogram(sampleRate);
	const minimumFrequency = finiteInRange(value.minimumFrequency ?? defaults.minimumFrequency, 0, sampleRate / 2, `${name}.minimumFrequency`);
	const maximumFrequency = finiteInRange(value.maximumFrequency ?? defaults.maximumFrequency, 0, sampleRate / 2, `${name}.maximumFrequency`);
	if (maximumFrequency <= minimumFrequency) throw new RangeError(`${name} must have a positive frequency range.`);
	const windowSize = safeInteger(value.windowSize ?? defaults.windowSize, 32, `${name}.windowSize`);
	if ((windowSize & (windowSize - 1)) !== 0) throw new RangeError(`${name}.windowSize must be a power of two.`);
	return {
		...plainClone(value),
		scale: nonEmptyString(value.scale ?? defaults.scale, `${name}.scale`),
		minimumFrequency,
		maximumFrequency,
		windowSize,
		windowType: nonEmptyString(value.windowType ?? defaults.windowType, `${name}.windowType`),
		gain: finiteInRange(value.gain ?? defaults.gain, -120, 120, `${name}.gain`),
		range: finiteInRange(value.range ?? defaults.range, 1, 240, `${name}.range`),
	};
}

/** @returns {AudioEditorSourceV2} */
export function createAudioSourceV2(options = {}) {
	const sampleRate = safeInteger(options.sampleRate ?? AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE, 1, 'source.sampleRate');
	return {
		id: options.id || createStableId('source'),
		name: String(options.name || 'Audio source'),
		mimeType: String(options.mimeType || 'audio/wav'),
		storageKey: nonEmptyString(String(options.storageKey || options.id || createStableId('pcm')), 'source.storageKey'),
		frameCount: safeInteger(options.frameCount, 1, 'source.frameCount'),
		channelCount: safeInteger(options.channelCount, 1, 'source.channelCount'),
		sampleRate,
		originalSampleRate: safeInteger(options.originalSampleRate ?? sampleRate, 1, 'source.originalSampleRate'),
		sampleFormat: oneOf(options.sampleFormat ?? 'float32', SAMPLE_FORMAT_SET, 'source.sampleFormat'),
		chunkFrames: safeInteger(options.chunkFrames ?? AUDIO_EDITOR_SOURCE_CHUNK_FRAMES, 1, 'source.chunkFrames'),
		opaqueExtensions: plainClone(options.opaqueExtensions ?? {}),
	};
}

/** @returns {AudioEditorClipV2} */
export function createAudioClipV2(options = {}) {
	const durationFrames = safeInteger(options.durationFrames, 1, 'clip.durationFrames');
	const sourceDurationFrames = safeInteger(options.sourceDurationFrames ?? durationFrames, 1, 'clip.sourceDurationFrames');
	const fadeInFrames = safeInteger(options.fadeInFrames ?? 0, 0, 'clip.fadeInFrames');
	const fadeOutFrames = safeInteger(options.fadeOutFrames ?? 0, 0, 'clip.fadeOutFrames');
	if (fadeInFrames > durationFrames || fadeOutFrames > durationFrames) {
		throw new RangeError('Clip fades cannot be longer than the clip.');
	}
	const envelope = normalizeEnvelope(options.envelope || [], 'clip.envelope');
	if (envelope.some((point) => point.frame > durationFrames)) {
		throw new RangeError('Clip envelope points must be inside the active clip range.');
	}
	return {
		id: options.id || createStableId('clip'),
		sourceId: nonEmptyString(options.sourceId, 'clip.sourceId'),
		title: String(options.title || 'Audio clip'),
		timelineStartFrame: safeInteger(options.timelineStartFrame ?? 0, 0, 'clip.timelineStartFrame'),
		sourceStartFrame: safeInteger(options.sourceStartFrame ?? 0, 0, 'clip.sourceStartFrame'),
		sourceDurationFrames,
		durationFrames,
		trimStartFrames: safeInteger(options.trimStartFrames ?? 0, 0, 'clip.trimStartFrames'),
		trimEndFrames: safeInteger(options.trimEndFrames ?? 0, 0, 'clip.trimEndFrames'),
		gain: finiteInRange(options.gain ?? 1, 0, 16, 'clip.gain'),
		fadeInFrames,
		fadeOutFrames,
		reversed: Boolean(options.reversed),
		envelope,
		groupId: options.groupId == null ? null : nonEmptyString(options.groupId, 'clip.groupId'),
		color: nonEmptyString(options.color || 'auto', 'clip.color'),
		pitchCents: finiteInRange(options.pitchCents ?? 0, -1_200, 1_200, 'clip.pitchCents'),
		speedRatio: finiteInRange(options.speedRatio ?? 1, 0.001, 1_000, 'clip.speedRatio'),
		preserveFormants: Boolean(options.preserveFormants),
		stretchToTempo: Boolean(options.stretchToTempo),
		renderCacheRevision: safeInteger(options.renderCacheRevision ?? 0, 0, 'clip.renderCacheRevision'),
		opaqueExtensions: plainClone(options.opaqueExtensions ?? {}),
	};
}

/** @returns {AudioEditorAudioTrackV2} */
export function createAudioTrackV2(options = {}) {
	const sampleRate = safeInteger(options.sampleRate ?? AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE, 1, 'track.sampleRate');
	const channelCount = safeInteger(options.channelCount ?? 2, 1, 'track.channelCount');
	return {
		type: 'audio',
		id: options.id || createStableId('track'),
		name: String(options.name || 'Audio track'),
		gain: finiteInRange(options.gain ?? 1, 0, 4, 'track.gain'),
		pan: finiteInRange(options.pan ?? 0, -1, 1, 'track.pan'),
		mute: Boolean(options.mute),
		solo: Boolean(options.solo),
		armed: Boolean(options.armed),
		channelCount,
		channelLayout: nonEmptyString(options.channelLayout || (channelCount === 1 ? 'mono' : channelCount === 2 ? 'stereo' : 'custom'), 'track.channelLayout'),
		sampleRate,
		sampleFormat: oneOf(options.sampleFormat ?? 'float32', SAMPLE_FORMAT_SET, 'track.sampleFormat'),
		displayMode: oneOf(options.displayMode ?? 'waveform', DISPLAY_MODE_SET, 'track.displayMode'),
		color: nonEmptyString(options.color || 'auto', 'track.color'),
		spectrogram: normalizeSpectrogram(options.spectrogram || {}, sampleRate, 'track.spectrogram'),
		envelope: normalizeEnvelope(options.envelope || [], 'track.envelope'),
		effects: normalizeEffects(options.effects || [], 'track.effects'),
		clipIds: uniqueStrings(options.clipIds || [], 'track.clipIds'),
		collapsed: Boolean(options.collapsed),
		height: safeInteger(options.height ?? 160, 40, 'track.height'),
		opaqueExtensions: plainClone(options.opaqueExtensions ?? {}),
	};
}

export function createLabelV2(options = {}) {
	const startFrame = safeInteger(options.startFrame ?? 0, 0, 'label.startFrame');
	const endFrame = safeInteger(options.endFrame ?? startFrame, 0, 'label.endFrame');
	if (endFrame < startFrame) throw new RangeError('label.endFrame cannot precede label.startFrame.');
	return {
		id: options.id || createStableId('label'),
		title: String(options.title || ''),
		startFrame,
		endFrame,
		color: nonEmptyString(options.color || 'auto', 'label.color'),
		opaqueExtensions: plainClone(options.opaqueExtensions ?? {}),
	};
}

/** @returns {AudioEditorLabelTrackV2} */
export function createLabelTrackV2(options = {}) {
	const labels = (options.labels || []).map(createLabelV2);
	assertUniqueIds(labels, 'label');
	return {
		type: 'label',
		id: options.id || createStableId('label-track'),
		name: String(options.name || 'Labels'),
		labels,
		collapsed: Boolean(options.collapsed),
		height: safeInteger(options.height ?? 96, 40, 'track.height'),
		opaqueExtensions: plainClone(options.opaqueExtensions ?? {}),
	};
}

function createTempo(value = {}) {
	const numerator = safeInteger(value.timeSignature?.numerator ?? 4, 1, 'tempo.timeSignature.numerator');
	const denominator = safeInteger(value.timeSignature?.denominator ?? 4, 1, 'tempo.timeSignature.denominator');
	if ((denominator & (denominator - 1)) !== 0) throw new RangeError('tempo.timeSignature.denominator must be a power of two.');
	return {
		bpm: finiteInRange(value.bpm ?? 120, 1, 1_000, 'tempo.bpm'),
		timeSignature: { numerator, denominator },
		detected: Boolean(value.detected),
	};
}

function createMetadata(value = {}, projectTitle = '') {
	const tags = value.tags ?? {};
	if (!tags || typeof tags !== 'object' || Array.isArray(tags)) throw new TypeError('metadata.tags must be an object.');
	const normalizedTags = {};
	for (const [key, tagValue] of Object.entries(tags)) {
		normalizedTags[nonEmptyString(key, 'metadata tag name')] = String(tagValue ?? '');
	}
	return {
		title: String(value.title ?? projectTitle),
		artist: String(value.artist ?? ''),
		album: String(value.album ?? ''),
		trackNumber: String(value.trackNumber ?? ''),
		year: String(value.year ?? ''),
		comments: String(value.comments ?? ''),
		tags: normalizedTags,
	};
}

function createSelection(value = {}, sampleRate = AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE) {
	const startFrame = safeInteger(value.startFrame ?? 0, 0, 'selection.startFrame');
	const endFrame = safeInteger(value.endFrame ?? startFrame, 0, 'selection.endFrame');
	if (endFrame < startFrame) throw new RangeError('selection.endFrame cannot precede selection.startFrame.');
	let frequencyRange = null;
	if (value.frequencyRange != null) {
		const minimumFrequency = finiteInRange(value.frequencyRange.minimumFrequency, 0, sampleRate / 2, 'selection.frequencyRange.minimumFrequency');
		const maximumFrequency = finiteInRange(value.frequencyRange.maximumFrequency, 0, sampleRate / 2, 'selection.frequencyRange.maximumFrequency');
		if (maximumFrequency <= minimumFrequency) throw new RangeError('Selection frequency range must have a positive width.');
		frequencyRange = { minimumFrequency, maximumFrequency };
	}
	return {
		startFrame,
		endFrame,
		trackIds: uniqueStrings(value.trackIds || [], 'selection.trackIds'),
		clipIds: uniqueStrings(value.clipIds || [], 'selection.clipIds'),
		frequencyRange,
	};
}

function createLoop(value = {}) {
	const startFrame = safeInteger(value.startFrame ?? 0, 0, 'loop.startFrame');
	const endFrame = safeInteger(value.endFrame ?? startFrame, 0, 'loop.endFrame');
	if (endFrame < startFrame) throw new RangeError('loop.endFrame cannot precede loop.startFrame.');
	if (value.enabled && endFrame === startFrame) throw new RangeError('An enabled loop must have a positive duration.');
	return { enabled: Boolean(value.enabled), startFrame, endFrame };
}

function createView(value = {}) {
	return {
		scrollFrame: safeInteger(value.scrollFrame ?? 0, 0, 'view.scrollFrame'),
		pixelsPerSecond: finiteInRange(value.pixelsPerSecond ?? 100, 0.001, 1_000_000, 'view.pixelsPerSecond'),
		playheadFrame: safeInteger(value.playheadFrame ?? 0, 0, 'view.playheadFrame'),
		zoom: finiteInRange(value.zoom ?? value.pixelsPerSecond ?? 100, 0.001, 1_000_000, 'view.zoom'),
		horizontalPosition: finiteInRange(value.horizontalPosition ?? 0, 0, Number.MAX_SAFE_INTEGER, 'view.horizontalPosition'),
		verticalPosition: safeInteger(value.verticalPosition ?? 0, 0, 'view.verticalPosition'),
		selectedTrackIds: uniqueStrings(value.selectedTrackIds || [], 'view.selectedTrackIds'),
		panelState: plainClone(value.panelState ?? {}),
	};
}

/** @returns {AudioEditorProjectV2} */
export function createAudioEditorProjectV2(options = {}) {
	const timestamp = isoTimestamp(options.now ?? options.createdAt);
	const updatedAt = options.updatedAt === undefined ? timestamp : isoTimestamp(options.updatedAt);
	const title = String(options.title || 'Untitled project').trim() || 'Untitled project';
	const sampleRate = safeInteger(options.sampleRate ?? AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE, 1, 'project.sampleRate');
	const tracks = (options.tracks || []).map((track) => {
		if (!track || !TRACK_TYPE_SET.has(track.type)) throw new RangeError(`Unsupported track type: ${track?.type}.`);
		return track.type === 'label' ? createLabelTrackV2(track) : createAudioTrackV2(track);
	});
	const masterEffects = normalizeEffects(options.master?.effects || [], 'master.effects');
	return {
		schemaVersion: AUDIO_EDITOR_PROJECT_SCHEMA_VERSION,
		id: options.id || createStableId('project'),
		title,
		revision: safeInteger(options.revision ?? 0, 0, 'project.revision'),
		createdAt: timestamp,
		updatedAt,
		sampleRate,
		masterChannels: safeInteger(options.masterChannels ?? AUDIO_EDITOR_PROJECT_DEFAULT_MASTER_CHANNELS, 1, 'project.masterChannels'),
		tempo: createTempo(options.tempo),
		snap: {
			enabled: Boolean(options.snap?.enabled),
			unit: nonEmptyString(options.snap?.unit || 'seconds', 'snap.unit'),
			mode: nonEmptyString(options.snap?.mode || 'nearest', 'snap.mode'),
			triplets: Boolean(options.snap?.triplets),
			division: nonEmptyString(options.snap?.division || options.snap?.unit || 'seconds', 'snap.division'),
			opaqueType: safeInteger(options.snap?.opaqueType ?? 0, 0, 'snap.opaqueType'),
		},
		timeDisplay: { format: nonEmptyString(options.timeDisplay?.format || 'hh:mm:ss+milliseconds', 'timeDisplay.format') },
		metadata: createMetadata(options.metadata, title),
		selection: createSelection(options.selection, sampleRate),
		loop: createLoop(options.loop),
		view: createView(options.view),
		sources: (options.sources || []).map(createAudioSourceV2),
		clips: (options.clips || []).map(createAudioClipV2),
		tracks,
		master: {
			gain: finiteInRange(options.master?.gain ?? 1, 0, 4, 'master.gain'),
			pan: finiteInRange(options.master?.pan ?? 0, -1, 1, 'master.pan'),
			effects: masterEffects,
		},
		opaqueExtensions: plainClone(options.opaqueExtensions ?? {}),
	};
}

/** @param {AudioEditorProjectV2} project @returns {AudioEditorProjectV2} */
export function cloneAudioEditorProjectV2(project) {
	return plainClone(project);
}

/** @param {AudioEditorProjectV2} project @returns {true} */
export function validateAudioEditorProjectV2(project) {
	if (!project || typeof project !== 'object') throw new TypeError('An audio editor project is required.');
	if (project.schemaVersion !== AUDIO_EDITOR_PROJECT_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported audio editor schema version: ${project.schemaVersion}.`);
	}
	nonEmptyString(project.id, 'project.id');
	nonEmptyString(project.title, 'project.title');
	isoTimestamp(project.createdAt);
	isoTimestamp(project.updatedAt);
	if (!Array.isArray(project.sources) || !Array.isArray(project.clips) || !Array.isArray(project.tracks)) {
		throw new TypeError('Project sources, clips, and tracks must be arrays.');
	}
	for (const name of ['tempo', 'snap', 'timeDisplay', 'metadata', 'selection', 'loop', 'view', 'master']) {
		if (!project[name] || typeof project[name] !== 'object' || Array.isArray(project[name])) {
			throw new TypeError(`project.${name} must be an object.`);
		}
	}
	assertUniqueIds(project.sources, 'source');
	assertUniqueIds(project.clips, 'clip');
	assertUniqueIds(project.tracks, 'track');
	for (const source of project.sources) nonEmptyString(source.storageKey, `source ${source.id}.storageKey`);
	for (const track of project.tracks) {
		if (!TRACK_TYPE_SET.has(track.type)) throw new RangeError(`Unsupported track type: ${track.type}.`);
		if (track.type === 'label') {
			if (!Array.isArray(track.labels)) throw new TypeError(`Label track ${track.id} must contain labels.`);
			assertUniqueIds(track.labels, 'label');
		}
	}
	const normalized = createAudioEditorProjectV2({ ...project, now: project.createdAt });
	const sourceById = new Map(normalized.sources.map((source) => [source.id, source]));
	const clipById = new Map(normalized.clips.map((clip) => [clip.id, clip]));
	const trackIds = new Set(normalized.tracks.map((track) => track.id));
	const assignedClipIds = new Set();
	let armedTracks = 0;

	for (const clip of normalized.clips) {
		const source = sourceById.get(clip.sourceId);
		if (!source) throw new ReferenceError(`Clip ${clip.id} references a missing source.`);
		if (clip.sourceStartFrame + clip.sourceDurationFrames > source.frameCount) {
			throw new RangeError(`Clip ${clip.id} exceeds its source bounds.`);
		}
		if (clip.trimStartFrames > clip.sourceStartFrame) {
			throw new RangeError(`Clip ${clip.id} has an invalid leading trim range.`);
		}
		if (clip.sourceStartFrame + clip.sourceDurationFrames + clip.trimEndFrames > source.frameCount) {
			throw new RangeError(`Clip ${clip.id} has an invalid trailing trim range.`);
		}
	}

	for (const track of normalized.tracks) {
		if (track.type === 'label') continue;
		if (track.armed) armedTracks += 1;
		const trackClips = [];
		for (const clipId of track.clipIds) {
			const clip = clipById.get(clipId);
			if (!clip) throw new ReferenceError(`Track ${track.id} references a missing clip.`);
			if (assignedClipIds.has(clipId)) throw new RangeError(`Clip ${clipId} is assigned to more than one track.`);
			assignedClipIds.add(clipId);
			trackClips.push(clip);
		}
		trackClips.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame);
		for (let index = 1; index < trackClips.length; index += 1) {
			if (clipEndFrameV2(trackClips[index - 1]) > trackClips[index].timelineStartFrame) {
				throw new RangeError(`Clips overlap on track ${track.id}.`);
			}
		}
	}
	if (assignedClipIds.size !== normalized.clips.length) throw new RangeError('Every clip must belong to exactly one audio track.');
	if (armedTracks > 1) throw new RangeError('Only one audio track can be armed at a time.');

	for (const trackId of [...normalized.selection.trackIds, ...normalized.view.selectedTrackIds]) {
		if (!trackIds.has(trackId)) throw new ReferenceError(`Project state references missing track ${trackId}.`);
	}
	for (const clipId of normalized.selection.clipIds) {
		if (!clipById.has(clipId)) throw new ReferenceError(`Selection references missing clip ${clipId}.`);
	}
	return true;
}

export function clipEndFrameV2(clip) {
	return clip.timelineStartFrame + clip.durationFrames;
}

export function projectDurationFramesV2(project) {
	let endFrame = project.clips.reduce((maximum, clip) => Math.max(maximum, clipEndFrameV2(clip)), 0);
	for (const track of project.tracks) {
		if (track.type !== 'label') continue;
		for (const label of track.labels) endFrame = Math.max(endFrame, label.endFrame);
	}
	return endFrame;
}

function assertUniqueIds(items, type) {
	const ids = new Set();
	for (const item of items) {
		if (!item || typeof item.id !== 'string' || !item.id) throw new TypeError(`Every ${type} needs an ID.`);
		if (ids.has(item.id)) throw new RangeError(`Duplicate ${type} ID: ${item.id}.`);
		ids.add(item.id);
	}
}

export function loadAudioEditorProjectV2(value) {
	if (!value || typeof value !== 'object') throw new TypeError('A saved project is required.');
	const schemaVersion = Number(value.schemaVersion);
	if (schemaVersion > AUDIO_EDITOR_PROJECT_SCHEMA_VERSION) {
		return { project: plainClone(value), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV2(value);
	return { project: cloneAudioEditorProjectV2(value), readOnly: false, reason: null };
}
