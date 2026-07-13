import {
	audacityXmlAttribute,
	audacityXmlChildren,
	createAudacityXmlNode,
} from './audacity-binary-xml.js';
import { createAup4EffectsNode } from './aup4-effects.js';
import { sanitizeAup4ProjectRoot } from './aup4-sanitization.js';

export const AUP4_APPLICATION_ID = 0x41554459;
export const AUP4_USER_VERSION = 0x04000001;
export const AUP4_BINARY_XML_VERSION = '2.0.0';
export const AUP4_AUDACITY_VERSION = '4.0.0';
export const AUP4_SAMPLE_FORMAT_FLOAT32 = 0x0004000f;
export const AUP4_MAX_BLOCK_SAMPLES = 262_144;
export const AUP4_HISTORY_DEPTH = 10;
export const AUP4_UPSTREAM_COMMIT = '908ad0a526e5bfdab68de780e893cebe172d27eb';
const FLOAT32_MAX = 3.4028234663852886e38;

export const AUP4_SCHEMA_SQL = `
	PRAGMA application_id = ${AUP4_APPLICATION_ID};
	PRAGMA user_version = ${AUP4_USER_VERSION};
	PRAGMA journal_mode = DELETE;
	CREATE TABLE IF NOT EXISTS project (
		id INTEGER PRIMARY KEY,
		dict BLOB,
		doc BLOB
	);
	CREATE TABLE IF NOT EXISTS autosave (
		id INTEGER PRIMARY KEY,
		dict BLOB,
		doc BLOB
	);
	CREATE TABLE IF NOT EXISTS sampleblocks (
		blockid INTEGER PRIMARY KEY AUTOINCREMENT,
		sampleformat INTEGER,
		summin REAL,
		summax REAL,
		sumrms REAL,
		summary256 BLOB,
		summary64k BLOB,
		samples BLOB
	);
	CREATE TABLE IF NOT EXISTS project_history (
		generation INTEGER PRIMARY KEY AUTOINCREMENT,
		saved_at INTEGER,
		dict BLOB,
		doc BLOB
	);
`;

export const AUP4_ALLOWED_USER_SCHEMA = Object.freeze({
	project: Object.freeze(['id', 'dict', 'doc']),
	autosave: Object.freeze(['id', 'dict', 'doc']),
	sampleblocks: Object.freeze(['blockid', 'sampleformat', 'summin', 'summax', 'sumrms', 'summary256', 'summary64k', 'samples']),
	project_history: Object.freeze(['generation', 'saved_at', 'dict', 'doc']),
});

export class Aup4Error extends Error {
	constructor(message, code = 'AUP4_ERROR', options) {
		super(message, options);
		this.name = 'Aup4Error';
		this.code = code;
	}
}

