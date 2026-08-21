import { normalizeProductId } from '../products.js';

export const DOCUMENTATION_ORIGIN = 'https://docs.soundscaper.org';

export type DocumentationDestination = 'manual' | 'tutorials';

const DOCUMENTATION_DESTINATION_PATHS = Object.freeze({
	manual: '',
	tutorials: 'first-project/',
} satisfies Record<DocumentationDestination, string>);

export function documentationUrl(productId: string, destination: DocumentationDestination): string {
	const normalizedProductId = normalizeProductId(productId);
	if (!Object.hasOwn(DOCUMENTATION_DESTINATION_PATHS, destination)) {
		throw new RangeError(`Unsupported documentation destination: ${destination}.`);
	}

	return `${DOCUMENTATION_ORIGIN}/${normalizedProductId}/${DOCUMENTATION_DESTINATION_PATHS[destination]}`;
}
