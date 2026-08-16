/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The main-process owner of plug-in discovery.
 *
 * Discovery and execution are separate helper kinds and separate security
 * controls, and this module is the discovery half only. It imports no
 * execution surface at all, so there is no code path — mistaken, coerced, or
 * added later by a caller — through which a scan request can start a plug-in
 * running: the only job kind this file can name is `plugin-scan`, and the only
 * authority it can hand a helper is one consented root.
 *
 * The renderer names an opaque root id and a format. It never names a
 * directory, never receives a raw path back, and cannot cause a scan of a
 * format it has not consented to. A scanner that crashes, hangs, or answers
 * with something the contract rejects quarantines the digest it was scanning,
 * so a bad installation stops costing the user a fault per attempt.
 *
 * Like every other native surface this one is off by default and degrades
 * rather than fails: disabled, unconsented, quarantined, unbuilt, or crashed,
 * it answers with a typed status and the Web Core editor is untouched.
 */

import { HELPER_PLUGIN_FORMATS, type HelperPluginFormat } from './helper-job-grant.ts';
import { HelperSupervisionError, type HelperJobRequest } from './helper-supervisor.ts';
import { HelperContractViolationError } from './helper-wire-admission.ts';
import type { NativeAddonAvailability } from './native-addon-payload.ts';
import {
	type HelperPluginScanResult,
	type RendererPluginScanResult,
	projectPluginScanForRenderer,
	validateHelperPluginScanResult,
} from './plugin-scan-results.ts';

/**
 * A scan grant declares zero granted bytes, so one byte is the tightest
 * admissible ceiling: a scan that tried to carry project audio would fail the
 * supervisor's own input accounting before the helper ever saw it. The
 * duration and RSS ceilings turn a wedged directory walk into a typed fault
 * inside a bounded window instead of a helper that never answers.
 */
export const PLUGIN_SCAN_RESOURCE_POLICY = Object.freeze({
	maximumInputBytes: 1,
	maximumJobDurationMs: 5 * 60_000,
	maximumRssBytes: 512 * 1024 ** 2,
});

export type PluginScanFailureCode =
	| 'helper-disabled'
	| 'helper-unavailable'
	| 'helper-quarantined'
	| 'digest-quarantined'
	| 'consent-required'
	| 'unknown-format'
	| 'unknown-root'
	| 'unsupported-job'
	| 'helper-cancelled'
	| 'helper-failed';

export type PluginScanOutcome =
	| Readonly<{ status: 'described'; scan: RendererPluginScanResult }>
	| Readonly<{ status: 'failed'; code: PluginScanFailureCode; message: string }>;

export interface PluginScanFormatAvailability {
	readonly format: HelperPluginFormat;
	readonly consented: boolean;
}

export interface PluginScanAvailability {
	readonly enabled: boolean;
	readonly quarantined: boolean;
	/**
	 * The closed reason code only. The payload describes itself with the file it
	 * resolved — `The native addon payload at <path> …` — and main owns that
	 * path, so the detail stops here exactly as it does on a scan failure.
	 */
	readonly payload: Readonly<{ status: 'available' | 'unavailable'; reason: string | null }>;
	readonly formats: readonly PluginScanFormatAvailability[];
}

/** The supervisor seam is typed to the scan kind; no other kind is expressible. */
export interface PluginScanSupervisorPort {
	runJob(request: HelperJobRequest<'plugin-scan'>): Promise<unknown>;
	snapshot(): Readonly<{ state: string; quarantined: boolean }>;
	clearQuarantine(): void;
	dispose(): void;
}

/**
 * Consent is a decision main has already recorded, never a prompt a renderer
 * can provoke: asking to scan an unconsented format fails, it does not ask.
 */
export interface PluginScanConsentPort {
	isGranted(format: HelperPluginFormat): boolean;
}

export type PluginScanQuarantineReason =
	| 'scanner-crash'
	| 'scanner-hang'
	| 'malformed-answer'
	| 'oversize-answer'
	| 'malformed-plugin'
	| 'oversize-plugin';

