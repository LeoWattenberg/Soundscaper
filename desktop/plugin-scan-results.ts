/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Result admission for the plug-in scan job kind.
 *
 * A scan answer is the least trusted input the desktop build accepts: it is
 * assembled by a helper that has just walked a user-chosen directory and read
 * third-party binaries, so main re-validates every field before anything else
 * sees it. The admission lives beside the scan surface rather than in the wire
 * schema every helper shares, so no other job kind can widen it by accident.
 *
 * The renderer projection lives here too, because dropping the raw path is
 * part of what a scan result *is* on this side of the wire: main owns paths,
 * and the projection is written key by key so a field added to the helper
 * shape later cannot reach a renderer merely by existing.
 */

import { HELPER_PLUGIN_FORMATS, type HelperPluginFormat } from './helper-job-grant.ts';
import { HelperContractViolationError, MAXIMUM_HELPER_WIRE_MESSAGE_BYTES } from './helper-wire-admission.ts';

/**
 * What a scan of one root can have come to. A root the helper could not read
 * reports the reason and no entries at all, so a caller can never mistake an
 * aborted walk for an empty directory; a root holding more plug-ins than one
 * answer carries reports `root-oversized` with the prefix that fits, so a
 * legitimate large folder is a bounded fact rather than an over-envelope answer
 * the supervisor tears the channel down for.
 */
export const PLUGIN_SCAN_STATUSES = Object.freeze([
	'scanned', 'root-oversized', 'unsupported-format', 'root-unreadable',
] as const);
export type PluginScanStatus = (typeof PLUGIN_SCAN_STATUSES)[number];

/** The statuses that read a directory far enough to name what is in it. */
const REPORTING_STATUSES: readonly PluginScanStatus[] = Object.freeze(['scanned', 'root-oversized']);

export const PLUGIN_CLASSIFICATIONS = Object.freeze(['effect', 'instrument', 'unknown'] as const);
export type PluginClassification = (typeof PLUGIN_CLASSIFICATIONS)[number];

export const PLUGIN_SIGNATURE_RESULTS = Object.freeze([
	'signed-valid', 'signed-invalid', 'unsigned', 'unverifiable',
] as const);
export type PluginSignatureResult = (typeof PLUGIN_SIGNATURE_RESULTS)[number];

export const PLUGIN_COMPATIBILITY_RESULTS = Object.freeze([
	'compatible', 'wrong-architecture', 'unsupported-format', 'malformed', 'oversize',
] as const);
export type PluginCompatibilityResult = (typeof PLUGIN_COMPATIBILITY_RESULTS)[number];

export const MAXIMUM_PLUGIN_CHANNEL_LAYOUTS = 32;
export const MAXIMUM_PLUGIN_CHANNEL_COUNT = 64;
export const MAXIMUM_PLUGIN_SCAN_DETAIL_LENGTH = 1_024;
export const MAXIMUM_PLUGIN_TEXT_LENGTH = 256;
export const MAXIMUM_PLUGIN_BINARY_BYTES = 8 * 1024 ** 3;
export const MAXIMUM_PLUGIN_LATENCY_FRAMES = 1_048_576;
export const MAXIMUM_PLUGIN_DESCRIPTOR_VERSION = 65_535;

/**
 * A scan answer rides the shared control envelope, so that envelope is the
 * bound — not a number declared beside it that can promise more plug-ins than
 * the wire will carry. Admitting a result the envelope cannot hold is how a
 * populated folder became an over-envelope answer, a killed channel, and a
 * healthy root treated as a fault.
 */
export const MAXIMUM_PLUGIN_SCAN_RESULT_BYTES: number = MAXIMUM_HELPER_WIRE_MESSAGE_BYTES;

/** One entry stripped to its shortest admissible form, plus its separator. */
const SMALLEST_SCAN_ENTRY_BYTES = JSON.stringify({
	stableId: 'a', name: 'a', vendor: 'a', version: 'a', binaryPath: '/a', binaryBytes: 1,
	binarySha256: '0'.repeat(64), classification: 'unknown', channelSupport: [], realtime: false,
	offline: false, reportedLatencyFrames: null, signature: 'unverifiable', compatibility: 'compatible',
	descriptorVersion: 0,
}).length + 1;

