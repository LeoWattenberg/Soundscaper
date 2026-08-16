/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The main-owned plug-in registry: stable identity, installations, and the
 * trust and compatibility decisions that make one of them usable.
 *
 * Identity is format plus the format-native stable id — never a path, because
 * a path is where a plug-in happens to live rather than what it is. An
 * installation adds the platform, architecture, version and binary digest that
 * distinguish two copies of the same identity. Two installations of one
 * identity make the entry ineligible until the user picks one: scan order is
 * an accident of the filesystem and must never decide silently. A changed
 * digest is therefore a *new* installation rather than an update, which is
 * also what revokes an earlier warning-and-allow decision — that decision
 * authorizes exactly one digest and nothing else.
 *
 * Instrument entries are recorded and never offered. There is no method here
 * that turns one into a host grant, which is the only reason the scanner is
 * allowed to classify them at all.
 *
 * `describe()` is the whole renderer-facing projection: opaque ids, bounded
 * facts, and display text with path separators removed. Binary paths and
 * digests stay behind `hostGrantFor()` and `digestFor()`.
 */

import { createHash } from 'node:crypto';

import {
	type HelperFileIdentity,
	type HelperPluginFormat,
	type HelperPluginHostJobGrant,
	HELPER_PLUGIN_FORMATS,
	validateHelperJobGrant,
} from './helper-job-grant.ts';

export type PluginFormat = HelperPluginFormat;

export const PLUGIN_CLASSIFICATIONS = Object.freeze(['effect', 'instrument', 'unknown'] as const);
export type PluginClassification = (typeof PLUGIN_CLASSIFICATIONS)[number];

export const PLUGIN_SIGNATURE_RESULTS = Object.freeze([
	'trusted', 'untrusted', 'unsigned', 'unverifiable',
] as const);
export type PluginSignatureResult = (typeof PLUGIN_SIGNATURE_RESULTS)[number];

export const PLUGIN_COMPATIBILITY_RESULTS = Object.freeze([
	'compatible', 'incompatible-platform', 'incompatible-architecture', 'incompatible-descriptor', 'unknown',
] as const);
export type PluginCompatibilityResult = (typeof PLUGIN_COMPATIBILITY_RESULTS)[number];

const PLATFORMS = Object.freeze(['darwin', 'linux', 'win32'] as const);
const ARCHITECTURES = Object.freeze(['arm64', 'ia32', 'x64'] as const);

/** Bounds on what one scanner answer may claim. */
export const MAXIMUM_PLUGIN_ENTRIES = 4_096;
export const MAXIMUM_PLUGIN_INSTALLATIONS = 16;
export const MAXIMUM_PLUGIN_TOPOLOGIES = 32;
export const MAXIMUM_PLUGIN_CHANNELS = 4_096;
export const MAXIMUM_PLUGIN_LATENCY_FRAMES = 10_000_000;

const SHA256 = /^[a-f\d]{64}$/u;
const MAXIMUM_TEXT_LENGTH = 256;

export interface PluginChannelTopology {
	readonly inputChannels: number;
	readonly outputChannels: number;
}

/** One scanner answer about one binary, already admitted off the helper wire. */
export interface PluginScanObservation {
	readonly format: PluginFormat;
	readonly stableId: string;
	readonly name: string;
	readonly vendor: string;
	readonly version: string;
	readonly platform: string;
	readonly architecture: string;
	readonly binaryPath: string;
	readonly binaryBytes: number;
	readonly binarySha256: string;
	readonly identity: Readonly<HelperFileIdentity>;
	readonly classification: PluginClassification;
	readonly topologies: readonly PluginChannelTopology[];
	readonly realtimeSupported: boolean;
	readonly offlineSupported: boolean;
	readonly reportedLatencyFrames: number | null;
	readonly signature: PluginSignatureResult;
	readonly compatibility: PluginCompatibilityResult;
	readonly descriptorVersion: number;
}

export type PluginAdmissionRejection = 'malformed' | 'identity-change' | 'quarantined' | 'capacity';

export type PluginRegistryAdmission =
	| Readonly<{
		status: 'recorded';
		entryId: string;
		installationId: string;
		unreviewed: boolean;
		selectionRequired: boolean;
	}>
	| Readonly<{ status: 'rejected'; reason: PluginAdmissionRejection; detail: string }>;