export function createAup4SampleBlock(input) {
	const samples = normalizeSamples(input);
	if (!samples.length || samples.length > AUP4_MAX_BLOCK_SAMPLES) {
		throw new Aup4Error(`AUP4 sample blocks must contain 1 to ${AUP4_MAX_BLOCK_SAMPLES} samples.`, 'INVALID_SAMPLE_COUNT');
	}
	const frames64k = Math.ceil(samples.length / 65_536);
	const frames256 = frames64k * 256;
	const usefulFrames256 = Math.ceil(samples.length / 256);
	const summary256 = new Float32Array(frames256 * 3);
	let totalSquares = 0;
	let fraction = 0;
	let usefulFinalSummaries = 256;

	for (let frame = 0; frame < usefulFrames256; frame += 1) {
		const start = frame * 256;
		const count = Math.min(256, samples.length - start);
		let minimum = samples[start];
		let maximum = samples[start];
		let squareSum = Math.fround(Math.fround(minimum) * Math.fround(minimum));
		if (count < 256) fraction = 1 - count / 256;
		for (let index = 1; index < count; index += 1) {
			const sample = samples[start + index];
			squareSum = Math.fround(squareSum + Math.fround(sample * sample));
			if (sample < minimum) minimum = sample;
			else if (sample > maximum) maximum = sample;
		}
		totalSquares += squareSum;
		const offset = frame * 3;
		summary256[offset] = minimum;
		summary256[offset + 1] = maximum;
		summary256[offset + 2] = Math.fround(Math.sqrt(squareSum / count));
	}

	for (let frame = usefulFrames256; frame < frames256; frame += 1) {
		usefulFinalSummaries -= 1;
		const offset = frame * 3;
		summary256[offset] = FLOAT32_MAX;
		summary256[offset + 1] = -FLOAT32_MAX;
		summary256[offset + 2] = 0;
	}

	const summary64k = new Float32Array(frames64k * 3);
	for (let frame = 0; frame < frames64k; frame += 1) {
		const start = frame * 256 * 3;
		let minimum = summary256[start];
		let maximum = summary256[start + 1];
		let squareSum = Math.fround(summary256[start + 2] * summary256[start + 2]);
		for (let index = 1; index < 256; index += 1) {
			const offset = start + index * 3;
			if (summary256[offset] < minimum) minimum = summary256[offset];
			if (summary256[offset + 1] > maximum) maximum = summary256[offset + 1];
			const rms = summary256[offset + 2];
			squareSum = Math.fround(squareSum + Math.fround(rms * rms));
		}
		const denominator = frame < frames64k - 1 ? 256 : usefulFinalSummaries - fraction;
		const offset = frame * 3;
		summary64k[offset] = minimum;
		summary64k[offset + 1] = maximum;
		summary64k[offset + 2] = Math.fround(Math.sqrt(squareSum / denominator));
	}

	let summin = summary64k[0];
	let summax = summary64k[1];
	for (let frame = 1; frame < frames64k; frame += 1) {
		summin = Math.min(summin, summary64k[frame * 3]);
		summax = Math.max(summax, summary64k[frame * 3 + 1]);
	}
	return {
		sampleformat: AUP4_SAMPLE_FORMAT_FLOAT32,
		summin,
		summax,
		sumrms: Math.sqrt(totalSquares / samples.length),
		summary256: float32ToLittleEndianBytes(summary256),
		summary64k: float32ToLittleEndianBytes(summary64k),
		samples: float32ToLittleEndianBytes(samples),
		sampleCount: samples.length,
	};
}

export function decodeAup4Float32Samples(input) {
	const bytes = toBytes(input);
	if (bytes.byteLength % 4) throw new Aup4Error('AUP4 Float32 sample data is not 4-byte aligned.', 'INVALID_SAMPLE_BLOCK');
	const output = new Float32Array(bytes.byteLength / 4);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let index = 0; index < output.length; index += 1) {
		const value = view.getFloat32(index * 4, true);
		output[index] = Number.isFinite(value) ? value : 0;
	}
	return output;
}

export function getAup4SaveLimit(options = {}) {
	const mebibyte = 1024 * 1024;
	const opfs = options.opfs !== false;
	if (!opfs) return 64 * mebibyte;
	const mobile = Boolean(options.mobile);
	const memory = Number(options.deviceMemory);
	if (mobile || (Number.isFinite(memory) && memory <= 4)) return 128 * mebibyte;
	if (Number.isFinite(memory) && memory >= 8) return 512 * mebibyte;
	return 256 * mebibyte;
}

export function effectiveAup4SaveLimit(options = {}) {
	const deviceLimit = getAup4SaveLimit(options);
	if (options.quota == null || options.usage == null) return deviceLimit;
	const quota = Number(options.quota);
	const usage = Number(options.usage);
	if (!Number.isFinite(quota) || !Number.isFinite(usage)) return deviceLimit;
	const available = Math.max(0, quota - usage);
	const workingBytes = Number(options.workingBytes);
	const reservedHeadroom = Math.max(16 * 1024 * 1024, Number.isFinite(workingBytes) && workingBytes > 0 ? workingBytes : 0);
	return Math.max(0, Math.min(deviceLimit, available - reservedHeadroom));
}

