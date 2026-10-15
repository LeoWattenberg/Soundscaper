/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import type { PhotoPreviewCachePortV1 } from './photo-preview-cache-v1.ts';
import type { PhotoCullingPreviewCachePortCurrentV1 } from './photo-culling-preview-cache-current-v1.ts';
import type { PhotoHdrPreviewCachePortCurrentV1 } from './photo-hdr-preview-cache-current-v1.ts';
import type { PhotoPreviewCachePortCore } from './photo-preview-scheduler-core.ts';
import type { PreparedPhotoPreviewCurrentV1 } from './photo-preview-protocol-current-v1.ts';

type Cache = PhotoPreviewCachePortCore<PreparedPhotoPreviewCurrentV1>;
function capture(value: unknown): Readonly<Cache> {
	const input = record(value, 'Current preview cache capability', ['load', 'store', 'trim']);
	const load = field(input, 'load', 'Current preview cache capability'), store = field(input, 'store', 'Current preview cache capability'),
		trim = field(input, 'trim', 'Current preview cache capability');
	if (typeof load !== 'function' || typeof store !== 'function' || typeof trim !== 'function') throw new TypeError('Current previews require complete cache capabilities.');
	return Object.freeze({ load: (plan, signal) => Reflect.apply(load, value, [plan, signal]) as ReturnType<Cache['load']>,
		store: (prepared, signal) => Reflect.apply(store, value, [prepared, signal]) as ReturnType<Cache['store']>,
		trim: signal => Reflect.apply(trim, value, [signal]) as ReturnType<Cache['trim']> });
}

/** One serial scheduler owns these routes. A pressure retry trims the same
 * selected cache, sharing the existing profile's capacity and eviction bound. */
export function createPhotoPreviewCacheRouteCurrentV1(legacyValue: PhotoPreviewCachePortV1,
	cameraValue?: PhotoCullingPreviewCachePortCurrentV1, hdrValue?: PhotoHdrPreviewCachePortCurrentV1): Readonly<Cache> {
	const legacy = capture(legacyValue), camera = cameraValue === undefined ? undefined : capture(cameraValue);
	const hdr = hdrValue === undefined ? undefined : capture(hdrValue);
	let selected = legacy;
	const choose = (kind: 'legacy' | 'camera' | 'hdr') => {
		if (kind === 'camera' && !camera) throw new TypeError('Camera culling preview cache is unavailable.');
		if (kind === 'hdr' && !hdr) throw new TypeError('HDR preview cache is unavailable.');
		selected = kind === 'camera' ? camera! : kind === 'hdr' ? hdr! : legacy; return selected;
	};
	return Object.freeze({
		load(plan, signal) {
			const kind = data(plan, 'kind');
			if (kind !== 'photo-preview-plan' && kind !== 'photo-culling-preview-plan' && kind !== 'photo-hdr-preview-plan') throw new TypeError('Unknown Current preview plan kind.');
			return choose(kind === 'photo-culling-preview-plan' ? 'camera' : kind === 'photo-hdr-preview-plan' ? 'hdr' : 'legacy').load(plan, signal);
		},
		store(prepared, signal) {
			const id = data(data(prepared, 'recipe'), 'id');
			if (id !== 'lightscaper.original-preview.rgba8-nearest' && id !== 'lightscaper.raw-culling.camera-embedded.rgba8-contain-nearest'
				&& id !== 'lightscaper.hdr-original-preview.linear-f32-srgb.rgba8-nearest') {
				throw new TypeError('Unknown Current preview recipe.');
			}
			return choose(id === 'lightscaper.original-preview.rgba8-nearest' ? 'legacy' : id === 'lightscaper.hdr-original-preview.linear-f32-srgb.rgba8-nearest' ? 'hdr' : 'camera').store(prepared, signal);
		},
		trim(signal) { return selected.trim(signal); },
	});
}
function data(value: unknown, key: string): unknown {
	if (typeof value !== 'object' || value === null) throw new TypeError('Current preview route requires inert metadata.');
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Current preview route requires own-data metadata.');
	return descriptor.value;
}
