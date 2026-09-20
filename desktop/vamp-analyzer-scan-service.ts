/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned, pathless discovery for Vamp analyzers. */

import type { NativeAddonAvailability } from './native-addon-payload.ts';
import type { HelperJobRequest } from './helper-supervisor.ts';
import { HelperSupervisionError } from './helper-supervisor.ts';
import {
	assertHelperWireEnvelope,
	HelperContractViolationError,
} from './helper-wire-admission.ts';
import { PLUGIN_SCAN_RESOURCE_POLICY, type PluginScanFailureCode } from './plugin-scan-service.ts';
import {
	admitVampAnalyzerLibraryObservation,
	type DesktopVampAnalyzerRegistry,
	type VampAnalyzerLibraryObservation,
	type VampAnalyzerRegistryAdmission,
	vampAnalyzerInstallationIdFor,
} from './vamp-analyzer-registry.ts';

export const VAMP_ANALYZER_SCAN_STATUSES = Object.freeze([
	'scanned', 'root-oversized', 'unsupported-format', 'root-unreadable',
] as const);
export type VampAnalyzerScanStatus = (typeof VAMP_ANALYZER_SCAN_STATUSES)[number];

export interface HelperVampAnalyzerScanResult {
	readonly format: 'vamp';
	readonly status: VampAnalyzerScanStatus;
	readonly detail: string;
	readonly libraries: readonly Readonly<VampAnalyzerLibraryObservation>[];
}

export interface RendererVampAnalyzerScanEntry {
	readonly stableId: string;
	readonly name: string;
	readonly vendor: string;
	readonly version: string;
	readonly classification: 'analyzer';
	readonly compatibility: string;
}

export interface RendererVampAnalyzerScanResult {
	readonly format: 'vamp';
	readonly status: VampAnalyzerScanStatus;
	readonly detail: string;
	readonly entries: readonly Readonly<RendererVampAnalyzerScanEntry>[];
}

export type VampAnalyzerScanOutcome =
	| Readonly<{ status: 'described'; scan: Readonly<RendererVampAnalyzerScanResult> }>
	| Readonly<{
		status: 'failed'; code: PluginScanFailureCode; message: string;
		fault: Readonly<{ reason: string; quarantined: true }> | null;
	}>;

export interface VampAnalyzerScanSupervisorPort {
	runJob(request: HelperJobRequest<'plugin-scan'>): Promise<unknown>;
	snapshot(): Readonly<{ state: string; quarantined: boolean }>;
}

export interface DesktopVampAnalyzerScanServiceOptions {
	readonly supervisor: VampAnalyzerScanSupervisorPort;
	readonly consent: Readonly<{ isGranted(format: 'vamp'): boolean }>;
	readonly quarantine: Readonly<{
		isQuarantined(digest: string): boolean;
		quarantine(digest: string, reason: string): void;
	}>;
	readonly roots: Readonly<{
		resolve(rootId: string, format: 'vamp'): Readonly<{
			path: string; identity: Readonly<{ dev: number; ino: number }>; scanDigest: string;
		}> | null;
	}>;
	readonly isEnabled: () => boolean;
	readonly describePayload: () => Promise<NativeAddonAvailability>;
	readonly registry: DesktopVampAnalyzerRegistry;
	readonly onRecorded?: (
		observation: Readonly<VampAnalyzerLibraryObservation>,
		admission: Extract<VampAnalyzerRegistryAdmission, { status: 'recorded' }>,
	) => void;
}

const MAXIMUM_LIBRARIES = 512;
const MAXIMUM_DETAIL_LENGTH = 1_024;
const MAXIMUM_ROOT_ID_LENGTH = 256;

export function validateHelperVampAnalyzerScanResult(value: unknown): HelperVampAnalyzerScanResult {
	try {
		assertHelperWireEnvelope(value);
		const record = closedRecord(value, ['format', 'status', 'detail', 'libraries'],
			'Vamp analyzer scan result');
		if (record.format !== 'vamp') throw new TypeError('Invalid Vamp analyzer scan format.');
		if (typeof record.status !== 'string'
			|| !(VAMP_ANALYZER_SCAN_STATUSES as readonly string[]).includes(record.status)) {
			throw new TypeError('Invalid Vamp analyzer scan status.');
		}
		if (typeof record.detail !== 'string' || record.detail.length > MAXIMUM_DETAIL_LENGTH) {
			throw new RangeError('Invalid Vamp analyzer scan detail.');
		}
		if (!Array.isArray(record.libraries) || record.libraries.length > MAXIMUM_LIBRARIES) {
			throw new RangeError('Invalid Vamp analyzer library inventory.');
		}
		const status = record.status as VampAnalyzerScanStatus;
		if (!['scanned', 'root-oversized'].includes(status) && record.libraries.length !== 0) {
			throw new TypeError('An incomplete Vamp scan cannot report libraries.');
		}
		const libraries = Object.freeze(record.libraries.map(admitVampAnalyzerLibraryObservation));
		const identities = new Set<string>();
		for (const library of libraries) {
			const identity = `${library.librarySha256}\0${library.libraryPath}`;
			if (identities.has(identity)) throw new TypeError('A Vamp scan repeated a library observation.');
			identities.add(identity);
		}
		return Object.freeze({ format: 'vamp', status, detail: record.detail, libraries });
	} catch (error) {
		if (error instanceof HelperContractViolationError) throw error;
		throw new HelperContractViolationError('malformed', describeError(error));
	}
}