/** Durability belongs to the port; the service only decides what is a fault. */
export interface PluginScanQuarantinePort {
	isQuarantined(digest: string): boolean;
	quarantine(digest: string, reason: PluginScanQuarantineReason): void;
}

export interface PluginScanRootLocation {
	/** Main-private directory. Never leaves this process. */
	readonly path: string;
	readonly identity: Readonly<{ dev: number; ino: number }>;
	/** Lowercase SHA-256 naming this root-and-format scan unit for quarantine. */
	readonly scanDigest: string;
}

export interface PluginScanRootPort {
	resolve(rootId: string, format: HelperPluginFormat): PluginScanRootLocation | null;
}

export interface PluginScanRequest {
	readonly owner: object;
	readonly rootId: string;
	readonly format: string;
}

export interface DesktopPluginScanServiceOptions {
	supervisor: PluginScanSupervisorPort;
	consent: PluginScanConsentPort;
	quarantine: PluginScanQuarantinePort;
	roots: PluginScanRootPort;
	isEnabled: () => boolean;
	describePayload: () => Promise<NativeAddonAvailability>;
}

const REQUEST_KEYS = Object.freeze(['owner', 'rootId', 'format']);
const MAXIMUM_ROOT_ID_LENGTH = 256;

/**
 * A precondition this service re-checked after it had already passed once, and
 * which no longer holds. It is deliberately private: it names a main-side
 * decision, never a helper fault, so it can never cost a location its digest.
 */
class ScanPreconditionError extends Error {
	readonly code: PluginScanFailureCode;

	constructor(code: PluginScanFailureCode) {
		super(FAILURE_MESSAGES[code]);
		this.name = 'ScanPreconditionError';
		this.code = code;
	}
}

export class DesktopPluginScanService {
	readonly #supervisor: PluginScanSupervisorPort;
	readonly #consent: PluginScanConsentPort;
	readonly #quarantine: PluginScanQuarantinePort;
	readonly #roots: PluginScanRootPort;
	readonly #isEnabled: () => boolean;
	readonly #describePayload: () => Promise<NativeAddonAvailability>;
	readonly #owners = new Map<object, AbortController>();
	#queue: Promise<unknown> = Promise.resolve();
	#disposed = false;

	constructor(options: DesktopPluginScanServiceOptions) {
		this.#supervisor = options.supervisor;
		this.#consent = options.consent;
		this.#quarantine = options.quarantine;
		this.#roots = options.roots;
		this.#isEnabled = options.isEnabled;
		this.#describePayload = options.describePayload;
	}

	async availability(): Promise<PluginScanAvailability> {
		const payload = await this.#describePayload();
		return Object.freeze({
			enabled: !this.#disposed && this.#isEnabled(),
			quarantined: this.#supervisor.snapshot().quarantined,
			payload: payload.status === 'available'
				? Object.freeze({ status: 'available' as const, reason: null })
				: Object.freeze({ status: 'unavailable' as const, reason: payload.reason }),
			formats: Object.freeze(HELPER_PLUGIN_FORMATS.map((format) => Object.freeze({
				format,
				consented: this.#consent.isGranted(format),
			}))),
		});
	}

	clearQuarantine(): void {
		this.#supervisor.clearQuarantine();
	}

