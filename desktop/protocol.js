import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

import {
	APP_HOST,
	APP_SCHEME,
	MAX_LINKED_VIDEO_PLAYBACK_RANGE_RESPONSE_BYTES,
	READ_CAPABILITY_PREFIX,
	READ_PROFILE_LINKED_AUDIO_RANGE_V1,
	READ_PROFILE_LINKED_VIDEO_RANGE_V1,
	READ_PROFILE_MATERIALIZED_V1,
	READ_PROFILE_SCAPE_RANGE_V1,
	RUNTIME_PREFIX,
} from './constants.js';
import { assertAppUrl } from './validation.js';

const MAX_SCAPE_RANGE_RESPONSE_BYTES = 16 * 1024 ** 2;

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
		...securityHeaders({ html, immutable: pathname.startsWith('assets/') }),
		'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
		'Content-Length': String(file.size),
	};
	if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
	return new Response(isHtml ? html : Readable.toWeb(createReadStream(file.path)), { status: 200, headers });
}

async function serveCapability(request, url, store) {
	const remainder = url.pathname.slice(READ_CAPABILITY_PREFIX.length);
	const [readProfile, id] = remainder.split('/');
	if (!isReadProfile(readProfile) || !/^[a-f0-9]{64}$/u.test(id)) {
		throw new ProtocolError(404, 'Capability not found');
	}
	const descriptor = store.get(id);
	if (!descriptor || descriptor.readProfile !== readProfile) {
		throw new ProtocolError(404, 'Capability not found');
	}
	const range = requestRange(request, readProfile, descriptor.size);
	const lease = store.acquireRequest(id, readProfile);
	if (!lease) throw new ProtocolError(404, 'Capability not found');
	let bodyOwnsLease = false;
	let streamCreated = false;
	try {
		const status = range ? 206 : 200;
		const start = range?.start ?? 0;
		const end = range?.end ?? Math.max(lease.size - 1, 0);
		const length = range?.length ?? lease.size;
		const headers = {
			...securityHeaders(),
			'Cache-Control': 'no-store',
			'Content-Type': lease.mimeType,
			'Content-Length': String(length),
			'Accept-Ranges': 'bytes',
		};
		if (range) headers['Content-Range'] = `bytes ${start}-${end}/${lease.size}`;
		if (request.method === 'HEAD' || lease.size === 0) {
			return new Response(null, { status, headers });
		}
		const stream = lease.createReadStream({ start, end, autoClose: false });
		streamCreated = true;
		const body = leasedResponseBody(stream, lease, request.signal, {
			retireOnCancel: !isLinkedOriginalRangeProfile(readProfile),
		});
		const response = new Response(body, { status, headers });
		bodyOwnsLease = true;
		return response;
	} finally {
		if (!bodyOwnsLease) {
			if (streamCreated) await lease.retire();
			else await lease.close();
		}
	}
}

function isReadProfile(value) {
	return value === READ_PROFILE_MATERIALIZED_V1
		|| value === READ_PROFILE_SCAPE_RANGE_V1
		|| value === READ_PROFILE_LINKED_AUDIO_RANGE_V1
		|| value === READ_PROFILE_LINKED_VIDEO_RANGE_V1;
}

function isLinkedOriginalRangeProfile(value) {
	return value === READ_PROFILE_LINKED_AUDIO_RANGE_V1
		|| value === READ_PROFILE_LINKED_VIDEO_RANGE_V1;
}

function requestRange(request, readProfile, size) {
	if (readProfile === READ_PROFILE_MATERIALIZED_V1) {
		return parseSingleRange(request.headers.get('range'), size);
	}
	if (isLinkedOriginalRangeProfile(readProfile)) {
		if (request.method === 'HEAD') return null;
		if (request.method !== 'GET') throw new ProtocolError(405, 'Method not allowed');
		const match = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.get('range') || '');
		if (!match || size <= 0) throw new ProtocolError(416, 'Range not satisfiable');
		const start = Number(match[1]);
		const requestedEnd = match[2] ? Number(match[2]) : null;
		if (!Number.isSafeInteger(start) || start >= size
			|| requestedEnd !== null && (!Number.isSafeInteger(requestedEnd)
				|| start > requestedEnd || requestedEnd >= size)) {
			throw new ProtocolError(416, 'Range not satisfiable');
		}
		const end = requestedEnd ?? Math.min(
			size - 1,
			start + MAX_LINKED_VIDEO_PLAYBACK_RANGE_RESPONSE_BYTES - 1,
		);
		const length = end - start + 1;
		if (length > MAX_LINKED_VIDEO_PLAYBACK_RANGE_RESPONSE_BYTES) {
			throw new ProtocolError(416, 'Range not satisfiable');
		}
		return { start, end, length };
	}
	if (request.method !== 'GET') throw new ProtocolError(405, 'Method not allowed');
	const match = /^bytes=(\d+)-(\d+)$/u.exec(request.headers.get('range') || '');
	if (!match || size <= 0) throw new ProtocolError(416, 'Range not satisfiable');
	const start = Number(match[1]);
	const requestedEnd = Number(match[2]);
	if (
		!Number.isSafeInteger(start)
		|| !Number.isSafeInteger(requestedEnd)
		|| start > requestedEnd
		|| start >= size
		|| requestedEnd >= size
	) {
		throw new ProtocolError(416, 'Range not satisfiable');
	}
	const end = requestedEnd;
	const length = end - start + 1;
	if (length > MAX_SCAPE_RANGE_RESPONSE_BYTES) {
		throw new ProtocolError(416, 'Range not satisfiable');
	}
	return { start, end, length };
}

