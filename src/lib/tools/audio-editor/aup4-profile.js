import {
	audacityXmlAttribute,
	audacityXmlChildren,
	createAudacityXmlNode,
} from './audacity-binary-xml.js';
import { createAup4EffectsNode } from './aup4-effects.js';
import { sanitizeAup4ProjectRoot } from './aup4-sanitization.js';
import {
	AUDIO_EDITOR_SNAP_UPSTREAM_MAX,
	audioEditorSnapGrid,
} from './snap-grid.js';

export const AUP4_APPLICATION_ID = 0x41554459;
export const AUP4_USER_VERSION = 0x04000001;
export const AUP4_BINARY_XML_VERSION = '2.0.0';
export const AUP4_AUDACITY_VERSION = '4.0.0';
export const AUP4_SAMPLE_FORMAT_FLOAT32 = 0x0004000f;
export const AUP4_MAX_BLOCK_SAMPLES = 262_144;
export const AUP4_HISTORY_DEPTH = 10;
export const AUP4_UPSTREAM_COMMIT = '908ad0a526e5bfdab68de780e893cebe172d27eb';
const FLOAT32_MAX = 3.4028234663852886e38;
const AUP4_COMPATIBILITY_DISPOSITIONS = new Set(['preserved', 'converted', 'missing', 'omitted']);
const OMIT_OPAQUE_CHILD = Symbol('omit opaque AUP4 child');

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

export function createAup4CompatibilityReport(direction, legacy = {}) {
	if (direction !== 'open' && direction !== 'save') throw new TypeError('AUP4 compatibility direction must be open or save.');
	const items = Array.isArray(legacy.items) ? legacy.items.map(cloneCompatibilityValue) : [];
	const report = {
		...cloneCompatibilityValue(legacy),
		schemaVersion: 1,
		format: 'aup4',
		direction,
		items,
		counts: { preserved: 0, converted: 0, missing: 0, omitted: 0 },
	};
	for (const item of items) {
		if (AUP4_COMPATIBILITY_DISPOSITIONS.has(item?.disposition)) report.counts[item.disposition] += 1;
	}
	return report;
}

