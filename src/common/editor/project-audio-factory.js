/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeEffect } from './effects.js';
import { createStableId } from './stable-id.js';

export const AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE = 48_000;
export const AUDIO_EDITOR_PROJECT_DEFAULT_MASTER_CHANNELS = 2;
export const AUDIO_EDITOR_SOURCE_CHUNK_FRAMES = 65_536;

export const AUDIO_EDITOR_TRACK_TYPES = Object.freeze(['audio', 'label']);
export const AUDIO_EDITOR_SAMPLE_FORMATS = Object.freeze([
	'int16',
	'int24',
	'int32',
	'float32',
	'float64',
	'unknown',
]);
export const AUDIO_EDITOR_DISPLAY_MODES = Object.freeze([
	'waveform',
	'spectrogram',
	'multiview',
	'half-wave',
]);
export const AUDIO_EDITOR_TRACK_COLORS = Object.freeze([
	'blue',
	'violet',
	'magenta',
	'teal',
	'cyan',
	'green',
	'orange',
	'red',
	'yellow',
]);

const SAMPLE_FORMAT_SET = new Set(AUDIO_EDITOR_SAMPLE_FORMATS);
const DISPLAY_MODE_SET = new Set(AUDIO_EDITOR_DISPLAY_MODES);

function clone(value) {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function nonEmptyString(value, name) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new TypeError(`${name} must be a non-empty string.`);
	}
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
		...clone(point),
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
		const normalized = {
			...clone(effect),
			enabled: effect.enabled !== false,
			params: clone(effect.params),
		};
		if (normalized.type === 'missing') return normalizeEffect(normalized);
		if (!['eq', 'parametric-eq', 'parametric_eq'].includes(normalized.type)) return normalized;
		return { ...normalized, ...normalizeEffect(normalized) };
	});
	assertUniqueIds(result, name);
	return result;
}

export function createAudioMixerBus(value = {}, type = 'group', index = 0) {
	if (type !== 'group' && type !== 'send') throw new RangeError(`Unsupported mixer bus type: ${type}.`);
	const label = type === 'send' ? 'Send' : 'Group';
	return {
		id: value.id || createStableId(`${type}-bus`),
		name: String(value.name || `${label} ${index + 1}`).trim() || `${label} ${index + 1}`,
		color: nonEmptyString(
			value.color || (type === 'send' ? '#8c6fd1' : '#4f87c8'),
			`mixer.${type}.color`,
		),
		gain: finiteInRange(value.gain ?? 1, 0, 4, `mixer.${type}.gain`),
		pan: finiteInRange(value.pan ?? 0, -1, 1, `mixer.${type}.pan`),
		mute: Boolean(value.mute),
		solo: Boolean(value.solo),
		envelope: normalizeEnvelope(value.envelope || [], `mixer.${type}.envelope`),
		collapsed: value.collapsed === undefined ? true : Boolean(value.collapsed),
		effectsActive: value.effectsActive !== false,
		effects: normalizeEffects(value.effects || [], `mixer.${type}.effects`),
	};
}

export function createAudioMaster(value = {}) {
	return {
		gain: finiteInRange(value.gain ?? 1, 0, 4, 'master.gain'),
		pan: finiteInRange(value.pan ?? 0, -1, 1, 'master.pan'),
		mute: Boolean(value.mute),
		solo: Boolean(value.solo),
		envelope: normalizeEnvelope(value.envelope || [], 'master.envelope'),
		collapsed: value.collapsed === undefined ? true : Boolean(value.collapsed),
		effectsActive: value.effectsActive !== false,
		effects: normalizeEffects(value.effects || [], 'master.effects'),
	};
}

