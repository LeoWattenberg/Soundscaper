/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

const MIME: Readonly<Record<string, string>> = Object.freeze({
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
	'.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.avif': 'image/avif',
	'.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
});
const ATTRIBUTES = String.raw`(?:"[^"]*"|'[^']*'|[^"'>])*`;

/** A renderer-only mount: no filesystem capabilities, native runtime, or sibling origin. */
export function createIsolatedRendererProtocolHandler(rendererRoot: string, scheme: string) {
	if (!isAbsolute(rendererRoot) || !/^[a-z][a-z0-9-]*$/u.test(scheme)) throw new TypeError('An absolute isolated renderer root and valid scheme are required.');
	return async (request: Request): Promise<Response> => {
		try {
			const url = new URL(request.url);
			if (url.protocol !== `${scheme}:` || url.host !== 'bundle'
				|| url.username || url.password) return rejected(403);
			if (!['GET', 'HEAD'].includes(request.method)) return rejected(405);
			const decoded = decodeURIComponent(url.pathname.slice(1));
			if (isAbsolute(decoded) || /[\\\0]/u.test(decoded)
				|| decoded.split('/').some((segment) => segment === '..' || segment === '.')) return rejected(403);
			const root = await realpath(rendererRoot);
			const candidate = await realpath(resolve(root, decoded.endsWith('/') || decoded === '' ? `${decoded}index.html` : decoded));
			const fromRoot = relative(root, candidate);
			if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) return rejected(403);
			const details = await stat(candidate);
			if (!details.isFile()) return rejected(404);
			const bytes = await readFile(candidate);
			const extension = extname(candidate);
			const headers = {
				...isolatedRendererSecurityHeaders(extension === '.html' ? bytes.toString('utf8') : ''),
				'Content-Type': MIME[extension] ?? 'application/octet-stream',
				'Content-Length': String(bytes.byteLength),
			};
			return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers });
		} catch (error) {
			return rejected(error instanceof URIError ? 400
				: error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 404 : 500);
		}
	};
}

export function isolatedRendererSecurityHeaders(html = ''): Readonly<Record<string, string>> {
	const pattern = new RegExp(`<script\\b(${ATTRIBUTES})>([\\s\\S]*?)<\\/script\\b${ATTRIBUTES}>`, 'giu');
	const hashes = [...html.matchAll(pattern)].filter((match) => !/\bsrc\s*=/iu.test(match[1]))
		.map((match) => `'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
	return Object.freeze({
		'Content-Security-Policy': [
			"default-src 'self'", `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}`,
			"style-src 'self' 'unsafe-inline'", "font-src 'self' data:", "img-src 'self' data: blob:",
			"media-src 'self' blob:", "worker-src 'self' blob:", "connect-src 'self' blob:",
			"object-src 'none'", "base-uri 'self'", "frame-src 'none'", "frame-ancestors 'none'", "form-action 'none'",
		].join('; '),
		'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless',
		'Permissions-Policy': 'microphone=(), speaker-selection=(), display-capture=(), camera=(), geolocation=()',
		'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache',
	});
}

function rejected(status: number): Response {
	return new Response('Request rejected', { status, headers: isolatedRendererSecurityHeaders() });
}
