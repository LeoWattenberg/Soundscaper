/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord, readClosedDomainField } from '../../src/common/editor/closed-domain-value.ts';
import { PHOTO_LARGE_LIBRARY_SPECIFICATION_V1 as SPEC } from '../../src/lightscaper/quality/large-library-workload-v1.ts';

export const PHOTO_LIBRARY_SEED_DIAGNOSTIC_KIND_V1 = 'lightscaper-library-seed-phase-v1';
type Phase = 'readiness' | 'managed-import' | 'schema' | 'first-publication' | 'first-retain' | 'final-custody' | 'digest';
type Base = Readonly<{ kind: typeof PHOTO_LIBRARY_SEED_DIAGNOSTIC_KIND_V1; schemaVersion: 1; elapsedMs: number; durationMs: number | null }>;
export type PhotoLibrarySeedPhaseV1 = Base & (Readonly<{ phase: Phase; event: 'begin' | 'end' }>
	| Readonly<{ phase: 'publication-progress'; event: 'progress'; photoCount: number; batchCount: number;
		retainDurationMs: number; publicationDurationMs: number; pointReads: number; nativeWrites: number;
		maximumResidentPhotos: number; maximumAdmittedBytes: number; getAllRequests: 0; cursorRequests: 0 }>);
const BASE = ['kind', 'schemaVersion', 'phase', 'event', 'elapsedMs', 'durationMs'];
const PROGRESS = ['photoCount', 'batchCount', 'retainDurationMs', 'publicationDurationMs', 'pointReads', 'nativeWrites',
	'maximumResidentPhotos', 'maximumAdmittedBytes', 'getAllRequests', 'cursorRequests'];
const PHASES: readonly string[] = ['readiness', 'managed-import', 'schema', 'first-publication', 'first-retain', 'final-custody', 'digest'];

/** Setup observations contain fixed scalar counters, never catalog identities or authority. */
export function formatLargePhotoLibrarySeedPhaseV1(value: unknown): string {
	const candidate = readClosedDomainRecord(value, 'Seed phase', [...BASE, ...PROGRESS], BASE);
	const field = (name: string) => readClosedDomainField(candidate, name, 'Seed phase');
	const phase = field('phase'), event = field('event');
	readClosedDomainRecord(value, 'Seed phase', phase === 'publication-progress' ? [...BASE, ...PROGRESS] : BASE);
	if (field('kind') !== PHOTO_LIBRARY_SEED_DIAGNOSTIC_KIND_V1 || field('schemaVersion') !== 1) throw new TypeError('Unsupported seed phase.');
	const elapsedMs = integer(field('elapsedMs'), 3_600_000), duration = field('durationMs');
	const durationMs = duration === null ? null : integer(duration, 3_600_000);
	let frame: PhotoLibrarySeedPhaseV1;
	if (phase === 'publication-progress') {
		if (event !== 'progress' || durationMs !== null || field('getAllRequests') !== 0 || field('cursorRequests') !== 0) throw new TypeError('Invalid seed progress.');
		const batchCount = integer(field('batchCount'), Math.ceil(SPEC.photoCount / SPEC.publicationBatchSize));
		const pointReads = integer(field('pointReads'), SPEC.photoCount * 4);
		if (pointReads !== batchCount * 4) throw new TypeError('Seed publication point-read totals disagree.');
		frame = { kind: PHOTO_LIBRARY_SEED_DIAGNOSTIC_KIND_V1, schemaVersion: 1, phase, event, elapsedMs, durationMs,
			photoCount: integer(field('photoCount'), SPEC.photoCount), batchCount,
			retainDurationMs: integer(field('retainDurationMs'), 3_600_000), publicationDurationMs: integer(field('publicationDurationMs'), 3_600_000),
			pointReads, nativeWrites: integer(field('nativeWrites'), 100_000_000),
			maximumResidentPhotos: integer(field('maximumResidentPhotos'), SPEC.publicationBatchSize),
			maximumAdmittedBytes: integer(field('maximumAdmittedBytes'), 8 * 1024 * 1024), getAllRequests: 0, cursorRequests: 0 };
	} else {
		if (typeof phase !== 'string' || !PHASES.includes(phase) || (event !== 'begin' && event !== 'end')
			|| (event === 'begin' ? durationMs !== null : durationMs === null)) throw new TypeError('Invalid seed phase boundary.');
		frame = { kind: PHOTO_LIBRARY_SEED_DIAGNOSTIC_KIND_V1, schemaVersion: 1, phase: phase as Phase, event, elapsedMs, durationMs };
	}
	const line = JSON.stringify(frame);
	if (line.length > 512) throw new RangeError('Seed phase exceeds its 512-byte ASCII frame bound.');
	return line;
}

