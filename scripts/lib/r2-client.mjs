/* SPDX-License-Identifier: AGPL-3.0-only */

// Signed Cloudflare R2 (S3) object access for the Audacity translation release
// workflow. Kept apart from the publication commands so the transport rules —
// SigV4 signing, identity transfer encoding, and strong ETag validators — stay
// reviewable on their own.

import { createHash, createHmac } from 'node:crypto';

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
	constructor() {
		const accessKeyId = process.env.R2_TRANSLATIONS_ACCESS_KEY_ID;
		const secretAccessKey = process.env.R2_TRANSLATIONS_SECRET_ACCESS_KEY;
		const endpointValue = process.env.R2_TRANSLATIONS_ENDPOINT;
		const bucket = process.env.R2_TRANSLATIONS_BUCKET ?? 'soundscaper-translations';
		assert(accessKeyId && secretAccessKey && endpointValue, 'R2 translation S3 credentials and endpoint are required');
		assert(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket), 'R2 translation bucket name is invalid');
		const endpoint = new URL(endpointValue);
		assert(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash,
			'R2 endpoint must be a bare HTTPS URL');
		assert(endpoint.pathname === '/' || endpoint.pathname === '', 'R2 endpoint must not contain a path');
		assert(endpoint.hostname.endsWith('.r2.cloudflarestorage.com'), 'R2 endpoint is not a Cloudflare S3 endpoint');
		this.accessKeyId = accessKeyId;
		this.secretAccessKey = secretAccessKey;
		this.sessionToken = process.env.R2_TRANSLATIONS_SESSION_TOKEN;
		this.endpoint = endpoint;
		this.bucket = bucket;
	}

	async request(method, key, { body = Buffer.alloc(0), headers = {}, acceptedStatuses = [200] } = {}) {
		key = safeRelativePath(key, 'R2 object key');
		const now = new Date();
		const dateStamp = now.toISOString().slice(0, 10).replaceAll('-', '');
		const amzDate = `${dateStamp}T${now.toISOString().slice(11, 19).replaceAll(':', '')}Z`;
		const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
		const payloadHash = sha256(payload);
		const canonicalUri = `/${rfc3986(this.bucket)}/${key.split('/').map(rfc3986).join('/')}`;
		const signedHeaders = {
			host: this.endpoint.host,
			'x-amz-content-sha256': payloadHash,
			'x-amz-date': amzDate,
		};
		if (this.sessionToken) signedHeaders['x-amz-security-token'] = this.sessionToken;
		for (const [name, value] of Object.entries(headers)) signedHeaders[name.toLowerCase()] = normalizeHeader(value);
		const names = Object.keys(signedHeaders).sort();
		const canonicalHeaders = `${names.map((name) => `${name}:${normalizeHeader(signedHeaders[name])}`).join('\n')}\n`;
		const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, names.join(';'), payloadHash].join('\n');
		const scope = `${dateStamp}/auto/s3/aws4_request`;
		const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
		const dateKey = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
		const regionKey = hmac(dateKey, 'auto');
		const serviceKey = hmac(regionKey, 's3');
		const signingKey = hmac(serviceKey, 'aws4_request');
		const signature = hmac(signingKey, stringToSign, 'hex');
		const requestHeaders = new Headers(headers);
		requestHeaders.set('Accept-Encoding', 'identity');
		requestHeaders.set('x-amz-content-sha256', payloadHash);
		requestHeaders.set('x-amz-date', amzDate);
		if (this.sessionToken) requestHeaders.set('x-amz-security-token', this.sessionToken);
		requestHeaders.set('Authorization', `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 120_000);
		let response;
		try {
				response = await fetch(`${this.endpoint.origin}${canonicalUri}`, {
					method,
					headers: requestHeaders,
					body: method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : payload,
					signal: controller.signal,
				});
		} catch (error) {
			fail(`R2 ${method} ${key} failed: ${error.message}`);
		} finally {
			clearTimeout(timer);
		}
		if (!acceptedStatuses.includes(response.status)) {
			const errorBody = (await response.text()).slice(0, 2_000);
			fail(`R2 ${method} ${key} returned HTTP ${response.status}: ${errorBody}`);
		}
		return response;
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

	async put(key, bytes, { contentType, cacheControl, ifMatch, ifNoneMatch } = {}) {
		const headers = {
			'Cache-Control': cacheControl,
			'Content-Type': contentType,
		};
		if (ifMatch) headers['If-Match'] = ifMatch;
		if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch;
		return this.request('PUT', key, { body: bytes, headers, acceptedStatuses: [200, 412] });
	}

	async delete(key) {
		return this.request('DELETE', key, { acceptedStatuses: [204] });
	}
}
