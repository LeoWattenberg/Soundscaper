/* SPDX-License-Identifier: AGPL-3.0-only */

export const ADM_BED_LAYOUTS = Object.freeze(['mono', 'stereo', '5.1'] as const);
export type AdmBedLayout = typeof ADM_BED_LAYOUTS[number];

export const ADM_BED_CHANNEL_ORDER = Object.freeze({
	mono: Object.freeze(['M'] as const),
	stereo: Object.freeze(['L', 'R'] as const),
	'5.1': Object.freeze(['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] as const),
});
export type AdmBedChannel = typeof ADM_BED_CHANNEL_ORDER[AdmBedLayout][number];
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
		| Readonly<{ kind: 'axml'; xml: string }>
		| Readonly<{ kind: 'bxml' | 'sxml'; base64: string }>;
	readonly chna: Readonly<{
		entries: readonly AdmChnaEntry[];
		rawBase64: string;
	}>;
	readonly source: Readonly<{ id: string; storageKey: string; mimeType: string }>;
	readonly geometry: Readonly<{
		sampleRate: number;
		channelCount: number;
		frameCount: number;
		bitDepth: 16 | 24 | 32;
		float: boolean;
	}>;
	readonly pristineRevision: number;
	readonly valid: boolean;
	readonly warnings: readonly string[];
}

export type AdmProjectMetadata = AdmAuthoredMetadata | AdmPassthroughMetadata;
export type AdmProjectMetadataInput = Readonly<Record<string, unknown>> & Readonly<{ mode: 'authored' | 'passthrough' }>;

export interface AdmPassthroughEligibilityContext {
	readonly projectRevision: number;
	readonly sourceId: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly bitDepth: 16 | 24 | 32;
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
	}>;
}

const MAX_ADM_PAYLOAD_BYTES = 16 * 1024 * 1024;
const MAX_ADM_NAME_BYTES = 512;
const MAX_ADM_WARNINGS = 100;
const BASE64_PATTERN = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u;

export function admBedChannelOrder(layout: AdmBedLayout): readonly AdmBedChannel[] {
	if (!ADM_BED_LAYOUTS.includes(layout)) throw new RangeError(`Unsupported ADM bed layout: ${String(layout)}.`);
	return ADM_BED_CHANNEL_ORDER[layout];
}

