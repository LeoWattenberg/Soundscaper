const ID_FALLBACK_RANDOM_LENGTH = 10;

export function createStableId(prefix = 'item') {
	const safePrefix = String(prefix || 'item').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'item';
	if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
		return `${safePrefix}-${globalThis.crypto.randomUUID()}`;
	}

	const random = Math.random().toString(36).slice(2, 2 + ID_FALLBACK_RANDOM_LENGTH);
	return `${safePrefix}-${Date.now().toString(36)}-${random}`;
}
