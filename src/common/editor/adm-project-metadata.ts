/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeWavAdmRiffChunkSequence,
	normalizeWavOpaqueRiffChunks,
	type WavOpaqueRiffChunk,
	type WavRiffChunkSequenceEntry,
} from './wav-opaque-chunks.ts';
import {
	resolveTerminalChannelWidths,
	type TerminalWidthProject,
} from './terminal-channel-widths.ts';
import {
	admObjectFormatIds,
	normalizeAdmAuthoredObjects,
	type AdmAuthoredObject,
} from './adm-authored-objects.ts';
import {
	MAX_ADM_NAME_BYTES,
	MAX_ADM_PAYLOAD_BYTES,
	base64,
	booleanValue,
	enumValue,
	finiteNumber,
	nonEmptyText,
	objectValue,
	safeInteger,
	text,
} from './adm-normalization-guards.ts';
import {
	ADM_BED_CHANNEL_ORDER,
	ADM_BED_CHANNELS,
	ADM_BED_LAYOUTS,
	admBedChannelCount,
	admBedChannelOrder,
	isAdmBedLayout,
	type AdmBedChannel,
	type AdmBedLayout,
} from './adm-bed-layout.ts';

export {
	ADM_BED_CHANNEL_ORDER,
	ADM_BED_CHANNELS,
	ADM_BED_LAYOUTS,
	admBedChannelCount,
	admBedChannelOrder,
	type AdmBedChannel,
	type AdmBedLayout,
};
export type AdmTerminalStripKind = 'track' | 'group' | 'send';

export interface AdmTerminalStripAssignment {
	readonly stripKind: AdmTerminalStripKind;
	readonly stripId: string;
	/** Zero-based channel index at the output of the terminal strip. */
	readonly sourceChannel: number;
	readonly bedChannel: AdmBedChannel;
	readonly gain: number;
}

export interface AdmAuthoredMetadata {
	readonly mode: 'authored';
	readonly programme: Readonly<{ name: string; language: string }>;
	readonly content: Readonly<{ name: string; language: string }>;
	readonly bed: Readonly<{
		name: string;
		layout: AdmBedLayout;
		assignments: readonly AdmTerminalStripAssignment[];
	}>;
	/**
	 * Positioned objects delivered after the bed, one channel each.
	 *
	 * Absent rather than empty when a programme has none, so a bed-only document
	 * normalizes to exactly the bytes it did before objects existed.
	 */
	readonly objects?: readonly AdmAuthoredObject[];
}

export type AdmPayloadKind = 'axml' | 'bxml' | 'sxml';

export interface AdmChnaEntry {
	readonly trackIndex: number;
	readonly audioTrackUid: string;
	readonly audioTrackFormatIdRef: string;
	readonly audioPackFormatIdRef: string;
}

export interface AdmPassthroughMetadata {
	readonly mode: 'passthrough';
	readonly payload:
		| Readonly<{ kind: 'axml'; xml: string; rawBase64: string }>
		| Readonly<{ kind: 'bxml' | 'sxml'; base64: string }>;
	readonly serialPayload?: Readonly<{ kind: 'sxml'; base64: string }>;
	readonly auxiliaryPayloads?: readonly (
		| Readonly<{ kind: 'axml'; xml: string; rawBase64: string }>
		| Readonly<{ kind: 'bxml'; base64: string }>
	)[];
	/** Exact nonstructural source chunks in their order on each side of PCM data. */
	readonly riffChunkSequence?: readonly WavRiffChunkSequenceEntry[];
	readonly opaqueRiffChunks?: readonly WavOpaqueRiffChunk[];
	readonly chna: Readonly<{
		entries: readonly AdmChnaEntry[];
		rawBase64: string;
	}>;
	readonly source: Readonly<{ id: string; storageKey: string; mimeType: string }>;
	readonly geometry: Readonly<{
		sampleRate: number;
		channelCount: number;
		frameCount: number;
		bitDepth: 16 | 20 | 24 | 32;
		float: boolean;
	}>;
	readonly pristineRevision: number;
	readonly valid: boolean;
	readonly warnings: readonly string[];
}

