/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	normalizeVideoProxyAttachmentV18,
} from '../common/editor/video-proxy-attachment-v18.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;

const JOURNAL_KEY = 'framescaper:selected-video-proxy-cleanup:v1';
const MAXIMUM_CLAIMS = 4_096;
const CLAIM_FIELDS = Object.freeze([
	'kind', 'version', 'id', 'projectId', 'sourceId', 'expectedProjectRevision', 'storageKeys',
]);

export interface FramescaperVideoProxyCleanupPortsV20 {
	loadJournal(): Awaitable<unknown>;
	saveJournal(journal: readonly unknown[]): Awaitable<void>;
	listCurrentProjects(): Awaitable<readonly unknown[]>;
	deleteBody(storageKey: string): Awaitable<void>;
}

export interface FramescaperVideoProxyCleanupClaimV20 {
	readonly kind: 'framescaper-selected-video-proxy-cleanup';
	readonly version: 1;
	readonly id: string;
	readonly projectId: string;
	readonly sourceId: string;
	readonly expectedProjectRevision: number;
	readonly storageKeys: readonly string[];
}

export interface FramescaperVideoProxyCleanupStoreV20 {
	loadAnalysis(key: string): Promise<unknown>;
	saveAnalysis(key: string, value: unknown): Promise<unknown>;
	deleteMediaAsset(storageKey: string): Promise<unknown>;
}

export interface FramescaperVideoProxyCleanupProjectStoreV20 {
	listProjects(): Promise<readonly unknown[]>;
}

/**
 * Crash-resumable reclamation for selected V20/V27 editorial proxy replacements.
 *
 * A durable intent always precedes pointer invalidation. Recovery cancels the
 * intent when the old pointer is still current, and otherwise deletes only
 * exact content-addressed bodies that no current project still roots.
 */
export class FramescaperVideoProxyCleanupCoordinatorV20 {
	readonly #ports: FramescaperVideoProxyCleanupPortsV20;
	#tail: Promise<void> = Promise.resolve();

	constructor(ports: FramescaperVideoProxyCleanupPortsV20) {
		for (const method of ['loadJournal', 'saveJournal', 'listCurrentProjects', 'deleteBody'] as const) {
			if (typeof ports?.[method] !== 'function') {
				throw new TypeError(`Selected video-proxy cleanup requires ${method}.`);
			}
		}
		this.#ports = ports;
	}

	prepareReplacement(
		projectValue: unknown,
		sourceIdValue: unknown,
	): Promise<Readonly<FramescaperVideoProxyCleanupClaimV20>> {
		return this.#serialize(async () => {
			const project = projectRecord(projectValue);
			const sourceId = identifier(sourceIdValue, 'proxy cleanup source ID');
			const source = videoSource(project, sourceId);
			if (source.proxyAttachment === null) {
				throw new RangeError(`Video source ${sourceId} has no proxy body to replace.`);
			}
			const attachment = normalizeVideoProxyAttachmentV18(source.proxyAttachment);
			const revision = revisionValue(project.revision);
			if (revision === Number.MAX_SAFE_INTEGER) {
				throw new RangeError('The proxy cleanup project revision cannot advance.');
			}
			const claim = createClaim(
				identifier(project.id, 'proxy cleanup project ID'),
				sourceId,
				revision + 1,
				[attachment.storageKey, attachment.timingAsset.storageKey],
			);
			const journal = await this.#journal();
			const existing = journal.find((candidate) => candidate.id === claim.id);
			if (existing) return existing;
			if (journal.length >= MAXIMUM_CLAIMS) {
				throw new RangeError('The selected video-proxy cleanup journal is full.');
			}
			await this.#ports.saveJournal(Object.freeze([...journal, claim]));
			return claim;
		});
	}

	cancel(claimValue: unknown): Promise<void> {
		return this.#serialize(async () => {
			const claim = normalizeClaim(claimValue);
			const journal = await this.#journal();
			await this.#ports.saveJournal(Object.freeze(
				journal.filter((candidate) => candidate.id !== claim.id),
			));
		});
	}

	settle(claimValue: unknown, currentProject?: unknown): Promise<void> {
		return this.#serialize(async () => {
			const expected = normalizeClaim(claimValue);
			const journal = await this.#journal();
			const claim = journal.find((candidate) => candidate.id === expected.id);
			if (!claim) return;
			await this.#drain(claim, currentProject);
		});
	}

	/** Resume every durable replacement intent after renderer or desktop restart. */
	recover(): Promise<void> {
		return this.#serialize(async () => {
			const journal = await this.#journal();
			for (const claim of journal) await this.#drain(claim);
		});
	}

	async #drain(
		initialClaim: Readonly<FramescaperVideoProxyCleanupClaimV20>,
		currentProject?: unknown,
	): Promise<void> {
		const projects = await currentProjects(this.#ports, currentProject);
		const owner = projects.find((candidate) => candidate.id === initialClaim.projectId);
		if (owner && (revisionValue(owner.revision) < initialClaim.expectedProjectRevision
			|| projectReferencesAny(owner, initialClaim.storageKeys))) {
			await this.#remove(initialClaim.id);
			return;
		}
		let claim = initialClaim;
		for (const storageKey of [...claim.storageKeys]) {
			if (!projects.some((project) => projectReferencesAny(project, [storageKey]))) {
				await this.#ports.deleteBody(storageKey);
			}
			const remaining = claim.storageKeys.filter((candidate) => candidate !== storageKey);
			const journal = await this.#journal();
			if (remaining.length === 0) {
				await this.#ports.saveJournal(Object.freeze(
					journal.filter((candidate) => candidate.id !== claim.id),
				));
				return;
			}
			const next = createClaim(
				claim.projectId,
				claim.sourceId,
				claim.expectedProjectRevision,
				remaining,
			);
			await this.#ports.saveJournal(Object.freeze(journal.map((candidate) => (
				candidate.id === claim.id ? next : candidate
			))));
			claim = next;
		}
	}

	async #remove(claimId: string): Promise<void> {
		const journal = await this.#journal();
		await this.#ports.saveJournal(Object.freeze(
			journal.filter((candidate) => candidate.id !== claimId),
		));
	}

	async #journal(): Promise<readonly Readonly<FramescaperVideoProxyCleanupClaimV20>[]> {
		return normalizeJournal(await this.#ports.loadJournal());
	}

	#serialize<Value>(operation: () => Promise<Value>): Promise<Value> {
		const result = this.#tail.then(operation, operation);
		this.#tail = result.then(() => undefined, () => undefined);
		return result;
	}
}

