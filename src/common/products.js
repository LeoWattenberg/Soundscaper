import { FRAMESCAPER_PROFILE } from '../framescaper/product.js';
import { SOUNDSCAPER_PROFILE } from '../soundscaper/product.js';
import { normalizeProductId } from './product-identities.js';

export {
	PRODUCT_IDS,
	normalizeProductId,
	otherProductId,
	productLocalePath,
} from './product-identities.js';

export const PRODUCT_PROFILES = deepFreeze({
	soundscaper: SOUNDSCAPER_PROFILE,
	framescaper: FRAMESCAPER_PROFILE,
});

export function productProfile(value = 'soundscaper') {
	return PRODUCT_PROFILES[normalizeProductId(value)];
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
