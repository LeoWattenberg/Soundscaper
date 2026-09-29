/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	desktopDownloadProductForHostname,
	desktopReleaseSearchUrl,
	type DesktopDownloadProductId,
} from '../../../src/common/editor/desktop-download-links.ts';

const RELEASES_API = 'https://api.github.com/repos/LeoWattenberg/Soundscaper/releases';
const RELEASES_WEB = 'https://github.com/LeoWattenberg/Soundscaper/releases';
const MAX_PAGES = 5;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

interface GitHubRelease {
	readonly tag_name?: unknown;
	readonly published_at?: unknown;
	readonly draft?: unknown;
	readonly assets?: unknown;
}

interface ReleaseCandidate {
	readonly url: string;
	readonly publishedAt: number;
	readonly tag: string;
}

interface CacheableRequestInit extends RequestInit {
	readonly cf: Readonly<{
		cacheEverything: true;
		cacheTtlByStatus: Readonly<Record<string, number>>;
	}>;
}

export function selectLatestDesktopRelease(releases: unknown, productId: DesktopDownloadProductId): string | null {
	if (!Array.isArray(releases)) return null;
	let latest: ReleaseCandidate | null = null;
	for (const value of releases as unknown[]) {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
		const release = value as GitHubRelease;
		if (release.draft !== false || typeof release.tag_name !== 'string'
			|| !productReleaseTag(productId, release.tag_name)
			|| typeof release.published_at !== 'string'
			|| !hasDesktopInstaller(release.assets, productId)) continue;
		const publishedAt = Date.parse(release.published_at);
		if (!Number.isFinite(publishedAt)) continue;
		const candidate = {
			url: `${RELEASES_WEB}/tag/${encodeURIComponent(release.tag_name)}`,
			publishedAt,
			tag: release.tag_name,
		};
		if (latest === null || candidate.publishedAt > latest.publishedAt
			|| (candidate.publishedAt === latest.publishedAt && candidate.tag > latest.tag)) latest = candidate;
	}
	return latest?.url ?? null;
}

/** Cloudflare Pages route at both /download/desktop and /download/desktop/. */
export function onRequest(context: Readonly<{ request: Request }>): Promise<Response> {
	return handleDesktopDownloadRequest(context.request);
}

export async function handleDesktopDownloadRequest(
	request: Request,
	fetchImpl: typeof fetch = fetch,
): Promise<Response> {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
	}
	const productId = desktopDownloadProductForHostname(new URL(request.url).hostname);
	if (productId === null) return new Response(null, { status: 404 });
	let destination: string | null = null;
	try {
		const releases = await fetchReleasePages(fetchImpl);
		destination = selectLatestDesktopRelease(releases, productId);
	} catch (error) {
		console.warn(JSON.stringify({ event: 'desktop_release_lookup_failed', productId,
			reason: error instanceof Error ? error.message : String(error) }));
	}
	return new Response(null, {
		status: 302,
		headers: {
			Location: destination ?? desktopReleaseSearchUrl(productId),
			'Cache-Control': 'no-store',
			'Referrer-Policy': 'no-referrer',
		},
	});
}

async function fetchReleasePages(fetchImpl: typeof fetch): Promise<unknown[]> {
	const releases: unknown[] = [];
	const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const url = `${RELEASES_API}?per_page=100&page=${page}`;
		const options: CacheableRequestInit = {
			headers: {
				Accept: 'application/vnd.github+json',
				'User-Agent': 'Soundscaper-desktop-downloads',
				'X-GitHub-Api-Version': '2026-03-10',
			},
			signal,
			redirect: 'error',
			cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 300, '400-599': 0 } },
		};
		const response = await fetchImpl(url, options);
		if (!response.ok) throw new Error(`GitHub release listing returned HTTP ${response.status}.`);
		if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')) {
			throw new Error('GitHub release listing was not JSON.');
		}
		const pageReleases = await readBoundedJson(response);
		if (!Array.isArray(pageReleases)) throw new Error('GitHub release listing was not an array.');
		releases.push(...pageReleases);
		if (!/rel="next"/u.test(response.headers.get('link') ?? '')) return releases;
	}
	throw new Error(`GitHub release listing exceeded ${MAX_PAGES} pages.`);
}

async function readBoundedJson(response: Response): Promise<unknown> {
	const contentLength = Number(response.headers.get('content-length'));
	if (contentLength > MAX_RESPONSE_BYTES) throw new Error('GitHub release listing exceeded its size limit.');
	if (response.body === null) throw new Error('GitHub release listing had no body.');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			throw new Error('GitHub release listing exceeded its size limit.');
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function productReleaseTag(productId: DesktopDownloadProductId, tag: string): boolean {
	return productId === 'soundscaper'
		? /^(?:v\d+\.\d+\.\d+|soundscaper-v\d+\.\d+\.\d+-(?:beta|rc)\.\d+)$/u.test(tag)
		: /^framescaper-v\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?$/u.test(tag);
}

function hasDesktopInstaller(assets: unknown, productId: DesktopDownloadProductId): boolean {
	if (!Array.isArray(assets)) return false;
	const prefix = productId === 'soundscaper' ? 'Soundscaper-' : 'Framescaper-';
	return assets.some((value: unknown) => {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
		const asset = value as Readonly<{ name?: unknown; state?: unknown }>;
		return asset.state === 'uploaded' && typeof asset.name === 'string'
			&& asset.name.startsWith(prefix) && !/source/iu.test(asset.name)
			&& /\.(?:AppImage|deb|dmg|exe|zip)$/iu.test(asset.name);
	});
}
