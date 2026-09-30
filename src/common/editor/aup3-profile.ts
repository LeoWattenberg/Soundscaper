/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAup4ProjectDocument } from './aup4-profile.js';
import { aup4ClipTempoStretchRatio } from './aup4-clip-timing.ts';
import { booleanValue } from './aup4-conversion-values.js';
import { aup3EffectOmission, projectAup3EffectState } from './aup3-effect-profile.ts';
import { trackChannelCount } from './aup4-track-nodes.js';

export {
	createAup4SampleBlock as createAup3SampleBlock,
	decodeAup4Float32Samples as decodeAup3Float32Samples,
} from './aup4-sample-block.js';

export const AUP3_APPLICATION_ID = 0x41554459;
export const AUP3_USER_VERSION = 0x03070000;
export const AUP3_BINARY_XML_VERSION = '1.3.0';
export const AUP3_AUDACITY_VERSION = '3.7.9';
export const AUP3_UPSTREAM_COMMIT = '86d74c770974b25188ca2f23bcce47c1181bd08a';
export const AUP3_PAGE_SIZE = 65_536;
export const AUP3_SAMPLE_FORMAT_FLOAT32 = 0x0004000f;
export const AUP3_MAX_BLOCK_SAMPLES = 262_144;

export const AUP3_SCHEMA_SQL = `
	PRAGMA application_id = ${AUP3_APPLICATION_ID};
	PRAGMA user_version = ${AUP3_USER_VERSION};
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
`;

export const AUP3_COLUMN_PROFILE = Object.freeze({
	project: Object.freeze([['id', 'INTEGER', 1], ['dict', 'BLOB', 0], ['doc', 'BLOB', 0]]),
	autosave: Object.freeze([['id', 'INTEGER', 1], ['dict', 'BLOB', 0], ['doc', 'BLOB', 0]]),
	sampleblocks: Object.freeze([
		['blockid', 'INTEGER', 1], ['sampleformat', 'INTEGER', 0], ['summin', 'REAL', 0],
		['summax', 'REAL', 0], ['sumrms', 'REAL', 0], ['summary256', 'BLOB', 0],
		['summary64k', 'BLOB', 0], ['samples', 'BLOB', 0],
	]),
} as const);

export class Aup3Error extends Error {
	readonly code: string;

	constructor(message: string, code = 'AUP3_ERROR', options?: ErrorOptions) {
		super(message, options);
		this.name = 'Aup3Error';
		this.code = code;
	}
}

export interface Aup3BlockReference {
	readonly blockId: number;
	readonly sampleCount: number;
	readonly start?: number;
}

export interface Aup3XmlAttribute {
	readonly kind: 'attribute';
	readonly name: string;
	readonly type: string;
	readonly value: unknown;
	readonly digits?: number;
}

export interface Aup3XmlBlob {
	readonly kind: 'blob';
	readonly name: string;
	readonly value: Uint8Array;
}

export interface Aup3XmlText {
	readonly kind: 'data' | 'raw';
	readonly value: string;
}

export interface Aup3XmlNodeEntry {
	readonly kind: 'node';
	readonly node: Aup3XmlNode;
}

export interface Aup3XmlNode {
	readonly name: string;
	readonly content: Aup3XmlEntry[];
}

export type Aup3XmlEntry = Aup3XmlAttribute | Aup3XmlBlob | Aup3XmlText | Aup3XmlNodeEntry;

export interface Aup3ProjectDocument {
	readonly roots: Aup3XmlEntry[];
}

export interface Aup3XmlOmission {
	readonly kind: 'attribute' | 'blob' | 'node';
	readonly name: string;
	readonly path: string;
	readonly reason:
		| 'converted-aup3-attribute'
		| 'unsupported-aup3-attribute'
		| 'unsupported-aup3-blob'
		| 'unsupported-aup3-cutline'
		| 'unsupported-aup3-effect-binary-state'
		| 'unsupported-aup3-realtime-effect'
		| 'unsupported-aup3-tempo-follow';
	readonly byteLength?: number;
	readonly count?: number;
	readonly active?: boolean;
	readonly nativeId?: string;
	readonly type?: string;
}

