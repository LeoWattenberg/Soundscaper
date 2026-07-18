import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

import {
	APP_HOST,
	APP_SCHEME,
	READ_CAPABILITY_PREFIX,
	RUNTIME_PREFIX,
} from './constants.js';
import { assertAppUrl } from './validation.js';

const MIME_TYPES = Object.freeze({
	'.avif': 'image/avif',
	'.css': 'text/css; charset=utf-8',
	'.gif': 'image/gif',
	'.html': 'text/html; charset=utf-8',
	'.ico': 'image/x-icon',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.m4v': 'video/mp4',
	'.mjs': 'text/javascript; charset=utf-8',
	'.mp3': 'audio/mpeg',
	'.mp4': 'video/mp4',
	'.ny': 'text/plain; charset=utf-8',
	'.ogg': 'audio/ogg',
	'.opus': 'audio/ogg; codecs=opus',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ttf': 'font/ttf',
	'.txt': 'text/plain; charset=utf-8',
	'.wasm': 'application/wasm',
	'.wav': 'audio/wav',
	'.webm': 'video/webm',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.xml': 'application/xml; charset=utf-8',
});

export class ProtocolError extends Error {
	constructor(status, message) {
		super(message);
		this.name = 'ProtocolError';
		this.status = status;
	}
}

export function registerAppScheme(protocolApi) {
	protocolApi.registerSchemesAsPrivileged([{
		scheme: APP_SCHEME,
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			stream: true,
			corsEnabled: true,
			codeCache: true,
		},
	}]);
}

export function createProtocolHandler({ rendererRoot, runtimeRoot, readCapabilities }) {
	return async (request) => {
		try {
			const url = assertAppUrl(request.url);
			if (request.method !== 'GET' && request.method !== 'HEAD') throw new ProtocolError(405, 'Method not allowed');
			if (url.pathname.startsWith(READ_CAPABILITY_PREFIX)) {
				return await serveCapability(request, url, readCapabilities);
			}
			const mount = url.pathname.startsWith(RUNTIME_PREFIX)
				? { root: runtimeRoot, pathname: url.pathname.slice(RUNTIME_PREFIX.length) }
				: { root: rendererRoot, pathname: url.pathname.slice(1) };
			return await serveStaticFile(request, mount.root, mount.pathname);
		} catch (error) {
			const status = error instanceof ProtocolError ? error.status : 500;
			return errorResponse(status);
		}
	};
}

export async function resolveStaticFile(root, requestPath) {
	const decoded = decodeRequestPath(requestPath);
	const relativePath = decoded.endsWith('/') || !decoded ? `${decoded}index.html` : decoded;
	const rootRealPath = await realpath(root).catch(() => { throw new ProtocolError(404, 'Mount not found'); });
	const candidate = resolve(rootRealPath, relativePath);
	assertContained(rootRealPath, candidate);
	const candidateRealPath = await realpath(candidate).catch(() => { throw new ProtocolError(404, 'File not found'); });
	assertContained(rootRealPath, candidateRealPath);
	const details = await stat(candidateRealPath);
	if (!details.isFile()) throw new ProtocolError(404, 'File not found');
	return { path: candidateRealPath, size: details.size };
}

export function decodeRequestPath(requestPath) {
	let decoded;
	try {
		decoded = decodeURIComponent(String(requestPath || ''));
	} catch {
		throw new ProtocolError(400, 'Malformed URL path');
	}
	if (decoded.includes('\0') || decoded.includes('\\') || isAbsolute(decoded)) throw new ProtocolError(400, 'Invalid URL path');
	const segments = decoded.split('/');
	if (segments.some((segment) => segment === '..' || segment === '.')) throw new ProtocolError(400, 'Invalid URL path');
	return segments.filter(Boolean).join('/') + (decoded.endsWith('/') ? '/' : '');
}

