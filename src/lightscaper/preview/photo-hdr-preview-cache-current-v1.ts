/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import type { BinaryDerivativeCacheIdentityV1, BinaryDerivativeCachePortV1 } from '../../common/editor/storage/binary-derivative-cache-repository.ts';
import { readPixelFrameDescriptorV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1, type PhotoPreviewCacheStoreReceiptV1, type PhotoPreviewCacheTrimReceiptV1 } from './photo-preview-cache-v1.ts';
import { normalizePhotoHdrPreviewPlanCurrentV1, planPhotoHdrPreviewCurrentV1, type PhotoHdrPreviewPlanCurrentV1 } from './photo-hdr-preview-plan-current-v1.ts';
import type { PreparedPhotoHdrPreviewCurrentV1 } from './photo-hdr-preview-preparation-current-v1.ts';

export interface PhotoHdrPreviewCachePortCurrentV1 {
	load(plan: unknown, signal?: AbortSignal): Promise<Readonly<PreparedPhotoHdrPreviewCurrentV1> | null>;
	store(prepared: unknown, signal?: AbortSignal): Promise<PhotoPreviewCacheStoreReceiptV1>;
	trim(signal?: AbortSignal): Promise<PhotoPreviewCacheTrimReceiptV1>;
}
const FIELDS = ['schemaVersion', 'kind', 'key', 'binding', 'tier', 'recipe', 'descriptor', 'byteLength', 'outputSha256', 'body'];
const IDENTITY_FIELDS = ['schemaVersion', 'kind', 'key', 'sourceId', 'originalSha256', 'originalByteLength', 'recipeId', 'recipeVersion', 'byteLength', 'metadata'];

/** A distinct deterministic HDR recipe over the same selected native cache
 * capacity and immutable Original-content-token fence. No HDR body is cached. */
export class PhotoHdrPreviewCacheCurrentV1 implements PhotoHdrPreviewCachePortCurrentV1 {
	readonly #core: BinaryDerivativeCachePortV1;
	constructor(core: BinaryDerivativeCachePortV1) {
		const input = record(core, 'HDR preview cache ports', ['load', 'store', 'trim']);
		const load = field(input, 'load', 'HDR preview cache ports'), store = field(input, 'store', 'HDR preview cache ports'), trim = field(input, 'trim', 'HDR preview cache ports');
		if (typeof load !== 'function' || typeof store !== 'function' || typeof trim !== 'function') throw new TypeError('HDR previews require complete shared cache capabilities.');
		this.#core = Object.freeze({ load: (...args: Parameters<BinaryDerivativeCachePortV1['load']>) => Reflect.apply(load, core, args) as ReturnType<BinaryDerivativeCachePortV1['load']>,
			store: (...args: Parameters<BinaryDerivativeCachePortV1['store']>) => Reflect.apply(store, core, args) as ReturnType<BinaryDerivativeCachePortV1['store']>,
			trim: (...args: Parameters<BinaryDerivativeCachePortV1['trim']>) => Reflect.apply(trim, core, args) as ReturnType<BinaryDerivativeCachePortV1['trim']> });
	}
	async load(value: unknown, signalValue?: AbortSignal): Promise<Readonly<PreparedPhotoHdrPreviewCurrentV1> | null> {
		const signal = captureRepairSignalV1(signalValue), plan = normalizePhotoHdrPreviewPlanCurrentV1(value), expected = identity(plan);
		const cached = await this.#core.load(expected, signal); checkRepairSignalV1(signal); if (cached === null) return null;
		const input = record(cached, 'cached HDR preview', ['identity', 'body', 'outputSha256']);
		const actual = record(field(input, 'identity', 'cached HDR preview'), 'cached HDR identity', IDENTITY_FIELDS);
		for (const [key, expectedValue] of Object.entries(expected)) if (field(actual, key, 'cached HDR identity') !== expectedValue) throw new RangeError('Cached HDR preview identity changed.');
		const body = canonicalMediaContentBlob(field(input, 'body', 'cached HDR preview')), outputSha256 = digest(field(input, 'outputSha256', 'cached HDR preview'));
		if (body.size !== plan.byteLength) throw new RangeError('Cached HDR preview body length changed.');
		return Object.freeze({ schemaVersion: 1, kind: 'photo-preview', key: plan.key, binding: plan.binding, tier: plan.tier,
			recipe: plan.recipe, descriptor: plan.output, byteLength: plan.byteLength, outputSha256, body });
	}
	async store(value: unknown, signalValue?: AbortSignal): Promise<PhotoPreviewCacheStoreReceiptV1> {
		const signal = captureRepairSignalV1(signalValue), input = record(value, 'prepared HDR preview', FIELDS);
		const get = (key: string) => field(input, key, 'prepared HDR preview');
		if (get('schemaVersion') !== 1 || get('kind') !== 'photo-preview') throw new RangeError('Unsupported prepared HDR preview.');
		const plan = planPhotoHdrPreviewCurrentV1({ binding: get('binding'), tier: get('tier') });
		normalizePhotoHdrPreviewPlanCurrentV1({ ...plan, recipe: get('recipe'), key: get('key'), byteLength: get('byteLength'), output: readPixelFrameDescriptorV1(get('descriptor')) });
		const outputSha256 = digest(get('outputSha256')), body = canonicalMediaContentBlob(get('body'));
		if (body.size !== plan.byteLength) throw new RangeError('Prepared HDR preview body length changed.');
		const receipt = await this.#core.store(identity(plan), body, outputSha256, signal);
		// Preserve a real storage ACK even when cancellation follows its commit.
		return Object.freeze({ ...receipt, ...(receipt.cleanupErrors ? { cleanupErrors: Object.freeze([...receipt.cleanupErrors]) } : {}) });
	}
	async trim(signalValue?: AbortSignal): Promise<PhotoPreviewCacheTrimReceiptV1> {
		const signal = captureRepairSignalV1(signalValue); return Object.freeze(await this.#core.trim(signal));
	}
}
function identity(plan: Readonly<PhotoHdrPreviewPlanCurrentV1>): BinaryDerivativeCacheIdentityV1 {
	return Object.freeze({ schemaVersion: 1, kind: PHOTO_PREVIEW_CACHE_PROFILE_V1.kind, key: plan.key, sourceId: plan.binding.storageKey,
		originalSha256: plan.binding.contentSha256, originalByteLength: plan.binding.byteLength, recipeId: plan.recipe.id,
		recipeVersion: plan.recipe.version, byteLength: plan.byteLength, metadata: JSON.stringify(plan) });
}
function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('HDR preview requires a lowercase output SHA-256.'); return value;
}
