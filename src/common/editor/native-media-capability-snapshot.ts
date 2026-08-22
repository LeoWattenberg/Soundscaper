/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * `NativeMediaCapabilitySnapshotV1` — the one truthful report of what the
 * milestone-5B native tier can currently do, and why.
 *
 * Runtime capability is an intersection, never a single flag: the pinned helper
 * build, the driver probe, the self-test, the fail-closed licensing row, the
 * master switch, and the user's per-feature opt-in all have to agree. The
 * snapshot keeps those apart so the report stays accurate when any one of them
 * is missing — most importantly when every helper is disabled and the editor
 * falls back to Web Core, where the report must still say what would have been
 * possible rather than pretending the capability never existed.
 *
 * Availability never implies user enablement. A row may read `available` while
 * `userEnabled` is false; consuming code asks `isNativeMediaCapabilityUsable`
 * rather than testing the state alone.
 */

import {
	createNativeValidators,
	NATIVE_SHA256_HEX_PATTERN,
} from './native-validation.ts';

export const NATIVE_MEDIA_CAPABILITY_SNAPSHOT_VERSION = 1;

export const NATIVE_MEDIA_CAPABILITY_STATES = Object.freeze([
	'disabled',
	'blocked-policy',
	'unavailable',
	'available',
	'degraded',
	'quarantined',
] as const);

export type NativeMediaCapabilityState = (typeof NATIVE_MEDIA_CAPABILITY_STATES)[number];

export const NATIVE_MEDIA_CAPABILITY_DOMAINS = Object.freeze([
	'codec',
	'operation',
	'backend',
	'queue',
	'watch',
	'scratch',
	'display',
	'ofx',
] as const);

export type NativeMediaCapabilityDomain = (typeof NATIVE_MEDIA_CAPABILITY_DOMAINS)[number];

export interface NativeMediaCapabilityRefV1 {
	readonly domain: NativeMediaCapabilityDomain;
	readonly id: string;
}

/**
 * The rows the milestone-5B surfaces gate on, named once.
 *
 * An id is a contract between whoever reports a capability and whoever consumes
 * it, and a lookup that misses is indistinguishable from a capability that is
 * genuinely off — so the two sides read the same constant rather than two
 * spellings that happen to agree today. The proxy row carries the encode
 * profile id the proxy recipe already pins, because that is the capability it
 * describes.
 */
export const NATIVE_MEDIA_CAPABILITY_IDS: Readonly<Record<
	'renderQueue' | 'watchFolders' | 'proxyCodec' | 'imageSequenceImport'
	| 'externalDisplay' | 'ofxHost',
	NativeMediaCapabilityRefV1
>> = Object.freeze({
	renderQueue: Object.freeze({ domain: 'queue', id: 'persistent-render-queue' }),
	watchFolders: Object.freeze({ domain: 'watch', id: 'watch-folders' }),
	proxyCodec: Object.freeze({ domain: 'codec', id: 'encode-mov-prores-proxy' }),
	imageSequenceImport: Object.freeze({ domain: 'operation', id: 'image-sequence-import' }),
	externalDisplay: Object.freeze({ domain: 'display', id: 'external-display' }),
	ofxHost: Object.freeze({ domain: 'ofx', id: 'isolated-host' }),
});

/** Exactly one reason per state, so a report can never say "off, unspecified". */
export const NATIVE_MEDIA_CAPABILITY_REASONS = Object.freeze([
	'policy-row-blocked',
	'quarantined-after-repeated-failure',
	'master-switch-off',
	'build-does-not-support',
	'driver-probe-failed',
	'self-test-failed',
	'degraded-after-failure',
	'ready',
] as const);

export type NativeMediaCapabilityReason = (typeof NATIVE_MEDIA_CAPABILITY_REASONS)[number];

/**
 * Every observation the resolver may consider. Each is a separate fact because
 * collapsing them loses the answer to "why can I not use this?".
 */
export interface NativeMediaCapabilityObservationV1 {
	/** The fail-closed licensing/provenance row for this capability is clear. */
	readonly policyCleared: boolean;
	/** The native media master switch is on. */
	readonly masterEnabled: boolean;
	/** The pinned helper build was compiled with this capability. */
	readonly buildSupported: boolean;
	/** The driver or platform probe succeeded on this machine. */
	readonly probeSucceeded: boolean;
	/** The capability's own self-test produced a correct result. */
	readonly selfTestPassed: boolean;
	/** The supervisor quarantined this capability after repeated failures. */
	readonly quarantined: boolean;
	/** The capability works but has been demoted after a recoverable failure. */
	readonly degraded: boolean;
	/** The user opted this specific capability in. Never implied by the rest. */
	readonly userEnabled: boolean;
}

export interface NativeMediaCapabilityResolutionV1 {
	readonly state: NativeMediaCapabilityState;
	readonly reason: NativeMediaCapabilityReason;
}

export interface NativeMediaCapabilityEntryV1 {
	readonly domain: NativeMediaCapabilityDomain;
	readonly id: string;
	readonly state: NativeMediaCapabilityState;
	readonly reason: NativeMediaCapabilityReason;
	readonly userEnabled: boolean;
	readonly buildFingerprint: string | null;
	readonly detail: string | null;
}