function leasedResponseBody(stream, lease, signal, { retireOnCancel = true } = {}) {
	const reader = Readable.toWeb(stream).getReader();
	let abortReason = null;
	let abortAttached = false;
	let aborted = false;
	let cancelled = false;
	let failed = false;
	let failurePromise = null;
	let outerController = null;
	let outerSettled = false;
	let retirementPromise = null;
	const detachAbort = () => {
		if (!abortAttached) return;
		abortAttached = false;
		signal.removeEventListener('abort', onAbort);
	};
	const cancelInner = (reason) => {
		try {
			void Promise.resolve(reader.cancel(reason)).catch(() => undefined);
		} catch {
			// Capability retirement remains the authoritative cleanup barrier.
		}
	};
	const retire = () => {
		if (!retirementPromise) retirementPromise = Promise.resolve().then(() => lease.retire());
		return retirementPromise;
	};
	const cancelRequest = () => retireOnCancel
		? retire()
		: Promise.resolve().then(() => lease.cancel());
	const fail = (failure, retirement = null) => {
		if (failurePromise) return failurePromise;
		failed = true;
		detachAbort();
		failurePromise = (async () => {
			const terminalFailure = await failureAfterRetirement(failure, lease, retirement ?? retire());
			if (!cancelled && !outerSettled) {
				outerSettled = true;
				outerController.error(terminalFailure);
			}
			return terminalFailure;
		})();
		void failurePromise.catch(() => undefined);
		return failurePromise;
	};
	const onAbort = () => {
		if (aborted || cancelled || outerSettled) return;
		aborted = true;
		abortReason = streamAbortError(signal.reason);
		detachAbort();
		cancelInner(abortReason);
		if (!stream.destroyed) {
			try {
				stream.destroy(abortReason);
			} catch {
				// Capability retirement retries and reports stream cleanup.
			}
		}
		void fail(abortReason, cancelRequest());
	};
	const body = new ReadableStream({
		start(controller) {
			outerController = controller;
			if (!signal?.addEventListener || !signal?.removeEventListener) return;
			if (signal.aborted) {
				onAbort();
				return;
			}
			abortAttached = true;
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) onAbort();
		},
		async pull(controller) {
			if (failed) {
				await failurePromise;
				return;
			}
			let result;
			try {
				result = await reader.read();
			} catch (error) {
				if (cancelled) return;
				await fail(aborted ? abortReason : error);
				return;
			}
			if (failed) {
				await failurePromise;
				return;
			}
			if (result.done) {
				detachAbort();
				try {
					await lease.close();
				} catch (error) {
					if (!cancelled) await fail(error);
					return;
				}
				if (!cancelled && !failed && !outerSettled) {
					outerSettled = true;
					controller.close();
				}
				return;
			}
			if (!cancelled) controller.enqueue(result.value);
		},
		async cancel(reason) {
			cancelled = true;
			detachAbort();
			cancelInner(reason);
			if (!stream.destroyed) {
				try {
					stream.destroy(streamAbortError(reason));
				} catch {
					// Capability retirement retries and reports stream cleanup.
				}
			}
			await cancelRequest();
		},
	}, { highWaterMark: 0 });
	void reader.closed.catch((error) => {
		if (!cancelled) void fail(aborted ? abortReason : error);
	});
	return body;
}

async function failureAfterRetirement(failure, lease, retirement = null) {
	try {
		await (retirement ?? lease.retire());
		return failure;
	} catch (cleanupError) {
		return new AggregateError(
			[failure, cleanupError],
			'Desktop capability response and request cleanup both failed',
			{ cause: failure },
		);
	}
}

function streamAbortError(reason) {
	if (reason instanceof Error) return reason;
	const error = new Error('Desktop capability request was aborted', reason === undefined ? undefined : { cause: reason });
	error.name = 'AbortError';
	return error;
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