/** Everything a result carries around its entries, at its longest. */
const SCAN_RESULT_OVERHEAD_BYTES = JSON.stringify({
	format: 'vst3', status: 'root-oversized', detail: 'x'.repeat(MAXIMUM_PLUGIN_SCAN_DETAIL_LENGTH), entries: [],
}).length;

/**
 * Derived rather than declared: how many shortest-possible entries the envelope
 * carries. Entries of ordinary length reach the byte bound first, and a root
 * with more plug-ins than either bound admits answers `root-oversized`.
 */
export const MAXIMUM_PLUGIN_SCAN_ENTRIES = Math.floor(
	(MAXIMUM_PLUGIN_SCAN_RESULT_BYTES - SCAN_RESULT_OVERHEAD_BYTES) / SMALLEST_SCAN_ENTRY_BYTES);

export interface PluginChannelSupport {
	readonly inputs: number;
	readonly outputs: number;
}

export interface PluginScanEntry {
	readonly stableId: string;
	readonly name: string;
	readonly vendor: string;
	readonly version: string;
	/** Main-private. Never projected to a renderer; see the module comment. */
	readonly binaryPath: string;
	readonly binaryBytes: number;
	readonly binarySha256: string;
	readonly classification: PluginClassification;
	readonly channelSupport: readonly PluginChannelSupport[];
	readonly realtime: boolean;
	readonly offline: boolean;
	readonly reportedLatencyFrames: number | null;
	readonly signature: PluginSignatureResult;
	readonly compatibility: PluginCompatibilityResult;
	readonly descriptorVersion: number;
}

export interface HelperPluginScanResult {
	readonly format: HelperPluginFormat;
	readonly status: PluginScanStatus;
	readonly detail: string;
	readonly entries: readonly PluginScanEntry[];
}

export type RendererPluginScanEntry = Omit<PluginScanEntry, 'binaryPath'>;

export interface RendererPluginScanResult {
	readonly format: HelperPluginFormat;
	readonly status: PluginScanStatus;
	readonly detail: string;
	readonly entries: readonly RendererPluginScanEntry[];
}

const RESULT_KEYS = Object.freeze(['format', 'status', 'detail', 'entries']);
const ENTRY_KEYS = Object.freeze([
	'stableId', 'name', 'vendor', 'version', 'binaryPath', 'binaryBytes', 'binarySha256',
	'classification', 'channelSupport', 'realtime', 'offline', 'reportedLatencyFrames',
	'signature', 'compatibility', 'descriptorVersion',
]);
const CHANNEL_KEYS = Object.freeze(['inputs', 'outputs']);
const SHA256 = /^[a-f\d]{64}$/u;

export function validateHelperPluginScanResult(value: unknown): HelperPluginScanResult {
	const record = plainRecord(value, 'A plug-in scan result');
	exactKeys(record, RESULT_KEYS, 'A plug-in scan result');
	const format = enumValue(record.format, HELPER_PLUGIN_FORMATS, 'plug-in format');
	const status = enumValue(record.status, PLUGIN_SCAN_STATUSES, 'plug-in scan status');
	const entries = denseArray(record.entries, 'A plug-in scan result must carry its entry list.');
	if (entries.length > MAXIMUM_PLUGIN_SCAN_ENTRIES) {
		throw new HelperContractViolationError('oversized',
			`A plug-in scan result may name at most ${MAXIMUM_PLUGIN_SCAN_ENTRIES} plug-ins.`);
	}
	if (!REPORTING_STATUSES.includes(status) && entries.length > 0) {
		malformed('A plug-in scan that did not complete must publish no entries.');
	}
	if (status === 'root-oversized' && entries.length === 0) {
		malformed('A plug-in scan of an oversized root must publish the entries it did read.');
	}
	// Identity is format plus format-native stable id, so a root that answers
	// with the same id twice has already lost the ability to say which
	// installation it means. That is a helper fault, not a user choice.
	const stableIds = new Set<string>();
	const admitted = entries.map((entry) => validatePluginScanEntry(entry, stableIds));
	const result = Object.freeze({
		format,
		status,
		detail: boundedDetail(record.detail),
		entries: Object.freeze(admitted),
	});
	if (utf8ByteLength(JSON.stringify(result)) > MAXIMUM_PLUGIN_SCAN_RESULT_BYTES) {
		throw new HelperContractViolationError('oversized',
			`A plug-in scan result must fit the ${String(MAXIMUM_PLUGIN_SCAN_RESULT_BYTES)}-byte control envelope; `
			+ 'a root with more plug-ins than one answer carries is reported as root-oversized.');
	}
	return result;
}