export function createFramescaperVideoProxyCleanupCoordinatorV20(
	bodyStore: FramescaperVideoProxyCleanupStoreV20,
	projectStore: FramescaperVideoProxyCleanupProjectStoreV20,
): FramescaperVideoProxyCleanupCoordinatorV20 {
	return new FramescaperVideoProxyCleanupCoordinatorV20({
		loadJournal: () => bodyStore.loadAnalysis(JOURNAL_KEY),
		saveJournal: (journal) => bodyStore.saveAnalysis(JOURNAL_KEY, journal).then(() => undefined),
		listCurrentProjects: () => projectStore.listProjects(),
		deleteBody: (storageKey) => bodyStore.deleteMediaAsset(storageKey).then(() => undefined),
	});
}

function createClaim(
	projectId: string,
	sourceId: string,
	expectedProjectRevision: number,
	storageKeysValue: readonly string[],
): Readonly<FramescaperVideoProxyCleanupClaimV20> {
	const storageKeys = Object.freeze([...new Set(storageKeysValue.map(storageKey))].sort());
	if (storageKeys.length < 1 || storageKeys.length > 2) {
		throw new TypeError('A proxy cleanup claim requires one or two exact body keys.');
	}
	const material = JSON.stringify([projectId, sourceId, expectedProjectRevision, storageKeys]);
	return Object.freeze({
		kind: 'framescaper-selected-video-proxy-cleanup',
		version: 1,
		id: bytesToHex(sha256(new TextEncoder().encode(material))),
		projectId,
		sourceId,
		expectedProjectRevision,
		storageKeys,
	});
}

function normalizeJournal(
	value: unknown,
): readonly Readonly<FramescaperVideoProxyCleanupClaimV20>[] {
	if (value === null || value === undefined) return Object.freeze([]);
	if (!Array.isArray(value) || value.length > MAXIMUM_CLAIMS) {
		throw new TypeError('The selected video-proxy cleanup journal is invalid or exceeds its bound.');
	}
	const ids = new Set<string>();
	try {
		return Object.freeze(value.map((candidate) => {
			const claim = normalizeClaim(candidate);
			if (ids.has(claim.id)) {
				throw new TypeError('The selected video-proxy cleanup journal has a duplicate claim.');
			}
			ids.add(claim.id);
			return claim;
		}));
	} catch (error) {
		throw new TypeError('The selected video-proxy cleanup journal is invalid.', { cause: error });
	}
}