export type PluginIneligibleReason =
	| 'unknown-entry'
	| 'instrument-not-offered'
	| 'identity-collision'
	| 'quarantined'
	| 'classification-unknown'
	| 'incompatible'
	| 'untrusted-code'
	| 'no-supported-mode';

export type PluginRegistryErrorCode =
	| PluginIneligibleReason
	| 'unknown-installation'
	| 'not-active-installation'
	| 'missing-quarantine';

export class PluginRegistryError extends Error {
	readonly code: PluginRegistryErrorCode;

	constructor(code: PluginRegistryErrorCode, message: string) {
		super(message);
		this.name = 'PluginRegistryError';
		this.code = code;
	}
}

export interface PluginInstallationView {
	readonly installationId: string;
	readonly version: string;
	readonly platform: string;
	readonly architecture: string;
	readonly classification: PluginClassification;
	readonly topologies: readonly PluginChannelTopology[];
	readonly realtimeSupported: boolean;
	readonly offlineSupported: boolean;
	readonly reportedLatencyFrames: number | null;
	readonly signature: PluginSignatureResult;
	readonly compatibility: PluginCompatibilityResult;
	readonly descriptorVersion: number;
	readonly reviewed: boolean;
	readonly selected: boolean;
	readonly quarantined: boolean;
}

export interface PluginEntryView {
	readonly entryId: string;
	readonly format: PluginFormat;
	readonly name: string;
	readonly vendor: string;
	readonly classification: PluginClassification;
	readonly eligible: boolean;
	readonly ineligibleReason: PluginIneligibleReason | null;
	readonly installations: readonly PluginInstallationView[];
}

export interface PluginRegistryView {
	readonly entries: readonly PluginEntryView[];
}

interface Installation {
	readonly installationId: string;
	readonly observation: PluginScanObservation;
	reviewed: boolean;
}

interface Entry {
	readonly entryId: string;
	readonly format: PluginFormat;
	readonly stableId: string;
	readonly installations: Map<string, Installation>;
	selected: string | null;
}

export interface DesktopPluginRegistryOptions {
	/**
	 * The durable quarantine, injected so the registry owns no persistence. It
	 * is required rather than defaulted: a registry that answers "nothing is
	 * quarantined" because nobody wired the store is indistinguishable from a
	 * clean machine, and it would record and host the very binaries the durable
	 * store exists to refuse.
	 */
	readonly isQuarantined: (digest: string) => boolean;
}

export class DesktopPluginRegistry {
	readonly #isQuarantined: (digest: string) => boolean;
	readonly #entries = new Map<string, Entry>();
	/** Digest → entry id, so the same bytes can never claim a second identity. */
	readonly #identities = new Map<string, string>();

	constructor(options: DesktopPluginRegistryOptions) {
		if (typeof options.isQuarantined !== 'function') {
			throw new PluginRegistryError('missing-quarantine',
				'A plug-in registry must be given the durable quarantine it consults.');
		}
		this.#isQuarantined = options.isQuarantined;
	}

	record(observation: PluginScanObservation): PluginRegistryAdmission {
		let admitted: PluginScanObservation;
		try {
			admitted = admitObservation(observation);
		} catch (error) {
			return rejected('malformed', error instanceof Error ? error.message : String(error));
		}
		const entryId = entryIdFor(admitted.format, admitted.stableId);
		const claimed = this.#identities.get(admitted.binarySha256);
		if (claimed !== undefined && claimed !== entryId) {
			return rejected('identity-change',
				'That binary previously reported a different plug-in identity and was not recorded.');
		}
		if (this.#isQuarantined(admitted.binarySha256)) {
			return rejected('quarantined', 'That plug-in binary is quarantined and was not recorded.');
		}
		const entry = this.#entries.get(entryId) ?? this.#createEntry(entryId, admitted);
		if (!entry) return rejected('capacity', `The registry holds at most ${String(MAXIMUM_PLUGIN_ENTRIES)} plug-ins.`);
		const installationId = installationIdFor(admitted.binarySha256);
		const existing = entry.installations.get(installationId);
		if (!existing && entry.installations.size >= MAXIMUM_PLUGIN_INSTALLATIONS) {
			return rejected('capacity',
				`A plug-in identity holds at most ${String(MAXIMUM_PLUGIN_INSTALLATIONS)} installations.`);
		}
		if (!existing && entry.installations.size > 0) {
			// A digest the user has never seen re-opens the choice: an earlier
			// selection was made about a set of installations that no longer
			// describes what is on this machine.
			entry.selected = null;
		}
		entry.installations.set(installationId, {
			installationId,
			observation: admitted,
			// A changed digest is never an update of the reviewed installation,
			// so review never carries across binaries — only across rescans of
			// the very same bytes.
			reviewed: existing?.reviewed === true,
		});
		// Registered only now that it holds an installation, so no rejection above
		// can leave an identity in the projection with nothing behind it.
		this.#entries.set(entryId, entry);
		this.#identities.set(admitted.binarySha256, entryId);
		return Object.freeze({
			status: 'recorded' as const,
			entryId,
			installationId,
			unreviewed: entry.installations.get(installationId)?.reviewed !== true,
			selectionRequired: entry.installations.size > 1 && entry.selected === null,
		});
	}

