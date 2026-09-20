/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';

import {
	admitVampAnalyzerDescriptor,
	type VampAnalyzerDescriptor,
} from './vamp-analyzer-contract.ts';

export const VAMP_ANALYZER_COMPATIBILITY = Object.freeze([
	'compatible', 'incompatible-platform', 'incompatible-architecture',
	'unusable-library', 'unknown',
] as const);
export type VampAnalyzerCompatibility = (typeof VAMP_ANALYZER_COMPATIBILITY)[number];

export const VAMP_ANALYZER_REGISTRY_LIMITS = Object.freeze({
	maximumEntries: 4_096,
	maximumInstallationsPerEntry: 16,
	maximumDescriptorsPerLibrary: 256,
	maximumLibraryBytes: 8 * 1_024 * 1_024 * 1_024,
	maximumPathLength: 32_768,
} as const);

export interface VampAnalyzerFileIdentity {
	readonly dev: number;
	readonly ino: number;
}

export interface VampAnalyzerLibraryObservation {
	readonly kind: 'analyzer-library';
	readonly format: 'vamp';
	readonly libraryPath: string;
	readonly libraryBytes: number;
	readonly librarySha256: string;
	readonly identity: Readonly<VampAnalyzerFileIdentity>;
	readonly platform: 'darwin' | 'linux' | 'win32';
	readonly architecture: 'arm64' | 'x64';
	readonly compatibility: VampAnalyzerCompatibility;
	readonly descriptors: readonly Readonly<VampAnalyzerDescriptor>[];
}

/** Main-private exact grant. Never return it across the preload boundary. */
export interface VampAnalyzerExecutionGrant {
	readonly kind: 'vamp-analyzer';
	readonly format: 'vamp';
	readonly analyzerIdentifier: string;
	readonly libraryPath: string;
	readonly libraryBytes: number;
	readonly librarySha256: string;
	readonly identity: Readonly<VampAnalyzerFileIdentity>;
	readonly descriptor: Readonly<VampAnalyzerDescriptor>;
}

export type VampAnalyzerIneligibleReason =
	| 'identity-collision' | 'allowance-required' | 'incompatible' | 'quarantined';

export interface VampAnalyzerInstallationView {
	readonly installationId: string;
	readonly librarySha256: string;
	readonly libraryBytes: number;
	readonly platform: string;
	readonly architecture: string;
	readonly compatibility: VampAnalyzerCompatibility;
	readonly descriptor: Readonly<VampAnalyzerDescriptor>;
	readonly allowed: boolean;
	readonly selected: boolean;
	readonly quarantined: boolean;
}

export interface VampAnalyzerEntryView {
	readonly kind: 'analyzer';
	readonly format: 'vamp';
	readonly analyzerId: string;
	readonly identifier: string;
	readonly name: string;
	readonly eligible: boolean;
	readonly ineligibleReason: VampAnalyzerIneligibleReason | null;
	readonly installations: readonly Readonly<VampAnalyzerInstallationView>[];
}

export interface VampAnalyzerRegistryView {
	readonly kind: 'analyzer-registry';
	readonly format: 'vamp';
	readonly entries: readonly Readonly<VampAnalyzerEntryView>[];
}

export type VampAnalyzerRegistryAdmission =
	| Readonly<{
		status: 'recorded';
		analyzers: readonly Readonly<{
			analyzerId: string;
			installationId: string;
			allowanceRequired: boolean;
			selectionRequired: boolean;
		}>[];
	}>
	| Readonly<{
		status: 'rejected';
		reason: 'malformed' | 'identity-change' | 'quarantined' | 'capacity';
		detail: string;
	}>;

export type VampAnalyzerRegistryErrorCode =
	| VampAnalyzerIneligibleReason | 'unknown-installation' | 'not-active-installation';

export class VampAnalyzerRegistryError extends Error {
	readonly code: VampAnalyzerRegistryErrorCode;

	constructor(code: VampAnalyzerRegistryErrorCode, message: string) {
		super(message);
		this.name = 'VampAnalyzerRegistryError';
		this.code = code;
	}
}

interface Installation {
	readonly installationId: string;
	observation: Readonly<VampAnalyzerLibraryObservation>;
	descriptor: Readonly<VampAnalyzerDescriptor>;
	allowed: boolean;
}

interface Entry {
	readonly analyzerId: string;
	readonly identifier: string;
	readonly installations: Map<string, Installation>;
	selected: string | null;
}