export function validateAup4SchemaObjects(objects, options = {}) {
	if (!Array.isArray(objects)) throw new TypeError('SQLite schema objects must be an array.');
	const unexpected = objects.filter((entry) => {
		const type = String(entry?.type || '');
		const name = String(entry?.name || '');
		const table = String(entry?.table || entry?.tblName || entry?.tbl_name || '');
		const sql = String(entry?.sql || '');
		if (type === 'table' && /\bCREATE\s+VIRTUAL\s+TABLE\b/i.test(sql)) return true;
		if (name.startsWith('sqlite_autoindex_')) {
			return type !== 'index' || !Object.hasOwn(AUP4_ALLOWED_USER_SCHEMA, table);
		}
		if (type === 'table' && (name === 'sqlite_sequence' || Object.hasOwn(AUP4_ALLOWED_USER_SCHEMA, name))) return false;
		if (options.futureReadOnly && type === 'table' && name && !name.startsWith('sqlite_')) return false;
		if (options.futureReadOnly && type === 'index' && table && !table.startsWith('sqlite_')) return false;
		return true;
	});
	if (unexpected.length) {
		throw new Aup4Error(`Unexpected SQLite schema object: ${unexpected[0].type} ${unexpected[0].name}.`, 'UNSAFE_SCHEMA');
	}
	return true;
}

export function inspectAup4Header({ applicationId, userVersion, xmlVersion }) {
	const issues = [];
	let readOnly = false;
	if (Number(applicationId) !== AUP4_APPLICATION_ID) issues.push({ level: 'error', code: 'NOT_AUDACITY_PROJECT', message: 'The SQLite application id is not Audacity.' });
	if (Number(userVersion) > AUP4_USER_VERSION) {
		readOnly = true;
		issues.push({ level: 'warning', code: 'NEWER_DATABASE', message: 'This project uses a newer Audacity database profile and is read-only.' });
	} else if (Number(userVersion) <= 0) issues.push({ level: 'error', code: 'INVALID_DATABASE_VERSION', message: 'The Audacity database profile is invalid.' });
	if (xmlVersion != null && !/^\d+\.\d+\.\d+$/.test(String(xmlVersion))) {
		issues.push({ level: 'error', code: 'INVALID_XML_VERSION', message: 'The Audacity document profile is invalid.' });
	} else if (xmlVersion && compareVersion(xmlVersion, AUP4_BINARY_XML_VERSION) > 0) {
		readOnly = true;
		issues.push({ level: 'warning', code: 'NEWER_XML', message: 'This project uses a newer Audacity document profile and is read-only.' });
	}
	return {
		compatible: !issues.some((issue) => issue.level === 'error'),
		readOnly,
		applicationId: Number(applicationId),
		userVersion: Number(userVersion),
		xmlVersion: xmlVersion || null,
		issues,
	};
}

export function createAup4ProjectTree(project, channelBlocks = new Map()) {
	if (!project || !Array.isArray(project.tracks) || !Array.isArray(project.clips)) throw new TypeError('An audio editor project is required.');
	const sampleRate = positiveRate(project.sampleRate || 48_000);
	const tempo = finiteInRange(project.tempo?.bpm ?? project.tempo ?? 120, 1, 999, 120);
	const timeSignature = project.timeSignature || project.tempo?.timeSignature || {};
	const numerator = integerInRange(timeSignature.numerator, 1, 32, 4);
	const denominator = [1, 2, 4, 8, 16, 32].includes(Number(timeSignature.denominator)) ? Number(timeSignature.denominator) : 4;
	const selectedTrackIds = new Set(project.selection?.trackIds || []);
	const rootAttributes = mergeAttributes([
		attribute('xmlns', 'string', 'http://audacity.sourceforge.net/xml/'),
		attribute('version', 'string', AUP4_BINARY_XML_VERSION),
		attribute('audacityversion', 'string', AUP4_AUDACITY_VERSION),
		attribute('viewstate_zoom', 'double', finite(project.view?.zoom, 86.1328125), -1),
		attribute('viewstate_vpos', 'int', Math.round(finite(project.view?.verticalPosition, 0))),
		attribute('viewstate_hpos', 'double', finite(project.view?.horizontalPosition, 0), -1),
		attribute('snap_enabled', 'bool', Boolean(project.snap?.enabled)),
		attribute('snap_type', 'int', integerInRange(project.snap?.type ?? project.snap?.opaqueType, 0, 255, 0)),
		attribute('snap_triplets', 'bool', Boolean(project.snap?.triplets)),
		attribute('sel0', 'double', framesToSeconds(project.selection?.startFrame, sampleRate), 10),
		attribute('sel1', 'double', framesToSeconds(project.selection?.endFrame, sampleRate), 10),
		attribute('vpos', 'int', 0),
		attribute('h', 'double', finite(project.view?.horizontalPosition, 0), 10),
		attribute('zoom', 'double', finite(project.view?.zoom, 86.1328125), 10),
		attribute('selectionformat', 'string', String(project.timeDisplay?.format || 'seconds')),
		attribute('frequencyformat', 'string', 'Hz'),
		attribute('bandwidthformat', 'string', 'octaves'),
		attribute('time_signature_tempo', 'double', tempo, -1),
		attribute('time_signature_upper', 'int', numerator),
		attribute('time_signature_lower', 'int', denominator),
		attribute('rate', 'double', sampleRate, -1),
	], project.opaqueExtensions?.aup4RootAttributes);
	const content = [createMetadataNode(project.metadata)];
	for (const track of project.tracks) {
		if ((track.kind || track.type || 'audio') === 'label') content.push({ kind: 'node', node: createLabelTrackNode(track, sampleRate, selectedTrackIds) });
		else for (let channel = 0; channel < trackChannelCount(project, track); channel += 1) {
			content.push({ kind: 'node', node: createWaveTrackNode(project, track, channel, channelBlocks, sampleRate, selectedTrackIds) });
		}
	}
	const opaqueMasterEffects = project.opaqueExtensions?.aup4MasterEffects;
	content.push({ kind: 'node', node: createAup4EffectsNode(project.master?.effects, opaqueMasterEffects?.node) });
	for (const opaque of [
		...(project.opaqueExtensions?.aup4UnknownNodes || []),
		...(project.opaqueAudacityNodes || []),
	]) {
		if (opaque?.kind === 'node' && opaque.node?.name) content.push(opaque);
	}
	return sanitizeAup4ProjectRoot(createAudacityXmlNode('project', rootAttributes, content)).node;
}