export interface NativeMediaCapabilitySnapshotV1 {
	readonly snapshotVersion: typeof NATIVE_MEDIA_CAPABILITY_SNAPSHOT_VERSION;
	readonly masterEnabled: boolean;
	readonly buildFingerprint: string | null;
	readonly entries: readonly NativeMediaCapabilityEntryV1[];
}

export interface NativeMediaCapabilityEntryInputV1
	extends Partial<NativeMediaCapabilityObservationV1> {
	readonly domain: NativeMediaCapabilityDomain;
	readonly id: string;
	readonly detail?: string | null;
	readonly buildFingerprint?: string | null;
}

export interface NativeMediaCapabilitySnapshotInputV1 {
	readonly masterEnabled?: boolean;
	readonly buildFingerprint?: string | null;
	readonly entries: readonly NativeMediaCapabilityEntryInputV1[];
}

export class NativeMediaCapabilityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NativeMediaCapabilityError';
	}
}

const CAPABILITY_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const MAXIMUM_DETAIL_LENGTH = 512;
const MAXIMUM_ENTRIES = 1_024;
const ENTRY_KEYS = Object.freeze([
	'domain', 'id', 'state', 'reason', 'userEnabled', 'buildFingerprint', 'detail',
]);
const SNAPSHOT_KEYS = Object.freeze([
	'snapshotVersion', 'masterEnabled', 'buildFingerprint', 'entries',
]);

const { exactKeys, plainRecord: record } = createNativeValidators({
	subject: 'A native media capability snapshot',
	raise: (message: string): never => {
		throw new NativeMediaCapabilityError(message);
	},
});

/**
 * Every observation defaults to its fail-closed value: nothing is cleared,
 * built, probed, self-tested, or opted into until something says so.
 */
export const NATIVE_MEDIA_CAPABILITY_CLOSED_OBSERVATION: NativeMediaCapabilityObservationV1 =
	Object.freeze({
		policyCleared: false,
		masterEnabled: false,
		buildSupported: false,
		probeSucceeded: false,
		selfTestPassed: false,
		quarantined: false,
		degraded: false,
		userEnabled: false,
	});

/**
 * Resolve one capability's state from its observations.
 *
 * Precedence is deliberate. A blocked licensing row dominates everything: it is
 * a permanent, fail-closed fact that must not be masked by a switch the user
 * could flip. Quarantine comes next so a capability that hurt the editor stays
 * visibly quarantined rather than reading as merely off. Only then does the
 * master switch answer, followed by the evidence the capability exists at all,
 * and finally its health.
 */
export function resolveNativeMediaCapability(
	observation: Partial<NativeMediaCapabilityObservationV1>,
): NativeMediaCapabilityResolutionV1 {
	const facts = { ...NATIVE_MEDIA_CAPABILITY_CLOSED_OBSERVATION, ...observation };
	if (!facts.policyCleared) return resolution('blocked-policy', 'policy-row-blocked');
	if (facts.quarantined) return resolution('quarantined', 'quarantined-after-repeated-failure');
	if (!facts.masterEnabled) return resolution('disabled', 'master-switch-off');
	if (!facts.buildSupported) return resolution('unavailable', 'build-does-not-support');
	if (!facts.probeSucceeded) return resolution('unavailable', 'driver-probe-failed');
	if (!facts.selfTestPassed) return resolution('unavailable', 'self-test-failed');
	if (facts.degraded) return resolution('degraded', 'degraded-after-failure');
	return resolution('available', 'ready');
}

/** Build a snapshot, resolving each entry against the shared master switch. */
export function createNativeMediaCapabilitySnapshotV1(
	input: NativeMediaCapabilitySnapshotInputV1,
): NativeMediaCapabilitySnapshotV1 {
	const masterEnabled = input.masterEnabled === true;
	const buildFingerprint = optionalFingerprint(input.buildFingerprint ?? null);
	if (!Array.isArray(input.entries)) {
		throw new NativeMediaCapabilityError('A native media capability snapshot requires an entry list.');
	}
	if (input.entries.length > MAXIMUM_ENTRIES) {
		throw new NativeMediaCapabilityError('A native media capability snapshot exceeds its entry ceiling.');
	}
	const seen = new Set<string>();
	const entries = input.entries.map((entry) => {
		const domain = capabilityDomain(entry.domain);
		const id = capabilityId(entry.id);
		const key = `${domain}/${id}`;
		if (seen.has(key)) {
			throw new NativeMediaCapabilityError(`Native media capability ${key} is reported more than once.`);
		}
		seen.add(key);
		const resolved = resolveNativeMediaCapability({ ...entry, masterEnabled });
		return Object.freeze({
			domain,
			id,
			state: resolved.state,
			reason: resolved.reason,
			userEnabled: entry.userEnabled === true,
			buildFingerprint: optionalFingerprint(entry.buildFingerprint ?? buildFingerprint),
			detail: optionalDetail(entry.detail ?? null),
		});
	});
	return Object.freeze({
		snapshotVersion: NATIVE_MEDIA_CAPABILITY_SNAPSHOT_VERSION,
		masterEnabled,
		buildFingerprint,
		entries: Object.freeze(entries),
	});
}