export interface DesktopVampAnalyzerRegistryOptions {
	readonly isQuarantined: (digest: string) => boolean;
}

export class DesktopVampAnalyzerRegistry {
	readonly #isQuarantined: (digest: string) => boolean;
	readonly #entries = new Map<string, Entry>();
	readonly #digestClaims = new Map<string, string>();

	constructor(options: DesktopVampAnalyzerRegistryOptions) {
		if (typeof options?.isQuarantined !== 'function') {
			throw new TypeError('A Vamp analyzer registry requires durable quarantine lookup.');
		}
		this.#isQuarantined = options.isQuarantined;
	}

	recordLibrary(value: unknown): VampAnalyzerRegistryAdmission {
		let observation: Readonly<VampAnalyzerLibraryObservation>;
		try {
			observation = admitObservation(value);
		} catch (error) {
			return rejected('malformed', describeError(error));
		}
		if (this.#isQuarantined(observation.librarySha256)) {
			return rejected('quarantined', 'That Vamp analyzer library is quarantined.');
		}
		const claim = descriptorClaim(observation);
		const priorClaim = this.#digestClaims.get(observation.librarySha256);
		if (priorClaim !== undefined && priorClaim !== claim) {
			return rejected('identity-change',
				'The same Vamp library digest reported a different analyzer descriptor set.');
		}
		const additions = observation.descriptors.filter((descriptor) =>
			!this.#entries.has(vampAnalyzerIdFor(descriptor.identifier))).length;
		if (this.#entries.size + additions > VAMP_ANALYZER_REGISTRY_LIMITS.maximumEntries) {
			return rejected('capacity', 'The Vamp analyzer registry is full.');
		}
		for (const descriptor of observation.descriptors) {
			const entry = this.#entries.get(vampAnalyzerIdFor(descriptor.identifier));
			const installationId = vampAnalyzerInstallationIdFor(
				observation.librarySha256, descriptor.identifier);
			if (entry !== undefined && !entry.installations.has(installationId)
				&& entry.installations.size >= VAMP_ANALYZER_REGISTRY_LIMITS.maximumInstallationsPerEntry) {
				return rejected('capacity', 'A Vamp analyzer identity has too many installations.');
			}
		}

		const analyzers = observation.descriptors.map((descriptor) => {
			const analyzerId = vampAnalyzerIdFor(descriptor.identifier);
			const entry: Entry = this.#entries.get(analyzerId) ?? {
				analyzerId, identifier: descriptor.identifier, installations: new Map(), selected: null,
			};
			const installationId = vampAnalyzerInstallationIdFor(
				observation.librarySha256, descriptor.identifier);
			const existing = entry.installations.get(installationId);
			if (!existing && entry.installations.size > 0) entry.selected = null;
			entry.installations.set(installationId, {
				installationId, observation, descriptor, allowed: existing?.allowed === true,
			});
			this.#entries.set(analyzerId, entry);
			return Object.freeze({
				analyzerId, installationId,
				allowanceRequired: existing?.allowed !== true,
				selectionRequired: entry.installations.size > 1 && entry.selected === null,
			});
		});
		this.#digestClaims.set(observation.librarySha256, claim);
		return Object.freeze({ status: 'recorded', analyzers: Object.freeze(analyzers) });
	}

	allow(installationId: unknown): void {
		const [, installation] = this.#locate(opaqueId(installationId, 'installation ID'));
		if (this.#isQuarantined(installation.observation.librarySha256)) {
			throw new VampAnalyzerRegistryError('quarantined', 'A quarantined Vamp analyzer cannot be allowed.');
		}
		installation.allowed = true;
	}

	withdrawAllowance(installationId: unknown): void {
		this.#locate(opaqueId(installationId, 'installation ID'))[1].allowed = false;
	}

	select(installationId: unknown): void {
		const admitted = opaqueId(installationId, 'installation ID');
		const [entry] = this.#locate(admitted);
		entry.selected = admitted;
	}

	forget(installationId: unknown): boolean {
		const admitted = opaqueId(installationId, 'installation ID');
		for (const entry of this.#entries.values()) {
			const installation = entry.installations.get(admitted);
			if (!installation) continue;
			entry.installations.delete(admitted);
			if (entry.selected === admitted) entry.selected = null;
			if (entry.installations.size === 0) this.#entries.delete(entry.analyzerId);
			const digest = installation.observation.librarySha256;
			if (![...this.#entries.values()].some((candidate) => [...candidate.installations.values()]
				.some((item) => item.observation.librarySha256 === digest))) this.#digestClaims.delete(digest);
			return true;
		}
		return false;
	}

