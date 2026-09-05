/* SPDX-License-Identifier: AGPL-3.0-only */

import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import {
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from 'node:path';
import { matchedHeaders, parseHeaderRules } from './product-web-routing.mjs';
import { staticSiteContentType } from './static-site-content-types.mjs';

// Cloudflare Pages serves a build directory plus two control files, `_headers`
// and `_redirects`. The browser suite that needs those semantics used to serve
// the built sites through `wrangler pages dev`, whose asset server answered a
// module chunk it had already served twice with an empty-message 500 in two of
// four recent CI runs, so the editable-copy handoff spec failed on the runner
// while the same build passed locally. This server applies the two control
// files to plain Node file serving so the suite depends on nothing beyond the
// filesystem, and it names any failure it does have on stderr.

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Reads the `_headers` and `_redirects` files of one built site; either may be absent. */
export async function loadPagesSiteControlFiles(root) {
	const [headersText, redirectsText] = await Promise.all([
		readFile(join(root, '_headers'), 'utf8').catch(absentFile),
		readFile(join(root, '_redirects'), 'utf8').catch(absentFile),
	]);
	return Object.freeze({
		headerRules: parseHeaderRules(headersText),
		redirects: parseRedirectRules(redirectsText),
	});
}

function absentFile(error) {
	if (error?.code === 'ENOENT') return '';
	throw error;
}

/**
 * Parses the `_redirects` grammar the route generator emits: one
 * `source destination [status]` rule per line with exact source paths. Splats
 * and placeholders are refused rather than approximated so a site that starts
 * relying on them fails at startup instead of serving the wrong document.
 */
export function parseRedirectRules(text) {
	const redirects = new Map();
	for (const rawLine of String(text).split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const [source, destination, status = '302', ...rest] = line.split(/\s+/u);
		if (!destination || rest.length > 0 || !source.startsWith('/')) {
			throw new Error(`Cloudflare redirect line is malformed: ${rawLine}`);
		}
		if (/[*:]/u.test(source)) {
			throw new Error(`Cloudflare redirect splats and placeholders are not served here: ${rawLine}`);
		}
		const statusCode = Number(status);
		if (!REDIRECT_STATUSES.has(statusCode)) {
			throw new Error(`Cloudflare redirect status is unsupported: ${rawLine}`);
		}
		if (!redirects.has(source)) redirects.set(source, Object.freeze({ destination, statusCode }));
	}
	return redirects;
}

/**
 * Serves one built Pages site directory over HTTP until `close()` is awaited.
 * @param {{ root: string, host?: string, port?: number }} options
 */
export async function startPagesSiteStaticServer({ root, host = '127.0.0.1', port = 0 } = {}) {
	if (typeof root !== 'string' || !isAbsolute(root)) {
		throw new TypeError('A Pages site root must be an absolute path.');
	}
	const siteRoot = await realpath(root);
	if (!(await stat(siteRoot)).isDirectory()) throw new Error('A Pages site root must be a directory.');
	const site = Object.freeze({ root: siteRoot, ...await loadPagesSiteControlFiles(siteRoot) });
	const server = createServer((request, response) => {
		void respond(site, request, response);
	});
	server.headersTimeout = 10_000;
	server.requestTimeout = 30_000;
	await listen(server, host, port);
	const address = server.address();
	if (!address || typeof address === 'string') {
		await closeServer(server);
		throw new Error('The Pages site server did not expose a TCP address.');
	}
	let closed = false;
	return Object.freeze({
		baseURL: `http://${host}:${String(address.port)}`,
		async close() {
			if (closed) return;
			closed = true;
			await closeServer(server);
		},
	});
}

async function respond(site, request, response) {
	try {
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			writeText(response, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
			return;
		}
		const { rawPath, pathname, search } = requestPath(request.url);
		const redirect = site.redirects.get(pathname);
		if (redirect) {
			response.writeHead(redirect.statusCode, { Location: redirect.destination, 'Cache-Control': 'no-store' });
			response.end();
			return;
		}
		const document = await resolveDocument(site.root, pathname);
		if (document.canonicalPath) {
			response.writeHead(308, { Location: `${canonicalRawPath(rawPath, document.canonicalPath)}${search}` });
			response.end();
			return;
		}
		const file = document.file ?? await fileAt(site.root, '404.html');
		const headers = {
			'Content-Type': file ? staticSiteContentType(file.extension) : 'text/plain; charset=utf-8',
			'Content-Length': String(file ? file.size : NOT_FOUND_TEXT.length),
		};
		for (const [name, values] of matchedHeaders(site.headerRules, pathname)) {
			headers[name] = values.join(', ');
		}
		response.writeHead(document.file ? 200 : 404, headers);
		if (request.method === 'HEAD') {
			response.end();
		} else if (file) {
			pipeFile(createReadStream(file.path), response);
		} else {
			response.end(NOT_FOUND_TEXT);
		}
	} catch (error) {
		const statusCode = error instanceof RequestError ? error.statusCode : 500;
		if (statusCode === 500) {
			console.error(`[pages-site] ${request.method ?? ''} ${request.url ?? ''}: ${error?.stack ?? String(error)}`);
		}
		if (response.headersSent) {
			response.destroy();
			return;
		}
		writeText(response, statusCode, statusCode === 500 ? 'Internal server error' : error.message);
	}
}

const NOT_FOUND_TEXT = 'Not found';

function requestPath(url) {
	const raw = String(url ?? '/');
	const query = raw.indexOf('?');
	const rawPath = query < 0 ? raw : raw.slice(0, query);
	let pathname;
	try {
		pathname = decodeURIComponent(rawPath);
	} catch {
		throw new RequestError(400, 'Malformed URL path');
	}
	if (!pathname.startsWith('/') || pathname.includes('\0') || pathname.includes('\\')) {
		throw new RequestError(400, 'Invalid URL path');
	}
	return { rawPath, pathname, search: query < 0 ? '' : raw.slice(query) };
}

// Pages canonicalises directory documents to a trailing slash and folds an
// explicit index.html back onto its directory, both with a 308.
async function resolveDocument(root, pathname) {
	const segments = pathname.split('/').filter(Boolean);
	if (segments.some((segment) => segment === '.' || segment === '..')) {
		throw new RequestError(400, 'Invalid URL path');
	}
	const relativePath = segments.join('/');
	if (pathname.endsWith('/')) {
		return { file: await fileAt(root, relativePath ? `${relativePath}/index.html` : 'index.html') };
	}
	if (segments.at(-1) === 'index.html') {
		return { canonicalPath: `/${segments.slice(0, -1).join('/')}${segments.length > 1 ? '/' : ''}` };
	}
	const file = await fileAt(root, relativePath);
	if (file) return { file };
	if (await fileAt(root, `${relativePath}/index.html`)) return { canonicalPath: `${pathname}/` };
	return { file: null };
}

function canonicalRawPath(rawPath, canonicalPath) {
	if (canonicalPath === `${decodeSafely(rawPath)}/`) return `${rawPath}/`;
	return encodeURI(canonicalPath);
}

function decodeSafely(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

async function fileAt(root, relativePath) {
	const candidate = resolve(root, relativePath);
	assertContained(root, candidate);
	const realPath = await realpath(candidate).catch(() => null);
	if (realPath === null) return null;
	assertContained(root, realPath);
	const details = await stat(realPath);
	return details.isFile() ? { path: realPath, size: details.size, extension: extname(realPath) } : null;
}

function assertContained(root, candidate) {
	const remainder = relative(root, candidate);
	if (remainder === '..' || remainder.startsWith(`..${sep}`) || isAbsolute(remainder)) {
		throw new RequestError(400, 'Invalid URL path');
	}
}

function pipeFile(stream, response) {
	const destroyStream = () => stream.destroy();
	response.once('close', destroyStream);
	stream.once('close', () => response.off('close', destroyStream));
	stream.once('error', () => response.destroy());
	stream.pipe(response);
}

function writeText(response, statusCode, text, extraHeaders = {}) {
	response.writeHead(statusCode, {
		'Cache-Control': 'no-store',
		'Content-Type': 'text/plain; charset=utf-8',
		...extraHeaders,
	});
	response.end(text);
}

function listen(server, host, port) {
	return new Promise((resolvePromise, reject) => {
		const onError = (error) => {
			server.off('listening', onListening);
			reject(error);
		};
		const onListening = () => {
			server.off('error', onError);
			resolvePromise();
		};
		server.once('error', onError);
		server.once('listening', onListening);
		server.listen(port, host);
	});
}

function closeServer(server) {
	return new Promise((resolvePromise, reject) => {
		server.close((error) => (error ? reject(error) : resolvePromise()));
		server.closeAllConnections?.();
	});
}

class RequestError extends Error {
	constructor(statusCode, errorMessage) {
		super(errorMessage);
		this.name = 'RequestError';
		this.statusCode = statusCode;
	}
}
