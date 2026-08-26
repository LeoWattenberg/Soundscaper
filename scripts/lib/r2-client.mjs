/* SPDX-License-Identifier: AGPL-3.0-only */

// Signed Cloudflare R2 (S3) object access shared by authenticated release
// publishers. Kept apart from publication commands so the transport rules —
// SigV4 signing, identity transfer encoding, and strong ETag validators — stay
// reviewable on their own.

import { createHash, createHmac } from 'node:crypto';

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAXIMUM_MULTIPART_PARTS = 10_000;

function fail(message) {
	throw new Error(message);
}

function assert(condition, message) {
	if (!condition) fail(message);
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function hmac(key, value, encoding) {
	return createHmac('sha256', key).update(value).digest(encoding);
}

function normalizeHeader(value) {
	return String(value).trim().replace(/\s+/g, ' ');
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function xmlDecode(value) {
	return value
		.replaceAll('&quot;', '"')
		.replaceAll('&apos;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&amp;', '&');
}

function xmlEncode(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function xmlValue(xml, name, required = true) {
	const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'u').exec(xml);
	if (!match) {
		if (!required) return null;
		fail(`R2 response has no ${name}`);
	}
	return xmlDecode(match[1]);
}

function canonicalQuery(query) {
	return Object.entries(query)
		.filter(([, value]) => value !== undefined && value !== null)
		.map(([name, value]) => [rfc3986(name), rfc3986(String(value))])
		.sort(([leftName, leftValue], [rightName, rightValue]) => {
			if (leftName !== rightName) return leftName < rightName ? -1 : 1;
			if (leftValue === rightValue) return 0;
			return leftValue < rightValue ? -1 : 1;
		})
		.map(([name, value]) => `${name}=${value}`)
		.join('&');
}

async function delay(milliseconds, signal) {
	if (signal?.aborted) throw signal.reason ?? new Error('R2 request aborted');
	if (milliseconds === 0) return;
	await new Promise((resolve, reject) => {
		const settled = () => {
			signal?.removeEventListener('abort', aborted);
			resolve();
		};
		const timer = setTimeout(settled, milliseconds);
		const aborted = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', aborted);
			reject(signal.reason ?? new Error('R2 request aborted'));
		};
		signal?.addEventListener('abort', aborted, { once: true });
	});
}

export function rfc3986(value) {
	return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function safeRelativePath(value, label = 'path') {
	assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
	assert(!value.startsWith('/') && !value.startsWith('\\'), `${label} must be relative`);
	assert(!value.includes('\\') && !value.includes('\0'), `${label} contains unsafe characters`);
	const segments = value.split('/');
	assert(segments.every((segment) => segment && segment !== '.' && segment !== '..'), `${label} is not normalized`);
	return value;
}

// If-Match uses strong comparison, so a weak validator can never satisfy it.
// Cloudflare weakens an ETag whenever it compresses a response, which is why
// every request below asks for identity encoding.
export function strongEntityTag(etag, label) {
	assert(etag, `${label} has no ETag`);
	assert(!etag.startsWith('W/'), `${label} returned the weak validator ${etag}; conditional writes require a strong ETag`);
	return etag;
}

export class R2Client {
	/**
	 * Defaults to the translation release credentials so existing callers are
	 * unchanged. Another workflow with its own bucket and token passes its own
	 * environment prefix rather than borrowing the translation credentials.
	 */
	constructor({
		environmentPrefix = 'R2_TRANSLATIONS',
		defaultBucket = 'soundscaper-translations',
		label = 'translation',
		fetchImpl,
		maximumAttempts = 4,
		requestTimeoutMs = 120_000,
		retryBaseDelayMs = 250,
	} = {}) {
		const accessKeyId = process.env[`${environmentPrefix}_ACCESS_KEY_ID`];
		const secretAccessKey = process.env[`${environmentPrefix}_SECRET_ACCESS_KEY`];
		const endpointValue = process.env[`${environmentPrefix}_ENDPOINT`];
		const bucket = process.env[`${environmentPrefix}_BUCKET`] ?? defaultBucket;
		// Name the variables the process could not see. A generic message sends
		// the reader hunting for a typo that may not exist, when the usual cause
		// is an environment that never reached this process at all.
		const missing = [
			['ACCESS_KEY_ID', accessKeyId],
			['SECRET_ACCESS_KEY', secretAccessKey],
			['ENDPOINT', endpointValue],
		].filter(([, value]) => !value).map(([suffix]) => `${environmentPrefix}_${suffix}`);
		assert(missing.length === 0,
			`R2 ${label} S3 credentials and endpoint are required. Not set in this process: ${missing.join(', ')}. `
			+ 'Node does not read .env on its own; pass --env-file=.env or export the variables in the shell that runs the command.');
		assert(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket), `R2 ${label} bucket name is invalid`);
		const endpoint = new URL(endpointValue);
		assert(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash,
			'R2 endpoint must be a bare HTTPS URL');
		assert(endpoint.pathname === '/' || endpoint.pathname === '', 'R2 endpoint must not contain a path');
		assert(endpoint.hostname.endsWith('.r2.cloudflarestorage.com'), 'R2 endpoint is not a Cloudflare S3 endpoint');
		assert(fetchImpl === undefined || typeof fetchImpl === 'function', 'R2 fetch implementation is invalid');
		assert(Number.isSafeInteger(maximumAttempts) && maximumAttempts >= 1 && maximumAttempts <= 5,
			'R2 maximum attempts must be between one and five');
		assert(Number.isSafeInteger(requestTimeoutMs) && requestTimeoutMs >= 1 && requestTimeoutMs <= 300_000,
			'R2 request timeout is invalid');
		assert(Number.isSafeInteger(retryBaseDelayMs) && retryBaseDelayMs >= 0 && retryBaseDelayMs <= 5_000,
			'R2 retry delay is invalid');
		this.accessKeyId = accessKeyId;
		this.secretAccessKey = secretAccessKey;
		this.sessionToken = process.env[`${environmentPrefix}_SESSION_TOKEN`];
		this.endpoint = endpoint;
		this.bucket = bucket;
		this.fetchImpl = fetchImpl;
		this.maximumAttempts = maximumAttempts;
		this.requestTimeoutMs = requestTimeoutMs;
		this.retryBaseDelayMs = retryBaseDelayMs;
	}

	async request(method, key, {
		body = Buffer.alloc(0),
		headers = {},
		acceptedStatuses = [200],
		query = {},
		signal,
	} = {}) {
		key = safeRelativePath(key, 'R2 object key');
		const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
		const payloadHash = sha256(payload);
		const canonicalUri = `/${rfc3986(this.bucket)}/${key.split('/').map(rfc3986).join('/')}`;
		const queryString = canonicalQuery(query);
		const requestUrl = `${this.endpoint.origin}${canonicalUri}${queryString ? `?${queryString}` : ''}`;
		const bodyAllowed = method !== 'GET' && method !== 'HEAD' && method !== 'DELETE';
		const baseHeaders = Object.fromEntries(Object.entries(headers)
			.filter(([, value]) => value !== undefined && value !== null));
		if (bodyAllowed) baseHeaders['Content-Length'] = String(payload.byteLength);
		if (signal?.aborted) throw signal.reason ?? new Error(`R2 ${method} ${key} aborted`);

		for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
			const now = new Date();
			const dateStamp = now.toISOString().slice(0, 10).replaceAll('-', '');
			const amzDate = `${dateStamp}T${now.toISOString().slice(11, 19).replaceAll(':', '')}Z`;
			const signedHeaders = {
				host: this.endpoint.host,
				'x-amz-content-sha256': payloadHash,
				'x-amz-date': amzDate,
			};
			if (this.sessionToken) signedHeaders['x-amz-security-token'] = this.sessionToken;
			for (const [name, value] of Object.entries(baseHeaders)) {
				signedHeaders[name.toLowerCase()] = normalizeHeader(value);
			}
			const names = Object.keys(signedHeaders).sort();
			const canonicalHeaders = `${names.map((name) => `${name}:${normalizeHeader(signedHeaders[name])}`).join('\n')}\n`;
			const canonicalRequest = [
				method, canonicalUri, queryString, canonicalHeaders, names.join(';'), payloadHash,
			].join('\n');
			const scope = `${dateStamp}/auto/s3/aws4_request`;
			const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
			const dateKey = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
			const regionKey = hmac(dateKey, 'auto');
			const serviceKey = hmac(regionKey, 's3');
			const signingKey = hmac(serviceKey, 'aws4_request');
			const signature = hmac(signingKey, stringToSign, 'hex');
			const requestHeaders = new Headers(baseHeaders);
			requestHeaders.set('Accept-Encoding', 'identity');
			requestHeaders.set('x-amz-content-sha256', payloadHash);
			requestHeaders.set('x-amz-date', amzDate);
			if (this.sessionToken) requestHeaders.set('x-amz-security-token', this.sessionToken);
			requestHeaders.set('Authorization', `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`);
			const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
			const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
			let response;
			try {
				response = await (this.fetchImpl ?? fetch)(requestUrl, {
					method,
					headers: requestHeaders,
					body: bodyAllowed ? payload : undefined,
					signal: requestSignal,
				});
			} catch (error) {
				if (signal?.aborted) throw signal.reason ?? error;
				if (attempt === this.maximumAttempts) {
					fail(`R2 ${method} ${key} failed after ${String(attempt)} attempts: ${errorMessage(error)}`);
				}
				await delay(this.retryBaseDelayMs * (2 ** (attempt - 1)), signal);
				continue;
			}
			if (acceptedStatuses.includes(response.status)) return response;
			if (RETRYABLE_STATUSES.has(response.status) && attempt < this.maximumAttempts) {
				await response.body?.cancel().catch(() => undefined);
				await delay(this.retryBaseDelayMs * (2 ** (attempt - 1)), signal);
				continue;
			}
			const errorBody = (await response.text()).slice(0, 2_000);
			fail(`R2 ${method} ${key} returned HTTP ${response.status}: ${errorBody}`);
		}
		fail(`R2 ${method} ${key} exhausted its retry bound`);
	}

	async get(key, maximum, acceptedStatuses = [200]) {
		const response = await this.request('GET', key, { acceptedStatuses });
		if (response.status !== 200) return { response, bytes: Buffer.alloc(0) };
		const declaredLength = Number(response.headers.get('content-length'));
		if (Number.isFinite(declaredLength)) assert(declaredLength <= maximum, `R2 ${key} exceeds ${maximum} bytes`);
		const bytes = Buffer.from(await response.arrayBuffer());
		assert(bytes.byteLength <= maximum, `R2 ${key} exceeds ${maximum} bytes`);
		return { response, bytes };
	}

	async put(key, bytes, { contentType, cacheControl, ifMatch, ifNoneMatch, signal } = {}) {
		const headers = {
			'Cache-Control': cacheControl,
			'Content-Type': contentType,
		};
		if (ifMatch) headers['If-Match'] = ifMatch;
		if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch;
		return this.request('PUT', key, { body: bytes, headers, acceptedStatuses: [200, 412], signal });
	}

	async head(key, { acceptedStatuses = [200, 404], signal } = {}) {
		return this.request('HEAD', key, { acceptedStatuses, signal });
	}

	async createMultipartUpload(key, { contentType, cacheControl, signal } = {}) {
		const response = await this.request('POST', key, {
			headers: { 'Cache-Control': cacheControl, 'Content-Type': contentType },
			query: { uploads: '' },
			signal,
		});
		const xml = await response.text();
		const uploadId = xmlValue(xml, 'UploadId');
		assert(uploadId.length > 0 && uploadId.length <= 2_048, `R2 multipart upload ID is invalid for ${key}`);
		return Object.freeze({ uploadId });
	}

	async listParts(key, uploadId, { signal } = {}) {
		assert(typeof uploadId === 'string' && uploadId.length > 0, 'R2 multipart upload ID is invalid');
		const parts = [];
		let marker;
		do {
			const response = await this.request('GET', key, {
				query: { 'max-parts': 1_000, 'part-number-marker': marker, uploadId },
				signal,
			});
			const xml = await response.text();
			for (const match of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/gu)) {
				const partNumber = Number(xmlValue(match[1], 'PartNumber'));
				const size = Number(xmlValue(match[1], 'Size'));
				const etag = xmlValue(match[1], 'ETag');
				assert(Number.isSafeInteger(partNumber) && partNumber >= 1
					&& partNumber <= MAXIMUM_MULTIPART_PARTS, `R2 returned an invalid part number for ${key}`);
				assert(Number.isSafeInteger(size) && size >= 0, `R2 returned an invalid part size for ${key}`);
				parts.push(Object.freeze({ partNumber, etag, size }));
			}
			const truncated = xmlValue(xml, 'IsTruncated', false) === 'true';
			marker = truncated ? xmlValue(xml, 'NextPartNumberMarker') : null;
			assert(parts.length <= MAXIMUM_MULTIPART_PARTS, `R2 returned too many parts for ${key}`);
		} while (marker !== null);
		return Object.freeze(parts);
	}

	async uploadPart(key, uploadId, partNumber, bytes, { signal } = {}) {
		assert(Number.isSafeInteger(partNumber) && partNumber >= 1
			&& partNumber <= MAXIMUM_MULTIPART_PARTS, 'R2 multipart part number is invalid');
		const response = await this.request('PUT', key, {
			body: bytes,
			query: { partNumber, uploadId },
			signal,
		});
		return Object.freeze({
			etag: strongEntityTag(response.headers.get('etag'), `R2 multipart part ${String(partNumber)}`),
		});
	}

	async completeMultipartUpload(key, uploadId, parts, { signal } = {}) {
		assert(Array.isArray(parts) && parts.length > 0 && parts.length <= MAXIMUM_MULTIPART_PARTS,
			'R2 multipart completion parts are invalid');
		const body = Buffer.from(`<CompleteMultipartUpload>${parts.map(({ partNumber, etag }) => (
			`<Part><ETag>${xmlEncode(etag)}</ETag><PartNumber>${String(partNumber)}</PartNumber></Part>`
		)).join('')}</CompleteMultipartUpload>`);
		const response = await this.request('POST', key, {
			body,
			headers: { 'Content-Type': 'application/xml' },
			query: { uploadId },
			signal,
		});
		const xml = await response.text();
		assert(!/<Error(?:>|\s)/u.test(xml), `R2 multipart completion failed for ${key}: ${xml.slice(0, 2_000)}`);
		return new Response(xml, { status: response.status, headers: response.headers });
	}

	async abortMultipartUpload(key, uploadId, { signal } = {}) {
		return this.request('DELETE', key, {
			acceptedStatuses: [204, 404], query: { uploadId }, signal,
		});
	}

	async copy(sourceKey, destinationKey, { ifNoneMatch, signal } = {}) {
		sourceKey = safeRelativePath(sourceKey, 'R2 source object key');
		const headers = {
			'x-amz-copy-source': `/${rfc3986(this.bucket)}/${sourceKey.split('/').map(rfc3986).join('/')}`,
		};
		if (ifNoneMatch) headers['cf-copy-destination-if-none-match'] = ifNoneMatch;
		return this.request('PUT', destinationKey, { headers, acceptedStatuses: [200, 412], signal });
	}

	async delete(key, { signal, acceptedStatuses = [204] } = {}) {
		return this.request('DELETE', key, { acceptedStatuses, signal });
	}
}
