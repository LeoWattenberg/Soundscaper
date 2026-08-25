/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	framescaperNativeWatchImportedWitness,
	framescaperNativeWatchImportClaimRequest,
	framescaperNativeWatchImportCompletionRequest,
	framescaperNativeWatchImportOffer,
	framescaperNativeWatchLinkedLocator,
	framescaperNativeWatchRuleAdmitted,
	framescaperNativeWatchUsableProject,
	type FramescaperNativeWatchImportedWitness,
	type FramescaperNativeWatchImportClaim,
	type FramescaperNativeWatchImportCompletionRequest,
	type FramescaperNativeWatchImportOffer,
	type FramescaperNativeWatchLinkedLocator,
	type FramescaperNativeWatchProjectWitness,
} from './native-services-watch-import-contract.ts';
import type { FramescaperNativeWatchEntry } from './native-services-watch-repository.ts';

export {
	framescaperNativeWatchImportClaim,
	framescaperNativeWatchImportClaimRequest,
	framescaperNativeWatchImportCompletionRequest,
} from './native-services-watch-import-contract.ts';
export type {
	FramescaperNativeWatchImportedWitness,
	FramescaperNativeWatchImportClaim,
	FramescaperNativeWatchImportClaimRequest,
	FramescaperNativeWatchImportCompletionRequest,
	FramescaperNativeWatchImportOffer,
	FramescaperNativeWatchLinkedLocator,
	FramescaperNativeWatchProjectWitness,
} from './native-services-watch-import-contract.ts';

const OPAQUE_ID = /^[a-f0-9]{16,64}$/u;
const MAXIMUM_PENDING_IMPORTS = 1_024;