export type AdmProjectMetadata = AdmAuthoredMetadata | AdmPassthroughMetadata;
export type AdmProjectMetadataInput = AdmProjectMetadata
	| (Readonly<Record<string, unknown>> & Readonly<{ mode: 'authored' | 'passthrough' }>);

export interface AdmPassthroughEligibilityContext {
	readonly projectRevision: number;
	readonly sourceId: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly bitDepth: 16 | 20 | 24 | 32;
	readonly float: boolean;
	readonly startFrame: number;
	readonly endFrame: number;
}

export type AdmPassthroughIneligibilityReason =
	| 'not-passthrough'
	| 'invalid-adm'
	| 'project-revision-changed'
	| 'source-changed'
	| 'range-changed'
	| 'sample-rate-changed'
	| 'channel-count-changed'
	| 'frame-count-changed'
	| 'bit-depth-changed'
	| 'sample-format-changed';

export interface AdmRoutingIssue {
	readonly code: 'unknown-strip' | 'non-terminal-strip' | 'source-channel-out-of-range'
		| 'missing-terminal-strip' | 'missing-bed-channel';
	readonly stripKind?: AdmTerminalStripKind;
	readonly stripId?: string;
	readonly bedChannel?: AdmBedChannel;
	readonly sourceChannel?: number;
	readonly message: string;
}

interface RoutingProject {
	readonly masterChannels: number;
	readonly sources?: readonly Readonly<Record<string, unknown>>[];
	readonly clips?: readonly Readonly<Record<string, unknown>>[];
	readonly tracks?: readonly Readonly<Record<string, unknown>>[];
	readonly mixer?: Readonly<{
		groups?: readonly Readonly<Record<string, unknown>>[];
		sends?: readonly Readonly<Record<string, unknown>>[];
		routes?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
		edges?: readonly unknown[];
	}>;
}

const MAX_ADM_WARNINGS = 100;

export function authoredAdmChannelCount(metadata: unknown): number | null {
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
	const candidate = metadata as Record<string, unknown>;
	if (candidate.mode !== 'authored') return null;
	const normalized = normalizeAdmProjectMetadata(candidate as AdmProjectMetadataInput);
	return normalized.mode === 'authored' ? authoredAdmDeliveryChannelCount(normalized) : null;
}

/** The delivered width of an authored programme: its bed, then one channel per object. */
export function authoredAdmDeliveryChannelCount(metadata: AdmAuthoredMetadata): number {
	return admBedChannelCount(metadata.bed.layout) + (metadata.objects?.length ?? 0);
}

/**
 * The delivered channel order, naming each channel by what feeds it.
 *
 * Bed channels keep their layout names; object channels are named by object ID,
 * so a caller that needs to know which delivered channel an object landed on can
 * ask this rather than recomputing the offset.
 */
export function authoredAdmDeliveryChannels(
	metadata: AdmAuthoredMetadata,
): readonly Readonly<{ kind: 'bed'; bedChannel: AdmBedChannel } | { kind: 'object'; objectId: string }>[] {
	return Object.freeze([
		...admBedChannelOrder(metadata.bed.layout).map((bedChannel) => (
			Object.freeze({ kind: 'bed' as const, bedChannel })
		)),
		...(metadata.objects ?? []).map((object) => Object.freeze({ kind: 'object' as const, objectId: object.id })),
	]);
}

export { admObjectFormatIds };

export function validateAdmProjectChannelCount(project: unknown): true {
	const candidate = objectValue(project, 'project');
	const metadata = objectValue(candidate.metadata, 'project.metadata');
	const channelCount = authoredAdmChannelCount(metadata.adm);
	if (channelCount !== null && candidate.masterChannels !== channelCount) {
		throw new RangeError(`The authored ADM bed requires ${channelCount} master channels.`);
	}
	return true;
}