export function createAup4ProjectDocument(project, channelBlocks = new Map()) {
	return {
		roots: [
			'<?xml ', 'version="1.0" ', 'standalone="no" ', '?>\n',
			'<!DOCTYPE ', 'project ', 'PUBLIC ', '"-//audacityproject-1.3.0//DTD//EN" ',
			'"http://audacity.sourceforge.net/xml/audacityproject-1.3.0.dtd" ', '>\n',
		].map((value) => ({ kind: 'raw', value })).concat({
			kind: 'node', node: createAup4ProjectTree(project, channelBlocks),
		}),
	};
}

export function readAup4ProjectSummary(root) {
	if (!root || root.name !== 'project') throw new Aup4Error('The Audacity document has no project root.', 'INVALID_PROJECT_XML');
	const rate = positiveRate(audacityXmlAttribute(root, 'rate', 44_100));
	return {
		xmlVersion: String(audacityXmlAttribute(root, 'version', '')),
		audacityVersion: String(audacityXmlAttribute(root, 'audacityversion', '')),
		sampleRate: rate,
		selection: {
			startFrame: secondsToFrames(audacityXmlAttribute(root, 'sel0', 0), rate),
			endFrame: secondsToFrames(audacityXmlAttribute(root, 'sel1', 0), rate),
		},
		tempo: finiteInRange(audacityXmlAttribute(root, 'time_signature_tempo', 120), 1, 999, 120),
		timeSignature: {
			numerator: integerInRange(audacityXmlAttribute(root, 'time_signature_upper', 4), 1, 32, 4),
			denominator: integerInRange(audacityXmlAttribute(root, 'time_signature_lower', 4), 1, 32, 4),
		},
		audioTrackCount: audacityXmlChildren(root, 'wavetrack').length,
		labelTrackCount: audacityXmlChildren(root, 'labeltrack').length,
	};
}

