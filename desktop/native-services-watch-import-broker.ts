/* SPDX-License-Identifier: AGPL-3.0-only */

import type { WatchRuleV1 } from '../src/common/editor/native-watch-rule.ts';
import type { FramescaperNativeWatchEntry } from './native-services-watch-repository.ts';

const OPAQUE_ID = /^[a-f0-9]{16,64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAXIMUM_PENDING_IMPORTS = 1_024;

export interface FramescaperNativeWatchLinkedLocator {
	readonly locatorId: string;
	readonly locatorRevision: string;
	readonly name: string;
	readonly size: number;
	readonly mimeType: string;
	readonly lastModified: number;
}

export interface FramescaperNativeWatchProjectWitness {
	readonly schemaVersion: 20;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly open: boolean;
	readonly writable: boolean;
}

export interface FramescaperNativeWatchImportClaimRequest {
	readonly projectId: string;
	readonly projectRevision: number;
}

export interface FramescaperNativeWatchImportClaim {
	readonly claimId: string;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly importMode: 'link' | 'copy';
	readonly locatorId: string;
	readonly locatorRevision: string;
	readonly name: string;
	readonly size: number;
	readonly mimeType: string;
	readonly lastModified: number;
	readonly contentSha256: string;
}

export interface FramescaperNativeWatchImportCompletionRequest {
	readonly claimId: string;
	readonly projectId: string;
	readonly expectedProjectRevision: number;
	readonly committedProjectRevision: number;
	readonly success: boolean;
}

export interface FramescaperNativeWatchImportOffer {
	readonly rule: WatchRuleV1;
	readonly entry: FramescaperNativeWatchEntry;
	readonly contentSha256: string;
}

export interface FramescaperNativeWatchImportBrokerOptions {
	readonly currentOwner: () => object | null;
	readonly isOwnerCurrent: (owner: object) => boolean;
	readonly inspectProject: (projectId: string) => FramescaperNativeWatchProjectWitness | null;
	readonly alreadyImported: (
		projectId: string,
		contentSha256: string,
	) => Promise<boolean>;
	readonly createLocator: (
		entry: FramescaperNativeWatchEntry,
		contentSha256: string,
		owner: object,
	) => Promise<FramescaperNativeWatchLinkedLocator>;
	readonly releaseLocator: (
		locator: Readonly<{ locatorId: string; locatorRevision: string }>,
		owner: object,
	) => Promise<boolean>;
	readonly mintOpaqueId: () => string;
	readonly timeoutMs?: number;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancelSchedule?: (handle: unknown) => void;
}

interface BrokerEntry {
	readonly key: string;
	readonly offer: FramescaperNativeWatchImportOffer;
	readonly owner: object;
	readonly projectRevision: number;
	readonly locator: FramescaperNativeWatchLinkedLocator;
	readonly promise: Promise<boolean>;
	readonly resolve: (result: boolean) => void;
	claimId: string | null;
	completion: FramescaperNativeWatchImportCompletionRequest | null;
	timer: unknown;
}

/** Main-private pathless handoff between watch reconciliation and one save owner. */
export class FramescaperNativeWatchImportBroker {
	readonly #options: FramescaperNativeWatchImportBrokerOptions;
	readonly #entries = new Map<string, BrokerEntry>();
	readonly #claims = new Map<string, BrokerEntry>();
	readonly #timeoutMs: number;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancelSchedule: (handle: unknown) => void;
	#disposed = false;

	constructor(options: FramescaperNativeWatchImportBrokerOptions) {
		if (!options || typeof options.currentOwner !== 'function'
			|| typeof options.isOwnerCurrent !== 'function'
			|| typeof options.inspectProject !== 'function'
			|| typeof options.alreadyImported !== 'function'
			|| typeof options.createLocator !== 'function'
			|| typeof options.releaseLocator !== 'function'
			|| typeof options.mintOpaqueId !== 'function') {
			throw new TypeError('A watch-import broker requires exact main-private authorities.');
		}
		this.#options = options;
		this.#timeoutMs = positiveInteger(options.timeoutMs ?? 300_000, 'watch-import timeout');
		this.#schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
		this.#cancelSchedule = options.cancelSchedule ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
	}

	async offer(value: FramescaperNativeWatchImportOffer): Promise<boolean> {
		if (this.#disposed) return false;
		const offer = watchOffer(value);
		const key = offerKey(offer);
		const existing = this.#entries.get(key);
		if (existing) return existing.promise;
		if (this.#entries.size >= MAXIMUM_PENDING_IMPORTS || !admittedRule(offer.rule)) return false;
		const owner = this.#options.currentOwner();
		if (!owner || !this.#options.isOwnerCurrent(owner)) return false;
		const project = this.#options.inspectProject(offer.rule.projectId);
		if (!usableProject(project, offer.rule.projectId)) return false;
		if (await this.#options.alreadyImported(offer.rule.projectId, offer.contentSha256)) {
			const current = this.#options.inspectProject(offer.rule.projectId);
			return this.#options.isOwnerCurrent(owner)
				&& usableProject(current, offer.rule.projectId)
				&& current.projectRevision === project.projectRevision;
		}
		let locator: FramescaperNativeWatchLinkedLocator | null = null;
		try {
			locator = linkedLocator(await this.#options.createLocator(
				offer.entry, offer.contentSha256, owner,
			));
			if (!this.#options.isOwnerCurrent(owner)) throw new Error('Watch-import owner changed during locator admission.');
			const current = this.#options.inspectProject(offer.rule.projectId);
			if (!usableProject(current, offer.rule.projectId)
				|| current.projectRevision !== project.projectRevision) {
				throw new Error('Watch-import project changed during locator admission.');
			}
			let resolve!: (result: boolean) => void;
			const promise = new Promise<boolean>((settle) => { resolve = settle; });
			const entry: BrokerEntry = {
				key, offer, owner, locator, promise, resolve,
				projectRevision: project.projectRevision,
				claimId: null, completion: null, timer: null,
			};
			entry.timer = this.#schedule(() => { void this.#expire(entry); }, this.#timeoutMs);
			this.#entries.set(key, entry);
			return promise;
		} catch (error) {
			if (locator) await this.#options.releaseLocator(locator, owner).catch(() => false);
			throw error;
		}
	}

	claim(owner: object, value: unknown): FramescaperNativeWatchImportClaim | null {
		if (this.#disposed || !this.#options.isOwnerCurrent(owner)) return null;
		const request = claimRequest(value);
		for (const entry of this.#entries.values()) {
			if (entry.owner !== owner || entry.completion !== null
				|| entry.offer.rule.projectId !== request.projectId
				|| entry.projectRevision !== request.projectRevision) continue;
			const project = this.#options.inspectProject(request.projectId);
			if (!usableProject(project, request.projectId)
				|| project.projectRevision !== request.projectRevision) continue;
			if (entry.claimId === null) {
				entry.claimId = opaqueId(this.#options.mintOpaqueId(), 'watch-import claim id');
				this.#claims.set(entry.claimId, entry);
			}
			return claimProjection(entry);
		}
		return null;
	}

	async complete(owner: object, value: unknown): Promise<boolean> {
		const request = completionRequest(value);
		const entry = this.#claims.get(request.claimId);
		if (!entry || entry.owner !== owner || !this.#options.isOwnerCurrent(owner)) return false;
		if (entry.offer.rule.projectId !== request.projectId
			|| entry.projectRevision !== request.expectedProjectRevision
			|| request.committedProjectRevision !== request.expectedProjectRevision + 1) return false;
		if (entry.completion !== null) return sameCompletion(entry.completion, request);
		if (request.success) {
			const project = this.#options.inspectProject(request.projectId);
			if (!usableProject(project, request.projectId)
				|| project.projectRevision !== request.committedProjectRevision) return false;
		}
		entry.completion = request;
		this.#cancelSchedule(entry.timer);
		if (!request.success || entry.offer.rule.importMode === 'copy') {
			await this.#release(entry);
		}
		if (!request.success) this.#forget(entry);
		entry.resolve(request.success);
		return true;
	}

	/** Forget only after the durable watch-import row is committed. */
	recorded(value: FramescaperNativeWatchImportOffer): boolean {
		const entry = this.#entries.get(offerKey(watchOffer(value)));
		if (!entry?.completion?.success) return false;
		this.#forget(entry);
		return true;
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		const entries = [...this.#entries.values()];
		this.#entries.clear();
		this.#claims.clear();
		await Promise.all(entries.map(async (entry) => {
			this.#cancelSchedule(entry.timer);
			if (!entry.completion?.success) await this.#release(entry);
			entry.resolve(false);
		}));
	}

	async #expire(entry: BrokerEntry): Promise<void> {
		if (this.#entries.get(entry.key) !== entry || entry.completion?.success) return;
		this.#forget(entry);
		await this.#release(entry);
		entry.resolve(false);
	}

	async #release(entry: BrokerEntry): Promise<void> {
		await this.#options.releaseLocator(entry.locator, entry.owner).catch(() => false);
	}

	#forget(entry: BrokerEntry): void {
		this.#cancelSchedule(entry.timer);
		this.#entries.delete(entry.key);
		if (entry.claimId) this.#claims.delete(entry.claimId);
	}
}

function watchOffer(value: FramescaperNativeWatchImportOffer): FramescaperNativeWatchImportOffer {
	if (!value?.rule || !value.entry || !SHA256.test(value.contentSha256)) {
		throw new TypeError('A watch-import offer requires an exact rule, entry, and SHA-256.');
	}
	return value;
}

function admittedRule(rule: WatchRuleV1): boolean {
	return rule.enabled && !rule.recursive && !rule.generateProxies && rule.binId === null
		&& (rule.importMode === 'link' || rule.importMode === 'copy');
}

function usableProject(
	value: FramescaperNativeWatchProjectWitness | null,
	projectId: string,
): value is FramescaperNativeWatchProjectWitness {
	return value?.schemaVersion === 20 && value.projectId === projectId
		&& value.open && value.writable && Number.isSafeInteger(value.projectRevision)
		&& value.projectRevision >= 0;
}

function linkedLocator(value: FramescaperNativeWatchLinkedLocator): FramescaperNativeWatchLinkedLocator {
	if (!value || Reflect.ownKeys(value).length !== 6
		|| !OPAQUE_ID.test(value.locatorId) || !OPAQUE_ID.test(value.locatorRevision)
		|| typeof value.name !== 'string' || !value.name || value.name.length > 255
		|| !Number.isSafeInteger(value.size) || value.size < 1
		|| typeof value.mimeType !== 'string' || !value.mimeType.startsWith('video/')
		|| !Number.isSafeInteger(value.lastModified) || value.lastModified < 0) {
		throw new TypeError('A watch-import locator is not an exact pathless video locator.');
	}
	return Object.freeze({ ...value });
}

function claimRequest(value: unknown): FramescaperNativeWatchImportClaimRequest {
	const record = closedRecord(value, ['projectId', 'projectRevision'], 'watch-import claim request');
	return Object.freeze({
		projectId: projectId(record.projectId),
		projectRevision: nonNegativeInteger(record.projectRevision, 'watch-import project revision'),
	});
}

export function framescaperNativeWatchImportClaimRequest(
	value: unknown,
): FramescaperNativeWatchImportClaimRequest {
	return claimRequest(value);
}

function completionRequest(value: unknown): FramescaperNativeWatchImportCompletionRequest {
	const record = closedRecord(value, [
		'claimId', 'projectId', 'expectedProjectRevision', 'committedProjectRevision', 'success',
	], 'watch-import completion request');
	if (typeof record.success !== 'boolean') throw new TypeError('Watch-import success must be boolean.');
	return Object.freeze({
		claimId: opaqueId(record.claimId, 'watch-import claim id'),
		projectId: projectId(record.projectId),
		expectedProjectRevision: nonNegativeInteger(record.expectedProjectRevision, 'expected project revision'),
		committedProjectRevision: nonNegativeInteger(record.committedProjectRevision, 'committed project revision'),
		success: record.success,
	});
}

export function framescaperNativeWatchImportCompletionRequest(
	value: unknown,
): FramescaperNativeWatchImportCompletionRequest {
	return completionRequest(value);
}

export function framescaperNativeWatchImportClaim(
	value: unknown,
): FramescaperNativeWatchImportClaim {
	const record = closedRecord(value, [
		'claimId', 'projectId', 'projectRevision', 'importMode',
		'locatorId', 'locatorRevision', 'name', 'size', 'mimeType',
		'lastModified', 'contentSha256',
	], 'watch-import claim');
	if (record.importMode !== 'link' && record.importMode !== 'copy') {
		throw new TypeError('Invalid watch-import mode.');
	}
	const locator = linkedLocator({
		locatorId: record.locatorId as string, locatorRevision: record.locatorRevision as string,
		name: record.name as string, size: record.size as number, mimeType: record.mimeType as string,
		lastModified: record.lastModified as number,
	});
	const contentSha256 = record.contentSha256;
	if (typeof contentSha256 !== 'string' || !SHA256.test(contentSha256)) {
		throw new TypeError('Invalid watch-import content digest.');
	}
	return Object.freeze({
		claimId: opaqueId(record.claimId, 'watch-import claim id'),
		projectId: projectId(record.projectId),
		projectRevision: nonNegativeInteger(record.projectRevision, 'watch-import project revision'),
		importMode: record.importMode, ...locator, contentSha256,
	});
}

function claimProjection(entry: BrokerEntry): FramescaperNativeWatchImportClaim {
	return Object.freeze({
		claimId: entry.claimId!, projectId: entry.offer.rule.projectId,
		projectRevision: entry.projectRevision, importMode: entry.offer.rule.importMode,
		...entry.locator, contentSha256: entry.offer.contentSha256,
	});
}

function sameCompletion(
	left: FramescaperNativeWatchImportCompletionRequest,
	right: FramescaperNativeWatchImportCompletionRequest,
): boolean {
	return left.claimId === right.claimId && left.projectId === right.projectId
		&& left.expectedProjectRevision === right.expectedProjectRevision
		&& left.committedProjectRevision === right.committedProjectRevision
		&& left.success === right.success;
}

function offerKey(value: FramescaperNativeWatchImportOffer): string {
	return JSON.stringify([value.rule.ruleId, value.entry.fileIdentity, value.contentSha256]);
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<Field, unknown>>;
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) throw new TypeError(`Invalid ${label}.`);
	return value;
}

function projectId(value: unknown): string {
	if (typeof value !== 'string' || !PROJECT_ID.test(value)) throw new TypeError('Invalid watch-import project id.');
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`Invalid ${label}.`);
	return Number(value);
}

function positiveInteger(value: unknown, label: string): number {
	const number = nonNegativeInteger(value, label);
	if (number < 1) throw new RangeError(`Invalid ${label}.`);
	return number;
}