export interface Aup3XmlOmissionReport {
	readonly count: number;
	readonly attributeCount: number;
	readonly blobCount: number;
	readonly entries: readonly Aup3XmlOmission[];
}

export interface Aup3ProjectDocumentResult {
	readonly document: Aup3ProjectDocument;
	readonly omissions: Aup3XmlOmissionReport;
}

interface Aup3WaveClipTiming {
	readonly rawAudioTempo: number;
	readonly storedStretchRatio: number;
}

const ROOT_OMISSIONS = new Set([
	'viewstate_zoom', 'viewstate_vpos', 'viewstate_hpos', 'snap_type', 'snap_triplets',
]);
const WAVE_TRACK_OMISSIONS = new Set([
	'isFocused', 'rulerType', 'trackViewType', 'syncWithGlobalSettings', 'minFreq',
	'maxFreq', 'range', 'frequencyGain', 'windowType', 'windowSize', 'zeroPaddingFactor',
	'colorScheme', 'scaleType', 'algorithm',
]);
const LABEL_TRACK_OMISSIONS = new Set(['isFocused']);
const WAVE_CLIP_OMISSIONS = new Set([
	'clipStretchToMatchTempo', 'groupId', 'clipTempo', 'isSelected',
]);
const LABEL_OMISSIONS = new Set(['isSelected']);
/**
 * Build the pinned Audacity 3.7.9 document from the maintained AUP4 tree
 * builder, then remove fields introduced by the AUP4 profile. Audacity 3's
 * binary serializer has no blob field, so opaque blob entries are always
 * omitted and reported instead of producing a file 3.7.9 cannot decode.
 */
export function createAup3ProjectDocument(
	project: unknown,
	channelBlocks: ReadonlyMap<string, readonly Aup3BlockReference[]> = new Map(),
): Aup3ProjectDocumentResult {
	const effectProjection = projectAup3EffectState(project);
	const aup4Document = createAup4ProjectDocument(
		effectProjection.project, new Map(channelBlocks),
	) as Aup3ProjectDocument;
	applyAup3TrackViewState(aup4Document, project);
	const omissions: Aup3XmlOmission[] = [
		...cutLineOmissions(project), ...effectProjection.omissions,
	];
	const projectTempo = documentProjectTempo(aup4Document);
	const roots = aup4Document.roots.flatMap((entry, index) => {
		const rewritten = rewriteEntry(entry, `$[${String(index)}]`, omissions, projectTempo, true);
		return rewritten === null ? [] : [rewritten];
	});
	const attributeCount = omissions.filter((entry) => entry.kind === 'attribute').length;
	const blobCount = omissions.filter((entry) => entry.kind === 'blob').length;
	return {
		document: { roots },
		omissions: {
			count: omissions.length,
			attributeCount,
			blobCount,
			entries: omissions,
		},
	};
}

function applyAup3TrackViewState(document: Aup3ProjectDocument, project: unknown): void {
	const projectRecord = recordValue(project);
	const tracks = Array.isArray(projectRecord?.tracks) ? projectRecord.tracks : [];
	const states: Array<Readonly<{ height: number; minimized: boolean }>> = [];
	for (const trackValue of tracks) {
		const track = recordValue(trackValue);
		if (!track) continue;
		const kind = String(track.kind ?? track.type ?? 'audio');
		const count = kind === 'label' ? 1 : trackChannelCount(projectRecord, track);
		const defaultHeight = kind === 'label' ? 96 : 160;
		const height = Math.max(40, Math.min(1_000, Math.round(positiveNumber(track.height, defaultHeight))));
		for (let channel = 0; channel < count; channel += 1) {
			states.push({ height, minimized: Boolean(track.collapsed) });
		}
	}
	const root = document.roots.find((entry): entry is Aup3XmlNodeEntry => (
		entry.kind === 'node' && entry.node.name === 'project'
	));
	if (!root) return;
	const trackNodes = root.node.content.filter((entry): entry is Aup3XmlNodeEntry => (
		entry.kind === 'node' && ['wavetrack', 'labeltrack'].includes(entry.node.name)
	));
	for (const [index, entry] of trackNodes.entries()) {
		const state = states[index];
		if (!state) continue;
		upsertAttribute(entry.node, {
			kind: 'attribute', name: 'height', type: 'int', value: state.height,
		});
		upsertAttribute(entry.node, {
			kind: 'attribute', name: 'minimized', type: 'bool', value: state.minimized,
		}, 'height');
	}
}

