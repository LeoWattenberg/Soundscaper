/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Consent, enablement, and quarantine for one OpenFX binary fingerprint.
 *
 * OFX is off until the user opens the manage surface, grants scan consent, and
 * then enables a specific discovered binary. Those are three separate
 * decisions on purpose: agreeing that the host may *look* at a directory is not
 * agreeing that arbitrary code found there may *run*.
 *
 * Consent never transfers. When a binary's digest changes, the previous record
 * does not carry over — a rebuilt or replaced bundle is a different capability,
 * and inheriting approval is exactly how a trusted plug-in becomes an untrusted
 * one without anybody being asked.
 *
 * Quarantine is split by severity. A crash, hang, or render error is treated as
 * possibly transient and needs three occurrences inside a minute; a malformed
 * descriptor or an attempt to reach the network or filesystem is a single,
 * immediate quarantine, because those are not accidents of load. Nothing leaves
 * quarantine except an explicit user action.
 */

import {
	ofxPluginFingerprint,
	type OfxPluginDescriptorV1,
} from './native-ofx-descriptor.ts';

export const OFX_CONSENT_STATES = Object.freeze([
	'discovered', 'consented', 'enabled', 'revoked', 'quarantined',
] as const);

export type OfxConsentState = (typeof OFX_CONSENT_STATES)[number];

export const OFX_FAILURE_KINDS = Object.freeze([
	'crash', 'hang', 'render-error',
	'malformed-descriptor', 'resource-violation', 'network-denied', 'filesystem-denied',
	'top-level-window-denied',
] as const);

export type OfxFailureKind = (typeof OFX_FAILURE_KINDS)[number];

/** Failures that quarantine on their first occurrence. */
export const OFX_IMMEDIATE_QUARANTINE_FAILURES: readonly OfxFailureKind[] = Object.freeze([
	'malformed-descriptor', 'resource-violation', 'network-denied', 'filesystem-denied',
	'top-level-window-denied',
]);

export const OFX_QUARANTINE_FAILURE_LIMIT = 3;
export const OFX_QUARANTINE_WINDOW_MS = 60_000;

export interface OfxFailureRecordV1 {
	readonly kind: OfxFailureKind;
	readonly atMs: number;
}

export interface OfxConsentRecordV1 {
	readonly fingerprint: string;
	readonly pluginId: string;
	readonly binarySha256: string;
	readonly state: OfxConsentState;
	readonly failures: readonly OfxFailureRecordV1[];
	readonly quarantinedAtMs: number | null;
}

export class OfxConsentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OfxConsentError';
	}
}

/**
 * Fold a freshly scanned descriptor into whatever was previously recorded.
 *
 * A record whose fingerprint no longer matches is discarded rather than
 * updated: it described a different binary.
 */
export function reconcileOfxConsent(
	previous: OfxConsentRecordV1 | null,
	descriptor: OfxPluginDescriptorV1,
): OfxConsentRecordV1 {
	const fingerprint = ofxPluginFingerprint(descriptor);
	if (previous !== null && previous.fingerprint === fingerprint) return previous;
	return Object.freeze({
		fingerprint,
		pluginId: descriptor.pluginId,
		binarySha256: descriptor.binarySha256,
		state: 'discovered',
		failures: Object.freeze([]),
		quarantinedAtMs: null,
	});
}

/** Scan consent: the host may examine this binary. It may not yet run it. */
export function grantOfxScanConsent(record: OfxConsentRecordV1): OfxConsentRecordV1 {
	if (record.state === 'quarantined') {
		throw new OfxConsentError('A quarantined OFX binary cannot be consented to until it is cleared.');
	}
	if (record.state === 'enabled') return record;
	return next(record, 'consented');
}

/** Enablement: this specific binary may run. Requires prior scan consent. */
export function enableOfxPlugin(record: OfxConsentRecordV1): OfxConsentRecordV1 {
	if (record.state === 'quarantined') {
		throw new OfxConsentError('A quarantined OFX binary cannot be enabled until it is cleared.');
	}
	if (record.state !== 'consented' && record.state !== 'enabled') {
		throw new OfxConsentError('An OFX binary is enabled only after scan consent is granted.');
	}
	return record.state === 'enabled' ? record : next(record, 'enabled');
}

export function revokeOfxPlugin(record: OfxConsentRecordV1): OfxConsentRecordV1 {
	return record.state === 'quarantined' ? record : next(record, 'revoked');
}

/** Only the host may run a plug-in, and only in exactly one state. */
export function ofxPluginMayRun(record: OfxConsentRecordV1): boolean {
	return record.state === 'enabled';
}

/**
 * Record one failure against a fingerprint.
 *
 * Timestamps outside the window are dropped so a plug-in that misbehaves once a
 * week never accumulates its way into quarantine.
 */
export function recordOfxFailure(
	record: OfxConsentRecordV1,
	kind: OfxFailureKind,
	atMs: number,
): OfxConsentRecordV1 {
	if (!(OFX_FAILURE_KINDS as readonly string[]).includes(kind)) {
		throw new OfxConsentError('An OFX failure must name a known kind.');
	}
	if (!Number.isSafeInteger(atMs) || atMs < 0) {
		throw new OfxConsentError('An OFX failure requires a non-negative safe-integer timestamp.');
	}
	const cutoff = atMs - OFX_QUARANTINE_WINDOW_MS;
	const failures = Object.freeze([
		...record.failures.filter((failure) => failure.atMs > cutoff),
		Object.freeze({ kind, atMs }),
	]);
	const immediate = OFX_IMMEDIATE_QUARANTINE_FAILURES.includes(kind);
	const repeated = failures.filter((failure) => (
		!OFX_IMMEDIATE_QUARANTINE_FAILURES.includes(failure.kind)
	)).length >= OFX_QUARANTINE_FAILURE_LIMIT;
	const quarantined = record.state === 'quarantined' || immediate || repeated;
	return Object.freeze({
		fingerprint: record.fingerprint,
		pluginId: record.pluginId,
		binarySha256: record.binarySha256,
		state: quarantined ? 'quarantined' : record.state,
		failures,
		quarantinedAtMs: quarantined ? record.quarantinedAtMs ?? atMs : null,
	});
}

/**
 * Leave quarantine. This is an explicit user action and nothing else triggers
 * it — a quarantined binary that simply stops failing stays quarantined,
 * because nobody watched it stop.
 *
 * Clearing returns to `discovered`, not to whatever it was before: the user is
 * asked to consent and enable again.
 */
export function clearOfxQuarantine(record: OfxConsentRecordV1): OfxConsentRecordV1 {
	if (record.state !== 'quarantined') return record;
	return Object.freeze({
		fingerprint: record.fingerprint,
		pluginId: record.pluginId,
		binarySha256: record.binarySha256,
		state: 'discovered',
		failures: Object.freeze([]),
		quarantinedAtMs: null,
	});
}

function next(record: OfxConsentRecordV1, state: OfxConsentState): OfxConsentRecordV1 {
	return Object.freeze({ ...record, state });
}
