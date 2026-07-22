import { FRAMESCAPER_PROFILE } from '../framescaper/product.js';
import { SOUNDSCAPER_PROFILE } from '../soundscaper/product.js';

export const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper']);

const PRODUCT_ID_SET = new Set(PRODUCT_IDS);

export const PRODUCT_PROFILES = deepFreeze({
	soundscaper: SOUNDSCAPER_PROFILE,
	framescaper: FRAMESCAPER_PROFILE,
});

export function normalizeProductId(value = 'soundscaper') {
	const productId = String(value || 'soundscaper').toLowerCase();
	if (!PRODUCT_ID_SET.has(productId)) throw new RangeError(`Unsupported editor product: ${productId}.`);
	return productId;
}

export function productProfile(value = 'soundscaper') {
	return PRODUCT_PROFILES[normalizeProductId(value)];
}

export function productLocalePath(product, locale, options = {}) {
	const profile = productProfile(product);
	const localeSegment = encodeURIComponent(String(locale || 'en'));
	const embedSegment = options.embedded ? '/embed' : '';
	return `${profile.basePath}${embedSegment}/${localeSegment}/` || '/';
}

export function otherProductId(product) {
	return normalizeProductId(product) === 'framescaper' ? 'soundscaper' : 'framescaper';
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