/**
 * The renderer-facing shape of a scan. Every field is copied deliberately and
 * `binaryPath` has no copy at all: a renderer that never receives a raw path
 * cannot leak it into project state, a log, or a later grant.
 */
export function projectPluginScanForRenderer(result: HelperPluginScanResult): RendererPluginScanResult {
	return Object.freeze({
		format: result.format,
		status: result.status,
		detail: result.detail,
		entries: Object.freeze(result.entries.map((entry) => Object.freeze({
			stableId: entry.stableId,
			name: entry.name,
			vendor: entry.vendor,
			version: entry.version,
			binaryBytes: entry.binaryBytes,
			binarySha256: entry.binarySha256,
			classification: entry.classification,
			channelSupport: entry.channelSupport,
			realtime: entry.realtime,
			offline: entry.offline,
			reportedLatencyFrames: entry.reportedLatencyFrames,
			signature: entry.signature,
			compatibility: entry.compatibility,
			descriptorVersion: entry.descriptorVersion,
		}))),
	});
}

function validatePluginScanEntry(value: unknown, stableIds: Set<string>): PluginScanEntry {
	const record = plainRecord(value, 'A plug-in scan entry');
	exactKeys(record, ENTRY_KEYS, 'A plug-in scan entry');
	const stableId = boundedText(record.stableId, 'plug-in stable id');
	if (stableIds.has(stableId)) {
		malformed('A plug-in scan must not report the same stable id twice.');
	}
	stableIds.add(stableId);
	// Each field is read once and the checked read is the one that is stored.
	// Reading a second time to build the result would admit whatever the second
	// read answered, which is not necessarily what the guard approved.
	const binarySha256 = record.binarySha256;
	if (typeof binarySha256 !== 'string' || !SHA256.test(binarySha256)) {
		malformed('A plug-in scan entry must carry a lowercase SHA-256 of its binary.');
	}
	const realtime = record.realtime;
	const offline = record.offline;
	if (typeof realtime !== 'boolean' || typeof offline !== 'boolean') {
		malformed('A plug-in scan entry must state real-time and offline support as booleans.');
	}
	return Object.freeze({
		stableId,
		name: boundedText(record.name, 'plug-in name'),
		vendor: boundedText(record.vendor, 'plug-in vendor'),
		version: boundedText(record.version, 'plug-in version'),
		binaryPath: absolutePath(record.binaryPath),
		binaryBytes: boundedInteger(record.binaryBytes, 1, MAXIMUM_PLUGIN_BINARY_BYTES, 'plug-in binary byte length'),
		binarySha256,
		classification: enumValue(record.classification, PLUGIN_CLASSIFICATIONS, 'plug-in classification'),
		channelSupport: validateChannelSupport(record.channelSupport),
		realtime,
		offline,
		reportedLatencyFrames: record.reportedLatencyFrames === null
			? null
			: boundedInteger(record.reportedLatencyFrames, 0, MAXIMUM_PLUGIN_LATENCY_FRAMES, 'plug-in reported latency'),
		signature: enumValue(record.signature, PLUGIN_SIGNATURE_RESULTS, 'plug-in signature result'),
		compatibility: enumValue(record.compatibility, PLUGIN_COMPATIBILITY_RESULTS, 'plug-in compatibility result'),
		descriptorVersion: boundedInteger(record.descriptorVersion, 0, MAXIMUM_PLUGIN_DESCRIPTOR_VERSION,
			'plug-in descriptor version'),
	});
}

