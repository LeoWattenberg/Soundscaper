/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { readPixelFrameDescriptorV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import type { BinaryDerivativeCacheIdentityV1, BinaryDerivativeCachePortV1 } from '../../common/editor/storage/binary-derivative-cache-repository.ts';
import { normalizePhotoPreviewOriginalBindingV1, normalizePhotoPreviewPlanV1, planPhotoPreviewV1,
	type PhotoPreviewPlanV1 } from './photo-preview-plan-v1.ts';
import type { PreparedPhotoPreviewV1 } from './photo-preview-preparation-v1.ts';

export const PHOTO_PREVIEW_CACHE_PROFILE_V1 = Object.freeze({ kind: 'photo-preview-cache', keyPrefix: 'photo-preview-sha256:',
	maximumBytes: 134_217_728, maximumEntries: 1_024, maximumManifestBytes: 4_096, maximumEvictions: 16 });

export type PhotoPreviewCacheStoreReceiptV1 = Awaited<ReturnType<BinaryDerivativeCachePortV1['store']>>;
export type PhotoPreviewCacheTrimReceiptV1 = Awaited<ReturnType<BinaryDerivativeCachePortV1['trim']>>;

export interface PhotoPreviewCachePortV1 {
	load(plan: unknown, signal?: AbortSignal): Promise<Readonly<PreparedPhotoPreviewV1> | null>;
	store(prepared: unknown, signal?: AbortSignal): Promise<PhotoPreviewCacheStoreReceiptV1>;
	trim(signal?: AbortSignal): Promise<PhotoPreviewCacheTrimReceiptV1>;
}

const PREPARED_FIELDS = ['schemaVersion', 'kind', 'key', 'binding', 'tier', 'recipe', 'descriptor', 'byteLength', 'outputSha256', 'body'];
const IDENTITY_FIELDS = ['schemaVersion', 'kind', 'key', 'sourceId', 'originalSha256', 'originalByteLength',
	'recipeId', 'recipeVersion', 'byteLength', 'metadata'];
const throwIfAborted = AbortSignal.prototype.throwIfAborted;

/** Photo identity adapter only; shared storage owns body verification and private source fencing. */
export class PhotoPreviewCacheV1 implements PhotoPreviewCachePortV1 {
	readonly #core: BinaryDerivativeCachePortV1;

	constructor(core: BinaryDerivativeCachePortV1) {
		const ports = record(core, 'photo preview cache storage port', ['load', 'store', 'trim']);
		for (const key of ['load', 'store', 'trim']) {
			if (typeof field(ports, key, 'photo preview cache storage port') !== 'function') throw new TypeError('Complete shared preview cache ports are required.');
		}
		this.#core = Object.freeze({ load: core.load.bind(core), store: core.store.bind(core), trim: core.trim.bind(core) });
	}

	async load(value: unknown, signal?: AbortSignal): Promise<Readonly<PreparedPhotoPreviewV1> | null> {
		checkSignal(signal);
		const plan = normalizePhotoPreviewPlanV1(value), expected = identity(plan);
		const cached = await this.#core.load(expected, signal);
		checkSignal(signal);
		if (cached === null) return null;
		const result = record(cached, 'cached photo preview', ['identity', 'body', 'outputSha256']);
		const candidate = record(field(result, 'identity', 'cached photo preview'), 'cached photo identity', IDENTITY_FIELDS);
		for (const [key, value] of Object.entries(expected)) {
			if (field(candidate, key, 'cached photo identity') !== value) throw new RangeError('Cached photo preview identity changed.');
		}
		const outputSha256 = digest(field(result, 'outputSha256', 'cached photo preview'));
		const body = canonicalMediaContentBlob(field(result, 'body', 'cached photo preview'));
		if (body.size !== plan.byteLength) throw new RangeError('Cached photo preview body length changed.');
		return prepared(plan, body, outputSha256);
	}

	async store(value: unknown, signal?: AbortSignal): Promise<PhotoPreviewCacheStoreReceiptV1> {
		checkSignal(signal);
		const input = record(value, 'prepared cached photo preview', PREPARED_FIELDS);
		const get = (key: string) => field(input, key, 'prepared cached photo preview');
		if (get('schemaVersion') !== 1 || get('kind') !== 'photo-preview') throw new RangeError('Unsupported prepared photo preview version or kind.');
		const binding = normalizePhotoPreviewOriginalBindingV1(get('binding'));
		const descriptor = readPixelFrameDescriptorV1(get('descriptor'));
		const plan = planPhotoPreviewV1({ binding, source: { ...descriptor, width: binding.width, height: binding.height }, tier: get('tier') });
		const recipe = record(get('recipe'), 'cached photo recipe', ['id', 'version']);
		if (field(recipe, 'id', 'cached photo recipe') !== plan.recipe.id || field(recipe, 'version', 'cached photo recipe') !== plan.recipe.version
			|| get('key') !== plan.key || get('byteLength') !== plan.byteLength || JSON.stringify(descriptor) !== JSON.stringify(plan.output)) {
			throw new RangeError('Prepared cached photo plan, recipe or descriptor changed.');
		}
		const outputSha256 = digest(get('outputSha256')), body = canonicalMediaContentBlob(get('body'));
		if (body.size !== plan.byteLength) throw new RangeError('Prepared cached photo body length changed.');
		const receipt = await this.#core.store(identity(plan), body, outputSha256, signal);
		// A successful commit remains acknowledged even if abort arrives afterward.
		return Object.freeze({ ...receipt, ...(receipt.cleanupErrors ? { cleanupErrors: Object.freeze([...receipt.cleanupErrors]) } : {}) });
	}

	async trim(signal?: AbortSignal): Promise<PhotoPreviewCacheTrimReceiptV1> {
		checkSignal(signal);
		return Object.freeze(await this.#core.trim(signal));
	}
}

function identity(plan: Readonly<PhotoPreviewPlanV1>): BinaryDerivativeCacheIdentityV1 {
	return Object.freeze({ schemaVersion: 1, kind: PHOTO_PREVIEW_CACHE_PROFILE_V1.kind, key: plan.key,
		sourceId: plan.binding.storageKey, originalSha256: plan.binding.contentSha256, originalByteLength: plan.binding.byteLength,
		recipeId: plan.recipe.id, recipeVersion: plan.recipe.version, byteLength: plan.byteLength, metadata: JSON.stringify(plan) });
}

function prepared(plan: Readonly<PhotoPreviewPlanV1>, body: Blob, outputSha256: string): Readonly<PreparedPhotoPreviewV1> {
	return Object.freeze({ schemaVersion: 1, kind: 'photo-preview', key: plan.key, binding: plan.binding, tier: plan.tier,
		recipe: plan.recipe, descriptor: plan.output, byteLength: plan.byteLength, outputSha256, body });
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Photo preview requires a lowercase output SHA-256.');
	return value;
}

function checkSignal(signal?: AbortSignal): void {
	if (signal !== undefined) {
		if (!(signal instanceof AbortSignal)) throw new TypeError('Photo preview cache requires a cancellation signal.');
		Reflect.apply(throwIfAborted, signal, []);
	}
}
