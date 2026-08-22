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

	constructor(ports: FramescaperVideoProxyLifecyclePortsV25) {
		for (const method of [
			'getProject', 'commitProject', 'enqueueProxy', 'reattestAttachment', 'cleanupBody',
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
		await this.#replaceAttachment(request.sourceId, request.attachment, false);
	}

	async relink(request: Readonly<{
		sourceId: string;
		attachment: unknown;
	}>): Promise<void> {
		await this.#replaceAttachment(request.sourceId, request.attachment, true);
	}

	async detach(request: Readonly<{ readonly sourceId: string }>): Promise<void> {
		const project = this.#project();
		const source = sourceById(project, request.sourceId);
		if (source.proxyAttachment === null) return;
		const prior = normalizeVideoProxyAttachmentV18(source.proxyAttachment);
		const next = mutateAttachment(project, source.id, null);
		await this.#ports.commitProject(next);
		await this.#cleanup(prior);
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
		await this.#ports.commitProject(mutateAttachment(project, source.id, attachment));
		if (prior && (prior.sha256 !== attachment.sha256
			|| prior.timingAsset.sha256 !== attachment.timingAsset.sha256)) await this.#cleanup(prior);
	}

	async #cleanup(attachment: Readonly<VideoProxyAttachmentV18>): Promise<void> {
		await this.#ports.cleanupBody(attachment.storageKey);
		await this.#ports.cleanupBody(attachment.timingAsset.storageKey);
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