export function admBedChannelCount(layout: AdmBedLayout): number {
	return admBedChannelOrder(layout).length;
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
		const key = stripKey(assignment.stripKind, assignment.stripId);
		const terminal = terminals.get(key);
		if (!terminal) {
			const known = stripExists(project, assignment.stripKind, assignment.stripId);
			issues.push(Object.freeze({
				code: known ? 'non-terminal-strip' : 'unknown-strip',
				stripKind: assignment.stripKind,
				stripId: assignment.stripId,
				message: known
					? `ADM assignment references non-terminal ${assignment.stripKind} ${assignment.stripId}.`
					: `ADM assignment references unknown ${assignment.stripKind} ${assignment.stripId}.`,
			}));
			continue;
		}
		assignedStrips.add(key);
		assignedBedChannels.add(assignment.bedChannel);
		if (assignment.sourceChannel >= terminal.channelCount) issues.push(Object.freeze({
			code: 'source-channel-out-of-range',
			stripKind: assignment.stripKind,
			stripId: assignment.stripId,
			sourceChannel: assignment.sourceChannel,
			message: `ADM source channel ${assignment.sourceChannel} is outside ${assignment.stripId}.`,
		}));
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

function normalizeAuthored(input: Record<string, unknown>): AdmAuthoredMetadata {
	const programme = objectValue(input.programme, 'project.metadata.adm.programme');
	const content = objectValue(input.content, 'project.metadata.adm.content');
	const bed = objectValue(input.bed, 'project.metadata.adm.bed');
	const layout = bed.layout as AdmBedLayout;
	const bedChannels = new Set(admBedChannelOrder(layout));
	if (!Array.isArray(bed.assignments)) throw new TypeError('project.metadata.adm.bed.assignments must be an array.');
	const seen = new Set<string>();
	const assignments = bed.assignments.map((value, index) => {
		const item = objectValue(value, `project.metadata.adm.bed.assignments[${index}]`);
		const stripKind = enumValue(item.stripKind, ['track', 'group', 'send'], `ADM assignment ${index} strip kind`);
		const stripId = nonEmptyText(item.stripId, `ADM assignment ${index} strip ID`, MAX_ADM_NAME_BYTES);
		const sourceChannel = safeInteger(item.sourceChannel, 0, 65_535, `ADM assignment ${index} source channel`);
		const bedChannel = enumValue(item.bedChannel, ['M', 'L', 'R', 'C', 'LFE', 'Ls', 'Rs'], `ADM assignment ${index} bed channel`);
		if (!bedChannels.has(bedChannel)) throw new RangeError(`ADM bed channel ${bedChannel} is not part of the ${layout} layout.`);
		const gain = finiteNumber(item.gain ?? 1, 0, 4, `ADM assignment ${index} gain`);
		const key = `${stripKind}\0${stripId}\0${sourceChannel}\0${bedChannel}`;
		if (seen.has(key)) throw new RangeError(`Duplicate ADM assignment for ${stripKind} ${stripId}.`);
		seen.add(key);
		return Object.freeze({ stripKind, stripId, sourceChannel, bedChannel, gain });
	});
	return Object.freeze({
		mode: 'authored',
		programme: normalizeNamedElement(programme, 'programme'),
		content: normalizeNamedElement(content, 'content'),
		bed: Object.freeze({
			name: nonEmptyText(bed.name, 'ADM bed name', MAX_ADM_NAME_BYTES),
			layout,
			assignments: Object.freeze(assignments),
		}),
	});
}

function normalizePassthrough(input: Record<string, unknown>): AdmPassthroughMetadata {
	const payload = normalizePayload(objectValue(input.payload, 'project.metadata.adm.payload'));
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
		const audioPackFormatIdRef = admId(entry.audioPackFormatIdRef, /^AP_[\dA-F]{8}$/u, `ADM CHNA entry ${index} audioPackFormatIdRef`);
		if (uids.has(audioTrackUid)) throw new RangeError(`Duplicate ADM CHNA audioTrackUid: ${audioTrackUid}.`);
		uids.add(audioTrackUid);
		return Object.freeze({ trackIndex, audioTrackUid, audioTrackFormatIdRef, audioPackFormatIdRef });
	});
	if (!Array.isArray(input.warnings)) throw new TypeError('project.metadata.adm.warnings must be an array.');
	if (input.warnings.length > MAX_ADM_WARNINGS) throw new RangeError(`ADM metadata supports at most ${MAX_ADM_WARNINGS} warnings.`);
	return Object.freeze({
		mode: 'passthrough',
		payload,
		chna: Object.freeze({ entries: Object.freeze(entries), rawBase64: base64(chna.rawBase64, 'ADM CHNA rawBase64') }),
		source: Object.freeze({
			id: nonEmptyText(source.id, 'ADM source ID', MAX_ADM_NAME_BYTES),
			storageKey: nonEmptyText(source.storageKey, 'ADM source storage key', 4_096),
			mimeType: nonEmptyText(source.mimeType, 'ADM source MIME type', 256),
		}),
		geometry: Object.freeze({
			sampleRate: safeInteger(geometry.sampleRate, 1, 768_000, 'ADM source sample rate'),
			channelCount: safeInteger(geometry.channelCount, 1, 65_535, 'ADM source channel count'),
			frameCount: safeInteger(geometry.frameCount, 0, Number.MAX_SAFE_INTEGER, 'ADM source frame count'),
			bitDepth: enumValue(geometry.bitDepth, [16, 24, 32], 'ADM source bit depth'),
			float: booleanValue(geometry.float, 'ADM source float flag'),
		}),
		pristineRevision: safeInteger(input.pristineRevision, 0, Number.MAX_SAFE_INTEGER, 'ADM pristine project revision'),
		valid: booleanValue(input.valid, 'ADM validity flag'),
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
	return Object.freeze({ kind, xml: text(input.xml, `ADM ${kind.toUpperCase()} XML`, MAX_ADM_PAYLOAD_BYTES) });
}

function normalizeNamedElement(value: Record<string, unknown>, name: string): Readonly<{ name: string; language: string }> {
	const language = text(value.language ?? '', `ADM ${name} language`, 128);
	if (language && !/^[A-Za-z]{2,8}(?:-[A-Za-z\d]{1,8})*$/u.test(language)) {
		throw new RangeError(`ADM ${name} language must be a BCP 47 language tag.`);
	}
	return Object.freeze({
		name: nonEmptyText(value.name, `ADM ${name} name`, MAX_ADM_NAME_BYTES),
		language,
	});
}

function collectTerminalStrips(project: RoutingProject): Map<string, { kind: AdmTerminalStripKind; id: string; channelCount: number }> {
	const terminals = new Map<string, { kind: AdmTerminalStripKind; id: string; channelCount: number }>();
	for (const track of project.tracks ?? []) {
		if (track.type !== 'audio' || typeof track.id !== 'string') continue;
		const route = project.mixer?.routes?.[track.id];
		if (route?.groupId != null) continue;
		const channelCount = trackChannelCount(project, track, project.masterChannels);
		terminals.set(stripKey('track', track.id), { kind: 'track', id: track.id, channelCount });
	}
	for (const [kind, buses] of [['group', project.mixer?.groups], ['send', project.mixer?.sends]] as const) {
		for (const bus of buses ?? []) if (typeof bus.id === 'string') {
			terminals.set(stripKey(kind, bus.id), { kind, id: bus.id, channelCount: project.masterChannels });
		}
	}
	return terminals;
}

function stripExists(project: RoutingProject, kind: AdmTerminalStripKind, id: string): boolean {
	if (kind === 'track') return Boolean(project.tracks?.some((track) => track.type === 'audio' && track.id === id));
	return Boolean(project.mixer?.[kind === 'group' ? 'groups' : 'sends']?.some((bus) => bus.id === id));
}

function trackChannelCount(project: RoutingProject, track: Readonly<Record<string, unknown>>, fallback: number): number {
	const clipIds = new Set(Array.isArray(track.clipIds) ? track.clipIds : []);
	const sourceIds = new Set((project.clips ?? []).filter((clip) => clipIds.has(clip.id)).map((clip) => clip.sourceId));
	const widths = (project.sources ?? []).filter((source) => sourceIds.has(source.id)).map((source) => Number(source.channelCount) || 0);
	return Math.max(0, ...widths) || fallback;
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

function objectValue(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function text(value: unknown, name: string, maximumBytes: number): string {
	if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
	if (value.includes('\0')) throw new RangeError(`${name} cannot contain NUL.`);
	if (new TextEncoder().encode(value).byteLength > maximumBytes) throw new RangeError(`${name} is too large.`);
	return value;
}

function nonEmptyText(value: unknown, name: string, maximumBytes: number): string {
	const normalized = text(value, name, maximumBytes).trim();
	if (!normalized) throw new TypeError(`${name} must be a non-empty string.`);
	return normalized;
}

function safeInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be a safe integer between ${minimum} and ${maximum}.`);
	}
	return number;
}

function finiteNumber(value: unknown, minimum: number, maximum: number, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
}

function enumValue<const Value extends string | number>(value: unknown, allowed: readonly Value[], name: string): Value {
	if (!allowed.includes(value as Value)) throw new RangeError(`${name} is unsupported: ${String(value)}.`);
	return value as Value;
}

function booleanValue(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
	return value;
}

function base64(value: unknown, name: string): string {
	if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
	if (!BASE64_PATTERN.test(value)) throw new RangeError(`${name} must use canonical base64.`);
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	const byteLength = value.length / 4 * 3 - padding;
	if (byteLength > MAX_ADM_PAYLOAD_BYTES) throw new RangeError(`${name} exceeds 16 MiB.`);
	return value;
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
