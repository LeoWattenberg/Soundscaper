import { normalizeProductId } from './product-identities.js';
import { FRAMESCAPER_PROFILE, LIGHTSCAPER_PROFILE, SOUNDSCAPER_PROFILE } from './product-profiles.js';

export {
	PRODUCT_IDS,
	normalizeProductId,
	otherProductId,
	otherProductIds,
	productLocalePath,
} from './product-identities.js';

export const PRODUCT_PROFILES = deepFreeze({
	soundscaper: SOUNDSCAPER_PROFILE,
	framescaper: FRAMESCAPER_PROFILE,
	lightscaper: LIGHTSCAPER_PROFILE,
});

export function productProfile(value = 'soundscaper') {
	return PRODUCT_PROFILES[normalizeProductId(value)];
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