export function addAup4CompatibilityItem(report, item) {
	if (!report || report.schemaVersion !== 1 || report.format !== 'aup4') {
		throw new TypeError('A versioned AUP4 compatibility report is required.');
	}
	if (!item || typeof item.code !== 'string' || !item.code) throw new TypeError('AUP4 compatibility items require a code.');
	if (!AUP4_COMPATIBILITY_DISPOSITIONS.has(item.disposition)) {
		throw new TypeError(`Unsupported AUP4 compatibility disposition: ${item.disposition}.`);
	}
	const normalized = {
		code: item.code,
		severity: item.severity === 'error' || item.severity === 'warning' ? item.severity : 'info',
		disposition: item.disposition,
		scope: item.scope == null ? { kind: 'project' } : cloneCompatibilityValue(item.scope),
		data: item.data == null ? {} : cloneCompatibilityValue(item.data),
		...(typeof item.message === 'string' && item.message.trim()
			? { message: item.message.trim() }
			: {}),
	};
	report.items.push(normalized);
	report.counts[normalized.disposition] += 1;
	return normalized;
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
	const tempo = finiteInRange(project.tempo?.bpm ?? project.tempo ?? 120, 1, 1000, 120);
	const timeSignature = project.timeSignature || project.tempo?.timeSignature || {};
	const numerator = integerInRange(timeSignature.numerator, 1, 0x7fff_ffff, 4);
	const denominator = nativeTimeSignatureDenominator(timeSignature.denominator);
	const selectedTrackIds = new Set(project.selection?.trackIds || []);
	const selectedClipIds = new Set(project.selection?.clipIds || []);
	const groupNumbers = createGroupNumberMap(project);
	const frequencySelection = aup4FrequencySelection(project.selection?.frequencyRange, sampleRate);
	const generatedRootAttributes = [
		attribute('xmlns', 'string', 'http://audacity.sourceforge.net/xml/'),
		attribute('version', 'string', AUP4_BINARY_XML_VERSION),
		attribute('audacityversion', 'string', AUP4_AUDACITY_VERSION),
		attribute('viewstate_zoom', 'double', finite(project.view?.zoom, 86.1328125), -1),
		attribute('viewstate_vpos', 'int', Math.round(finite(project.view?.verticalPosition, 0))),
		attribute('viewstate_hpos', 'double', finite(project.view?.horizontalPosition, 0), -1),
		attribute('snap_enabled', 'bool', Boolean(project.snap?.enabled)),
		attribute('snap_type', 'int', aup4SnapType(project.snap)),
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
	];
	if (frequencySelection) generatedRootAttributes.push(
		attribute('selLow', 'double', frequencySelection.minimumFrequency, -1),
		attribute('selHigh', 'double', frequencySelection.maximumFrequency, -1),
	);
	const opaqueRootAttributes = (project.opaqueExtensions?.aup4RootAttributes || [])
		.filter((entry) => frequencySelection || (entry?.name !== 'selLow' && entry?.name !== 'selHigh'));
	const rootAttributes = mergeAttributes(generatedRootAttributes, opaqueRootAttributes);
	const rootTemplate = project.opaqueExtensions?.aup4RootTemplate?.node;
	const opaqueTags = audacityXmlChildren(rootTemplate, 'tags')[0];
	const generatedRootChildren = [{
		key: 'tags',
		entry: createMetadataNode(project.metadata, opaqueTags),
	}];
	for (const track of project.tracks) {
		if ((track.kind || track.type || 'audio') === 'label') generatedRootChildren.push({
			key: 'track',
			entry: { kind: 'node', node: createLabelTrackNode(track, sampleRate, selectedTrackIds) },
		});
		else for (let channel = 0; channel < trackChannelCount(project, track); channel += 1) {
			generatedRootChildren.push({
				key: 'track',
				entry: { kind: 'node', node: createWaveTrackNode(project, track, channel, channelBlocks, sampleRate, selectedTrackIds, selectedClipIds, groupNumbers) },
			});
		}
	}
	const opaqueMasterEffects = project.opaqueExtensions?.aup4MasterEffects;
	generatedRootChildren.push({
		key: 'master-effects',
		entry: {
			kind: 'node',
			node: createAup4EffectsNode(project.master?.effects, opaqueMasterEffects?.node, {
				effectsActive: project.master?.effectsActive,
			}),
		},
	});
	const masterEffectsContentIndex = Number(project.opaqueExtensions?.aup4MasterEffectsContentIndex);
	const content = mergeOpaqueChildren(rootTemplate, generatedRootChildren, (entry, index) => {
		if (entry.kind !== 'node') return null;
		if (entry.node?.name === 'tags') return 'tags';
		if (entry.node?.name === 'wavetrack' || entry.node?.name === 'labeltrack') return 'track';
		if (entry.node?.name === 'effects' && index === masterEffectsContentIndex) return 'master-effects';
		return null;
	});
	const templateTrackSlots = (rootTemplate?.content || []).filter((entry) => (
		entry?.kind === 'node'
		&& (entry.node?.name === 'wavetrack' || entry.node?.name === 'labeltrack')
	)).length;
	const overflowTracks = generatedRootChildren
		.filter((descriptor) => descriptor.key === 'track')
		.slice(templateTrackSlots)
		.map((descriptor) => descriptor.entry);
	if (overflowTracks.length) {
		for (const entry of overflowTracks) {
			const index = content.indexOf(entry);
			if (index >= 0) content.splice(index, 1);
		}
		const masterEntry = generatedRootChildren.find((descriptor) => descriptor.key === 'master-effects')?.entry;
		const masterIndex = content.indexOf(masterEntry);
		content.splice(masterIndex < 0 ? content.length : masterIndex, 0, ...overflowTracks);
	}
	for (const opaque of [
		...(rootTemplate ? [] : project.opaqueExtensions?.aup4UnknownNodes || []),
		...(project.opaqueAudacityNodes || []),
	]) {
		if (opaque?.kind === 'node' && opaque.node?.name) content.push(opaque);
	}
	const tree = createAudacityXmlNode('project', rootAttributes, content);
	return sanitizeAup4ProjectRoot(stripUnsupportedNestedWaveClips(tree)).node;
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

function createWaveTrackNode(project, track, channel, channelBlocks, projectRate, selectedTrackIds, selectedClipIds, groupNumbers) {
	const channelCount = trackChannelCount(project, track);
	const trackRate = trackSampleRate(project, track, projectRate);
	const opaqueTrack = track.opaqueExtensions?.aup4WaveTracks?.[channel]?.node;
	const importedColor = track.opaqueExtensions?.aup4TrackColor;
	const nativeColorIndex = Number.isSafeInteger(importedColor?.value)
		&& track.color === importedColor.color
		? importedColor.value
		: colorIndex(track.color, audacityXmlAttribute(opaqueTrack, 'colorindex', 0));
	const attributes = mergeAttributes([
		attribute('name', 'string', String(track.name || 'Audio Track')),
		attribute('isSelected', 'bool', selectedTrackIds.has(track.id)),
		attribute('isFocused', 'bool', false),
		attribute('colorindex', 'int', nativeColorIndex),
		attribute('height', 'int', track.collapsed ? 40 : Math.max(40, Math.round(finite(track.height, 160)))),
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
		attribute('windowType', 'int', nativeSpectrogramWindowType(track.spectrogram)),
		attribute('windowSize', 'int', integerInRange(track.spectrogram?.windowSize, 128, 131_072, 2048)),
		attribute('zeroPaddingFactor', 'int', integerInRange(track.spectrogram?.zeroPaddingFactor, 1, 8, 2)),
		attribute('colorScheme', 'int', integerInRange(track.spectrogram?.colorScheme, 0, 0x7fff_ffff, 0)),
		attribute('scaleType', 'int', nativeSpectrogramScaleType(track.spectrogram)),
		attribute('algorithm', 'int', integerInRange(track.spectrogram?.algorithm, 0, 0x7fff_ffff, 0)),
		attribute('channel', 'int', channel),
		attribute('linked', 'int', channelCount > 1 && channel === 0 ? 1 : 0),
		attribute('mute', 'bool', Boolean(track.mute)),
		attribute('solo', 'bool', Boolean(track.solo)),
		attribute('rate', 'double', trackRate, -1),
		attribute('gain', 'double', finiteInRange(track.gain, 0, 4, 1), -1),
		attribute('pan', 'double', finiteInRange(track.pan, -1, 1, 0), -1),
		attribute('sampleformat', 'long', AUP4_SAMPLE_FORMAT_FLOAT32),
	], opaqueTrack?.content);
	const generatedChildren = [];
	const opaqueEffects = track.opaqueExtensions?.effects?.[channel];
	if (channel === 0) {
		generatedChildren.push({
			key: 'effects',
			entry: {
				kind: 'node',
				node: createAup4EffectsNode(track.effects, opaqueEffects?.node, {
					effectsActive: track.effectsActive,
				}),
			},
		});
	} else if (opaqueEffects?.kind === 'node') {
		// Native files normally attach the group rack to the leader channel. Keep
		// an unexpected follower-channel rack opaque instead of shifting or losing it.
		generatedChildren.push({ key: 'effects', entry: cloneXmlEntry(opaqueEffects) });
	}
	for (const clipId of track.clipIds || []) {
		const clip = project.clips.find((candidate) => candidate.id === clipId);
		if (clip) generatedChildren.push({
			key: 'waveclip',
			entry: { kind: 'node', node: createWaveClipNode(project, clip, channel, channelBlocks, trackRate, projectRate, selectedClipIds, groupNumbers) },
		});
	}
	let matchedEffects = false;
	const children = mergeOpaqueChildren(opaqueTrack, generatedChildren, (entry) => {
		if (entry.kind !== 'node') return null;
		if (entry.node?.name === 'waveclip') return 'waveclip';
		if (entry.node?.name !== 'effects' || matchedEffects) return null;
		matchedEffects = true;
		return 'effects';
	});
	const content = [...attributes, ...children];
	return createAudacityXmlNode('wavetrack', [], content);
}

function createWaveClipNode(project, clip, channel, channelBlocks, rate, projectRate, selectedClipIds, groupNumbers) {
	const blocks = channelBlocks.get(`${clip.id}:${channel}`)
		|| channelBlocks.get(`${clip.sourceId}:${channel}`)
		|| channelBlocks.get(clip.id)
		|| channelBlocks.get(clip.sourceId)
		|| [];
	const opaqueChannelClips = clip.opaqueExtensions?.aup4WaveClips;
	const opaqueClip = Array.isArray(opaqueChannelClips)
		? opaqueChannelClips[channel]?.node
		: clip.opaqueExtensions?.aup4WaveClip?.node;
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
	const opaqueSequence = audacityXmlChildren(opaqueClip, 'sequence')[0];
	const sequenceAttributes = [
		attribute('maxsamples', 'size-t', AUP4_MAX_BLOCK_SAMPLES),
		attribute('sampleformat', 'size-t', AUP4_SAMPLE_FORMAT_FLOAT32),
		attribute('effectivesampleformat', 'size-t', AUP4_SAMPLE_FORMAT_FLOAT32),
		attribute('numsamples', 'long-long', sequenceSamples),
	];
	const generatedWaveBlocks = [];
	let start = 0;
	for (const block of blocks) {
		const sampleCount = nonNegativeInteger(block.sampleCount, 0);
		generatedWaveBlocks.push({
			key: 'waveblock',
			entry: { kind: 'node', node: createAudacityXmlNode('waveblock', [
				attribute('start', 'long-long', Number(block.start ?? start)),
				attribute('length', 'long-long', sampleCount),
				attribute('blockid', 'long-long', block.blockId),
			]) },
		});
		start += sampleCount;
	}
	const sequenceNode = createAudacityXmlNode(
		'sequence',
		mergeAttributes(sequenceAttributes, opaqueSequence?.content),
		mergeOpaqueChildren(opaqueSequence, generatedWaveBlocks, (entry) => (
			entry.kind === 'node' && entry.node?.name === 'waveblock' ? 'waveblock' : null
		)),
	);
	const modelEnvelopePoints = Array.isArray(clip.envelope) ? clip.envelope : [];
	const opaqueEnvelope = audacityXmlChildren(opaqueClip, 'envelope')[0];
	const importedEnvelope = clip.opaqueExtensions?.aup4Envelope;
	const preserveImportedEnvelope = importedEnvelope?.node?.kind === 'node'
		&& envelopePointsEqual(modelEnvelopePoints, importedEnvelope.model)
		&& Math.abs(trimLeftSeconds - Number(importedEnvelope.trimLeftSeconds)) <= 1e-9
		&& Number(clip.durationFrames) === Number(importedEnvelope.durationFrames);
	const envelopePoints = nativeLinearEnvelopePoints(modelEnvelopePoints, duration);
	const envelopeNode = preserveImportedEnvelope
		? cloneXmlEntry(importedEnvelope.node).node
		: createAudacityXmlNode(
			'envelope',
			mergeAttributes([
				attribute('numpoints', 'size-t', envelopePoints.length),
			], opaqueEnvelope?.content),
			mergeOpaqueChildren(opaqueEnvelope, envelopePoints.map((point) => ({
				key: 'controlpoint',
				entry: { kind: 'node', node: createAudacityXmlNode('controlpoint', [
					attribute('t', 'double', trimLeftSeconds + framesToSeconds(point.frame, projectRate), 12),
					attribute('val', 'double', Math.max(0, Math.min(4, finite(point.value, 1))), 12),
				]) },
			})), (entry) => (
				entry.kind === 'node' && entry.node?.name === 'controlpoint' ? 'controlpoint' : null
			)),
		);
	const importedPitchPreset = clip.opaqueExtensions?.aup4PitchAndSpeedPreset;
	const preserveImportedPitchPreset = Number.isSafeInteger(importedPitchPreset?.value)
		&& importedPitchPreset.value >= 0
		&& importedPitchPreset.value <= 0x7fff_ffff
		&& Boolean(clip.preserveFormants) === Boolean(importedPitchPreset.preserveFormants);
	const pitchAndSpeedPreset = preserveImportedPitchPreset
		? importedPitchPreset.value
		: (clip.preserveFormants ? 1 : 0);
	const clipAttributes = [
		attribute('offset', 'double', visibleStartSeconds - trimLeftSeconds, 8),
		attribute('trimLeft', 'double', trimLeftSeconds, 8),
		attribute('trimRight', 'double', trimRightSeconds, 8),
		attribute('centShift', 'double', finiteInRange(clip.pitchCents, -1200, 1200, 0), -1),
		attribute('pitchAndSpeedPreset', 'long', pitchAndSpeedPreset),
		attribute('clipStretchRatio', 'double', storedStretchRatio, 8),
		attribute('clipStretchToMatchTempo', 'bool', clip.stretchToTempo == null
			? Boolean(audacityXmlAttribute(opaqueClip, 'clipStretchToMatchTempo', false))
			: Boolean(clip.stretchToTempo)),
		attribute('name', 'string', String(clip.name || clip.title || 'Audio')),
		attribute('groupId', 'long', groupNumbers.get(clip.groupId) ?? -1),
		attribute('colorindex', 'int', colorIndex(clip.color, audacityXmlAttribute(opaqueClip, 'colorindex', 0))),
		attribute('isSelected', 'bool', selectedClipIds.has(clip.id)),
	];
	if (clipTempo != null) clipAttributes.push(attribute('clipTempo', 'double', clipTempo, 8));
	if (rawAudioTempo != null) clipAttributes.push(attribute('rawAudioTempo', 'double', rawAudioTempo, 8));
	const clipContent = mergeOpaqueChildren(opaqueClip, [
		{ key: 'sequence', entry: { kind: 'node', node: sequenceNode } },
		{ key: 'envelope', entry: { kind: 'node', node: envelopeNode } },
	], (entry) => {
		if (entry.kind !== 'node') return null;
		if (entry.node?.name === 'waveclip') return OMIT_OPAQUE_CHILD;
		if (entry.node?.name === 'sequence') return 'sequence';
		if (entry.node?.name === 'envelope') return 'envelope';
		return null;
	});
	return createAudacityXmlNode('waveclip', mergeAttributes(clipAttributes, opaqueClip?.content), clipContent);
}

function createLabelTrackNode(track, sampleRate, selectedTrackIds) {
	const opaqueTrack = track.opaqueExtensions?.aup4LabelTrack?.node;
	const attributes = mergeAttributes([
		attribute('name', 'string', String(track.name || 'Labels')),
		attribute('isSelected', 'bool', selectedTrackIds.has(track.id)),
		attribute('isFocused', 'bool', false),
		attribute('height', 'int', track.collapsed ? 40 : Math.max(40, Math.round(finite(track.height, 96)))),
		attribute('numlabels', 'int', (track.labels || []).length),
	], opaqueTrack?.content);
	const generatedLabels = [];
	for (const label of track.labels || []) {
		const opaqueLabel = label.opaqueExtensions?.aup4Label?.node;
		generatedLabels.push({
			key: 'label',
			entry: { kind: 'node', node: createAudacityXmlNode('label', mergeAttributes([
				attribute('t', 'double', framesToSeconds(label.startFrame, sampleRate), 10),
				attribute('t1', 'double', framesToSeconds(label.endFrame ?? label.startFrame, sampleRate), 10),
				attribute('title', 'string', String(label.text || label.title || '')),
				attribute('isSelected', 'bool', label.selected == null
					? Boolean(audacityXmlAttribute(opaqueLabel, 'isSelected', false))
					: Boolean(label.selected)),
			], opaqueLabel?.content), opaqueChildren(opaqueLabel)) },
		});
	}
	const content = [
		...attributes,
		...mergeOpaqueChildren(opaqueTrack, generatedLabels, (entry) => (
			entry.kind === 'node' && entry.node?.name === 'label' ? 'label' : null
		)),
	];
	return createAudacityXmlNode('labeltrack', [], content);
}

function createMetadataNode(metadata = {}, opaqueTags = null) {
	const generatedTags = [];
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
		const canonicalName = String(name).toUpperCase();
		generatedTags.push({
			key: `tag:${canonicalName}`,
			entry: { kind: 'node', node: createAudacityXmlNode('tag', [
				attribute('name', 'string', canonicalName),
				attribute('value', 'string', String(value)),
			]) },
		});
	}
	const content = mergeOpaqueChildren(opaqueTags, generatedTags, (entry) => {
		if (entry.kind !== 'node' || entry.node?.name !== 'tag') return null;
		return `tag:${String(audacityXmlAttribute(entry.node, 'name', '')).toUpperCase()}`;
	});
	return {
		kind: 'node',
		node: createAudacityXmlNode('tags', mergeAttributes([], opaqueTags?.content), content),
	};
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

function mergeOpaqueChildren(opaqueNode, generated, keyForOpaque) {
	const descriptors = generated || [];
	if (!opaqueNode) return descriptors.map((descriptor) => descriptor.entry);
	const queues = new Map();
	for (const descriptor of descriptors) {
		const queue = queues.get(descriptor.key) || [];
		queue.push(descriptor);
		queues.set(descriptor.key, queue);
	}
	const consumed = new Set();
	const output = [];
	for (const [index, entry] of (opaqueNode.content || []).entries()) {
		if (entry?.kind === 'attribute') continue;
		const key = keyForOpaque(entry, index);
		if (key === OMIT_OPAQUE_CHILD) continue;
		if (key != null) {
			const descriptor = queues.get(key)?.shift();
			if (descriptor) {
				consumed.add(descriptor);
				output.push(descriptor.entry);
			}
			// A modeled child which no longer has a generated counterpart was
			// deleted. Never resurrect its stale opaque subtree.
			continue;
		}
		output.push(cloneXmlEntry(entry));
	}
	for (const descriptor of descriptors) {
		if (!consumed.has(descriptor)) output.push(descriptor.entry);
	}
	return output;
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

function stripUnsupportedNestedWaveClips(root) {
	const visit = (node, directProjectWaveTrack = false) => ({
		...node,
		content: (node.content || []).flatMap((entry) => {
			if (entry?.kind !== 'node') return [cloneXmlEntry(entry)];
			if (entry.node?.name === 'waveclip') {
				return directProjectWaveTrack ? [{
					kind: 'node',
					node: visit(entry.node, false),
				}] : [];
			}
			return [{
				kind: 'node',
				node: visit(entry.node, node.name === 'project' && entry.node?.name === 'wavetrack'),
			}];
		}),
	});
	return visit(root);
}

function cloneCompatibilityValue(value) {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
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
function nativeTimeSignatureDenominator(value) {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 && number <= 0x4000_0000
		&& Number.isInteger(Math.log2(number))
		? number
		: 4;
}
function envelopePointsEqual(left, right) {
	if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
	return left.every((point, index) => (
		Number(point?.frame) === Number(right[index]?.frame)
		&& Number(point?.value) === Number(right[index]?.value)
	));
}
function nativeLinearEnvelopePoints(points, durationFrames) {
	if (!points.length) return [];
	const output = points.map((point) => ({
		frame: Math.max(0, Math.min(durationFrames, Math.round(Number(point.frame)))),
		value: finite(point.value, 1),
	})).sort((left, right) => left.frame - right.frame);
	if (output[0].frame > 0) output.unshift({ frame: 0, value: 1 });
	return output.filter((point, index, all) => !index || point.frame > all[index - 1].frame);
}
function aup4SnapType(snap = {}) {
	if (snap.type != null) return integerInRange(snap.type, 0, 255, 8);
	const opaqueType = Number(snap.opaqueType);
	if (Number.isSafeInteger(opaqueType) && opaqueType > AUDIO_EDITOR_SNAP_UPSTREAM_MAX && opaqueType <= 255) {
		return opaqueType;
	}
	try {
		return audioEditorSnapGrid(snap.division || snap.unit || 'seconds').upstreamType;
	} catch {
		return integerInRange(opaqueType, 0, 255, 8);
	}
}
function aup4FrequencySelection(value, sampleRate) {
	const minimumFrequency = Number(value?.minimumFrequency);
	const maximumFrequency = Number(value?.maximumFrequency);
	if (!Number.isFinite(minimumFrequency) || !Number.isFinite(maximumFrequency)
		|| minimumFrequency < 0 || maximumFrequency <= minimumFrequency) return null;
	const nyquist = sampleRate / 2;
	const minimum = Math.min(nyquist, minimumFrequency);
	const maximum = Math.min(nyquist, maximumFrequency);
	return maximum > minimum ? { minimumFrequency: minimum, maximumFrequency: maximum } : null;
}
function nativeSpectrogramScaleType(spectrogram = {}) {
	const imported = spectrogram.aup4ScaleType;
	if (Number.isSafeInteger(imported?.value) && spectrogram.scale === imported.model) return imported.value;
	return new Map([
		['linear', 0],
		['log', 1],
		['logarithmic', 1],
		['mel', 2],
		['bark', 3],
		['erb', 4],
		['period', 5],
	]).get(String(spectrogram.scale || '').toLowerCase()) ?? 2;
}
function nativeSpectrogramWindowType(spectrogram = {}) {
	const imported = spectrogram.aup4WindowType;
	if (Number.isSafeInteger(imported?.value) && spectrogram.windowType === imported.model) return imported.value;
	return new Map([
		['hamming', 2],
		['hann', 3],
		['hanning', 3],
		['blackman', 4],
	]).get(String(spectrogram.windowType || '').toLowerCase()) ?? 3;
}

function trackChannelCount(project, track) {
	for (const clipId of track.clipIds || []) {
		const clip = project.clips?.find((candidate) => candidate.id === clipId);
		const source = project.sources?.find((candidate) => candidate.id === clip?.sourceId);
		if (Number(source?.channelCount) > 1) return 2;
	}
	const importedChannels = track.opaqueExtensions?.aup4WaveTracks?.length;
	if (Number.isSafeInteger(importedChannels) && importedChannels > 1) return 2;
	return 1;
}

function trackSampleRate(project, track, projectRate) {
	const rates = new Set();
	for (const clipId of track.clipIds || []) {
		const clip = project.clips?.find((candidate) => candidate.id === clipId);
		const source = project.sources?.find((candidate) => candidate.id === clip?.sourceId);
		if (source?.sampleRate != null) rates.add(positiveRate(source.sampleRate));
	}
	if (rates.size === 1) return rates.values().next().value;
	const importedRate = audacityXmlAttribute(
		track.opaqueExtensions?.aup4WaveTracks?.[0]?.node,
		'rate',
		null,
	);
	return importedRate == null ? projectRate : positiveRate(importedRate);
}

function createGroupNumberMap(project) {
	const groupIds = [...new Set((project.clips || [])
		.map((clip) => clip.groupId)
		.filter((groupId) => groupId != null && groupId !== '' && !(Number.isSafeInteger(groupId) && groupId < 0)))]
		.sort(compareGroupIds);
	const result = new Map();
	const usedNumbers = new Set();
	const generatedIds = [];
	for (const groupId of groupIds) {
		const importedNumber = importedGroupNumber(groupId);
		if (importedNumber != null && !usedNumbers.has(importedNumber)) {
			result.set(groupId, importedNumber);
			usedNumbers.add(importedNumber);
		} else generatedIds.push(groupId);
	}
	let candidate = 0;
	for (const groupId of generatedIds) {
		while (usedNumbers.has(candidate)) candidate += 1;
		result.set(groupId, candidate);
		usedNumbers.add(candidate);
		candidate += 1;
	}
	return result;
}

function compareGroupIds(left, right) {
	const leftKey = `${typeof left}:${String(left)}`;
	const rightKey = `${typeof right}:${String(right)}`;
	return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function importedGroupNumber(groupId) {
	if (Number.isSafeInteger(groupId) && groupId >= 0) return groupId;
	const imported = /^aup4-group-(\d+)$/.exec(String(groupId));
	const value = Number(imported?.[1]);
	return imported && Number.isSafeInteger(value) ? value : null;
}