	executionGrantFor(installationId: unknown): Readonly<VampAnalyzerExecutionGrant> {
		const admitted = opaqueId(installationId, 'installation ID');
		const [entry, installation] = this.#locate(admitted);
		const reason = this.#ineligibleReason(entry);
		if (reason !== null) throw new VampAnalyzerRegistryError(reason, ineligibleMessage(reason));
		const active = entry.selected ?? (entry.installations.size === 1 ? admitted : null);
		if (active !== admitted) {
			throw new VampAnalyzerRegistryError('not-active-installation',
				'That Vamp analyzer installation is not the selected installation.');
		}
		return Object.freeze({
			kind: 'vamp-analyzer', format: 'vamp', analyzerIdentifier: entry.identifier,
			libraryPath: installation.observation.libraryPath,
			libraryBytes: installation.observation.libraryBytes,
			librarySha256: installation.observation.librarySha256,
			identity: installation.observation.identity,
			descriptor: installation.descriptor,
		});
	}

	describe(): Readonly<VampAnalyzerRegistryView> {
		const entries = [...this.#entries.values()]
			.sort((left, right) => left.analyzerId.localeCompare(right.analyzerId))
			.map((entry): Readonly<VampAnalyzerEntryView> => {
				const reason = this.#ineligibleReason(entry);
				const installations = [...entry.installations.values()]
					.sort((left, right) => left.installationId.localeCompare(right.installationId))
					.map((installation): Readonly<VampAnalyzerInstallationView> => Object.freeze({
						installationId: installation.installationId,
						librarySha256: installation.observation.librarySha256,
						libraryBytes: installation.observation.libraryBytes,
						platform: installation.observation.platform,
						architecture: installation.observation.architecture,
						compatibility: installation.observation.compatibility,
						descriptor: installation.descriptor,
						allowed: installation.allowed,
						selected: entry.selected === installation.installationId,
						quarantined: this.#isQuarantined(installation.observation.librarySha256),
					}));
				return Object.freeze({
					kind: 'analyzer', format: 'vamp', analyzerId: entry.analyzerId,
					identifier: entry.identifier, name: installations[0]?.descriptor.name ?? entry.identifier,
					eligible: reason === null, ineligibleReason: reason,
					installations: Object.freeze(installations),
				});
			});
		return Object.freeze({ kind: 'analyzer-registry', format: 'vamp', entries: Object.freeze(entries) });
	}

	#locate(installationId: string): readonly [Entry, Installation] {
		for (const entry of this.#entries.values()) {
			const installation = entry.installations.get(installationId);
			if (installation) return [entry, installation];
		}
		throw new VampAnalyzerRegistryError('unknown-installation', 'Unknown Vamp analyzer installation.');
	}

	#ineligibleReason(entry: Entry): VampAnalyzerIneligibleReason | null {
		if (entry.installations.size > 1 && entry.selected === null) return 'identity-collision';
		const activeId = entry.selected ?? entry.installations.keys().next().value as string | undefined;
		const active = activeId === undefined ? undefined : entry.installations.get(activeId);
		if (!active) return 'identity-collision';
		if (this.#isQuarantined(active.observation.librarySha256)) return 'quarantined';
		if (active.observation.compatibility !== 'compatible') return 'incompatible';
		return active.allowed ? null : 'allowance-required';
	}
}

export function vampAnalyzerIdFor(identifier: string): string {
	return opaqueHash('va', 'vamp-analyzer', identifier);
}

export function vampAnalyzerInstallationIdFor(digest: string, identifier: string): string {
	return opaqueHash('vi', 'vamp-analyzer-installation', digest, identifier);
}