export function normalizeAdmProjectMetadata(input: AdmProjectMetadataInput): AdmProjectMetadata {
	const candidate = objectValue(input, 'project.metadata.adm');
	if (candidate.mode === 'authored') return normalizeAuthored(candidate);
	if (candidate.mode === 'passthrough') return normalizePassthrough(candidate);
	throw new RangeError(`Unsupported ADM metadata mode: ${String(candidate.mode)}.`);
}

export function validateAdmProjectMetadata(metadata: unknown): true {
	const container = objectValue(metadata, 'project.metadata');
	if (!Object.hasOwn(container, 'adm')) {
		throw new TypeError('project.metadata.adm must be normalized ADM metadata or null.');
	}
	if (container.adm === null) return true;
	const candidate = objectValue(container.adm, 'project.metadata.adm');
	const normalized = normalizeAdmProjectMetadata(candidate as AdmProjectMetadataInput);
	if (!canonicalEqual(candidate, normalized)) {
		throw new TypeError('project.metadata.adm must be normalized ADM metadata.');
	}
	return true;
}

export function evaluateAdmPassthroughEligibility(
	metadata: AdmProjectMetadata | null | undefined,
	context: AdmPassthroughEligibilityContext,
): Readonly<{ eligible: boolean; reason: AdmPassthroughIneligibilityReason | null }> {
	if (metadata?.mode !== 'passthrough') return ineligible('not-passthrough');
	if (!metadata.valid) return ineligible('invalid-adm');
	if (context.projectRevision !== metadata.pristineRevision) return ineligible('project-revision-changed');
	if (context.sourceId !== metadata.source.id) return ineligible('source-changed');
	if (context.startFrame !== 0 || context.endFrame !== metadata.geometry.frameCount) return ineligible('range-changed');
	if (context.sampleRate !== metadata.geometry.sampleRate) return ineligible('sample-rate-changed');
	if (context.channelCount !== metadata.geometry.channelCount) return ineligible('channel-count-changed');
	if (context.frameCount !== metadata.geometry.frameCount) return ineligible('frame-count-changed');
	if (context.bitDepth !== metadata.geometry.bitDepth) return ineligible('bit-depth-changed');
	if (context.float !== metadata.geometry.float) return ineligible('sample-format-changed');
	return Object.freeze({ eligible: true, reason: null });
}

export function isAdmPassthroughEligible(
	metadata: AdmProjectMetadata | null | undefined,
	context: AdmPassthroughEligibilityContext,
): boolean {
	return evaluateAdmPassthroughEligibility(metadata, context).eligible;
}

export function validateAdmAuthoredRouting(
	metadata: AdmProjectMetadata | null | undefined,
	project: RoutingProject,
): readonly AdmRoutingIssue[] {
	if (metadata?.mode !== 'authored') return Object.freeze([]);
	const terminals = collectTerminalStrips(project);
	const issues: AdmRoutingIssue[] = [];
	const assignedStrips = new Set<string>();
	const assignedBedChannels = new Set<AdmBedChannel>();
	for (const assignment of metadata.bed.assignments) {
		const key = resolveStripReference(project, terminals, issues, assignment, 'assignment');
		if (key === null) continue;
		assignedStrips.add(key);
		assignedBedChannels.add(assignment.bedChannel);
	}
	// An object claims its source channel as surely as a bed assignment does, so a
	// strip that only feeds objects is routed rather than unassigned. Reporting it
	// as missing would ask the operator to route it twice.
	for (const object of metadata.objects ?? []) {
		const key = resolveStripReference(project, terminals, issues, object, `object ${object.id}`);
		if (key !== null) assignedStrips.add(key);
	}
	for (const [key, terminal] of terminals) if (!assignedStrips.has(key)) issues.push(Object.freeze({
		code: 'missing-terminal-strip', stripKind: terminal.kind, stripId: terminal.id,
		message: `Terminal ${terminal.kind} ${terminal.id} has no ADM bed assignment.`,
	}));
	for (const bedChannel of admBedChannelOrder(metadata.bed.layout)) if (!assignedBedChannels.has(bedChannel)) {
		issues.push(Object.freeze({
			code: 'missing-bed-channel', bedChannel,
			message: `ADM bed channel ${bedChannel} has no assignment.`,
		}));
	}
	return Object.freeze(issues);
}

