/* SPDX-License-Identifier: AGPL-3.0-only */

/** Maintained clients confirm whole-file policies before retaining downloaded audio. */
export function freesoundDownloadMaximumBytes(request: Request, defaultBytes: number, invalidQuery: () => Error): number {
	const query = new URL(request.url).searchParams;
	if (query.size === 0) return defaultBytes;
	if (query.size !== 1 || query.get('sizeWarning') !== 'client') throw invalidQuery();
	return Number.MAX_SAFE_INTEGER;
}
