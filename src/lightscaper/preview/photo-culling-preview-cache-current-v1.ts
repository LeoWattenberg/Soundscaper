/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import type { BinaryDerivativeCacheIdentityV1, BinaryDerivativeCachePortV1 } from '../../common/editor/storage/binary-derivative-cache-repository.ts';
import { readPixelFrameDescriptorV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1, type PhotoPreviewCacheStoreReceiptV1, type PhotoPreviewCacheTrimReceiptV1 } from './photo-preview-cache-v1.ts';
import { normalizePhotoCullingPreviewPlanCurrentV1, planPhotoCullingPreviewCurrentV1, type PhotoCullingPreviewPlanCurrentV1 } from './photo-culling-preview-plan-current-v1.ts';
import type { PreparedPhotoCullingPreviewCurrentV1 } from './photo-culling-preview-preparation-current-v1.ts';

export interface PhotoCullingPreviewCachePortCurrentV1 {
	load(plan: unknown, signal?: AbortSignal): Promise<Readonly<PreparedPhotoCullingPreviewCurrentV1> | null>;
	store(prepared: unknown, signal?: AbortSignal): Promise<PhotoPreviewCacheStoreReceiptV1>;
	trim(signal?: AbortSignal): Promise<PhotoPreviewCacheTrimReceiptV1>;
}
const FIELDS = ['schemaVersion', 'kind', 'key', 'binding', 'tier', 'recipe', 'descriptor', 'byteLength', 'outputSha256', 'body'];
const IDENTITY_FIELDS = ['schemaVersion', 'kind', 'key', 'sourceId', 'originalSha256', 'originalByteLength', 'recipeId', 'recipeVersion', 'byteLength', 'metadata'];

/** Shares the existing cache's physical capacity, pairing and trusted Original
 * token fence. Only the closed policy/plan and resulting key are different. */
export class PhotoCullingPreviewCacheCurrentV1 implements PhotoCullingPreviewCachePortCurrentV1 {
	readonly #core: BinaryDerivativeCachePortV1;
	constructor(core: BinaryDerivativeCachePortV1) {
		const input = record(core, 'Current culling cache ports', ['load', 'store', 'trim']);
		const load = field(input, 'load', 'Current culling cache ports'), store = field(input, 'store', 'Current culling cache ports'), trim = field(input, 'trim', 'Current culling cache ports');
		if (typeof load !== 'function' || typeof store !== 'function' || typeof trim !== 'function') throw new TypeError('Current culling cache requires complete shared methods.');
		this.#core = Object.freeze({ load: (...args: Parameters<BinaryDerivativeCachePortV1['load']>) => Reflect.apply(load, core, args) as ReturnType<BinaryDerivativeCachePortV1['load']>,
			store: (...args: Parameters<BinaryDerivativeCachePortV1['store']>) => Reflect.apply(store, core, args) as ReturnType<BinaryDerivativeCachePortV1['store']>,
			trim: (...args: Parameters<BinaryDerivativeCachePortV1['trim']>) => Reflect.apply(trim, core, args) as ReturnType<BinaryDerivativeCachePortV1['trim']> });
	}
	async load(value: unknown, signalValue?: AbortSignal): Promise<Readonly<PreparedPhotoCullingPreviewCurrentV1> | null> {
		const signal = captureRepairSignalV1(signalValue), plan = normalizePhotoCullingPreviewPlanCurrentV1(value), expected = identity(plan);
		const cached = await this.#core.load(expected, signal); checkRepairSignalV1(signal); if (cached === null) return null;
		const input = record(cached, 'Current cached culling preview', ['identity', 'body', 'outputSha256']);
		const actual = record(field(input, 'identity', 'Current cached culling preview'), 'Current cached culling identity', IDENTITY_FIELDS);
		for (const [key, expectedValue] of Object.entries(expected)) if (field(actual, key, 'Current cached culling identity') !== expectedValue) throw new RangeError('Current cached culling identity changed.');
		const body = canonicalMediaContentBlob(field(input, 'body', 'Current cached culling preview')), outputSha256 = digest(field(input, 'outputSha256', 'Current cached culling preview'));
		if (body.size !== plan.byteLength) throw new RangeError('Current cached culling body length changed.');
		return Object.freeze({ schemaVersion: 1, kind: 'photo-preview', key: plan.key, binding: plan.binding, tier: plan.tier,
			recipe: plan.recipe, descriptor: plan.output, byteLength: plan.byteLength, outputSha256, body });
	}
	async store(value: unknown, signalValue?: AbortSignal): Promise<PhotoPreviewCacheStoreReceiptV1> {
		const signal = captureRepairSignalV1(signalValue), input = record(value, 'Current prepared culling preview', FIELDS);
		const get = (key: string) => field(input, key, 'Current prepared culling preview');
		if (get('schemaVersion') !== 1 || get('kind') !== 'photo-preview') throw new RangeError('Unsupported Current prepared culling preview.');
		const plan = planPhotoCullingPreviewCurrentV1({ binding: get('binding'), tier: get('tier'), source: 'camera-embedded' });
		normalizePhotoCullingPreviewPlanCurrentV1({ ...plan, recipe: get('recipe'), key: get('key'), byteLength: get('byteLength'), output: readPixelFrameDescriptorV1(get('descriptor')) });
		const outputSha256 = digest(get('outputSha256')), body = canonicalMediaContentBlob(get('body'));
		if (body.size !== plan.byteLength) throw new RangeError('Current prepared culling body length changed.');
		const receipt = await this.#core.store(identity(plan), body, outputSha256, signal);
		// An acknowledged cache publication survives cancellation after the ACK.
		return Object.freeze({ ...receipt, ...(receipt.cleanupErrors ? { cleanupErrors: Object.freeze([...receipt.cleanupErrors]) } : {}) });
	}
	async trim(signalValue?: AbortSignal): Promise<PhotoPreviewCacheTrimReceiptV1> {
		const signal = captureRepairSignalV1(signalValue); return Object.freeze(await this.#core.trim(signal));
	}
}
function identity(plan: Readonly<PhotoCullingPreviewPlanCurrentV1>): BinaryDerivativeCacheIdentityV1 {
	return Object.freeze({ schemaVersion: 1, kind: PHOTO_PREVIEW_CACHE_PROFILE_V1.kind, key: plan.key, sourceId: plan.binding.storageKey,
		originalSha256: plan.binding.contentSha256, originalByteLength: plan.binding.byteLength, recipeId: plan.recipe.id,
		recipeVersion: plan.recipe.version, byteLength: plan.byteLength, metadata: JSON.stringify(plan) });
}
function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Current culling requires a lowercase output SHA-256.'); return value;
}
