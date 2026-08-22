/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * V25 composition over the existing V18 proxy attachment relationship.
 *
 * The controller adds the native queue recipe and the missing product actions,
 * but the persisted pointer remains `source.proxyAttachment`. No native-only
 * proxy relationship, export authority, or timing model is introduced.
 */

import {
	assertNativeMediaExportSourceIsOriginal,
	planNativeMediaProxy,
	type NativeMediaProxyRecipeV1,
} from '../common/editor/native-media-proxy-recipe.ts';
import {
	normalizeVideoProxyAttachmentV18,
	type VideoProxyAttachmentV18,
} from '../common/editor/video-proxy-attachment-v18.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type {
	VideoSourceCharacteristicsV25,
} from '../common/editor/video-source-professional-characteristics-v25.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;

export interface FramescaperVideoSourceV25 extends Readonly<Record<string, unknown>> {
	readonly kind: 'video';
	readonly id: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly contentSha256: string;
	readonly width: number;
	readonly height: number;
	readonly characteristics: VideoSourceCharacteristicsV25;
	readonly proxyAttachment: Readonly<VideoProxyAttachmentV18> | null;
}

export interface FramescaperProxyProjectV25 extends Readonly<Record<string, unknown>> {
	/** V26 is cumulative and retains the exact V25 professional-media model. */
	readonly schemaVersion: 25 | 26;
	readonly id: string;
	readonly revision: number;
	readonly sources: readonly FramescaperVideoSourceV25[];
}

export interface FramescaperProxyQueueJobV25 extends Readonly<Record<string, unknown>> {
	readonly kind: 'media-proxy';
	readonly version: 1;
	readonly projectId: string;
	readonly sourceId: string;
	readonly originalStorageKey: string;
	readonly originalSha256: string;
	readonly recipe: NativeMediaProxyRecipeV1;
}

export interface FramescaperVideoProxyLifecyclePortsV25 {
	getProject(): FramescaperProxyProjectV25;
	commitProject(project: FramescaperProxyProjectV25): Awaitable<void>;
	enqueueProxy(job: FramescaperProxyQueueJobV25): Awaitable<string>;
	reattestAttachment(
		source: FramescaperVideoSourceV25,
		attachment: Readonly<VideoProxyAttachmentV18>,
	): Awaitable<boolean>;
	cleanupBody(storageKey: string): Awaitable<void>;
	loadCleanupJournal(projectId: string): Awaitable<unknown>;
	saveCleanupJournal(projectId: string, journal: readonly unknown[]): Awaitable<void>;
}

export interface FramescaperVideoProxyCleanupClaimV25 {
	readonly kind: 'framescaper-video-proxy-cleanup';
	readonly version: 1;
	readonly id: string;
	readonly projectId: string;
	readonly sourceId: string;
	readonly expectedProjectRevision: number;
	readonly storageKeys: readonly string[];
}

export type FramescaperVideoProxyGenerationV25 = Readonly<
	| { readonly status: 'queued'; readonly jobId: string }
	| { readonly status: 'blocked-policy'; readonly blockedPolicyRowIds: readonly string[] }
>;

export type FramescaperVideoProxyOfflineStatusV25 = Readonly<{
	readonly status: 'online' | 'original-offline' | 'proxy-offline' | 'no-proxy';
	readonly exportAvailable: boolean;
	readonly previewAvailable: boolean;
}>;

declare const proxyAttestationIdentity: unique symbol;
export type FramescaperVideoProxyAttestationV25 = Readonly<{
	readonly [proxyAttestationIdentity]: true;
}>;

interface AttestationMaterial {
	readonly sourceId: string;
	readonly originalSha256: string;
	readonly proxySha256: string;
}

const ATTESTATIONS = new WeakMap<FramescaperVideoProxyAttestationV25, AttestationMaterial>();

export interface FramescaperVideoMediaSelectionRequestV25 {
	readonly purpose: 'preview' | 'export' | 'delivery';
	readonly source: FramescaperVideoSourceV25;
	readonly attestation: FramescaperVideoProxyAttestationV25 | null;
	readonly proxyBodyAvailable: boolean;
	readonly originalBodyAvailable: boolean;
	readonly previewWidth: number;
}

