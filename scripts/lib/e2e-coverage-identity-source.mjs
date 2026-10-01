/* SPDX-License-Identifier: AGPL-3.0-only */

export function normalizedInstalledPath(path, platform) {
	const slashed = path.replaceAll('\\', '/');
	const unc = platform === 'win32' && slashed.startsWith('//');
	let normalized = slashed.replace(/\/{2,}/gu, '/').replace(/\/$/u, '');
	if (unc) normalized = `/${normalized}`;
	if (platform === 'win32' && /^\/[A-Za-z]:\//u.test(normalized)) normalized = normalized.slice(1);
	return normalized;
}

export function decodedUrlPath(url) {
	return decodeURIComponent(new URL(url).pathname).replaceAll('\\', '/').replace(/^\/+/u, '');
}

export function origin(url) {
	try { return new URL(url).origin; } catch { return null; }
}

export function sourceLineLengths(value) {
	const lines = String(value).split('\n');
	if (lines.length > 1 && lines.at(-1) === '') lines.pop();
	return lines.map((line) => line.length);
}