export function normalizeAudioMixer(value = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('project.mixer must be an object.');
	}
	const groups = (value.groups || []).map((bus, index) => createAudioMixerBus(bus, 'group', index));
	const sends = (value.sends || []).map((bus, index) => createAudioMixerBus(bus, 'send', index));
	assertUniqueIds([...groups, ...sends], 'mixer bus');
	const groupIds = new Set(groups.map((bus) => bus.id));
	const sendIds = new Set(sends.map((bus) => bus.id));
	const routes = {};
	if (!value.routes || typeof value.routes !== 'object' || Array.isArray(value.routes)) {
		if (value.routes != null) throw new TypeError('project.mixer.routes must be an object.');
	} else for (const [trackId, route] of Object.entries(value.routes)) {
		nonEmptyString(trackId, 'mixer route track ID');
		if (!route || typeof route !== 'object' || Array.isArray(route)) {
			throw new TypeError(`mixer.routes.${trackId} must be an object.`);
		}
		const groupId = route.groupId == null
			? null
			: nonEmptyString(route.groupId, `mixer.routes.${trackId}.groupId`);
		if (groupId && !groupIds.has(groupId)) {
			throw new ReferenceError(`Mixer route references missing group bus ${groupId}.`);
		}
		const routeSends = {};
		if (!route.sends || typeof route.sends !== 'object' || Array.isArray(route.sends)) {
			if (route.sends != null) throw new TypeError(`mixer.routes.${trackId}.sends must be an object.`);
		} else for (const [sendId, gain] of Object.entries(route.sends)) {
			if (!sendIds.has(sendId)) throw new ReferenceError(`Mixer route references missing send bus ${sendId}.`);
			routeSends[sendId] = finiteInRange(gain, 0, 4, `mixer.routes.${trackId}.sends.${sendId}`);
		}
		routes[trackId] = { groupId, sends: routeSends };
	}
	return { groups, sends, routes };
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

function normalizeSpectrogram(
	value = {},
	sampleRate = AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE,
	name = 'spectrogram',
) {
	const defaults = defaultSpectrogram(sampleRate);
	const minimumFrequency = finiteInRange(
		value.minimumFrequency ?? defaults.minimumFrequency,
		0,
		sampleRate / 2,
		`${name}.minimumFrequency`,
	);
	const maximumFrequency = finiteInRange(
		value.maximumFrequency ?? defaults.maximumFrequency,
		0,
		sampleRate / 2,
		`${name}.maximumFrequency`,
	);
	if (maximumFrequency <= minimumFrequency) throw new RangeError(`${name} must have a positive frequency range.`);
	const windowSize = safeInteger(value.windowSize ?? defaults.windowSize, 32, `${name}.windowSize`);
	if ((windowSize & (windowSize - 1)) !== 0) throw new RangeError(`${name}.windowSize must be a power of two.`);
	return {
		...clone(value),
		scale: nonEmptyString(value.scale ?? defaults.scale, `${name}.scale`),
		minimumFrequency,
		maximumFrequency,
		windowSize,
		windowType: nonEmptyString(value.windowType ?? defaults.windowType, `${name}.windowType`),
		gain: finiteInRange(value.gain ?? defaults.gain, -120, 120, `${name}.gain`),
		range: finiteInRange(value.range ?? defaults.range, 1, 240, `${name}.range`),
	};
}

export function createAudioSource(options = {}) {
	const sampleRate = safeInteger(
		options.sampleRate ?? AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE,
		1,
		'source.sampleRate',
	);
	return {
		id: options.id || createStableId('source'),
		name: String(options.name || 'Audio source'),
		mimeType: String(options.mimeType || 'audio/wav'),
		storageKey: nonEmptyString(
			String(options.storageKey || options.id || createStableId('pcm')),
			'source.storageKey',
		),
		frameCount: safeInteger(options.frameCount, 1, 'source.frameCount'),
		channelCount: safeInteger(options.channelCount, 1, 'source.channelCount'),
		sampleRate,
		originalSampleRate: safeInteger(options.originalSampleRate ?? sampleRate, 1, 'source.originalSampleRate'),
		sampleFormat: oneOf(options.sampleFormat ?? 'float32', SAMPLE_FORMAT_SET, 'source.sampleFormat'),
		chunkFrames: safeInteger(options.chunkFrames ?? AUDIO_EDITOR_SOURCE_CHUNK_FRAMES, 1, 'source.chunkFrames'),
		opaqueExtensions: clone(options.opaqueExtensions ?? {}),
	};
}