function createWaveTrackNode(project, track, channel, channelBlocks, projectRate, selectedTrackIds) {
	const channelCount = trackChannelCount(project, track);
	const trackRate = positiveRate(track.sampleRate || projectRate);
	const opaqueTrack = track.opaqueExtensions?.aup4WaveTracks?.[channel]?.node;
	const attributes = mergeAttributes([
		attribute('name', 'string', String(track.name || 'Audio Track')),
		attribute('isSelected', 'bool', selectedTrackIds.has(track.id)),
		attribute('isFocused', 'bool', false),
		attribute('colorindex', 'int', colorIndex(track.color, audacityXmlAttribute(opaqueTrack, 'colorindex', 0))),
		attribute('height', 'int', Math.max(0, Math.round(finite(track.height, 0)))),
		attribute('rulerType', 'int', 0),
		attribute('trackViewType', 'int', displayType(track.displayMode || track.display)),
		attribute('syncWithGlobalSettings', 'bool', track.spectrogram?.syncWithGlobal !== false),
		// Audacity 4 stores the frequency bounds as doubles, even though its
		// settings UI currently presents whole-Hz values.
		attribute('minFreq', 'double', Math.max(0, finite(track.spectrogram?.minimumFrequency, 0)), -1),
		attribute('maxFreq', 'double', Math.max(1, finite(track.spectrogram?.maximumFrequency, 20_000)), -1),
		attribute('range', 'int', Math.round(finite(track.spectrogram?.rangeDb ?? track.spectrogram?.range, 80))),
		attribute('gain', 'int', Math.round(finite(track.spectrogram?.gainDb ?? track.spectrogram?.gain, 20))),
		attribute('frequencyGain', 'int', Math.round(finite(track.spectrogram?.frequencyGainDb, 0))),
		attribute('windowType', 'int', integerInRange(track.spectrogram?.windowType, 0, 32, 3)),
		attribute('windowSize', 'int', integerInRange(track.spectrogram?.windowSize, 128, 131_072, 2048)),
		attribute('zeroPaddingFactor', 'int', integerInRange(track.spectrogram?.zeroPaddingFactor, 1, 8, 2)),
		attribute('colorScheme', 'int', integerInRange(track.spectrogram?.colorScheme, 0, 32, 0)),
		attribute('scaleType', 'int', integerInRange(track.spectrogram?.scaleType, 0, 32, 0)),
		attribute('algorithm', 'int', integerInRange(track.spectrogram?.algorithm, 0, 32, 0)),
		attribute('channel', 'int', channel),
		attribute('linked', 'int', channelCount > 1 && channel === 0 ? 1 : 0),
		attribute('mute', 'bool', Boolean(track.mute)),
		attribute('solo', 'bool', Boolean(track.solo)),
		attribute('rate', 'double', trackRate, -1),
		attribute('gain', 'double', finiteInRange(track.gain, 0, 4, 1), -1),
		attribute('pan', 'double', finiteInRange(track.pan, -1, 1, 0), -1),
		attribute('sampleformat', 'long', AUP4_SAMPLE_FORMAT_FLOAT32),
	], opaqueTrack?.content);
	const content = [...attributes];
	const opaqueEffects = track.opaqueExtensions?.effects?.[channel];
	if (channel === 0) {
		content.push({ kind: 'node', node: createAup4EffectsNode(track.effects, opaqueEffects?.node) });
	} else if (opaqueEffects?.kind === 'node') {
		// Native files normally attach the group rack to the leader channel. Keep
		// an unexpected follower-channel rack opaque instead of shifting or losing it.
		content.push(cloneXmlEntry(opaqueEffects));
	}
	for (const clipId of track.clipIds || []) {
		const clip = project.clips.find((candidate) => candidate.id === clipId);
		if (clip) content.push({ kind: 'node', node: createWaveClipNode(project, clip, channel, channelBlocks, trackRate, projectRate) });
	}
	appendOpaqueChildren(content, opaqueTrack, new Set(['effects', 'waveclip']));
	return createAudacityXmlNode('wavetrack', [], content);
}

