/* SPDX-License-Identifier: AGPL-3.0-only */

// The constants the upstream Audacity artifact is verified against, and the
// bounded, assertion-first primitives discovery reads and writes through:
// option parsing, size-capped network reads, atomic writes.

import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const AUDACITY = Object.freeze({
	repository: 'audacity/audacity',
	repositoryId: 32921736,
	workflowPath: '.github/workflows/translate_tx_pull_to_s3.yml',
	branch: 'master',
});

export const API_VERSION = '2026-03-10';

export const MAX_API_BYTES = 4 * 1024 * 1024;

export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;

export const MAX_LICENSE_BYTES = 2 * 1024 * 1024;

export const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const ARTIFACT_NAME_PATTERN = /^Audacity_locale_[0-9]+$/;

export function fail(message) {
	throw new Error(message);
}

export function assert(condition, message) {
	if (!condition) fail(message);
}

export function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype;
}

export function parseArgs(argv) {
	const [command, ...rest] = argv;
	const options = {};
	for (let index = 0; index < rest.length; index += 2) {
		const flag = rest[index];
		assert(flag?.startsWith('--'), `Unexpected argument: ${flag ?? '<missing>'}`);
		const value = rest[index + 1];
		assert(value !== undefined && !value.startsWith('--'), `Missing value for ${flag}`);
		const key = flag.slice(2);
		assert(!(key in options), `Duplicate option: ${flag}`);
		options[key] = value;
	}
	return { command, options };
}

export function requiredOption(options, name) {
	const value = options[name];
	assert(typeof value === 'string' && value.length > 0, `Missing --${name}`);
	return value;
}

export function rejectUnknownOptions(options, allowed) {
	for (const name of Object.keys(options)) {
		assert(allowed.includes(name), `Unknown option: --${name}`);
	}
}

export function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

export function parseJson(bytes, label) {
	try {
		return JSON.parse(Buffer.from(bytes).toString('utf8'));
	} catch (error) {
		fail(`${label} is not valid JSON: ${error.message}`);
	}
}

export async function ensureEmptyDirectory(path) {
	await mkdir(path, { recursive: true });
	const entries = await readdir(path);
	assert(entries.length === 0, `Output directory is not empty: ${path}`);
}

export async function writeAtomic(path, bytes) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(temporary, bytes, { flag: 'wx' });
	try {
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

export async function fetchLimited(url, {
	maximum,
	label,
	headers = {},
	acceptedStatuses = [200],
	timeout = 30_000,
} = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		let response;
		try {
			response = await fetch(url, {
				headers,
				redirect: 'follow',
				signal: controller.signal,
			});
		} catch (error) {
			fail(`${label} request failed: ${error.message}`);
		}
		assert(acceptedStatuses.includes(response.status), `${label} returned HTTP ${response.status}`);
		const declaredLength = Number(response.headers.get('content-length'));
		if (Number.isFinite(declaredLength)) {
			assert(declaredLength <= maximum, `${label} declares more than ${maximum} bytes`);
		}
		const chunks = [];
		let byteLength = 0;
		if (response.body) {
			for await (const chunk of response.body) {
				byteLength += chunk.byteLength;
				assert(byteLength <= maximum, `${label} exceeds ${maximum} bytes`);
				chunks.push(Buffer.from(chunk));
			}
		}
		return { response, bytes: Buffer.concat(chunks, byteLength) };
	} finally {
		clearTimeout(timer);
	}
}

export async function fetchJson(url, options) {
	const result = await fetchLimited(url, options);
	return { ...result, json: parseJson(result.bytes, options.label) };
}

export function githubHeaders() {
	const headers = {
		Accept: 'application/vnd.github+json',
		'User-Agent': 'Soundscaper-translation-sync',
		'X-GitHub-Api-Version': API_VERSION,
	};
	const token = process.env.GITHUB_TOKEN;
	if (token) {
		assert(!/[\r\n]/u.test(token), 'GITHUB_TOKEN contains unsafe characters');
		headers.Authorization = `Bearer ${token}`;
	}
	return headers;
}