export type FramescaperVideoMediaSelectionV25 = Readonly<
	| { readonly kind: 'proxy'; readonly storageKey: string; readonly mimeType: string }
	| { readonly kind: 'original'; readonly storageKey: string; readonly mimeType: string }
	| { readonly kind: 'unavailable' }
>;

export class FramescaperVideoProxyLifecycleV25 {
	readonly #ports: FramescaperVideoProxyLifecyclePortsV25;
	#operationTail: Promise<void> = Promise.resolve();

	constructor(ports: FramescaperVideoProxyLifecyclePortsV25) {
		for (const method of [
			'getProject', 'commitProject', 'enqueueProxy', 'reattestAttachment', 'cleanupBody',
			'loadCleanupJournal', 'saveCleanupJournal',
		] as const) {
			if (typeof ports?.[method] !== 'function') {
				throw new TypeError(`V25 video proxy lifecycle requires ${method}.`);
			}
		}
		this.#ports = ports;
	}

	async generate(request: Readonly<{
		sourceId: string;
		clearedPolicyRowIds: readonly string[];
	}>): Promise<FramescaperVideoProxyGenerationV25> {
		const project = this.#project();
		const source = sourceById(project, request.sourceId);
		const plan = planNativeMediaProxy({
			sourceWidth: source.width,
			sourceHeight: source.height,
			sourceCharacteristics: source.characteristics,
			clearedPolicyRowIds: request.clearedPolicyRowIds,
		});
		if (plan.blocked) {
			return Object.freeze({
				status: 'blocked-policy',
				blockedPolicyRowIds: Object.freeze([...plan.blockedPolicyRowIds]),
			});
		}
		const jobId = await this.#ports.enqueueProxy(Object.freeze({
			kind: 'media-proxy',
			version: 1,
			projectId: project.id,
			sourceId: source.id,
			originalStorageKey: source.storageKey,
			originalSha256: source.contentSha256,
			recipe: plan.recipe,
		}));
		return Object.freeze({ status: 'queued', jobId: nonEmpty(jobId, 'queue job ID') });
	}

	async attach(request: Readonly<{
		sourceId: string;
		attachment: unknown;
	}>): Promise<void> {
		await this.#serialize(() => this.#replaceAttachment(request.sourceId, request.attachment, false));
	}

	async relink(request: Readonly<{
		sourceId: string;
		attachment: unknown;
	}>): Promise<void> {
		await this.#serialize(() => this.#replaceAttachment(request.sourceId, request.attachment, true));
	}

	async detach(request: Readonly<{ readonly sourceId: string }>): Promise<void> {
		await this.#serialize(() => this.#detach(request.sourceId));
	}

	/** Resume idempotent body reclamation after a renderer or desktop restart. */
	async recoverCleanup(): Promise<void> {
		await this.#serialize(async () => {
			const claims = await this.#loadCleanupJournal();
			for (const claim of claims) await this.#drainCleanupClaim(claim.id);
		});
	}

	async #detach(sourceId: string): Promise<void> {
		const project = this.#project();
		const source = sourceById(project, sourceId);
		if (source.proxyAttachment === null) return;
		const prior = normalizeVideoProxyAttachmentV18(source.proxyAttachment);
		const next = mutateAttachment(project, source.id, null);
		await this.#commitWithCleanup(project, source.id, next, cleanupKeys(prior, next));
	}

	async reattest(request: Readonly<{
		readonly sourceId: string;
	}>): Promise<FramescaperVideoProxyAttestationV25 | null> {
		const project = this.#project();
		const before = sourceById(project, request.sourceId);
		if (before.proxyAttachment === null) return null;
		const attachment = normalizeVideoProxyAttachmentV18(before.proxyAttachment);
		if (!await this.#ports.reattestAttachment(before, attachment)) return null;
		const current = sourceById(this.#project(), request.sourceId);
		if (current.contentSha256 !== before.contentSha256
			|| current.proxyAttachment?.sha256 !== attachment.sha256) return null;
		const token = Object.freeze(Object.create(null)) as FramescaperVideoProxyAttestationV25;
		ATTESTATIONS.set(token, Object.freeze({
			sourceId: before.id,
			originalSha256: before.contentSha256,
			proxySha256: attachment.sha256,
		}));
		return token;
	}

	offlineStatus(request: Readonly<{
		readonly sourceId: string;
		readonly originalBodyAvailable: boolean;
		readonly proxyBodyAvailable: boolean;
		readonly attestation: FramescaperVideoProxyAttestationV25 | null;
	}>): FramescaperVideoProxyOfflineStatusV25 {
		const source = sourceById(this.#project(), request.sourceId);
		if (!request.originalBodyAvailable) {
			return Object.freeze({
				status: 'original-offline',
				exportAvailable: false,
				previewAvailable: request.proxyBodyAvailable
					&& validProxyAttestation(source, request.attestation),
			});
		}
		if (source.proxyAttachment === null) {
			return Object.freeze({ status: 'no-proxy', exportAvailable: true, previewAvailable: true });
		}
		if (!request.proxyBodyAvailable) {
			return Object.freeze({ status: 'proxy-offline', exportAvailable: true, previewAvailable: true });
		}
		return Object.freeze({ status: 'online', exportAvailable: true, previewAvailable: true });
	}

	async #replaceAttachment(sourceId: string, value: unknown, replace: boolean): Promise<void> {
		const project = this.#project();
		const source = sourceById(project, sourceId);
		const attachment = normalizeVideoProxyAttachmentV18(value);
		if (!replace && source.proxyAttachment !== null) {
			throw new RangeError('The source already has a proxy attachment; use relink or detach.');
		}
		if (attachment.originalSha256 !== source.contentSha256) {
			throw new RangeError('The proxy attachment does not bind the current original.');
		}
		if (attachment.recipeId !== 'framescaper-native-prores-proxy-mov-v1'
			|| attachment.recipeVersion !== 1 || attachment.mimeType !== 'video/quicktime') {
			throw new RangeError('V25 admits only its ProRes Proxy/MOV relationship recipe.');
		}
		const prior = source.proxyAttachment === null
			? null
			: normalizeVideoProxyAttachmentV18(source.proxyAttachment);
		const next = mutateAttachment(project, source.id, attachment);
		const keys = prior === null ? [] : cleanupKeys(prior, next);
		await this.#commitWithCleanup(project, source.id, next, keys);
	}

	async #commitWithCleanup(
		project: FramescaperProxyProjectV25,
		sourceId: string,
		next: FramescaperProxyProjectV25,
		storageKeys: readonly string[],
	): Promise<void> {
		if (storageKeys.length === 0) {
			await this.#ports.commitProject(next);
			return;
		}
		const claim = createCleanupClaim(project, sourceId, next.revision, storageKeys);
		await this.#appendCleanupClaim(claim);
		try {
			await this.#ports.commitProject(next);
		} catch (commitError) {
			try {
				await this.#removeCleanupClaim(claim.id);
			} catch (cancelError) {
				throw new AggregateError(
					[commitError, cancelError],
					'The proxy relationship commit failed and its cleanup claim could not be cancelled.',
				);
			}
			throw commitError;
		}
		await this.#drainCleanupClaim(claim.id);
	}

	async #appendCleanupClaim(claim: FramescaperVideoProxyCleanupClaimV25): Promise<void> {
		const journal = await this.#loadCleanupJournal();
		if (journal.some((candidate) => candidate.id === claim.id)) {
			throw new RangeError(`Proxy cleanup claim ${claim.id} already exists.`);
		}
		if (journal.length >= MAXIMUM_CLEANUP_CLAIMS) {
			throw new RangeError('The V25 proxy cleanup journal is full.');
		}
		await this.#saveCleanupJournal([...journal, claim]);
	}

	async #removeCleanupClaim(claimId: string): Promise<void> {
		const journal = await this.#loadCleanupJournal();
		await this.#saveCleanupJournal(journal.filter((claim) => claim.id !== claimId));
	}

	async #drainCleanupClaim(claimId: string): Promise<void> {
		let journal = await this.#loadCleanupJournal();
		let claim = journal.find((candidate) => candidate.id === claimId);
		if (!claim) return;
		const project = this.#project();
		if (project.revision < claim.expectedProjectRevision) {
			await this.#saveCleanupJournal(journal.filter((candidate) => candidate.id !== claimId));
			return;
		}
		for (const storageKey of claim.storageKeys) {
			if (!projectReferencesStorageKey(this.#project(), storageKey)) {
				await this.#ports.cleanupBody(storageKey);
			}
			journal = await this.#loadCleanupJournal();
			claim = journal.find((candidate) => candidate.id === claimId);
			if (!claim) return;
			const remaining = claim.storageKeys.filter((candidate) => candidate !== storageKey);
			if (remaining.length === 0) {
				await this.#saveCleanupJournal(journal.filter((candidate) => candidate.id !== claimId));
				continue;
			}
			const pending = createCleanupClaim(
				{ id: claim.projectId } as FramescaperProxyProjectV25,
				claim.sourceId,
				claim.expectedProjectRevision,
				remaining,
			);
			await this.#saveCleanupJournal(journal.map((candidate) => (
				candidate.id === claimId ? pending : candidate
			)));
			claimId = pending.id;
		}
	}

	async #loadCleanupJournal(): Promise<readonly FramescaperVideoProxyCleanupClaimV25[]> {
		const project = this.#project();
		return normalizeCleanupJournal(await this.#ports.loadCleanupJournal(project.id), project.id);
	}

	async #saveCleanupJournal(journal: readonly FramescaperVideoProxyCleanupClaimV25[]): Promise<void> {
		const projectId = this.#project().id;
		await this.#ports.saveCleanupJournal(projectId, Object.freeze([...journal]));
	}

	#serialize<Value>(operation: () => Promise<Value>): Promise<Value> {
		const result = this.#operationTail.then(operation, operation);
		this.#operationTail = result.then(() => undefined, () => undefined);
		return result;
	}

	#project(): FramescaperProxyProjectV25 {
		const project = this.#ports.getProject();
		if ((project?.schemaVersion !== 25 && project?.schemaVersion !== 26) || !Array.isArray(project.sources)
			|| !Number.isSafeInteger(project.revision) || project.revision < 0) {
			throw new TypeError('The professional proxy lifecycle requires an exact V25 or V26 project.');
		}
		return project;
	}
}