function createWaveClipNode(project, clip, channel, channelBlocks, rate, projectRate) {
	const blocks = channelBlocks.get(`${clip.id}:${channel}`)
		|| channelBlocks.get(`${clip.sourceId}:${channel}`)
		|| channelBlocks.get(clip.id)
		|| channelBlocks.get(clip.sourceId)
		|| [];
	const opaqueClip = clip.opaqueExtensions?.aup4WaveClips?.[channel]?.node
		|| clip.opaqueExtensions?.aup4WaveClip?.node;
	const source = project.sources?.find((candidate) => candidate.id === clip.sourceId);
	const duration = Math.max(0, Number(clip.durationFrames || 0));
	const sourceDuration = Math.max(0, Number(clip.sourceDurationFrames || duration));
	const sequenceSamples = blocks.reduce((total, block) => total + Number(block.sampleCount || 0), 0) || Number(source?.frameCount || duration);
	const trimStartFrames = Math.max(0, Number(clip.sourceStartFrame ?? clip.trimStartFrames ?? 0));
	const trimEndFrames = Math.max(0, sequenceSamples - trimStartFrames - sourceDuration);
	const modelStretchRatio = sourceDuration > 0 && duration > 0
		? duration / projectRate * rate / sourceDuration
		: Number.NaN;
	const stretchRatio = finiteInRange(modelStretchRatio, 0.001, 1000,
		finiteInRange(clip.stretchRatio ?? clip.timeRatio ?? inverseRatio(clip.speedRatio), 0.001, 1000, 1));
	const clipTempo = optionalFiniteInRange(clip.tempo, 1, 999)
		?? optionalFiniteInRange(audacityXmlAttribute(opaqueClip, 'clipTempo', null), 1, 999);
	const rawAudioTempo = optionalFiniteInRange(clip.rawAudioTempo, 1, 999)
		?? optionalFiniteInRange(audacityXmlAttribute(opaqueClip, 'rawAudioTempo', null), 1, 999);
	const tempoStretchRatio = clipTempo != null && rawAudioTempo != null ? rawAudioTempo / clipTempo : 1;
	const storedStretchRatio = stretchRatio / tempoStretchRatio;
	const trimLeftSeconds = trimStartFrames * stretchRatio / rate;
	const trimRightSeconds = trimEndFrames * stretchRatio / rate;
	const visibleStartSeconds = framesToSeconds(clip.timelineStartFrame, projectRate);
	const sequenceContent = [
		attribute('maxsamples', 'size-t', AUP4_MAX_BLOCK_SAMPLES),
		attribute('sampleformat', 'size-t', AUP4_SAMPLE_FORMAT_FLOAT32),
		attribute('effectivesampleformat', 'size-t', AUP4_SAMPLE_FORMAT_FLOAT32),
		attribute('numsamples', 'long-long', sequenceSamples),
	];
	let start = 0;
	for (const block of blocks) {
		const sampleCount = nonNegativeInteger(block.sampleCount, 0);
		sequenceContent.push({ kind: 'node', node: createAudacityXmlNode('waveblock', [
			attribute('start', 'long-long', Number(block.start ?? start)),
			attribute('length', 'long-long', sampleCount),
			attribute('blockid', 'long-long', block.blockId),
		]) });
		start += sampleCount;
	}
	const envelopePoints = Array.isArray(clip.envelope) ? clip.envelope : [];
	const envelopeContent = [attribute('numpoints', 'size-t', envelopePoints.length)];
	for (const point of envelopePoints) envelopeContent.push({ kind: 'node', node: createAudacityXmlNode('controlpoint', [
		attribute('t', 'double', framesToSeconds(point.frame, projectRate), 12),
		attribute('val', 'double', finiteInRange(point.value, 0, 2, 1), 12),
	]) });
	const clipAttributes = [
		attribute('offset', 'double', visibleStartSeconds - trimLeftSeconds, 8),
		attribute('trimLeft', 'double', trimLeftSeconds, 8),
		attribute('trimRight', 'double', trimRightSeconds, 8),
		attribute('centShift', 'double', finiteInRange(clip.pitchCents, -1200, 1200, 0), -1),
		attribute('pitchAndSpeedPreset', 'long', integerInRange(audacityXmlAttribute(opaqueClip, 'pitchAndSpeedPreset', 0), 0, 32, 0)),
		attribute('clipStretchRatio', 'double', storedStretchRatio, 8),
		attribute('clipStretchToMatchTempo', 'bool', clip.stretchToTempo == null
			? Boolean(audacityXmlAttribute(opaqueClip, 'clipStretchToMatchTempo', false))
			: Boolean(clip.stretchToTempo)),
		attribute('name', 'string', String(clip.name || clip.title || 'Audio')),
		attribute('groupId', 'long', groupNumber(project, clip.groupId)),
		attribute('colorindex', 'int', colorIndex(clip.color, audacityXmlAttribute(opaqueClip, 'colorindex', 0))),
		attribute('isSelected', 'bool', clip.selected == null
			? Boolean(audacityXmlAttribute(opaqueClip, 'isSelected', false))
			: Boolean(clip.selected)),
	];
	if (clipTempo != null) clipAttributes.push(attribute('clipTempo', 'double', clipTempo, 8));
	if (rawAudioTempo != null) clipAttributes.push(attribute('rawAudioTempo', 'double', rawAudioTempo, 8));
	const clipContent = [
		{ kind: 'node', node: createAudacityXmlNode('sequence', [], sequenceContent) },
		{ kind: 'node', node: createAudacityXmlNode('envelope', [], envelopeContent) },
	];
	appendOpaqueChildren(clipContent, opaqueClip, new Set(['sequence', 'envelope']));
	return createAudacityXmlNode('waveclip', mergeAttributes(clipAttributes, opaqueClip?.content), clipContent);
}