	/** Removes one installation, and the entry once its last one is gone. */
	forget(installationId: string): boolean {
		for (const entry of this.#entries.values()) {
			const installation = entry.installations.get(installationId);
			if (!installation) continue;
			entry.installations.delete(installationId);
			// The binding is a projection of the live installations, not a
			// history: keeping it would leave the one collection here that has no
			// ceiling growing across every record-and-forget cycle. The durable
			// quarantine is what remembers a binary that lied about its identity,
			// and it survives forgetting precisely because this does not.
			this.#identities.delete(installation.observation.binarySha256);
			if (entry.selected === installationId) entry.selected = null;
			if (entry.installations.size === 0) this.#entries.delete(entry.entryId);
			return true;
		}
		return false;
	}

	/** The user resolving a stable-id collision; nothing else may choose. */
	select(installationId: string): void {
		const [entry] = this.#locate(installationId);
		entry.selected = installationId;
	}

	/**
	 * The one explicit warning-and-allow decision. It authorizes exactly the
	 * digest behind this installation id, which is why a changed binary — a new
	 * installation with a new id — is not covered by it.
	 */
	allow(installationId: string): void {
		const [, installation] = this.#locate(installationId);
		if (this.#isQuarantined(installation.observation.binarySha256)) {
			throw new PluginRegistryError('quarantined', 'A quarantined plug-in binary cannot be allowed.');
		}
		installation.reviewed = true;
	}

	/** Withdraws the warning-and-allow decision for exactly that digest. */
	withdrawAllowance(installationId: string): void {
		this.#locate(installationId)[1].reviewed = false;
	}

	describe(): PluginRegistryView {
		return Object.freeze({
			entries: Object.freeze([...this.#entries.values()].map((entry) => this.#describeEntry(entry))),
		});
	}

	eligibility(entryId: string): Readonly<{ eligible: boolean; reason: PluginIneligibleReason | null }> {
		const entry = this.#entries.get(entryId);
		// Named for what it is: reporting an id the registry never held as a
		// collision would have the caller offer the user a choice to resolve.
		if (!entry) return Object.freeze({ eligible: false, reason: 'unknown-entry' as const });
		const reason = this.#ineligibleReason(entry);
		return Object.freeze({ eligible: reason === null, reason });
	}

	/** Main-private: the digest the durable quarantine is keyed by. */
	digestFor(installationId: string): string {
		return this.#locate(installationId)[1].observation.binarySha256;
	}

	/**
	 * The only path from the registry to something that can run. It refuses an
	 * instrument, an installation that is not the active one, and every
	 * ineligible entry, so there is no arrangement of public calls that turns a
	 * scanned instrument into a hosted one.
	 */
	hostGrantFor(installationId: string): HelperPluginHostJobGrant {
		const [entry, installation] = this.#locate(installationId);
		const reason = this.#ineligibleReason(entry);
		if (reason !== null) {
			throw new PluginRegistryError(reason, `That plug-in is not eligible to be hosted (${reason}).`);
		}
		if (this.#active(entry)?.installationId !== installationId) {
			throw new PluginRegistryError('not-active-installation',
				'Only the installation the user selected may be hosted.');
		}
		const { observation } = installation;
		return validateHelperJobGrant('plugin-host', {
			binaryPath: observation.binaryPath,
			binaryBytes: observation.binaryBytes,
			binarySha256: observation.binarySha256,
			format: observation.format,
			identity: observation.identity,
		});
	}

	#createEntry(entryId: string, observation: PluginScanObservation): Entry | null {
		if (this.#entries.size >= MAXIMUM_PLUGIN_ENTRIES) return null;
		const entry: Entry = {
			entryId,
			format: observation.format,
			stableId: observation.stableId,
			installations: new Map(),
			selected: null,
		};
		return entry;
	}

	#locate(installationId: string): [Entry, Installation] {
		for (const entry of this.#entries.values()) {
			const installation = entry.installations.get(installationId);
			if (installation) return [entry, installation];
		}
		throw new PluginRegistryError('unknown-installation', 'That plug-in installation is not registered.');
	}

	/** The installation an entry would use: the only one, or the selected one. */
	#active(entry: Entry): Installation | null {
		if (entry.selected !== null) return entry.installations.get(entry.selected) ?? null;
		return entry.installations.size === 1 ? [...entry.installations.values()][0] : null;
	}