export interface FramescaperNativeWatchImportBrokerOptions {
	readonly currentOwner: () => object | null;
	readonly isOwnerCurrent: (owner: object) => boolean;
	readonly inspectProject: (projectId: string) => FramescaperNativeWatchProjectWitness | null;
	readonly alreadyImported: (
		projectId: string,
		contentSha256: string,
	) => Promise<boolean>;
	readonly inspectImported?: (
		projectId: string,
		binId: string | null,
		contentSha256: string,
	) => Promise<FramescaperNativeWatchImportedWitness | null>;
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
	readonly projectSchemaVersion: 20 | 28 | 31;
	readonly existingSourceId: string | null;
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
		const offer = framescaperNativeWatchImportOffer(value);
		const key = offerKey(offer);
		const existing = this.#entries.get(key);
		if (existing) return existing.promise;
		if (this.#entries.size >= MAXIMUM_PENDING_IMPORTS) return false;
		const owner = this.#options.currentOwner();
		if (!owner || !this.#options.isOwnerCurrent(owner)) return false;
		const project = this.#options.inspectProject(offer.rule.projectId);
		if (!framescaperNativeWatchUsableProject(project, offer.rule.projectId)
			|| !framescaperNativeWatchRuleAdmitted(offer.rule, project)) return false;
		let existingSourceId: string | null = null;
		if (project.schemaVersion !== 20) {
			if (!this.#options.inspectImported) return false;
			const imported = framescaperNativeWatchImportedWitness(await this.#options.inspectImported(
				offer.rule.projectId, offer.rule.binId, offer.contentSha256,
			));
			if (imported && !sameImportedTarget(imported, offer, project)) return false;
			if (imported && (!offer.rule.generateProxies || imported.proxyAttached)) {
				return this.#unchanged(owner, project);
			}
			existingSourceId = imported?.sourceId ?? null;
		} else if (await this.#options.alreadyImported(offer.rule.projectId, offer.contentSha256)) {
			return this.#unchanged(owner, project);
		}
		let locator: FramescaperNativeWatchLinkedLocator | null = null;
		try {
			locator = framescaperNativeWatchLinkedLocator(await this.#options.createLocator(
				offer.entry, offer.contentSha256, owner,
			));
			if (!this.#options.isOwnerCurrent(owner)) throw new Error('Watch-import owner changed during locator admission.');
			const current = this.#options.inspectProject(offer.rule.projectId);
			if (!framescaperNativeWatchUsableProject(current, offer.rule.projectId)
				|| !framescaperNativeWatchRuleAdmitted(offer.rule, current)
				|| current.projectRevision !== project.projectRevision) {
				throw new Error('Watch-import project changed during locator admission.');
			}
			let resolve!: (result: boolean) => void;
			const promise = new Promise<boolean>((settle) => { resolve = settle; });
			const entry: BrokerEntry = {
				key, offer, owner, locator, promise, resolve,
				projectRevision: project.projectRevision,
				projectSchemaVersion: project.schemaVersion, existingSourceId,
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
		const request = framescaperNativeWatchImportClaimRequest(value);
		for (const entry of this.#entries.values()) {
			if (entry.owner !== owner || entry.completion !== null
				|| entry.offer.rule.projectId !== request.projectId
				|| entry.projectRevision !== request.projectRevision) continue;
			const project = this.#options.inspectProject(request.projectId);
			if (!framescaperNativeWatchUsableProject(project, request.projectId)
				|| !framescaperNativeWatchRuleAdmitted(entry.offer.rule, project)
				|| project.schemaVersion !== entry.projectSchemaVersion
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
		const request = framescaperNativeWatchImportCompletionRequest(value);
		const entry = this.#claims.get(request.claimId);
		if (!entry || entry.owner !== owner || !this.#options.isOwnerCurrent(owner)) return false;
		if (entry.offer.rule.projectId !== request.projectId
			|| entry.projectRevision !== request.expectedProjectRevision) return false;
		if (entry.completion !== null) return sameCompletion(entry.completion, request);
		if (!validCompletionTarget(entry, request)) return false;
		if (request.success) {
			const project = this.#options.inspectProject(request.projectId);
			if (!framescaperNativeWatchUsableProject(project, request.projectId)
				|| project.schemaVersion !== entry.projectSchemaVersion
				|| project.projectRevision !== request.committedProjectRevision) return false;
			if (entry.projectSchemaVersion !== 20) {
				const imported = await this.#inspectImported(entry);
				if (!imported || imported.sourceId !== requestSourceId(request)
					|| imported.projectRevision !== request.committedProjectRevision
					|| (entry.offer.rule.generateProxies && !imported.proxyAttached)) return false;
				const verifiedProject = this.#options.inspectProject(request.projectId);
				if (!framescaperNativeWatchUsableProject(verifiedProject, request.projectId)
					|| verifiedProject.schemaVersion !== entry.projectSchemaVersion
					|| verifiedProject.projectRevision !== request.committedProjectRevision) return false;
			}
		}
		entry.completion = request;
		this.#cancelSchedule(entry.timer);
		if (!request.success || entry.offer.rule.importMode === 'copy'
			|| entry.existingSourceId !== null) {
			await this.#release(entry);
		}
		if (!request.success) this.#forget(entry);
		entry.resolve(request.success);
		return true;
	}

	/** Forget only after the durable watch-import row is committed. */
	recorded(value: FramescaperNativeWatchImportOffer): boolean {
		const entry = this.#entries.get(offerKey(framescaperNativeWatchImportOffer(value)));
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
		if (entry.projectSchemaVersion !== 20 && entry.offer.rule.importMode === 'link'
			&& entry.existingSourceId === null) {
			try {
				if (await this.#inspectImported(entry) !== null) return;
			} catch {
				// Uncertain project custody must not break a possibly landed linked source.
				return;
			}
		}
		await this.#options.releaseLocator(entry.locator, entry.owner).catch(() => false);
	}

	async #inspectImported(entry: BrokerEntry): Promise<FramescaperNativeWatchImportedWitness | null> {
		if (!this.#options.inspectImported) return null;
		const value = framescaperNativeWatchImportedWitness(await this.#options.inspectImported(
			entry.offer.rule.projectId, entry.offer.rule.binId, entry.offer.contentSha256,
		));
		if (!value || !sameImportedTarget(value, entry.offer, {
			schemaVersion: entry.projectSchemaVersion,
			projectId: entry.offer.rule.projectId,
			projectRevision: value.projectRevision,
			open: true, writable: true, binId: entry.offer.rule.binId,
		})) return null;
		return value;
	}

	#unchanged(owner: object, project: FramescaperNativeWatchProjectWitness): boolean {
		const current = this.#options.inspectProject(project.projectId);
		return this.#options.isOwnerCurrent(owner)
			&& framescaperNativeWatchUsableProject(current, project.projectId)
			&& current.schemaVersion === project.schemaVersion
			&& current.projectRevision === project.projectRevision;
	}

	#forget(entry: BrokerEntry): void {
		this.#cancelSchedule(entry.timer);
		this.#entries.delete(entry.key);
		if (entry.claimId) this.#claims.delete(entry.claimId);
	}
}

function claimProjection(entry: BrokerEntry): FramescaperNativeWatchImportClaim {
	const claim = {
		claimId: entry.claimId!, projectId: entry.offer.rule.projectId,
		projectRevision: entry.projectRevision, importMode: entry.offer.rule.importMode,
		...entry.locator, contentSha256: entry.offer.contentSha256,
	} as const;
	if (entry.projectSchemaVersion === 20) return Object.freeze(claim);
	return Object.freeze({
		...claim, projectSchemaVersion: entry.projectSchemaVersion, binId: entry.offer.rule.binId!,
		generateProxies: entry.offer.rule.generateProxies,
		existingSourceId: entry.existingSourceId,
	});
}

function sameCompletion(
	left: FramescaperNativeWatchImportCompletionRequest,
	right: FramescaperNativeWatchImportCompletionRequest,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function validCompletionTarget(
	entry: BrokerEntry,
	request: FramescaperNativeWatchImportCompletionRequest,
): boolean {
	if (entry.projectSchemaVersion === 20) {
		return !('projectSchemaVersion' in request)
			&& request.committedProjectRevision === request.expectedProjectRevision + 1;
	}
	if (!('projectSchemaVersion' in request)
		|| request.projectSchemaVersion !== entry.projectSchemaVersion
		|| request.binId !== entry.offer.rule.binId
		|| request.contentSha256 !== entry.offer.contentSha256) return false;
	if (!request.success) {
		return request.committedProjectRevision === request.expectedProjectRevision;
	}
	const revisionDelta = entry.existingSourceId === null && entry.offer.rule.generateProxies ? 2 : 1;
	return request.sourceId !== null
		&& request.committedProjectRevision === request.expectedProjectRevision + revisionDelta;
}

function requestSourceId(request: FramescaperNativeWatchImportCompletionRequest): string | null {
	return 'projectSchemaVersion' in request ? request.sourceId : null;
}

function sameImportedTarget(
	value: FramescaperNativeWatchImportedWitness,
	offer: FramescaperNativeWatchImportOffer,
	project: FramescaperNativeWatchProjectWitness,
): boolean {
	return value.projectId === offer.rule.projectId
		&& value.projectRevision === project.projectRevision
		&& value.binId === offer.rule.binId
		&& value.contentSha256 === offer.contentSha256;
}

function offerKey(value: FramescaperNativeWatchImportOffer): string {
	return JSON.stringify([value.rule.ruleId, value.entry.fileIdentity, value.contentSha256]);
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) throw new TypeError(`Invalid ${label}.`);
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