/** Admit an independently parsed snapshot arriving from a helper or bridge. */
export function assertNativeMediaCapabilitySnapshotV1(
	value: unknown,
): asserts value is NativeMediaCapabilitySnapshotV1 {
	const snapshot = record(value, 'native media capability snapshot');
	exactKeys(snapshot, SNAPSHOT_KEYS, 'native media capability snapshot');
	if (snapshot.snapshotVersion !== NATIVE_MEDIA_CAPABILITY_SNAPSHOT_VERSION) {
		throw new NativeMediaCapabilityError('The native media capability snapshot version is unsupported.');
	}
	if (typeof snapshot.masterEnabled !== 'boolean') {
		throw new NativeMediaCapabilityError('A native media capability snapshot must state its master switch.');
	}
	optionalFingerprint(snapshot.buildFingerprint as string | null);
	if (!Array.isArray(snapshot.entries) || snapshot.entries.length > MAXIMUM_ENTRIES) {
		throw new NativeMediaCapabilityError('A native media capability snapshot carries an unbounded entry list.');
	}
	const seen = new Set<string>();
	for (const value_ of snapshot.entries as readonly unknown[]) {
		const entry = record(value_, 'native media capability entry');
		exactKeys(entry, ENTRY_KEYS, 'native media capability entry');
		const key = `${capabilityDomain(entry.domain)}/${capabilityId(entry.id)}`;
		if (seen.has(key)) {
			throw new NativeMediaCapabilityError(`Native media capability ${key} is reported more than once.`);
		}
		seen.add(key);
		if (!(NATIVE_MEDIA_CAPABILITY_STATES as readonly unknown[]).includes(entry.state)
			|| !(NATIVE_MEDIA_CAPABILITY_REASONS as readonly unknown[]).includes(entry.reason)) {
			throw new NativeMediaCapabilityError('A native media capability entry must carry a known state and reason.');
		}
		if (typeof entry.userEnabled !== 'boolean') {
			throw new NativeMediaCapabilityError('A native media capability entry must state its user opt-in.');
		}
		if (entry.state === 'disabled' && snapshot.masterEnabled
			&& entry.reason === 'master-switch-off') {
			throw new NativeMediaCapabilityError('A native media capability entry contradicts its own master switch.');
		}
		optionalFingerprint(entry.buildFingerprint as string | null);
		optionalDetail(entry.detail as string | null);
	}
}

export function nativeMediaCapabilityEntry(
	snapshot: NativeMediaCapabilitySnapshotV1,
	domain: NativeMediaCapabilityDomain,
	id: string,
): NativeMediaCapabilityEntryV1 | null {
	return snapshot.entries.find((entry) => entry.domain === domain && entry.id === id) ?? null;
}

/**
 * The one question production code should ask. A capability is usable only when
 * it is ready or knowingly degraded *and* the user opted in; every other state,
 * and every un-opted-in row, falls back to the Web path.
 */
export function isNativeMediaCapabilityUsable(
	entry: NativeMediaCapabilityEntryV1 | null,
): boolean {
	if (!entry) return false;
	return entry.userEnabled && (entry.state === 'available' || entry.state === 'degraded');
}

/** Rows the report should surface to the user as an explained refusal. */
export function nativeMediaCapabilityRefusals(
	snapshot: NativeMediaCapabilitySnapshotV1,
): readonly NativeMediaCapabilityEntryV1[] {
	return Object.freeze(snapshot.entries.filter((entry) => (
		entry.state === 'blocked-policy'
		|| entry.state === 'quarantined'
		|| (entry.state === 'unavailable' && entry.userEnabled)
	)));
}

function resolution(
	state: NativeMediaCapabilityState,
	reason: NativeMediaCapabilityReason,
): NativeMediaCapabilityResolutionV1 {
	return Object.freeze({ state, reason });
}

function capabilityDomain(value: unknown): NativeMediaCapabilityDomain {
	if (typeof value !== 'string'
		|| !(NATIVE_MEDIA_CAPABILITY_DOMAINS as readonly string[]).includes(value)) {
		throw new NativeMediaCapabilityError('A native media capability entry must name a known domain.');
	}
	return value as NativeMediaCapabilityDomain;
}

function capabilityId(value: unknown): string {
	if (typeof value !== 'string' || !CAPABILITY_ID_PATTERN.test(value)) {
		throw new NativeMediaCapabilityError('A native media capability id must be bounded lowercase kebab-case.');
	}
	return value;
}

function optionalFingerprint(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string' || !NATIVE_SHA256_HEX_PATTERN.test(value)) {
		throw new NativeMediaCapabilityError('A native media build fingerprint must be a lowercase SHA-256 digest.');
	}
	return value;
}

function optionalDetail(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string' || value.length === 0 || value.length > MAXIMUM_DETAIL_LENGTH) {
		throw new NativeMediaCapabilityError('A native media capability detail must be bounded non-empty text.');
	}
	return value;
}