const MAXIMUM_CLEANUP_CLAIMS = 4_096;
const CLEANUP_CLAIM_KEYS = Object.freeze([
	'kind', 'version', 'id', 'projectId', 'sourceId', 'expectedProjectRevision', 'storageKeys',
]);

function createCleanupClaim(
	project: FramescaperProxyProjectV25,
	sourceId: string,
	expectedProjectRevision: number,
	storageKeys: readonly string[],
): FramescaperVideoProxyCleanupClaimV25 {
	const material = [project.id, sourceId, expectedProjectRevision, storageKeys];
	return Object.freeze({
		kind: 'framescaper-video-proxy-cleanup',
		version: 1,
		id: bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(material)))),
		projectId: project.id,
		sourceId,
		expectedProjectRevision,
		storageKeys: Object.freeze([...storageKeys]),
	});
}

function normalizeCleanupJournal(
	value: unknown,
	projectId: string,
): readonly FramescaperVideoProxyCleanupClaimV25[] {
	if (!Array.isArray(value) || value.length > MAXIMUM_CLEANUP_CLAIMS) {
		throw new TypeError('The V25 proxy cleanup journal is invalid or exceeds its bound.');
	}
	const ids = new Set<string>();
	return Object.freeze(value.map((candidate) => {
		if (!isRecord(candidate) || !hasExactKeys(candidate, CLEANUP_CLAIM_KEYS)
			|| candidate.kind !== 'framescaper-video-proxy-cleanup' || candidate.version !== 1
			|| candidate.projectId !== projectId || typeof candidate.id !== 'string'
			|| !/^[a-f0-9]{64}$/u.test(candidate.id) || typeof candidate.sourceId !== 'string'
			|| !candidate.sourceId || !Number.isSafeInteger(candidate.expectedProjectRevision)
			|| (candidate.expectedProjectRevision as number) < 1 || !Array.isArray(candidate.storageKeys)
			|| candidate.storageKeys.length < 1 || candidate.storageKeys.length > 2
			|| candidate.storageKeys.some((key) => typeof key !== 'string' || !key)
			|| new Set(candidate.storageKeys).size !== candidate.storageKeys.length) {
			throw new TypeError('The V25 proxy cleanup journal contains an invalid claim.');
		}
		const normalized = createCleanupClaim(
			{ id: projectId } as FramescaperProxyProjectV25,
			candidate.sourceId,
			candidate.expectedProjectRevision as number,
			candidate.storageKeys as string[],
		);
		if (normalized.id !== candidate.id || ids.has(candidate.id)) {
			throw new TypeError('The V25 proxy cleanup journal contains a forged or duplicate claim.');
		}
		ids.add(candidate.id);
		return normalized;
	}));
}

