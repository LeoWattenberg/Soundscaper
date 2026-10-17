/* SPDX-License-Identifier: AGPL-3.0-only */

export const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper', 'motionscaper']);

const PRODUCT_ID_SET = new Set(PRODUCT_IDS);

const PRODUCT_WORKSPACES = { soundscaper: 'modern', framescaper: 'video-editor', motionscaper: 'motion' };

export const PRODUCT_IDENTITIES = Object.freeze(Object.fromEntries(PRODUCT_IDS.map((id) => [id, Object.freeze({
	id,
	name: id[0].toUpperCase() + id.slice(1),
	basePath: id === 'soundscaper' ? '' : `/${id}`,
	defaultWorkspace: PRODUCT_WORKSPACES[id],
})])));

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

export function otherProductIds(product) {
	const selected = normalizeProductId(product);
	return Object.freeze(PRODUCT_IDS.filter((id) => id !== selected));
}

/** Legacy two-product handoff; new callers choose an explicit destination. */
export function otherProductId(product, destination) {
	const selected = normalizeProductId(product);
	if (destination !== undefined) {
		const target = normalizeProductId(destination);
		if (target === selected) throw new RangeError('Destination must differ.');
		return target;
	}
	if (selected === 'motionscaper') throw new RangeError('Motionscaper needs an explicit destination.');
	return selected === 'framescaper' ? 'soundscaper' : 'framescaper';
}