	async scanRoot(request: PluginScanRequest): Promise<PluginScanOutcome> {
		if (this.#disposed || !this.#isEnabled()) {
			return failure('helper-disabled', 'Plug-in discovery is disabled.');
		}
		// The request domain is closed. A request carrying anything beyond the
		// three scan keys — an execution target above all — is refused here
		// rather than interpreted, so widening the surface takes a code change.
		const admitted = admitRequest(request);
		if (!admitted) {
			return failure('unsupported-job', 'This surface accepts plug-in discovery requests only.');
		}
		if (!(HELPER_PLUGIN_FORMATS as readonly string[]).includes(admitted.format)) {
			return failure('unknown-format', 'That plug-in format is not offered by this build.');
		}
		const format = admitted.format as HelperPluginFormat;
		if (!this.#consent.isGranted(format)) {
			return failure('consent-required', 'Scanning this plug-in format has not been allowed.');
		}
		if (this.#supervisor.snapshot().quarantined) {
			return failure('helper-quarantined', 'The plug-in scanner is quarantined after repeated faults.');
		}
		// Resolution is synchronous on purpose: the raw root must be looked up
		// while main still owns the decision, not across an await where the
		// consent that authorized it could already have been withdrawn.
		const root = this.#roots.resolve(admitted.rootId, format);
		if (!root) {
			return failure('unknown-root', 'That scan location is not registered for this format.');
		}
		if (this.#quarantine.isQuarantined(root.scanDigest)) {
			return failure('digest-quarantined', 'That scan location is quarantined until it is rescanned explicitly.');
		}
		// Registered before the first await, not after it: an owner that goes
		// away while the payload is still being verified must still be revoked,
		// or a helper is spawned for a renderer that is already gone.
		const controller = new AbortController();
		const previous = this.#owners.get(admitted.owner);
		previous?.abort(new HelperSupervisionError('cancelled', 'A newer scan request replaced this one.'));
		this.#owners.set(admitted.owner, controller);
		try {
			const payload = await this.#describePayload();
			if (controller.signal.aborted) {
				return failure('helper-cancelled', 'The scan was cancelled before it began.');
			}
			if (payload.status !== 'available') {
				// The payload detail names a filesystem path, so it stays here.
				return failure('helper-unavailable', 'No verified plug-in scanner is available in this build.');
			}
			const result = await this.#enqueue(async () => {
				// Consent was granted before the payload was verified and before
				// this job reached the head of the queue. Both waits are
				// unbounded from main's point of view, so it is re-read at the
				// last instant: a withdrawal must stop the scan, not race it.
				if (!this.#consent.isGranted(format)) {
					throw new ScanPreconditionError('consent-required');
				}
				return this.#supervisor.runJob({
					kind: 'plugin-scan',
					grant: { rootPath: root.path, format, identity: root.identity },
					resourcePolicy: PLUGIN_SCAN_RESOURCE_POLICY,
					signal: controller.signal,
					validateResult: (value) => validateHelperPluginScanResult(value),
				});
			}) as HelperPluginScanResult;
			// The quarantine record stands either way: it is main's own durable
			// knowledge about an installation, not something the owner asked for.
			this.#quarantineUnusableEntries(result);
			if (controller.signal.aborted) {
				// A scanner that answered as the abort landed still answered for
				// an owner that has gone; publishing it now would hand a
				// revoked renderer the inventory it was cancelled out of.
				return failure('helper-cancelled', FAILURE_MESSAGES['helper-cancelled']);
			}
			return Object.freeze({
				status: 'described' as const,
				scan: projectPluginScanForRenderer(result),
			});
		} catch (error) {
			const reason = quarantineReason(error);
			if (reason) this.#quarantine.quarantine(root.scanDigest, reason);
			const code = failureCode(error);
			return failure(code, FAILURE_MESSAGES[code]);
		} finally {
			if (this.#owners.get(admitted.owner) === controller) this.#owners.delete(admitted.owner);
		}
	}

	revokeOwner(owner: object): void {
		const controller = this.#owners.get(owner);
		if (!controller) return;
		this.#owners.delete(owner);
		controller.abort(new HelperSupervisionError('cancelled', 'The scan owner went away.'));
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const [owner, controller] of this.#owners) {
			this.#owners.delete(owner);
			controller.abort(new HelperSupervisionError('disposed', 'Plug-in discovery is shutting down.'));
		}
		this.#supervisor.dispose();
	}

	/**
	 * An installation the scanner itself calls malformed or oversize is the
	 * per-binary case of the same rule that quarantines a faulting scan: the
	 * digest becomes ineligible until the user rescans it deliberately.
	 */
	#quarantineUnusableEntries(result: HelperPluginScanResult): void {
		for (const entry of result.entries) {
			if (entry.compatibility === 'malformed') {
				this.#quarantine.quarantine(entry.binarySha256, 'malformed-plugin');
			} else if (entry.compatibility === 'oversize') {
				this.#quarantine.quarantine(entry.binarySha256, 'oversize-plugin');
			}
		}
	}

	/** Contract v1 admits one concurrent job, so scans serialize. */
	#enqueue(operation: () => Promise<unknown>): Promise<unknown> {
		const next = this.#queue.then(operation, operation);
		this.#queue = next.catch(() => undefined);
		return next;
	}
}