function createLabelTrackNode(track, sampleRate, selectedTrackIds) {
	const opaqueTrack = track.opaqueExtensions?.aup4LabelTrack?.node;
	const content = mergeAttributes([
		attribute('name', 'string', String(track.name || 'Labels')),
		attribute('isSelected', 'bool', selectedTrackIds.has(track.id)),
		attribute('isFocused', 'bool', false),
		attribute('numlabels', 'int', (track.labels || []).length),
	], opaqueTrack?.content);
	for (const label of track.labels || []) {
		const opaqueLabel = label.opaqueExtensions?.aup4Label?.node;
		content.push({ kind: 'node', node: createAudacityXmlNode('label', mergeAttributes([
			attribute('t', 'double', framesToSeconds(label.startFrame, sampleRate), 10),
			attribute('t1', 'double', framesToSeconds(label.endFrame ?? label.startFrame, sampleRate), 10),
			attribute('title', 'string', String(label.text || label.title || '')),
			attribute('isSelected', 'bool', label.selected == null
				? Boolean(audacityXmlAttribute(opaqueLabel, 'isSelected', false))
				: Boolean(label.selected)),
		], opaqueLabel?.content), opaqueChildren(opaqueLabel)) });
	}
	appendOpaqueChildren(content, opaqueTrack, new Set(['label']));
	return createAudacityXmlNode('labeltrack', [], content);
}

function createMetadataNode(metadata = {}) {
	const content = [];
	const standard = {
		TITLE: metadata.title,
		ARTIST: metadata.artist,
		ALBUM: metadata.album,
		TRACKNUMBER: metadata.trackNumber,
		YEAR: metadata.year,
		COMMENTS: metadata.comments,
	};
	const entries = new Map(Object.entries(metadata.tags || {}).map(([name, value]) => [String(name).toUpperCase(), value]));
	for (const [name, value] of Object.entries(standard)) if (value != null && value !== '') entries.set(name, value);
	for (const [name, value] of entries) {
		if (value == null || value === '') continue;
		content.push({ kind: 'node', node: createAudacityXmlNode('tag', [
			attribute('name', 'string', String(name).toUpperCase()),
			attribute('value', 'string', String(value)),
		]) });
	}
	return { kind: 'node', node: createAudacityXmlNode('tags', [], content) };
}

function attribute(name, type, value, digits) {
	return { kind: 'attribute', name, type, value, ...(digits == null ? {} : { digits }) };
}

function mergeAttributes(generated, opaqueContent) {
	const generatedByName = new Map();
	for (let index = 0; index < generated.length; index += 1) {
		const entry = generated[index];
		const indexes = generatedByName.get(entry.name) || [];
		indexes.push(index);
		generatedByName.set(entry.name, indexes);
	}
	const consumed = new Set();
	const output = [];
	for (const entry of opaqueContent || []) {
		if (entry?.kind !== 'attribute') continue;
		const indexes = generatedByName.get(entry.name);
		if (!indexes) {
			output.push(cloneXmlEntry(entry));
			continue;
		}
		const replacement = indexes.find((index) => !consumed.has(index));
		if (replacement == null) continue;
		consumed.add(replacement);
		output.push(generated[replacement]);
	}
	for (let index = 0; index < generated.length; index += 1) {
		if (!consumed.has(index)) output.push(generated[index]);
	}
	return output;
}

function appendOpaqueChildren(content, opaqueNode, excludedNames = new Set()) {
	for (const entry of opaqueNode?.content || []) {
		if (entry?.kind === 'attribute') continue;
		if (entry?.kind === 'node' && excludedNames.has(entry.node?.name)) continue;
		content.push(cloneXmlEntry(entry));
	}
}