export function projectVampAnalyzerScanForRenderer(
	result: Readonly<HelperVampAnalyzerScanResult>,
): Readonly<RendererVampAnalyzerScanResult> {
	return Object.freeze({
		format: 'vamp', status: result.status, detail: result.detail,
		entries: Object.freeze(result.libraries.flatMap((library) => library.descriptors.map((descriptor) =>
			Object.freeze({
				stableId: vampAnalyzerInstallationIdFor(library.librarySha256, descriptor.identifier),
				name: descriptor.name, vendor: descriptor.maker, version: String(descriptor.pluginVersion),
				classification: 'analyzer' as const, compatibility: library.compatibility,
			})))),
	});
}

/** Serializes shared scanner access while keeping Vamp out of the effect registry. */
export class DesktopVampAnalyzerScanService {
	readonly #options: DesktopVampAnalyzerScanServiceOptions;
	readonly #owners = new Map<object, AbortController>();
	#queue: Promise<unknown> = Promise.resolve();
	#disposed = false;

	constructor(options: DesktopVampAnalyzerScanServiceOptions) {
		if (!options || typeof options.supervisor?.runJob !== 'function'
			|| typeof options.registry?.recordLibrary !== 'function') {
			throw new TypeError('Vamp analyzer discovery requires a supervisor and registry.');
		}
		this.#options = options;
	}

	async scanRoot(request: Readonly<{ owner: object; rootId: string; format: string }>): Promise<VampAnalyzerScanOutcome> {
		if (this.#disposed || !this.#options.isEnabled()) return failure('helper-disabled');
		const admitted = admitRequest(request);
		if (admitted === null) return failure('unsupported-job');
		if (admitted.format !== 'vamp') return failure('unknown-format');
		if (!this.#options.consent.isGranted('vamp')) return failure('consent-required');
		if (this.#options.supervisor.snapshot().quarantined) return failure('helper-quarantined');
		const root = this.#options.roots.resolve(admitted.rootId, 'vamp');
		if (root === null) return failure('unknown-root');
		if (this.#options.quarantine.isQuarantined(root.scanDigest)) return failure('digest-quarantined');
		const controller = new AbortController();
		this.#owners.get(admitted.owner)?.abort(
			new HelperSupervisionError('cancelled', 'A newer Vamp scan replaced this one.'),
		);
		this.#owners.set(admitted.owner, controller);
		try {
			const payload = await this.#options.describePayload();
			if (controller.signal.aborted) return failure('helper-cancelled');
			if (payload.status !== 'available') return failure('helper-unavailable');
			const result = await this.#enqueue(async () => {
				if (!this.#options.consent.isGranted('vamp')) {
					throw new ScanPreconditionError('consent-required');
				}
				const raw = await this.#options.supervisor.runJob({
					kind: 'plugin-scan',
					grant: { rootPath: root.path, format: 'vamp', identity: root.identity },
					resourcePolicy: PLUGIN_SCAN_RESOURCE_POLICY,
					signal: controller.signal,
					validateResult: validateHelperVampAnalyzerScanResult,
				});
				return validateHelperVampAnalyzerScanResult(raw);
			});
			if (controller.signal.aborted) return failure('helper-cancelled');
			this.#record(result);
			return Object.freeze({
				status: 'described' as const,
				scan: projectVampAnalyzerScanForRenderer(result),
			});
		} catch (error) {
			const code = failureCode(error);
			const reason = scanFaultReason(error);
			if (reason !== null) this.#options.quarantine.quarantine(root.scanDigest, reason);
			return failure(code, reason);
		} finally {
			if (this.#owners.get(admitted.owner) === controller) this.#owners.delete(admitted.owner);
		}
	}