function upsertAttribute(
	node: Aup3XmlNode,
	attribute: Aup3XmlAttribute,
	afterName?: string,
): void {
	const existing = node.content.findIndex((entry) => (
		entry.kind === 'attribute' && entry.name === attribute.name
	));
	if (existing >= 0) {
		node.content.splice(existing, 1, attribute);
		return;
	}
	const after = afterName == null ? -1 : node.content.findIndex((entry) => (
		entry.kind === 'attribute' && entry.name === afterName
	));
	const firstChild = node.content.findIndex((entry) => entry.kind !== 'attribute');
	const insertion = after >= 0 ? after + 1 : firstChild >= 0 ? firstChild : node.content.length;
	node.content.splice(insertion, 0, attribute);
}

function cutLineOmissions(project: unknown): Aup3XmlOmission[] {
	const clips = recordValue(project)?.clips;
	if (!Array.isArray(clips)) return [];
	return clips.flatMap((clipValue, index) => {
		const clip = recordValue(clipValue);
		const opaque = recordValue(clip?.opaqueExtensions);
		const count = Math.max(0, Math.trunc(Number(opaque?.audacityCutLineCount) || 0));
		if (!count) return [];
		return [{
			kind: 'node' as const,
			name: 'waveclip',
			path: `project/clips/${String(clip?.id ?? index)}/cut-lines`,
			reason: 'unsupported-aup3-cutline' as const,
			count,
		}];
	});
}