function admitObservation(value: unknown): Readonly<VampAnalyzerLibraryObservation> {
	const record = closedRecord(value, [
		'kind', 'format', 'libraryPath', 'libraryBytes', 'librarySha256', 'identity',
		'platform', 'architecture', 'compatibility', 'descriptors',
	], 'Vamp analyzer library observation');
	if (record.kind !== 'analyzer-library' || record.format !== 'vamp') {
		throw new TypeError('Invalid Vamp analyzer library kind or format.');
	}
	const platform = enumeration(record.platform, ['darwin', 'linux', 'win32'], 'platform');
	const libraryPath = exactPath(record.libraryPath, platform);
	const identityRecord = closedRecord(record.identity, ['dev', 'ino'], 'Vamp library identity');
	if (!Array.isArray(record.descriptors) || record.descriptors.length < 1
		|| record.descriptors.length > VAMP_ANALYZER_REGISTRY_LIMITS.maximumDescriptorsPerLibrary) {
		throw new RangeError('Invalid Vamp analyzer descriptor count.');
	}
	const descriptors = Object.freeze(record.descriptors.map(admitVampAnalyzerDescriptor));
	const identifiers = descriptors.map(({ identifier }) => identifier);
	if (new Set(identifiers).size !== identifiers.length) {
		throw new TypeError('A Vamp library reported duplicate analyzer identifiers.');
	}
	return Object.freeze({
		kind: 'analyzer-library', format: 'vamp', libraryPath,
		libraryBytes: integer(record.libraryBytes, 1,
			VAMP_ANALYZER_REGISTRY_LIMITS.maximumLibraryBytes, 'library byte length'),
		librarySha256: digest(record.librarySha256),
		identity: Object.freeze({
			dev: integer(identityRecord.dev, 0, Number.MAX_SAFE_INTEGER, 'library device identity'),
			ino: integer(identityRecord.ino, 0, Number.MAX_SAFE_INTEGER, 'library inode identity'),
		}),
		platform, architecture: enumeration(record.architecture, ['arm64', 'x64'], 'architecture'),
		compatibility: enumeration(record.compatibility, VAMP_ANALYZER_COMPATIBILITY, 'compatibility'),
		descriptors,
	});
}

function descriptorClaim(observation: Readonly<VampAnalyzerLibraryObservation>): string {
	return createHash('sha256').update(JSON.stringify({
		libraryBytes: observation.libraryBytes,
		descriptors: [...observation.descriptors]
			.sort((left, right) => left.identifier.localeCompare(right.identifier)),
	})).digest('hex');
}

function exactPath(value: unknown, platform: 'darwin' | 'linux' | 'win32'): string {
	if (typeof value !== 'string' || value.length < 1
		|| value.length > VAMP_ANALYZER_REGISTRY_LIMITS.maximumPathLength || value.includes('\0')) {
		throw new TypeError('Invalid Vamp analyzer library path.');
	}
	const api = platform === 'win32' ? win32 : posix;
	if (!api.isAbsolute(value) || api.normalize(value) !== value) {
		throw new TypeError('A Vamp analyzer library path must be absolute and normalized.');
	}
	return value;
}

function closedRecord<const Keys extends readonly string[]>(
	value: unknown, keys: Keys, label: string,
): Record<Keys[number], unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a record.`);
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain record.`);
	for (const property of Object.values(Object.getOwnPropertyDescriptors(value))) {
		if (property.get !== undefined || property.set !== undefined) throw new TypeError(`${label} may not contain accessors.`);
	}
	const record = value as Record<string, unknown>;
	const actual = Object.keys(record).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		throw new TypeError(`${label} has invalid keys.`);
	}
	return record as Record<Keys[number], unknown>;
}

function enumeration<const Value extends string>(
	value: unknown, values: readonly Value[], label: string,
): Value {
	if (typeof value !== 'string' || !values.includes(value as Value)) throw new TypeError(`Invalid Vamp ${label}.`);
	return value as Value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new RangeError(`Invalid Vamp ${label}.`);
	}
	return value as number;
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f\d]{64}$/u.test(value)) throw new TypeError('Invalid Vamp library digest.');
	return value;
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^vi[a-f\d]{30}$/u.test(value)) throw new TypeError(`Invalid Vamp ${label}.`);
	return value;
}

function opaqueHash(prefix: string, ...parts: string[]): string {
	const hash = createHash('sha256');
	for (const part of parts) hash.update(part.length.toString(10)).update(':').update(part);
	return `${prefix}${hash.digest('hex').slice(0, 30)}`;
}

function rejected(
	reason: 'malformed' | 'identity-change' | 'quarantined' | 'capacity', detail: string,
): VampAnalyzerRegistryAdmission {
	return Object.freeze({ status: 'rejected', reason, detail });
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function ineligibleMessage(reason: VampAnalyzerIneligibleReason): string {
	switch (reason) {
		case 'identity-collision': return 'The Vamp analyzer installation choice is unresolved.';
		case 'allowance-required': return 'The Vamp analyzer installation requires explicit allowance.';
		case 'incompatible': return 'The Vamp analyzer installation is incompatible.';
		case 'quarantined': return 'The Vamp analyzer installation is quarantined.';
	}
}