function opaqueChildren(node) {
	const output = [];
	appendOpaqueChildren(output, node);
	return output;
}

function cloneXmlEntry(entry) {
	if (typeof structuredClone === 'function') return structuredClone(entry);
	if (entry?.value instanceof Uint8Array) return { ...entry, value: entry.value.slice() };
	if (entry?.kind === 'node') return { kind: 'node', node: createAudacityXmlNode(entry.node.name, [], (entry.node.content || []).map(cloneXmlEntry)) };
	return { ...entry };
}

function colorIndex(value, fallback) {
	const number = Number(value);
	if (Number.isSafeInteger(number) && number >= 0 && number <= 3) return number;
	const colors = new Map([
		['#66a3ff', 0], ['#9996fc', 1], ['#b5b5b5', 2], ['#ffad51', 3],
	]);
	return colors.get(String(value || '').toLowerCase()) ?? fallback;
}

function float32ToLittleEndianBytes(values) {
	const bytes = new Uint8Array(values.length * 4);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < values.length; index += 1) view.setFloat32(index * 4, values[index], true);
	return bytes;
}

function normalizeSamples(input) {
	if (input instanceof Float32Array) {
		if (input.every(Number.isFinite)) return input;
		return Float32Array.from(input, (value) => Number.isFinite(value) ? value : 0);
	}
	if (ArrayBuffer.isView(input) || Array.isArray(input)) return Float32Array.from(input, (value) => Number.isFinite(Number(value)) ? Number(value) : 0);
	throw new TypeError('A Float32 sample array is required.');
}

function toBytes(value) {
	if (value instanceof Uint8Array) return value;
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new TypeError('Binary sample data is required.');
}

function compareVersion(left, right) {
	const a = String(left).split('.').map(Number);
	const b = String(right).split('.').map(Number);
	for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
		const difference = (a[index] || 0) - (b[index] || 0);
		if (difference) return difference;
	}
	return 0;
}

function positiveRate(value) {
	const rate = Number(value);
	if (!Number.isFinite(rate) || rate < 1 || rate > 768_000) throw new Aup4Error('Audacity sample rate is invalid.', 'INVALID_SAMPLE_RATE');
	return Math.round(rate);
}

function finite(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function finiteInRange(value, minimum, maximum, fallback) { const number = Number(value); return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback; }
function optionalFiniteInRange(value, minimum, maximum) { const number = Number(value); return value != null && value !== '' && Number.isFinite(number) && number >= minimum && number <= maximum ? number : null; }
function integerInRange(value, minimum, maximum, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback; }
function nonNegativeInteger(value, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : fallback; }
function framesToSeconds(value, rate) { const frame = Number(value); return Number.isFinite(frame) && frame >= 0 ? frame / rate : 0; }
function secondsToFrames(value, rate) { const seconds = Number(value); return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * rate) : 0; }
function displayType(value) { return value === 'spectrogram' ? 1 : value === 'multiview' ? 2 : 0; }
function inverseRatio(value) { const ratio = Number(value); return Number.isFinite(ratio) && ratio > 0 ? 1 / ratio : 1; }

function trackChannelCount(project, track) {
	const explicit = Number(track.channelCount);
	if (Number.isSafeInteger(explicit) && explicit > 0) return Math.min(32, explicit);
	let inferred = 1;
	for (const clipId of track.clipIds || []) {
		const clip = project.clips?.find((candidate) => candidate.id === clipId);
		const source = project.sources?.find((candidate) => candidate.id === clip?.sourceId);
		inferred = Math.max(inferred, Number(source?.channelCount || 1));
	}
	return Math.min(32, inferred);
}

function groupNumber(project, groupId) {
	if (Number.isSafeInteger(groupId)) return groupId;
	if (groupId == null || groupId === '') return -1;
	const imported = /^aup4-group-(\d+)$/.exec(String(groupId));
	if (imported && Number.isSafeInteger(Number(imported[1]))) return Number(imported[1]);
	const ids = [...new Set((project.clips || []).map((clip) => clip.groupId).filter((id) => id != null && id !== ''))];
	return ids.indexOf(groupId);
}