/** Caller owns the shared total record budget and decides how admitted lines reach stdout. */
export function observeLargePhotoLibrarySeedConsoleV1(message: string, emit: (line: string) => void): boolean {
	if (message.length > 512) {
		if (message.includes(PHOTO_LIBRARY_SEED_DIAGNOSTIC_KIND_V1)) throw new RangeError('Seed console frame exceeds its byte bound.');
		return false;
	}
	let value: unknown;
	try { value = JSON.parse(message) as unknown; } catch { return false; }
	if (!value || typeof value !== 'object' || Object.getOwnPropertyDescriptor(value, 'kind')?.value !== PHOTO_LIBRARY_SEED_DIAGNOSTIC_KIND_V1) return false;
	emit(formatLargePhotoLibrarySeedPhaseV1(value));
	return true;
}

function integer(value: unknown, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new RangeError('Seed phase requires bounded integer facts.');
	return value;
}

export interface PhotoLibraryQueryTransactionObservationV1 {
	snapshot(): Readonly<{ started: number; completed: number; aborted: number; active: number; maximumActive: number; nativeDurationMs: number }>;
	stop(): void;
}

/** Passive first-warm-up observation: no IDB requests, timers, cancellation or resource ownership. */
export function createLargePhotoLibraryQueryTransactionObserverV1(
	host: Pick<IDBDatabase, 'transaction'>, databaseName: string, now: () => number = () => performance.now(),
): PhotoLibraryQueryTransactionObservationV1 {
	const native = host.transaction, add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
	let listening = true, started = 0, completed = 0, aborted = 0, active = 0, maximumActive = 0, nativeDurationMs = 0;
	const profiles = [['catalogs', 'catalogStates', 'photoQueryRows', 'photoQueryBuildStates'],
		['catalogs', 'catalogStates', 'photoQueryRowsV2', 'photoQueryBuildStatesV2']];
	const observed = function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>): IDBTransaction {
		const transaction = Reflect.apply(native, this, args) as IDBTransaction;
		const names = args[0];
		if (!listening || this.name !== databaseName || args[1] !== 'readonly' || !Array.isArray(names)
			|| names.length !== 4 || !profiles.some(profile => profile.every(name => names.includes(name)))) return transaction;
		started++; active++; maximumActive = Math.max(maximumActive, active);
		const began = now(); let settled = false;
		const terminal = (event: Event) => {
			if (settled) return;
			settled = true; active--; nativeDurationMs += Math.max(0, now() - began);
			if (event.type === 'complete') completed++; else aborted++;
			Reflect.apply(remove, transaction, ['complete', terminal]); Reflect.apply(remove, transaction, ['abort', terminal]);
		};
		Reflect.apply(add, transaction, ['complete', terminal]); Reflect.apply(add, transaction, ['abort', terminal]);
		return transaction;
	};
	host.transaction = observed;
	return Object.freeze({ snapshot: () => Object.freeze({ started, completed, aborted, active, maximumActive, nativeDurationMs: Math.round(nativeDurationMs) }),
		stop: () => { listening = false; if (host.transaction === observed) host.transaction = native; } });
}