	#ineligibleReason(entry: Entry): PluginIneligibleReason | null {
		// Checked across every installation rather than only the active one: an
		// identity that is an instrument anywhere is never offered, whatever the
		// user later selects.
		if ([...entry.installations.values()].some(({ observation }) => observation.classification === 'instrument')) {
			return 'instrument-not-offered';
		}
		const active = this.#active(entry);
		if (!active) return 'identity-collision';
		if (this.#isQuarantined(active.observation.binarySha256)) return 'quarantined';
		const { observation } = active;
		if (observation.classification !== 'effect') return 'classification-unknown';
		if (observation.compatibility !== 'compatible') return 'incompatible';
		if (observation.signature !== 'trusted' && !active.reviewed) return 'untrusted-code';
		if (!observation.realtimeSupported && !observation.offlineSupported) return 'no-supported-mode';
		return null;
	}

	/**
	 * The text an identity is shown under comes from the installation in use, or
	 * from the incumbent while a collision is unresolved. A binary that turns up
	 * claiming an identity the machine already holds must not be able to rename
	 * it in the very prompt that asks the user which of the two to keep.
	 */
	#label(entry: Entry): PluginScanObservation {
		const [incumbent] = entry.installations.values();
		return (this.#active(entry) ?? incumbent).observation;
	}

	#describeEntry(entry: Entry): PluginEntryView {
		const reason = this.#ineligibleReason(entry);
		const active = this.#active(entry);
		const label = this.#label(entry);
		const classifications = new Set([...entry.installations.values()]
			.map(({ observation }) => observation.classification));
		return Object.freeze({
			entryId: entry.entryId,
			format: entry.format,
			name: displayText(label.name),
			vendor: displayText(label.vendor),
			classification: classifications.size === 1
				? [...classifications][0]
				: ('unknown' as PluginClassification),
			eligible: reason === null,
			ineligibleReason: reason,
			installations: Object.freeze([...entry.installations.values()].map((installation) => Object.freeze({
				installationId: installation.installationId,
				version: displayText(installation.observation.version),
				platform: installation.observation.platform,
				architecture: installation.observation.architecture,
				classification: installation.observation.classification,
				topologies: installation.observation.topologies,
				realtimeSupported: installation.observation.realtimeSupported,
				offlineSupported: installation.observation.offlineSupported,
				reportedLatencyFrames: installation.observation.reportedLatencyFrames,
				signature: installation.observation.signature,
				compatibility: installation.observation.compatibility,
				descriptorVersion: installation.observation.descriptorVersion,
				reviewed: installation.reviewed,
				selected: active?.installationId === installation.installationId,
				quarantined: this.#isQuarantined(installation.observation.binarySha256),
			}))),
		});
	}
}

export function entryIdFor(format: PluginFormat, stableId: string): string {
	return `e${createHash('sha256').update(`${format}\u0000${stableId}`).digest('hex').slice(0, 15)}`;
}

/**
 * Derived from the digest alone: an identity change is refused at admission,
 * so one digest belongs to at most one entry for the registry's lifetime.
 */
export function installationIdFor(binarySha256: string): string {
	return `i${createHash('sha256').update(binarySha256).digest('hex').slice(0, 15)}`;
}

function rejected(reason: PluginAdmissionRejection, detail: string): PluginRegistryAdmission {
	return Object.freeze({ status: 'rejected' as const, reason, detail });
}