function recordValue(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function rewriteEntry(
	entry: Aup3XmlEntry,
	path: string,
	omissions: Aup3XmlOmission[],
	projectTempo: number,
	rackActive: boolean,
): Aup3XmlEntry | null {
	if (entry.kind === 'blob') {
		omissions.push({
			kind: 'blob',
			name: entry.name,
			path: `${path}/@${entry.name}`,
			reason: 'unsupported-aup3-blob',
			byteLength: entry.value.byteLength,
		});
		return null;
	}
	if (entry.kind === 'node') {
		const nodePath = `${path}/${entry.node.name}`;
		const effectOmission = entry.node.name === 'effect'
			? aup3EffectOmission(entry.node, nodePath, rackActive)
			: null;
		if (effectOmission) {
			omissions.push(effectOmission);
			return null;
		}
		return {
			kind: 'node',
			node: rewriteNode(entry.node, nodePath, omissions, projectTempo, rackActive),
		};
	}
	if (entry.kind === 'attribute') return cloneAttribute(entry);
	return { ...entry };
}

function rewriteNode(
	node: Aup3XmlNode,
	path: string,
	omissions: Aup3XmlOmission[],
	projectTempo: number,
	rackActive: boolean,
): Aup3XmlNode {
	const snapEnabled = rootSnapEnabled(node);
	const waveClipTiming = node.name === 'waveclip'
		? aup3WaveClipTiming(node, projectTempo)
		: null;
	const monoWaveTrack = node.name === 'wavetrack'
		&& Number(attributeValue(node, 'channel')) === 0
		&& Number(attributeValue(node, 'linked')) === 0;
	const childRackActive = node.name === 'effects'
		? rackActive && booleanValue(attributeValue(node, 'active'), true)
		: rackActive;
	let snapWritten = false;
	let rawAudioTempoWritten = false;
	let clipStretchRatioWritten = false;
	const childCounts = new Map<string, number>();
	const content: Aup3XmlEntry[] = [];
	const appendWaveClipTiming = (): void => {
		if (!waveClipTiming) return;
		if (!rawAudioTempoWritten) {
			content.push(nativeRawAudioTempo(waveClipTiming));
			rawAudioTempoWritten = true;
		}
		if (!clipStretchRatioWritten) {
			content.push(nativeClipStretchRatio(waveClipTiming));
			clipStretchRatioWritten = true;
		}
	};
	for (const entry of node.content) {
		if (entry.kind === 'attribute') {
			if (node.name === 'waveclip' && entry.name === 'rawAudioTempo') continue;
			if (node.name === 'project' && entry.name === 'snap_enabled') {
				if (!snapWritten) content.push({
					kind: 'attribute', name: 'snapto', type: 'string', value: snapEnabled ? 'on' : 'off',
				});
				snapWritten = true;
				continue;
			}
			if (node.name === 'project' && entry.name === 'snapto') {
				if (!snapWritten) content.push({
					kind: 'attribute', name: 'snapto', type: 'string', value: snapEnabled ? 'on' : 'off',
				});
				snapWritten = true;
				continue;
			}
			if (shouldOmitAttribute(node.name, entry)) {
				omissions.push({
					kind: 'attribute', name: entry.name, path: `${path}/@${entry.name}`,
					reason: omissionReason(node.name, entry),
				});
				continue;
			}
			if (node.name === 'waveclip' && entry.name === 'clipStretchRatio') {
				appendWaveClipTiming();
			}
			if (node.name === 'waveclip' && entry.name === 'clipStretchRatio') continue;
			content.push(rewriteAttribute(node.name, entry, monoWaveTrack));
			continue;
		}
		if (node.name === 'waveclip') appendWaveClipTiming();
		const childName = entry.kind === 'node' ? entry.node.name : entry.kind;
		const childIndex = childCounts.get(childName) ?? 0;
		childCounts.set(childName, childIndex + 1);
		const rewritten = rewriteEntry(
			entry, `${path}/${childName}[${String(childIndex)}]`, omissions, projectTempo,
			childRackActive,
		);
		if (rewritten !== null) content.push(rewritten);
	}
	if (node.name === 'waveclip') appendWaveClipTiming();
	return { name: node.name, content };
}

function shouldOmitAttribute(nodeName: string, entry: Aup3XmlAttribute): boolean {
	if (nodeName === 'project') return ROOT_OMISSIONS.has(entry.name);
	if (nodeName === 'wavetrack') {
		return WAVE_TRACK_OMISSIONS.has(entry.name) || (entry.name === 'gain' && entry.type === 'int');
	}
	if (nodeName === 'labeltrack') return LABEL_TRACK_OMISSIONS.has(entry.name);
	if (nodeName === 'waveclip') return WAVE_CLIP_OMISSIONS.has(entry.name);
	if (nodeName === 'label') return LABEL_OMISSIONS.has(entry.name);
	return false;
}

function omissionReason(
	nodeName: string,
	entry: Aup3XmlAttribute,
): Aup3XmlOmission['reason'] {
	if (nodeName === 'waveclip' && entry.name === 'clipStretchToMatchTempo'
		&& !booleanValue(entry.value, true)) {
		return 'unsupported-aup3-tempo-follow';
	}
	if (nodeName === 'project' && ['viewstate_zoom', 'viewstate_vpos', 'viewstate_hpos'].includes(entry.name)) {
		return 'converted-aup3-attribute';
	}
	if (nodeName === 'waveclip'
		&& ['clipStretchToMatchTempo', 'clipTempo'].includes(entry.name)) {
		return 'converted-aup3-attribute';
	}
	return 'unsupported-aup3-attribute';
}

function rewriteAttribute(
	nodeName: string,
	entry: Aup3XmlAttribute,
	monoWaveTrack: boolean,
): Aup3XmlAttribute {
	if (nodeName === 'project' && entry.name === 'version') return {
		kind: 'attribute', name: entry.name, type: 'string', value: AUP3_BINARY_XML_VERSION,
	};
	if (nodeName === 'project' && entry.name === 'audacityversion') return {
		kind: 'attribute', name: entry.name, type: 'string', value: AUP3_AUDACITY_VERSION,
	};
	if (monoWaveTrack && entry.name === 'channel') {
		return { ...cloneAttribute(entry), value: 2 };
	}
	return cloneAttribute(entry);
}

function cloneAttribute(entry: Aup3XmlAttribute): Aup3XmlAttribute {
	return {
		kind: 'attribute',
		name: entry.name,
		type: entry.type,
		value: entry.value,
		...(entry.digits === undefined ? {} : { digits: entry.digits }),
	};
}

function rootSnapEnabled(node: Aup3XmlNode): boolean {
	const enabled = node.content.find((entry): entry is Aup3XmlAttribute => (
		entry.kind === 'attribute' && entry.name === 'snap_enabled'
	));
	if (enabled !== undefined) return Boolean(enabled.value);
	const legacy = node.content.find((entry): entry is Aup3XmlAttribute => (
		entry.kind === 'attribute' && entry.name === 'snapto'
	));
	return String(legacy?.value ?? 'off').toLowerCase() === 'on';
}

function attributeValue(node: Aup3XmlNode, name: string): unknown {
	for (let index = node.content.length - 1; index >= 0; index -= 1) {
		const entry = node.content[index];
		if (entry?.kind === 'attribute' && entry.name === name) return entry.value;
	}
	return undefined;
}

function nativeRawAudioTempo(timing: Aup3WaveClipTiming): Aup3XmlAttribute {
	return {
		kind: 'attribute',
		name: 'rawAudioTempo',
		type: 'double',
		value: timing.rawAudioTempo,
		digits: 8,
	};
}

function nativeClipStretchRatio(timing: Aup3WaveClipTiming): Aup3XmlAttribute {
	return {
		kind: 'attribute',
		name: 'clipStretchRatio',
		type: 'double',
		value: timing.storedStretchRatio,
		digits: 8,
	};
}

function aup3WaveClipTiming(node: Aup3XmlNode, projectTempo: number): Aup3WaveClipTiming {
	const storedStretchRatio = positiveNumber(attributeValue(node, 'clipStretchRatio'), 1);
	const rawAudioTempo = optionalPositiveNumber(attributeValue(node, 'rawAudioTempo'));
	const clipTempo = optionalPositiveNumber(attributeValue(node, 'clipTempo'));
	const stretchToTempo = booleanValue(attributeValue(node, 'clipStretchToMatchTempo'), true);
	const effectiveStretchRatio = storedStretchRatio * aup4ClipTempoStretchRatio({
		clipTempo,
		rawAudioTempo,
		projectTempo,
		stretchToTempo,
	});
	// Audacity 4 divides raw tempo by a clip-local tempo. Audacity 3 divides it
	// by project tempo instead, so fold that denominator change into the stored
	// ratio while keeping the effective duration identical at export time.
	const preserveRawTempo = rawAudioTempo !== null && (clipTempo !== null || stretchToTempo);
	const legacyRawAudioTempo = preserveRawTempo ? rawAudioTempo : 0;
	const legacyTempoStretchRatio = legacyRawAudioTempo > 0
		? legacyRawAudioTempo / projectTempo
		: 1;
	return {
		rawAudioTempo: legacyRawAudioTempo,
		storedStretchRatio: effectiveStretchRatio / legacyTempoStretchRatio,
	};
}

function documentProjectTempo(document: Aup3ProjectDocument): number {
	const root = document.roots.find((entry): entry is Aup3XmlNodeEntry => (
		entry.kind === 'node' && entry.node.name === 'project'
	));
	return positiveNumber(root && attributeValue(root.node, 'time_signature_tempo'), 120);
}

function positiveNumber(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : fallback;
}

function optionalPositiveNumber(value: unknown): number | null {
	const number = Number(value);
	return value != null && value !== '' && Number.isFinite(number) && number > 0 ? number : null;
}
