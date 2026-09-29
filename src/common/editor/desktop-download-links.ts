/* SPDX-License-Identifier: AGPL-3.0-only */

export type DesktopDownloadProductId = 'soundscaper' | 'framescaper';

const DOWNLOAD_ORIGINS: Readonly<Record<DesktopDownloadProductId, string>> = Object.freeze({
	soundscaper: 'https://soundscaper.org',
	framescaper: 'https://framescaper.org',
});

const GITHUB_RELEASES = 'https://github.com/LeoWattenberg/Soundscaper/releases';

function downloadProductId(value: string): DesktopDownloadProductId {
	const productId = value.toLowerCase();
	if (productId === 'soundscaper' || productId === 'framescaper') return productId;
	throw new RangeError(`Unsupported editor product: ${productId}.`);
}

/** A stable product-owned URL; Pages resolves the newest published desktop release on visit. */
export function desktopDownloadUrl(productId: string): string {
	return `${DOWNLOAD_ORIGINS[downloadProductId(productId)]}/download/desktop/`;
}

export function desktopReleaseSearchUrl(productId: string): string {
	return `${GITHUB_RELEASES}?q=${downloadProductId(productId)}`;
}

export function desktopDownloadProductForHostname(hostname: string): DesktopDownloadProductId | null {
	const host = hostname.toLowerCase();
	for (const productId of ['soundscaper', 'framescaper'] as const) {
		if (host === `${productId}.org` || host === `www.${productId}.org`
			|| host === `${productId}.pages.dev` || host.endsWith(`.${productId}.pages.dev`)) {
			return productId;
		}
	}
	return null;
}
