/* SPDX-License-Identifier: AGPL-3.0-only */

import { realpath, stat } from 'node:fs/promises';
import {
	isAbsolute,
	relative,
	resolve,
	sep,
} from 'node:path';

const HTML_MEDIA_TYPE = 'text/html';
const QUALITY_VALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u;
const EMBEDDED_ROUTE = /^\/(?:(framescaper)\/)?embed\/([A-Za-z\d-]{1,64})\/?$/u;

export async function resolveDesktopNightlyTestsStaticRequestFile(staticRoot, requestUrl, accept) {
	const rawPath = String(requestUrl ?? '/').split('?', 1)[0];
	let decoded;
	try {
		decoded = decodeURIComponent(rawPath);
	} catch {
		throw new StaticRequestError(400, 'Malformed URL path');
	}
	if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) {
		throw new StaticRequestError(400, 'Invalid URL path');
	}
	const segments = decoded.split('/');
	if (segments.some((segment) => segment === '.' || segment === '..')) {
		throw new StaticRequestError(400, 'Invalid URL path');
	}
	let relativePath = segments.filter(Boolean).join('/');
	if (!relativePath || decoded.endsWith('/')) relativePath = `${relativePath}${relativePath ? '/' : ''}index.html`;
	relativePath = embeddedShellRelativePath(decoded, accept) ?? relativePath;
	return resolveStaticFile(staticRoot, relativePath);
}

async function resolveStaticFile(staticRoot, relativePath) {
	const candidate = resolve(staticRoot, relativePath);
	assertContained(staticRoot, candidate, 400);
	const candidateRealPath = await realpath(candidate).catch(() => {
		throw new StaticRequestError(404, 'File not found');
	});
	assertContained(staticRoot, candidateRealPath, 404);
	const details = await stat(candidateRealPath);
	if (!details.isFile()) throw new StaticRequestError(404, 'File not found');
	return { path: candidateRealPath, relativePath, size: details.size };
}

function embeddedShellRelativePath(pathname, accept) {
	if (!acceptsHtml(accept)) return null;
	const match = EMBEDDED_ROUTE.exec(pathname);
	if (!match) return null;
	return `${match[1] ? 'framescaper/' : ''}${match[2]}/index.html`;
}

function acceptsHtml(value) {
	for (const range of String(value ?? '').split(',')) {
		const [mediaType, ...parameters] = range.split(';').map((part) => part.trim().toLowerCase());
		if (mediaType !== HTML_MEDIA_TYPE) continue;
		let quality = 1;
		for (const parameter of parameters) {
			const separator = parameter.indexOf('=');
			if (separator < 0 || parameter.slice(0, separator).trim() !== 'q') continue;
			const encoded = parameter.slice(separator + 1).trim();
			if (!QUALITY_VALUE.test(encoded)) return false;
			quality = Number(encoded);
		}
		if (quality > 0) return true;
	}
	return false;
}

function assertContained(root, candidate, statusCode) {
	const remainder = relative(root, candidate);
	if (remainder === '..' || remainder.startsWith(`..${sep}`) || isAbsolute(remainder)) {
		throw new StaticRequestError(statusCode, statusCode === 400 ? 'Invalid URL path' : 'File not found');
	}
}

export class StaticRequestError extends Error {
	constructor(statusCode, errorMessage) {
		super(errorMessage);
		this.name = 'StaticRequestError';
		this.statusCode = statusCode;
	}
}