	revokeOwner(owner: object): void {
		const controller = this.#owners.get(owner);
		if (controller === undefined) return;
		this.#owners.delete(owner);
		controller.abort(new HelperSupervisionError('cancelled', 'The Vamp scan owner went away.'));
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const [owner, controller] of this.#owners) {
			this.#owners.delete(owner);
			controller.abort(new HelperSupervisionError('disposed', 'Vamp discovery is shutting down.'));
		}
	}

	#record(result: Readonly<HelperVampAnalyzerScanResult>): void {
		for (const observation of result.libraries) {
			const admission = this.#options.registry.recordLibrary(observation);
			if (admission.status === 'recorded') this.#options.onRecorded?.(observation, admission);
			else if (admission.reason === 'identity-change') {
				this.#options.quarantine.quarantine(observation.librarySha256, 'identity-change');
			}
		}
	}

	#enqueue(operation: () => Promise<Readonly<HelperVampAnalyzerScanResult>>): Promise<Readonly<HelperVampAnalyzerScanResult>> {
		const next = this.#queue.then(operation, operation);
		this.#queue = next.catch(() => undefined);
		return next;
	}
}

class ScanPreconditionError extends Error {
	readonly code: PluginScanFailureCode;
	constructor(code: PluginScanFailureCode) { super(FAILURE_MESSAGES[code]); this.code = code; }
}

const FAILURE_MESSAGES: Readonly<Record<PluginScanFailureCode, string>> = Object.freeze({
	'helper-disabled': 'Plug-in discovery is disabled.',
	'helper-unavailable': 'No verified plug-in scanner is available in this build.',
	'helper-quarantined': 'The plug-in scanner is quarantined after repeated faults.',
	'digest-quarantined': 'That scan location is quarantined until it is rescanned explicitly.',
	'consent-required': 'Scanning Vamp analyzers has not been allowed.',
	'unknown-format': 'That analyzer format is not offered by this build.',
	'unknown-root': 'That Vamp scan location is not registered.',
	'unsupported-job': 'This surface accepts Vamp discovery requests only.',
	'helper-cancelled': 'The Vamp scan was cancelled.',
	'helper-failed': 'The Vamp scan did not complete.',
});

function failure(
	code: PluginScanFailureCode,
	reason: string | null = null,
): Extract<VampAnalyzerScanOutcome, { status: 'failed' }> {
	return Object.freeze({
		status: 'failed', code, message: FAILURE_MESSAGES[code],
		fault: reason === null ? null : Object.freeze({ reason, quarantined: true as const }),
	});
}

function failureCode(error: unknown): PluginScanFailureCode {
	if (error instanceof ScanPreconditionError) return error.code;
	if (error instanceof HelperSupervisionError) {
		if (['cancelled', 'cancellation-timeout'].includes(error.cause_)) return 'helper-cancelled';
		if (error.cause_ === 'quarantined') return 'helper-quarantined';
		if (error.cause_ === 'disposed') return 'helper-disabled';
		if (error.cause_ === 'binary-mismatch') return 'helper-unavailable';
	}
	return 'helper-failed';
}

function scanFaultReason(error: unknown): string | null {
	if (error instanceof ScanPreconditionError) return null;
	if (error instanceof HelperContractViolationError) {
		return error.code === 'oversized' ? 'oversize-answer' : 'malformed-answer';
	}
	if (error instanceof HelperSupervisionError) {
		if (['malformed-message', 'job-mismatch'].includes(error.cause_)) return 'malformed-answer';
		if (['heartbeat', 'cancellation-timeout', 'resource-violation'].includes(error.cause_)) return 'scanner-hang';
		if (error.cause_ === 'helper-exit') return 'scanner-crash';
	}
	return null;
}

function admitRequest(
	value: unknown,
): Readonly<{ owner: object; rootId: string; format: string }> | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (!sameKeys(record, ['owner', 'rootId', 'format'])) return null;
	if (record.owner === null || typeof record.owner !== 'object') return null;
	if (typeof record.rootId !== 'string' || record.rootId.length < 1
		|| record.rootId.length > MAXIMUM_ROOT_ID_LENGTH || typeof record.format !== 'string') return null;
	return Object.freeze({ owner: record.owner, rootId: record.rootId, format: record.format });
}

function closedRecord<const Keys extends readonly string[]>(
	value: unknown, keys: Keys, label: string,
): Record<Keys[number], unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be a record.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be plain.`);
	const record = value as Record<string, unknown>;
	if (!sameKeys(record, keys)) throw new TypeError(`${label} has invalid keys.`);
	return record as Record<Keys[number], unknown>;
}

function sameKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(record).sort();
	const sorted = [...expected].sort();
	return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
