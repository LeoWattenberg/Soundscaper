/* SPDX-License-Identifier: AGPL-3.0-only */

export const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper']);

const PRODUCT_ID_SET = new Set(PRODUCT_IDS);

export const PRODUCT_IDENTITIES = deepFreeze({
	soundscaper: {
		id: 'soundscaper',
		name: 'Soundscaper',
		basePath: '',
		defaultWorkspace: 'modern',
	},
	framescaper: {
		id: 'framescaper',
		name: 'Framescaper',
		basePath: '/framescaper',
		defaultWorkspace: 'video-editor',
	},
});

export function normalizeProductId(value = 'soundscaper') {
	const productId = String(value || 'soundscaper').toLowerCase();
	if (!PRODUCT_ID_SET.has(productId)) throw new RangeError(`Unsupported editor product: ${productId}.`);
	return productId;
}

export function productIdentity(value = 'soundscaper') {
	return PRODUCT_IDENTITIES[normalizeProductId(value)];
}

export function productLocalePath(product, locale, options = {}) {
	const identity = productIdentity(product);
	const localeSegment = encodeURIComponent(String(locale || 'en'));
	const embedSegment = options.embedded ? '/embed' : '';
	return `${identity.basePath}${embedSegment}/${localeSegment}/`;
}

export function otherProductId(product) {
	return normalizeProductId(product) === 'framescaper' ? 'soundscaper' : 'framescaper';
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