export function securityHeaders({ html = null, immutable = false } = {}) {
	const hashes = html === null ? [] : inlineScriptHashes(html);
	const scriptSources = ["'self'", "'wasm-unsafe-eval'", ...hashes.map((hash) => `'sha256-${hash}'`)];
	return {
		'Content-Security-Policy': [
			"default-src 'self'",
			`script-src ${scriptSources.join(' ')}`,
			"style-src 'self' 'unsafe-inline'",
			"font-src 'self' data:",
			"img-src 'self' data: blob:",
			"media-src 'self' blob:",
			"worker-src 'self' blob:",
			"connect-src 'self'",
			"object-src 'none'",
			"base-uri 'self'",
			"frame-src 'none'",
			"frame-ancestors 'none'",
			"form-action 'none'",
		].join('; '),
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'credentialless',
		'Referrer-Policy': 'no-referrer',
		'Permissions-Policy': 'microphone=(self), speaker-selection=(self), display-capture=(self), camera=(), geolocation=()',
		'X-Content-Type-Options': 'nosniff',
		'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
	};
}

export function inlineScriptHashes(html) {
	const hashes = [];
	const scripts = String(html || '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu);
	for (const match of scripts) {
		if (/\bsrc\s*=/iu.test(match[1])) continue;
		hashes.push(createHash('sha256').update(match[2], 'utf8').digest('base64'));
	}
	return [...new Set(hashes)];
}

export function parseSingleRange(header, size) {
	if (!header) return null;
	const match = /^bytes=(\d*)-(\d*)$/u.exec(String(header).trim());
	if (!match || (!match[1] && !match[2]) || size <= 0) throw new ProtocolError(416, 'Range not satisfiable');
	let start;
	let end;
	if (!match[1]) {
		const suffixLength = Number(match[2]);
		if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) throw new ProtocolError(416, 'Range not satisfiable');
		start = Math.max(size - suffixLength, 0);
		end = size - 1;
	} else {
		start = Number(match[1]);
		end = match[2] ? Number(match[2]) : size - 1;
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
			throw new ProtocolError(416, 'Range not satisfiable');
		}
		end = Math.min(end, size - 1);
	}
	return { start, end, length: end - start + 1 };
}

async function serveStaticFile(request, root, pathname) {
	const file = await resolveStaticFile(root, pathname);
	const extension = extname(file.path).toLowerCase();
	const isHtml = extension === '.html';
	let html = null;
	if (isHtml) html = await import('node:fs/promises').then(({ readFile }) => readFile(file.path, 'utf8'));
	const headers = {
		...securityHeaders({ html, immutable: pathname.startsWith('_astro/') }),
		'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
		'Content-Length': String(file.size),
	};
	if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
	return new Response(isHtml ? html : Readable.toWeb(createReadStream(file.path)), { status: 200, headers });
}

async function serveCapability(request, url, store) {
	const remainder = url.pathname.slice(READ_CAPABILITY_PREFIX.length);
	const id = remainder.split('/')[0];
	if (!/^[a-f0-9]{64}$/u.test(id)) throw new ProtocolError(404, 'Capability not found');
	const entry = store.get(id);
	if (!entry) throw new ProtocolError(404, 'Capability not found');
	const range = parseSingleRange(request.headers.get('range'), entry.size);
	const status = range ? 206 : 200;
	const start = range?.start ?? 0;
	const end = range?.end ?? Math.max(entry.size - 1, 0);
	const length = range?.length ?? entry.size;
	const headers = {
		...securityHeaders(),
		'Cache-Control': 'no-store',
		'Content-Type': entry.mimeType,
		'Content-Length': String(length),
		'Accept-Ranges': 'bytes',
	};
	if (range) headers['Content-Range'] = `bytes ${start}-${end}/${entry.size}`;
	if (request.method === 'HEAD' || entry.size === 0) return new Response(null, { status, headers });
	const stream = entry.handle.createReadStream({ start, end, autoClose: false });
	return new Response(Readable.toWeb(stream), { status, headers });
}

function assertContained(root, candidate) {
	const pathFromRoot = relative(root, candidate);
	if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
		throw new ProtocolError(403, 'Path escapes mount');
	}
}

function errorResponse(status) {
	const body = status === 404 ? 'Not found' : status === 405 ? 'Method not allowed' : 'Request rejected';
	const headers = {
		...securityHeaders(),
		'Content-Type': 'text/plain; charset=utf-8',
		'Content-Length': String(Buffer.byteLength(body)),
	};
	if (status === 405) headers.Allow = 'GET, HEAD';
	if (status === 416) headers['Content-Range'] = 'bytes */*';
	return new Response(body, { status, headers });
}

export const APP_PROTOCOL_IDENTITY = Object.freeze({ scheme: APP_SCHEME, host: APP_HOST });