function admitObservation(value: unknown): PluginScanObservation {
	const record = plainRecord(value, 'A plug-in scan observation');
	const identity = plainRecord(record.identity, 'A plug-in scan identity');
	const binarySha256 = record.binarySha256;
	if (typeof binarySha256 !== 'string' || !SHA256.test(binarySha256)) {
		throw new TypeError('A plug-in scan observation must carry a lowercase SHA-256 binary digest.');
	}
	const admitted: PluginScanObservation = {
		format: enumValue(record.format, HELPER_PLUGIN_FORMATS, 'plug-in format'),
		stableId: boundedText(record.stableId, 'format-native stable id'),
		name: boundedText(record.name, 'plug-in name'),
		vendor: boundedText(record.vendor, 'plug-in vendor'),
		version: boundedText(record.version, 'plug-in version'),
		platform: enumValue(record.platform, PLATFORMS, 'plug-in platform'),
		architecture: enumValue(record.architecture, ARCHITECTURES, 'plug-in architecture'),
		binaryPath: absolutePath(record.binaryPath),
		binaryBytes: boundedInteger(record.binaryBytes, 1, Number.MAX_SAFE_INTEGER, 'binary byte length'),
		binarySha256,
		identity: Object.freeze({
			dev: boundedInteger(identity.dev, 0, Number.MAX_SAFE_INTEGER, 'file device'),
			ino: boundedInteger(identity.ino, 0, Number.MAX_SAFE_INTEGER, 'file inode'),
		}),
		classification: enumValue(record.classification, PLUGIN_CLASSIFICATIONS, 'plug-in classification'),
		topologies: admitTopologies(record.topologies),
		realtimeSupported: booleanValue(record.realtimeSupported, 'real-time support'),
		offlineSupported: booleanValue(record.offlineSupported, 'offline support'),
		reportedLatencyFrames: record.reportedLatencyFrames === null
			? null
			: boundedInteger(record.reportedLatencyFrames, 0, MAXIMUM_PLUGIN_LATENCY_FRAMES, 'reported latency'),
		signature: enumValue(record.signature, PLUGIN_SIGNATURE_RESULTS, 'signature result'),
		compatibility: enumValue(record.compatibility, PLUGIN_COMPATIBILITY_RESULTS, 'compatibility result'),
		descriptorVersion: boundedInteger(record.descriptorVersion, 0, 1_000_000, 'descriptor version'),
	};
	return Object.freeze(admitted);
}

function admitTopologies(value: unknown): readonly PluginChannelTopology[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAXIMUM_PLUGIN_TOPOLOGIES) {
		throw new TypeError(`A plug-in must report between one and ${String(MAXIMUM_PLUGIN_TOPOLOGIES)} channel topologies.`);
	}
	return Object.freeze(value.map((entry) => {
		const record = plainRecord(entry, 'A plug-in channel topology');
		return Object.freeze({
			inputChannels: boundedInteger(record.inputChannels, 0, MAXIMUM_PLUGIN_CHANNELS, 'input channel count'),
			outputChannels: boundedInteger(record.outputChannels, 0, MAXIMUM_PLUGIN_CHANNELS, 'output channel count'),
		});
	}));
}

/**
 * Scanner-reported text is authored by the plug-in, so it is bounded at
 * admission and stripped of path separators here, at the renderer boundary. A
 * vendor that names itself after a filesystem path still cannot put one into
 * renderer-facing state.
 */
function displayText(value: string): string {
	return value.split(/[\\/]/u).join(' ').replace(/\s+/gu, ' ').trim() || '(unnamed)';
}

function absolutePath(value: unknown): string {
	if (typeof value !== 'string'
		|| value.length === 0
		|| new TextEncoder().encode(value).byteLength > 4_096
		|| value.includes('\u0000')
		|| !(value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\'))
		|| value.split(/[\\/]/u).includes('..')) {
		throw new TypeError('A plug-in binary path must be one absolute, traversal-free path.');
	}
	return value;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

function enumValue<const Values extends readonly string[]>(
	value: unknown,
	values: Values,
	label: string,
): Values[number] {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new TypeError(`A plug-in scan observation must name a supported ${label}.`);
	}
	return value as Values[number];
}

function booleanValue(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`A plug-in ${label} flag must be a boolean.`);
	return value;
}

function boundedText(value: unknown, label: string): string {
	if (typeof value !== 'string'
		|| value.length === 0
		|| value.length > MAXIMUM_TEXT_LENGTH
		|| value.includes('\u0000')) {
		throw new TypeError(`A plug-in ${label} must be bounded, non-empty text.`);
	}
	return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new TypeError(`A plug-in ${label} is outside its admitted bounds.`);
	}
	return value as number;
}