function normalizeClaim(value: unknown): Readonly<FramescaperVideoProxyCleanupClaimV20> {
	const raw = exactRecord(value, CLAIM_FIELDS, 'selected video-proxy cleanup claim');
	if (raw.kind !== 'framescaper-selected-video-proxy-cleanup' || raw.version !== 1
		|| typeof raw.id !== 'string' || !/^[a-f0-9]{64}$/u.test(raw.id)
		|| !Array.isArray(raw.storageKeys)) {
		throw new TypeError('The selected video-proxy cleanup journal contains an invalid claim.');
	}
	const claim = createClaim(
		identifier(raw.projectId, 'proxy cleanup project ID'),
		identifier(raw.sourceId, 'proxy cleanup source ID'),
		positiveRevision(raw.expectedProjectRevision),
		raw.storageKeys as string[],
	);
	if (claim.id !== raw.id) {
		throw new TypeError('The selected video-proxy cleanup journal contains a forged claim.');
	}
	return claim;
}

async function currentProjects(
	ports: FramescaperVideoProxyCleanupPortsV20,
	currentProject: unknown,
): Promise<readonly Readonly<Record<string, unknown>>[]> {
	const values = await ports.listCurrentProjects();
	if (!Array.isArray(values) || values.length > 100_000) {
		throw new TypeError('The selected proxy cleanup project inventory is invalid.');
	}
	const projects = values.map(projectRecord);
	if (currentProject !== undefined) {
		const current = projectRecord(currentProject);
		const index = projects.findIndex((candidate) => candidate.id === current.id);
		if (index < 0) projects.push(current);
		else projects[index] = current;
	}
	return Object.freeze(projects);
}

function projectReferencesAny(
	project: Readonly<Record<string, unknown>>,
	storageKeys: readonly string[],
): boolean {
	if (!Array.isArray(project.sources)) {
		throw new TypeError('A proxy cleanup project has an invalid source inventory.');
	}
	const wanted = new Set(storageKeys);
	return project.sources.some((candidate) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError('A proxy cleanup project has an invalid source record.');
		}
		const source = candidate as Readonly<Record<string, unknown>>;
		if (source.kind !== 'video' || source.proxyAttachment === null
			|| source.proxyAttachment === undefined) return false;
		const attachment = normalizeVideoProxyAttachmentV18(source.proxyAttachment);
		return wanted.has(attachment.storageKey) || wanted.has(attachment.timingAsset.storageKey);
	});
}

function videoSource(
	project: Readonly<Record<string, unknown>>,
	sourceId: string,
): Readonly<Record<string, unknown>> & { readonly proxyAttachment: unknown | null } {
	if (!Array.isArray(project.sources)) throw new TypeError('The proxy cleanup source list is invalid.');
	const source = project.sources.find((candidate) => candidate && typeof candidate === 'object'
		&& !Array.isArray(candidate) && (candidate as Readonly<Record<string, unknown>>).id === sourceId);
	if (!source || (source as Readonly<Record<string, unknown>>).kind !== 'video'
		|| !Object.hasOwn(source, 'proxyAttachment')) {
		throw new ReferenceError(`Video source ${sourceId} is unavailable for proxy cleanup.`);
	}
	return source as Readonly<Record<string, unknown>> & { readonly proxyAttachment: unknown | null };
}

function projectRecord(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A selected proxy cleanup project is required.');
	}
	identifier((value as Readonly<Record<string, unknown>>).id, 'proxy cleanup project ID');
	revisionValue((value as Readonly<Record<string, unknown>>).revision);
	return value as Readonly<Record<string, unknown>>;
}

function exactRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	const keys = Object.keys(value);
	if (keys.length !== fields.length || [...fields].sort().some((field, index) => (
		keys.sort()[index] !== field
	))) throw new TypeError(`The ${label} is invalid.`);
	return value as Readonly<Record<string, unknown>>;
}

function identifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value)) {
		throw new TypeError(`A valid ${label} is required.`);
	}
	return value;
}

function revisionValue(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new TypeError('A non-negative proxy cleanup project revision is required.');
	}
	return Number(value);
}

function positiveRevision(value: unknown): number {
	const result = revisionValue(value);
	if (result < 1) throw new TypeError('A positive proxy cleanup expected revision is required.');
	return result;
}

function storageKey(value: unknown): string {
	if (typeof value !== 'string'
		|| !/^(?:video-proxy|video-timing)-sha256:[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError('An exact content-addressed proxy cleanup body key is required.');
	}
	return value;
}