function validateChannelSupport(value: unknown): readonly PluginChannelSupport[] {
	const layouts = denseArray(value, 'A plug-in scan entry must carry its channel support list.');
	if (layouts.length > MAXIMUM_PLUGIN_CHANNEL_LAYOUTS) {
		throw new HelperContractViolationError('oversized',
			`A plug-in scan entry may claim at most ${MAXIMUM_PLUGIN_CHANNEL_LAYOUTS} channel layouts.`);
	}
	return Object.freeze(layouts.map((layout) => {
		const record = plainRecord(layout, 'A plug-in channel layout');
		exactKeys(record, CHANNEL_KEYS, 'A plug-in channel layout');
		return Object.freeze({
			inputs: boundedInteger(record.inputs, 0, MAXIMUM_PLUGIN_CHANNEL_COUNT, 'plug-in input channel count'),
			outputs: boundedInteger(record.outputs, 0, MAXIMUM_PLUGIN_CHANNEL_COUNT, 'plug-in output channel count'),
		});
	}));
}

/**
 * The one path admission every plug-in surface uses, so a path one gate admits
 * cannot be rejected by the next. The bound is counted in UTF-8 bytes because
 * that is what a filesystem counts: a bound in UTF-16 code units both admits
 * paths the operating system will refuse and refuses paths it would accept, and
 * the two answers diverge exactly on the non-ASCII names users actually have.
 */
export const MAXIMUM_PLUGIN_PATH_BYTES = 4_096;

const PATH_ENCODER = new TextEncoder();

export function isAdmissiblePluginPath(value: unknown): value is string {
	return typeof value === 'string'
		&& value.length > 0
		&& PATH_ENCODER.encode(value).byteLength <= MAXIMUM_PLUGIN_PATH_BYTES
		&& !value.includes('\0')
		&& (value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\'))
		&& !value.split(/[\\/]/u).includes('..');
}

/**
 * The path a scan reports is re-checked exactly as a grant path is, because it
 * is the value main would have to trust if it ever acted on this entry.
 */
function absolutePath(value: unknown): string {
	if (!isAdmissiblePluginPath(value)) {
		malformed('A plug-in scan entry must name one absolute, traversal-free binary path.');
	}
	return value;
}

function boundedDetail(value: unknown): string {
	if (typeof value !== 'string' || value.length > MAXIMUM_PLUGIN_SCAN_DETAIL_LENGTH) {
		malformed('A plug-in scan detail must be bounded text.');
	}
	return value;
}

/**
 * A hole is not a value. Every array walk here uses `map`, which skips holes
 * silently, so a list the helper left gapped would carry positions no validator
 * ever saw — past the duplicate check, into the projection, out as nulls.
 */
function denseArray(value: unknown, message: string): readonly unknown[] {
	if (!Array.isArray(value)) malformed(message);
	for (let index = 0; index < value.length; index += 1) {
		if (!Object.hasOwn(value, index)) malformed(message);
	}
	return value as readonly unknown[];
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		malformed(`${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		malformed(`${label} must carry exactly its schema keys.`);
	}
}

function boundedText(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > MAXIMUM_PLUGIN_TEXT_LENGTH) {
		malformed(`A helper ${label} must be bounded non-empty text.`);
	}
	return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		malformed(`A helper ${label} is outside its admitted bounds.`);
	}
	return value as number;
}

function enumValue<const Values extends readonly string[]>(
	value: unknown,
	values: Values,
	label: string,
): Values[number] {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		malformed(`A plug-in scan result must name a known ${label}.`);
	}
	return value as Values[number];
}

function malformed(message: string): never {
	throw new HelperContractViolationError('malformed', message);
}

function utf8ByteLength(value: string): number {
	return PATH_ENCODER.encode(value).byteLength;
}
