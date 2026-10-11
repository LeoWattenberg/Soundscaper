/* SPDX-License-Identifier: AGPL-3.0-only */
import { selectUpdate } from './update-check.js';
import { motionscaperDesktopDocumentUrl, MOTIONSCAPER_DESKTOP } from './motionscaper-desktop-contract.ts';

const RELEASES_API = 'https://api.github.com/repos/LeoWattenberg/Soundscaper/releases?per_page=20';
const RELEASE_PAGES = 10;
export const MOTION_UPDATE_RESPONSE_BYTES = 2 * 1024 * 1024;
export type MotionUpdateResult = Readonly<{ status: 'current' | 'error' }> | Readonly<{ status: 'available'; version: string; url: string }>;
interface ReleaseRow { tag_name: string; draft: boolean; prerelease: boolean }

function validVersion(value: string): boolean {
	if (value.length > 128) return false;
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(value);
	return !!match && match.slice(1, 4).every(part => Number.isSafeInteger(Number(part)))
		&& (!match[4] || match[4].split('.').every(part => !/^\d+$/u.test(part) || /^(0|[1-9]\d*)$/u.test(part) && Number.isSafeInteger(Number(part))));
}

async function readReleases(response: Response): Promise<unknown> {
	const body = response.body; if (!body) throw new Error('Missing update response.');
	const declared = response.headers.get('content-length');
	if (!response.ok || declared !== null && (!/^\d+$/u.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > MOTION_UPDATE_RESPONSE_BYTES)) {
		await body.cancel(); throw new Error('Update response is unavailable or oversized.');
	}
	const reader = body.getReader(), chunks: Uint8Array[] = []; let total = 0, complete = false;
	try {
		for (;;) {
			const next = await reader.read(); if (next.done) { complete = true; break; }
			if (next.value.byteLength > MOTION_UPDATE_RESPONSE_BYTES - total) throw new Error('Update response exceeds its limit.');
			if (next.value.byteLength) chunks.push(next.value); total += next.value.byteLength;
		}
		const bytes = new Uint8Array(total); let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
	} finally { try { if (!complete) await reader.cancel(); } finally { reader.releaseLock(); } }
}

async function checkMotionUpdates(currentVersion: string, fetchImpl: typeof fetch): Promise<MotionUpdateResult> {
	try {
		if (!validVersion(currentVersion)) throw new Error('Invalid current Motion version.');
		const rows: ReleaseRow[] = [], signal = AbortSignal.timeout(10_000);
		for (let page = 1; page <= RELEASE_PAGES; page++) {
			const response = await fetchImpl(`${RELEASES_API}${page === 1 ? '' : `&page=${page}`}`, { redirect: 'error', credentials: 'omit', signal,
				headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
			const body = await readReleases(response);
			if (!Array.isArray(body) || body.length > 20) throw new Error('Invalid update release inventory.');
			for (const value of body as unknown[]) {
				if (!value || typeof value !== 'object') continue;
				const row = value as Record<string, unknown>, tag = row.tag_name;
				if (typeof tag !== 'string' || !tag.startsWith(MOTIONSCAPER_DESKTOP.updateTagPrefix)
					|| !validVersion(tag.slice(MOTIONSCAPER_DESKTOP.updateTagPrefix.length)) || typeof row.draft !== 'boolean' || typeof row.prerelease !== 'boolean') continue;
				rows.push({ tag_name: tag, draft: row.draft, prerelease: row.prerelease });
			}
			const link = response.headers.get('link') ?? '';
			if (link.length > 4096) throw new Error('Oversized update pagination header.');
			if (!/\brel\s*=\s*(?:"[^"\r\n]*\bnext\b[^"\r\n]*"|next)(?:\s*[,;]|\s*$)/iu.test(link)) break;
			if (page === RELEASE_PAGES) throw new Error('Release history exceeds the update page limit.');
		}
		const selected = selectUpdate(rows, currentVersion, MOTIONSCAPER_DESKTOP.updateTagPrefix) as ReleaseRow | null;
		if (!selected || !rows.includes(selected)) return Object.freeze({ status: 'current' });
		return Object.freeze({ status: 'available', version: selected.tag_name.slice(MOTIONSCAPER_DESKTOP.updateTagPrefix.length),
			url: `https://github.com/LeoWattenberg/Soundscaper/releases/tag/${encodeURIComponent(selected.tag_name)}` });
	} catch { return Object.freeze({ status: 'error' }); }
}

/** Only an explicit manual action fetches; concurrent callers join one bounded operation. */
export function createMotionscaperUpdateChecker(currentVersion: string, fetchImpl: typeof fetch = fetch): () => Promise<MotionUpdateResult> {
	let pending: Promise<MotionUpdateResult> | null = null;
	return () => pending ??= checkMotionUpdates(currentVersion, fetchImpl).finally(() => { pending = null; });
}

export async function dispatchMotionscaperUpdateCheck(context: Readonly<{ ownWindow: boolean; mainFrame: boolean; url: string }>, request: unknown, check: () => Promise<void>): Promise<void> {
	if (!context.ownWindow || !context.mainFrame || !motionscaperDesktopDocumentUrl(context.url)) throw new Error('Untrusted Motionscaper update caller.');
	if (!request || typeof request !== 'object' || Array.isArray(request) || Reflect.ownKeys(request).length !== 0) throw new TypeError('Invalid Motion update request.');
	await check();
}
