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
import { HelperContractViolationError } from './helper-wire-admission.ts';

/**
 * A scan either completed or it did not. There is no partial status: a root
 * the helper could not read reports the reason and no entries at all, so a
 * caller can never mistake an aborted walk for an empty directory.
 */
export const PLUGIN_SCAN_STATUSES = Object.freeze([
	'scanned', 'unsupported-format', 'root-unreadable',
] as const);
export type PluginScanStatus = (typeof PLUGIN_SCAN_STATUSES)[number];

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

/**
 * One scan answers for one root, so its size is bounded like any envelope.
 *
 * This is the outer ceiling and it is not the one a populated root reaches
 * first: the 64 KiB control envelope admits about 185 entries even when every
 * field is one character, so a root holding a few hundred plug-ins fails whole
 * rather than reporting a bounded prefix. Answering such a root needs paging in
 * the wire contract, which is not this module's to add.
 */
export const MAXIMUM_PLUGIN_SCAN_ENTRIES = 512;
export const MAXIMUM_PLUGIN_CHANNEL_LAYOUTS = 32;
export const MAXIMUM_PLUGIN_CHANNEL_COUNT = 64;
export const MAXIMUM_PLUGIN_SCAN_DETAIL_LENGTH = 1_024;
export const MAXIMUM_PLUGIN_TEXT_LENGTH = 256;
export const MAXIMUM_PLUGIN_BINARY_PATH_LENGTH = 4_096;
export const MAXIMUM_PLUGIN_BINARY_BYTES = 8 * 1024 ** 3;
export const MAXIMUM_PLUGIN_LATENCY_FRAMES = 1_048_576;
export const MAXIMUM_PLUGIN_DESCRIPTOR_VERSION = 65_535;

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
	if (status !== 'scanned' && entries.length > 0) {
		malformed('A plug-in scan that did not complete must publish no entries.');
	}
	// Identity is format plus format-native stable id, so a root that answers
	// with the same id twice has already lost the ability to say which
	// installation it means. That is a helper fault, not a user choice.
	const stableIds = new Set<string>();
	const admitted = entries.map((entry) => validatePluginScanEntry(entry, stableIds));
	return Object.freeze({
		format,
		status,
		detail: boundedDetail(record.detail),
		entries: Object.freeze(admitted),
	});
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
 * The path a scan reports is re-checked exactly as a grant path is, because it
 * is the value main would have to trust if it ever acted on this entry.
 */
function absolutePath(value: unknown): string {
	if (typeof value !== 'string'
		|| value.length === 0
		|| value.length > MAXIMUM_PLUGIN_BINARY_PATH_LENGTH
		|| value.includes('\0')
		|| !(value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\'))
		|| value.split(/[\\/]/u).includes('..')) {
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
