import { audacityXmlAttribute, audacityXmlChildren, createAudacityXmlNode } from './audacity-binary-xml.js';
import { createAup4EffectsNode } from './aup4-effects.js';
import {
	attribute,
	mergeAttributes,
	mergeOpaqueChildren,
	stripUnsupportedNestedWaveClips,
} from './aup4-opaque-merge.js';
import {
	AUP4_APPLICATION_ID,
	AUP4_AUDACITY_VERSION,
	AUP4_BINARY_XML_VERSION,
	AUP4_USER_VERSION,
	Aup4Error,
	cloneCompatibilityValue,
	compareVersion,
	finite,
	finiteInRange,
	integerInRange,
	positiveRate,
} from './aup4-profile-values.js';
import { sanitizeAup4ProjectRoot } from './aup4-sanitization.js';
import { nativeAup4TimeSignatureDenominator } from './aup4-time-signature.ts';
import {
	createLabelTrackNode,
	createMetadataNode,
	createWaveTrackNode,
	trackChannelCount,
} from './aup4-track-nodes.js';
import {
	AUDIO_EDITOR_SNAP_UPSTREAM_MAX,
	audioEditorSnapGrid,
} from './snap-grid.js';
import { getPortableProjectSizeLimit } from '../project-size-limits.ts';
import {
	sampleFrameToSeconds as framesToSeconds,
	secondsToSampleFrame as secondsToFrames,
} from './timeline-time.ts';

export {
	AUP4_APPLICATION_ID,
	AUP4_AUDACITY_VERSION,
	AUP4_BINARY_XML_VERSION,
	AUP4_HISTORY_DEPTH,
	AUP4_MAX_BLOCK_SAMPLES,
	AUP4_SAMPLE_FORMAT_FLOAT32,
	AUP4_UPSTREAM_COMMIT,
	AUP4_USER_VERSION,
	Aup4Error,
} from './aup4-profile-values.js';
export { createAup4SampleBlock, decodeAup4Float32Samples } from './aup4-sample-block.js';

const AUP4_COMPATIBILITY_DISPOSITIONS = new Set(['preserved', 'converted', 'missing', 'omitted']);

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
	if (!report || report.schemaVersion !== 1 || !['aup4', 'audacity-project'].includes(report.format)) {
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

export function getAup4SaveLimit(options = {}) {
	return getPortableProjectSizeLimit(options);
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
		issues.push({ level: 'error', code: 'NEWER_DATABASE', message: 'This project uses a newer Audacity database profile.' });
	} else if (Number(userVersion) <= 0) issues.push({ level: 'error', code: 'INVALID_DATABASE_VERSION', message: 'The Audacity database profile is invalid.' });
	if (xmlVersion != null && !/^\d+\.\d+\.\d+$/.test(String(xmlVersion))) {
		issues.push({ level: 'error', code: 'INVALID_XML_VERSION', message: 'The Audacity document profile is invalid.' });
	} else if (xmlVersion && compareVersion(xmlVersion, AUP4_BINARY_XML_VERSION) > 0) {
		issues.push({ level: 'error', code: 'NEWER_XML', message: 'This project uses a newer Audacity document profile.' });
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
	const denominator = nativeAup4TimeSignatureDenominator(timeSignature.denominator);
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
		attribute('sel0', 'double', framesToSeconds(project.selection?.startFrame ?? 0, sampleRate), 10),
		attribute('sel1', 'double', framesToSeconds(project.selection?.endFrame ?? 0, sampleRate), 10),
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
		tempo: finiteInRange(audacityXmlAttribute(root, 'time_signature_tempo', 120), 1, 1_000, 120),
		timeSignature: {
			numerator: integerInRange(audacityXmlAttribute(root, 'time_signature_upper', 4),
				1, 0x7fff_ffff, 4),
			denominator: nativeAup4TimeSignatureDenominator(
				audacityXmlAttribute(root, 'time_signature_lower', 4),
			),
		},
		audioTrackCount: audacityXmlChildren(root, 'wavetrack').length,
		labelTrackCount: audacityXmlChildren(root, 'labeltrack').length,
	};
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