/** Check one strip reference, reporting what is wrong and returning its key when it is not. */
function resolveStripReference(
	project: RoutingProject,
	terminals: ReadonlyMap<string, { kind: AdmTerminalStripKind; id: string; channelCount: number }>,
	issues: AdmRoutingIssue[],
	reference: Readonly<{ stripKind: AdmTerminalStripKind; stripId: string; sourceChannel: number }>,
	subject: string,
): string | null {
	const { stripKind, stripId, sourceChannel } = reference;
	const key = stripKey(stripKind, stripId);
	const terminal = terminals.get(key);
	if (!terminal) {
		const known = stripExists(project, stripKind, stripId);
		issues.push(Object.freeze({
			code: known ? 'non-terminal-strip' : 'unknown-strip',
			stripKind,
			stripId,
			message: `ADM ${subject} references ${known ? 'non-terminal' : 'unknown'} ${stripKind} ${stripId}.`,
		}));
		return null;
	}
	if (sourceChannel >= terminal.channelCount) issues.push(Object.freeze({
		code: 'source-channel-out-of-range',
		stripKind,
		stripId,
		sourceChannel,
		message: `ADM source channel ${sourceChannel} is outside ${stripId}.`,
	}));
	return key;
}

function normalizeAuthored(input: Record<string, unknown>): AdmAuthoredMetadata {
	const programme = objectValue(input.programme, 'project.metadata.adm.programme');
	const content = objectValue(input.content, 'project.metadata.adm.content');
	const bed = objectValue(input.bed, 'project.metadata.adm.bed');
	const layout = bed.layout;
	if (!isAdmBedLayout(layout)) throw new RangeError(`Unsupported ADM bed layout: ${String(layout)}.`);
	const bedChannels = new Set(admBedChannelOrder(layout));
	if (!Array.isArray(bed.assignments)) throw new TypeError('project.metadata.adm.bed.assignments must be an array.');
	const seen = new Set<string>();
	const assignments = bed.assignments.map((value, index) => {
		const item = objectValue(value, `project.metadata.adm.bed.assignments[${index}]`);
		const stripKind = enumValue(item.stripKind, ['track', 'group', 'send'], `ADM assignment ${index} strip kind`);
		const stripId = nonEmptyText(item.stripId, `ADM assignment ${index} strip ID`, MAX_ADM_NAME_BYTES);
		const sourceChannel = safeInteger(item.sourceChannel, 0, 65_535, `ADM assignment ${index} source channel`);
		const bedChannel = enumValue(item.bedChannel, ADM_BED_CHANNELS, `ADM assignment ${index} bed channel`);
		if (!bedChannels.has(bedChannel)) throw new RangeError(`ADM bed channel ${bedChannel} is not part of the ${layout} layout.`);
		const gain = finiteNumber(item.gain ?? 1, 0, 4, `ADM assignment ${index} gain`);
		const key = `${stripKind}\0${stripId}\0${sourceChannel}\0${bedChannel}`;
		if (seen.has(key)) throw new RangeError(`Duplicate ADM assignment for ${stripKind} ${stripId}.`);
		seen.add(key);
		return Object.freeze({ stripKind, stripId, sourceChannel, bedChannel, gain });
	});
	const objects = normalizeAdmAuthoredObjects(input.objects, admBedChannelCount(layout));
	return Object.freeze({
		mode: 'authored',
		programme: normalizeNamedElement(programme, 'programme'),
		content: normalizeNamedElement(content, 'content'),
		bed: Object.freeze({
			name: nonEmptyText(bed.name, 'ADM bed name', MAX_ADM_NAME_BYTES),
			layout,
			assignments: Object.freeze(assignments),
		}),
		...(objects.length ? { objects } : {}),
	});
}