export function createAudioClip(options = {}) {
	const durationFrames = safeInteger(options.durationFrames, 1, 'clip.durationFrames');
	const sourceDurationFrames = safeInteger(
		options.sourceDurationFrames ?? durationFrames,
		1,
		'clip.sourceDurationFrames',
	);
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
		opaqueExtensions: clone(options.opaqueExtensions ?? {}),
	};
}

export function createAudioTrack(
	options = {},
	projectSampleRate = AUDIO_EDITOR_PROJECT_DEFAULT_SAMPLE_RATE,
) {
	const sampleRate = safeInteger(projectSampleRate, 1, 'project.sampleRate');
	return {
		type: 'audio',
		id: options.id || createStableId('track'),
		name: String(options.name || 'Audio track'),
		gain: finiteInRange(options.gain ?? 1, 0, 4, 'track.gain'),
		pan: finiteInRange(options.pan ?? 0, -1, 1, 'track.pan'),
		mute: Boolean(options.mute),
		solo: Boolean(options.solo),
		armed: Boolean(options.armed),
		displayMode: oneOf(options.displayMode ?? 'waveform', DISPLAY_MODE_SET, 'track.displayMode'),
		color: nonEmptyString(
			options.color && options.color !== 'auto' ? options.color : AUDIO_EDITOR_TRACK_COLORS[0],
			'track.color',
		),
		spectrogram: normalizeSpectrogram(options.spectrogram || {}, sampleRate, 'track.spectrogram'),
		envelope: normalizeEnvelope(options.envelope || [], 'track.envelope'),
		effectsActive: options.effectsActive !== false,
		effects: normalizeEffects(options.effects || [], 'track.effects'),
		clipIds: uniqueStrings(options.clipIds || [], 'track.clipIds'),
		collapsed: Boolean(options.collapsed),
		height: safeInteger(options.height ?? 160, 40, 'track.height'),
		opaqueExtensions: clone(options.opaqueExtensions ?? {}),
	};
}

export function createLabel(options = {}) {
	const startFrame = safeInteger(options.startFrame ?? 0, 0, 'label.startFrame');
	const endFrame = safeInteger(options.endFrame ?? startFrame, 0, 'label.endFrame');
	if (endFrame < startFrame) throw new RangeError('label.endFrame cannot precede label.startFrame.');
	return {
		id: options.id || createStableId('label'),
		title: String(options.title || ''),
		startFrame,
		endFrame,
		color: nonEmptyString(options.color || 'auto', 'label.color'),
		opaqueExtensions: clone(options.opaqueExtensions ?? {}),
	};
}

export function createLabelTrack(options = {}) {
	const labels = (options.labels || []).map(createLabel);
	assertUniqueIds(labels, 'label');
	return {
		type: 'label',
		id: options.id || createStableId('label-track'),
		name: String(options.name || 'Labels'),
		labels,
		collapsed: Boolean(options.collapsed),
		height: safeInteger(options.height ?? 96, 40, 'track.height'),
		opaqueExtensions: clone(options.opaqueExtensions ?? {}),
	};
}

export function audioTrackChannelCount(project, track, fallback = 0) {
	if (!track || track.type === 'label') return fallback;
	const clipById = new Map((project?.clips || []).map((clip) => [clip.id, clip]));
	const sourceById = new Map((project?.sources || []).map((source) => [source.id, source]));
	let channelCount = 0;
	for (const clipId of track.clipIds || []) {
		const source = sourceById.get(clipById.get(clipId)?.sourceId);
		if (source) channelCount = Math.max(channelCount, Number(source.channelCount) || 0);
	}
	return channelCount || fallback;
}

function assertUniqueIds(items, type) {
	const ids = new Set();
	for (const item of items) {
		if (!item || typeof item.id !== 'string' || !item.id) throw new TypeError(`Every ${type} needs an ID.`);
		if (ids.has(item.id)) throw new RangeError(`Duplicate ${type} ID: ${item.id}.`);
		ids.add(item.id);
	}
}
