/* SPDX-License-Identifier: AGPL-3.0-only */

export const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper', 'lightscaper']);

const PRODUCT_ID_SET = new Set(PRODUCT_IDS);

// Register conversion edges independently of navigation and product identity.
// Lightscaper's editable still conversion is introduced with its L5 consumer.
const EDITABLE_COPY_DESTINATIONS = deepFreeze({
	soundscaper: ['framescaper'],
	framescaper: ['soundscaper'],
	lightscaper: [],
});

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
	lightscaper: {
		id: 'lightscaper',
		name: 'Lightscaper',
		basePath: '/lightscaper',
		defaultWorkspace: 'photo-library',
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
	const productId = normalizeProductId(product);
	const destinations = EDITABLE_COPY_DESTINATIONS[productId];
	if (destinations.length === 1) return destinations[0];
	if (destinations.length > 1) throw new RangeError(`Choose an explicit editable-copy destination for product: ${productId}.`);
	throw new RangeError(`No editable-copy destination is registered for product: ${productId}.`);
}

export function otherProductIds(product) {
	const productId = normalizeProductId(product);
	return Object.freeze(PRODUCT_IDS.filter((candidate) => candidate !== productId));
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