function normalizePassthrough(input: Record<string, unknown>): AdmPassthroughMetadata {
	const payload = normalizePayload(objectValue(input.payload, 'project.metadata.adm.payload'));
	const riffChunkSequence = input.riffChunkSequence == null
		? undefined
		: normalizeWavAdmRiffChunkSequence(input.riffChunkSequence);
	const opaqueRiffChunks = input.opaqueRiffChunks == null
		? undefined
		: normalizeWavOpaqueRiffChunks(input.opaqueRiffChunks);
	let normalizedSerialPayload: AdmPassthroughMetadata['serialPayload'];
	if (input.serialPayload != null) {
		const candidate = normalizePayload(objectValue(input.serialPayload, 'project.metadata.adm.serialPayload'));
		if (candidate.kind !== 'sxml') throw new RangeError('ADM serialPayload must contain SXML.');
		normalizedSerialPayload = Object.freeze({ kind: 'sxml', base64: candidate.base64 });
	}
	if (payload.kind === 'sxml' && normalizedSerialPayload) {
		throw new RangeError('ADM passthrough cannot contain two SXML payloads.');
	}
	let auxiliaryPayloads: NonNullable<AdmPassthroughMetadata['auxiliaryPayloads']> | undefined;
	if (input.auxiliaryPayloads != null) {
		if (!Array.isArray(input.auxiliaryPayloads) || input.auxiliaryPayloads.length > 2) {
			throw new RangeError('ADM auxiliaryPayloads must contain at most two static XML payloads.');
		}
		const seenKinds = new Set(payload.kind === 'sxml' ? [] : [payload.kind]);
		auxiliaryPayloads = Object.freeze(input.auxiliaryPayloads.map((value, index) => {
			const candidate = normalizePayload(objectValue(value, `project.metadata.adm.auxiliaryPayloads[${index}]`));
			if (candidate.kind === 'sxml') throw new RangeError('ADM auxiliary payloads must be AXML or BXML.');
			if (seenKinds.has(candidate.kind)) throw new RangeError(`ADM passthrough contains duplicate ${candidate.kind.toUpperCase()} payloads.`);
			seenKinds.add(candidate.kind);
			return candidate.kind === 'axml'
				? candidate
				: Object.freeze({ kind: 'bxml' as const, base64: candidate.base64 });
		}));
	}
	const chna = objectValue(input.chna, 'project.metadata.adm.chna');
	const source = objectValue(input.source, 'project.metadata.adm.source');
	const geometry = objectValue(input.geometry, 'project.metadata.adm.geometry');
	if (!Array.isArray(chna.entries)) throw new TypeError('project.metadata.adm.chna.entries must be an array.');
	if (chna.entries.length > 65_535) throw new RangeError('ADM CHNA has too many entries.');
	const uids = new Set<string>();
	const entries = chna.entries.map((value, index) => {
		const entry = objectValue(value, `project.metadata.adm.chna.entries[${index}]`);
		const trackIndex = safeInteger(entry.trackIndex, 1, 65_535, `ADM CHNA entry ${index} track index`);
		const audioTrackUid = admId(entry.audioTrackUid, /^ATU_[\dA-F]{8}$/u, `ADM CHNA entry ${index} audioTrackUid`);
		const audioTrackFormatIdRef = admTrackRef(entry.audioTrackFormatIdRef, `ADM CHNA entry ${index} audioTrackFormatIdRef`);
		const audioPackFormatIdRef = entry.audioPackFormatIdRef === ''
			? ''
			: admId(entry.audioPackFormatIdRef, /^AP_[\dA-F]{8}$/u, `ADM CHNA entry ${index} audioPackFormatIdRef`);
		if (uids.has(audioTrackUid)) throw new RangeError(`Duplicate ADM CHNA audioTrackUid: ${audioTrackUid}.`);
		uids.add(audioTrackUid);
		return Object.freeze({ trackIndex, audioTrackUid, audioTrackFormatIdRef, audioPackFormatIdRef });
	});
	if (!Array.isArray(input.warnings)) throw new TypeError('project.metadata.adm.warnings must be an array.');
	if (input.warnings.length > MAX_ADM_WARNINGS) throw new RangeError(`ADM metadata supports at most ${MAX_ADM_WARNINGS} warnings.`);
	const rawChnaBase64 = base64(chna.rawBase64, 'ADM CHNA rawBase64');
	const valid = booleanValue(input.valid, 'ADM validity flag');
	if (valid && payload.kind !== 'sxml' && (entries.length === 0 || rawChnaBase64 === '')) {
		throw new RangeError('Static AXML or BXML passthrough requires CHNA metadata.');
	}
	return Object.freeze({
		mode: 'passthrough',
		payload,
		...(normalizedSerialPayload ? { serialPayload: normalizedSerialPayload } : {}),
		...(auxiliaryPayloads?.length ? { auxiliaryPayloads } : {}),
		...(riffChunkSequence?.length ? { riffChunkSequence } : {}),
		...(opaqueRiffChunks?.length ? { opaqueRiffChunks } : {}),
		chna: Object.freeze({ entries: Object.freeze(entries), rawBase64: rawChnaBase64 }),
		source: Object.freeze({
			id: nonEmptyText(source.id, 'ADM source ID', MAX_ADM_NAME_BYTES),
			storageKey: nonEmptyText(source.storageKey, 'ADM source storage key', 4_096),
			mimeType: nonEmptyText(source.mimeType, 'ADM source MIME type', 256),
		}),
		geometry: Object.freeze({
			sampleRate: safeInteger(geometry.sampleRate, 1, 768_000, 'ADM source sample rate'),
			channelCount: safeInteger(geometry.channelCount, 1, 65_535, 'ADM source channel count'),
			frameCount: safeInteger(geometry.frameCount, 0, Number.MAX_SAFE_INTEGER, 'ADM source frame count'),
			bitDepth: enumValue(geometry.bitDepth, [16, 20, 24, 32], 'ADM source bit depth'),
			float: booleanValue(geometry.float, 'ADM source float flag'),
		}),
		pristineRevision: safeInteger(input.pristineRevision, 0, Number.MAX_SAFE_INTEGER, 'ADM pristine project revision'),
		valid,
		warnings: Object.freeze(input.warnings.map((warning, index) => text(warning, `ADM warning ${index}`, 4_096))),
	});
}