function cleanupKeys(
	attachment: Readonly<VideoProxyAttachmentV18>,
	next: FramescaperProxyProjectV25,
): readonly string[] {
	return Object.freeze([
		attachment.storageKey,
		attachment.timingAsset.storageKey,
	].filter((storageKey, index, all) => all.indexOf(storageKey) === index
		&& !projectReferencesStorageKey(next, storageKey)));
}

function projectReferencesStorageKey(project: FramescaperProxyProjectV25, storageKey: string): boolean {
	return project.sources.some((source) => {
		if (source.proxyAttachment === null || source.proxyAttachment === undefined) return false;
		const attachment = normalizeVideoProxyAttachmentV18(source.proxyAttachment);
		return attachment.storageKey === storageKey || attachment.timingAsset.storageKey === storageKey;
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	return actual.length === keys.length && [...keys].sort().every((key, index) => actual[index] === key);
}

/** Adaptive preview consumes the proxy; delivery and export never do. */
export function selectFramescaperVideoMediaV25(
	request: FramescaperVideoMediaSelectionRequestV25,
): FramescaperVideoMediaSelectionV25 {
	const source = request.source;
	if (request.purpose !== 'preview') {
		assertNativeMediaExportSourceIsOriginal('original');
		return request.originalBodyAvailable
			? originalSelection(source)
			: Object.freeze({ kind: 'unavailable' });
	}
	const attachment = source.proxyAttachment;
	const wantsProxy = request.previewWidth < source.width || source.width > 1_280 || source.height > 720;
	if (attachment && request.proxyBodyAvailable && wantsProxy
		&& validProxyAttestation(source, request.attestation)) {
		return Object.freeze({
			kind: 'proxy', storageKey: attachment.storageKey, mimeType: attachment.mimeType,
		});
	}
	return request.originalBodyAvailable
		? originalSelection(source)
		: Object.freeze({ kind: 'unavailable' });
}

function validProxyAttestation(
	source: FramescaperVideoSourceV25,
	attestation: FramescaperVideoProxyAttestationV25 | null,
): boolean {
	const attachment = source.proxyAttachment;
	const material = attestation === null ? undefined : ATTESTATIONS.get(attestation);
	return attachment !== null && material !== undefined
		&& material.sourceId === source.id
		&& material.originalSha256 === source.contentSha256
		&& material.proxySha256 === attachment.sha256;
}

function sourceById(project: FramescaperProxyProjectV25, sourceIdValue: unknown): FramescaperVideoSourceV25 {
	const sourceId = nonEmpty(sourceIdValue, 'source ID');
	const source = project.sources.find((candidate) => candidate.id === sourceId);
	if (!source) throw new ReferenceError(`Video source ${sourceId} is unavailable.`);
	if (source.kind !== 'video' || typeof source.contentSha256 !== 'string') {
		throw new TypeError(`Source ${sourceId} is not a V25 video source.`);
	}
	return source;
}

function mutateAttachment(
	project: FramescaperProxyProjectV25,
	sourceId: string,
	attachment: Readonly<VideoProxyAttachmentV18> | null,
): FramescaperProxyProjectV25 {
	if (project.revision === Number.MAX_SAFE_INTEGER) throw new RangeError('The V25 project revision cannot advance.');
	const next = structuredClone(project) as unknown as {
		schemaVersion: 25 | 26;
		id: string;
		revision: number;
		sources: Array<Record<string, unknown>>;
	};
	const source = next.sources.find((candidate) => candidate.id === sourceId);
	if (!source) throw new ReferenceError(`Video source ${sourceId} changed before commit.`);
	source.proxyAttachment = attachment;
	next.revision += 1;
	return next as unknown as FramescaperProxyProjectV25;
}

function originalSelection(source: FramescaperVideoSourceV25): FramescaperVideoMediaSelectionV25 {
	return Object.freeze({ kind: 'original', storageKey: source.storageKey, mimeType: source.mimeType });
}

function nonEmpty(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`V25 video proxy ${name} is required.`);
	return value;
}