const FAILURE_MESSAGES: Readonly<Record<PluginScanFailureCode, string>> = Object.freeze({
	'helper-disabled': 'Plug-in discovery is disabled.',
	'helper-unavailable': 'No verified plug-in scanner is available in this build.',
	'helper-quarantined': 'The plug-in scanner is quarantined after repeated faults.',
	'digest-quarantined': 'That scan location is quarantined until it is rescanned explicitly.',
	'consent-required': 'Scanning this plug-in format has not been allowed.',
	'unknown-format': 'That plug-in format is not offered by this build.',
	'unknown-root': 'That scan location is not registered for this format.',
	'unsupported-job': 'This surface accepts plug-in discovery requests only.',
	'helper-cancelled': 'The scan was cancelled.',
	'helper-failed': 'The plug-in scan did not complete.',
});

function admitRequest(request: PluginScanRequest): Readonly<{ owner: object; rootId: string; format: string }> | null {
	if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
	const record = request as unknown as Record<string, unknown>;
	const present = Object.keys(record);
	if (present.length !== REQUEST_KEYS.length || present.some((key) => !REQUEST_KEYS.includes(key))) return null;
	const owner = record.owner;
	if (!owner || typeof owner !== 'object') return null;
	if (typeof record.rootId !== 'string' || record.rootId.length === 0
		|| record.rootId.length > MAXIMUM_ROOT_ID_LENGTH) {
		return null;
	}
	if (typeof record.format !== 'string') return null;
	return Object.freeze({ owner, rootId: record.rootId, format: record.format });
}

function failure(code: PluginScanFailureCode, message: string): PluginScanOutcome {
	return Object.freeze({ status: 'failed' as const, code, message });
}

function failureCode(error: unknown): PluginScanFailureCode {
	if (error instanceof ScanPreconditionError) return error.code;
	if (error instanceof HelperSupervisionError) {
		if (error.cause_ === 'cancelled' || error.cause_ === 'cancellation-timeout') return 'helper-cancelled';
		if (error.cause_ === 'quarantined') return 'helper-quarantined';
		if (error.cause_ === 'disposed') return 'helper-disabled';
		if (error.cause_ === 'binary-mismatch') return 'helper-unavailable';
	}
	return 'helper-failed';
}

/**
 * What counts as a scanner fault, and what does not. Cancellation, disposal
 * and our own payload or admission problems are not the scanned installation's
 * doing, so they must never cost it its eligibility.
 */
function quarantineReason(error: unknown): PluginScanQuarantineReason | null {
	if (error instanceof ScanPreconditionError) return null;
	if (error instanceof HelperContractViolationError) {
		return error.code === 'oversized' ? 'oversize-answer' : 'malformed-answer';
	}
	if (error instanceof HelperSupervisionError) {
		if (error.cause_ === 'cancelled' || error.cause_ === 'disposed'
			|| error.cause_ === 'quarantined' || error.cause_ === 'binary-mismatch'
			|| error.cause_ === 'invalid-request' || error.cause_ === 'unsupported-kind') {
			return null;
		}
		if (error.cause_ === 'malformed-message') return 'malformed-answer';
		if (error.cause_ === 'heartbeat' || error.cause_ === 'cancellation-timeout'
			|| error.cause_ === 'resource-violation') {
			return 'scanner-hang';
		}
	}
	return 'scanner-crash';
}