function normalizePayload(input: Record<string, unknown>): AdmPassthroughMetadata['payload'] {
	const kind = enumValue(input.kind, ['axml', 'bxml', 'sxml'], 'ADM payload kind');
	if (kind === 'bxml' || kind === 'sxml') {
		if (typeof input.base64 !== 'string') throw new TypeError(`ADM ${kind.toUpperCase()} base64 payload must be a string.`);
		return Object.freeze({ kind, base64: base64(input.base64, `ADM ${kind.toUpperCase()} base64`) });
	}
	if (typeof input.xml !== 'string') throw new TypeError(`ADM ${kind.toUpperCase()} xml payload must be a string.`);
	const xml = text(input.xml, `ADM ${kind.toUpperCase()} XML`, MAX_ADM_PAYLOAD_BYTES, true);
	if (!Object.hasOwn(input, 'rawBase64')) throw new RangeError('ADM AXML passthrough requires exact raw AXML bytes.');
	const rawBase64 = base64(input.rawBase64, 'ADM raw AXML base64');
	let rawXml: string;
	try {
		const binary = atob(rawBase64);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
		rawXml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (error) {
		throw new RangeError('ADM raw AXML must contain valid UTF-8.', { cause: error });
	}
	if (rawXml !== xml) throw new RangeError('ADM raw AXML bytes must decode to the normalized AXML text.');
	return Object.freeze({ kind, xml, rawBase64 });
}

function normalizeNamedElement(value: Record<string, unknown>, name: string): Readonly<{ name: string; language: string }> {
	const language = text(value.language ?? '', `ADM ${name} language`, 128);
	if (language && !/^[A-Za-z]{2,3}$/u.test(language)) {
		throw new RangeError(`ADM ${name} language must be a two- or three-letter ISO 639 code.`);
	}
	return Object.freeze({
		name: nonEmptyText(value.name, `ADM ${name} name`, MAX_ADM_NAME_BYTES),
		language,
	});
}

function collectTerminalStrips(project: RoutingProject): Map<string, { kind: AdmTerminalStripKind; id: string; channelCount: number }> {
	const terminals = new Map<string, { kind: AdmTerminalStripKind; id: string; channelCount: number }>();
	const widths = resolveTerminalChannelWidths(project as TerminalWidthProject);
	const masterFed = masterFedStrips(project);
	for (const track of project.tracks ?? []) {
		if (track.type !== 'audio' || typeof track.id !== 'string') continue;
		if (masterFed ? !masterFed.has(track.id) : project.mixer?.routes?.[track.id]?.groupId != null) continue;
		const channelCount = widths.tracks.get(track.id) ?? 2;
		terminals.set(stripKey('track', track.id), { kind: 'track', id: track.id, channelCount });
	}
	for (const [kind, buses] of [['group', project.mixer?.groups], ['send', project.mixer?.sends]] as const) {
		for (const bus of buses ?? []) if (typeof bus.id === 'string') {
			if (masterFed && !masterFed.has(bus.id)) continue;
			const channelCount = (kind === 'group' ? widths.groups : widths.sends).get(bus.id) ?? 2;
			terminals.set(stripKey(kind, bus.id), { kind, id: bus.id, channelCount });
		}
	}
	return terminals;
}

/**
 * The strip identifiers that reach the master, on a graph that says so in edges.
 *
 * Returns null for the older shape, whose terminality is read from its route map
 * instead. On a production graph a track routed into a bus is not a terminal and
 * must not be asked for a bed assignment, and a bus that feeds another bus is not
 * one either — which is exactly the set the renderer routes through the bed, so
 * the validator and the render agree by construction rather than by coincidence.
 */
function masterFedStrips(project: RoutingProject): ReadonlySet<string> | null {
	const edges = project.mixer?.edges;
	if (!Array.isArray(edges)) return null;
	const fed = new Set<string>();
	for (const edge of edges) {
		if (!edge || typeof edge !== 'object') continue;
		const candidate = edge as Readonly<Record<string, unknown>>;
		if (candidate.enabled === false) continue;
		const destination = candidate.destination as Readonly<Record<string, unknown>> | undefined;
		const source = candidate.source as Readonly<Record<string, unknown>> | undefined;
		if (destination?.kind !== 'master' || typeof source?.id !== 'string') continue;
		fed.add(source.id);
	}
	return fed;
}

function stripExists(project: RoutingProject, kind: AdmTerminalStripKind, id: string): boolean {
	if (kind === 'track') return Boolean(project.tracks?.some((track) => track.type === 'audio' && track.id === id));
	return Boolean(project.mixer?.[kind === 'group' ? 'groups' : 'sends']?.some((bus) => bus.id === id));
}

function canonicalEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left) && Array.isArray(right) && left.length === right.length
			&& left.every((value, index) => canonicalEqual(value, right[index]));
	}
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const leftKeys = Object.keys(leftRecord).sort();
	const rightKeys = Object.keys(rightRecord).sort();
	return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => (
		key === rightKeys[index] && canonicalEqual(leftRecord[key], rightRecord[key])
	));
}

function ineligible(reason: AdmPassthroughIneligibilityReason): Readonly<{ eligible: false; reason: AdmPassthroughIneligibilityReason }> {
	return Object.freeze({ eligible: false, reason });
}


function admId(value: unknown, pattern: RegExp, name: string): string {
	const normalized = nonEmptyText(value, name, 64).toUpperCase();
	if (!pattern.test(normalized)) throw new RangeError(`${name} is not a valid ADM ID.`);
	return normalized;
}

function admTrackRef(value: unknown, name: string): string {
	const normalized = nonEmptyText(value, name, 64).toUpperCase();
	if (/^AT_[\dA-F]{8}_[\dA-F]{2}$/u.test(normalized)) return normalized;
	if (/^AC_[\dA-F]{8}(?:_00)?$/u.test(normalized)) return normalized.replace(/_00$/u, '');
	throw new RangeError(`${name} is not a valid ADM track or channel format ID.`);
}

function stripKey(kind: AdmTerminalStripKind, id: string): string {
	return `${kind}\0${id}`;
}
