/* SPDX-License-Identifier: AGPL-3.0-only */

import { NYQUIST_ARCHIVE_ID } from './archive-store.js';

export const NYQUIST_ARCHIVE_BASE_URL = 'https://assets.soundscaper.org/plugins/nyquist/audacityteam.org/ed168a19631ec48d0029dfb5c17d16c339a174c1/';
const MANIFEST_SHA256 = '9b646177cfe178c2d0a03cdda53ae0bbdb7b82f91a1c7594fb7d779e8c45e655';
const MANIFEST_BYTES = 138_341;
const MAX_ARCHIVE_FILE_BYTES = 512 * 1024;

async function digest(bytes) {
	const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function boundedResponseBytes(response, maximum) {
	if (!response.ok) throw new Error(`Unable to download Nyquist archive: HTTP ${response.status}`);
	const length = Number(response.headers.get('content-length'));
	if (length > maximum) throw new RangeError('Nyquist archive download is too large.');
	const reader = response.body?.getReader();
	if (!reader) throw new Error('Nyquist archive download has no body.');
	const chunks = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maximum) throw new RangeError('Nyquist archive download is too large.');
			chunks.push(value);
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		throw error;
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function validateArtifact(artifact) {
	if (!artifact || typeof artifact.fileName !== 'string'
		|| !/^[A-Za-z0-9][A-Za-z0-9._-]*\.ny$/u.test(artifact.fileName)
		|| artifact.publicUrl !== `${NYQUIST_ARCHIVE_BASE_URL}files/${artifact.fileName}`
		|| !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 1
		|| artifact.byteLength > MAX_ARCHIVE_FILE_BYTES
		|| !/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
		throw new Error('Invalid Nyquist archive URL or artifact metadata.');
	}
	return artifact;
}

export async function parseNyquistArchiveManifest(bytes, expectedSha256 = MANIFEST_SHA256) {
	if (bytes.byteLength > 256 * 1024 || await digest(bytes) !== expectedSha256) {
		throw new Error('Nyquist archive manifest digest mismatch.');
	}
	const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	if (manifest.schemaVersion !== 1 || manifest.archiveId !== NYQUIST_ARCHIVE_ID
		|| !Array.isArray(manifest.artifacts)) {
		throw new Error('Invalid Nyquist archive manifest.');
	}
	const seen = new Set();
	for (const artifact of manifest.artifacts) {
		validateArtifact(artifact);
		if (seen.has(artifact.fileName)) throw new Error('Duplicate Nyquist archive file name.');
		seen.add(artifact.fileName);
	}
	return manifest;
}

export async function fetchNyquistArchiveManifest({ fetchImpl = globalThis.fetch, signal } = {}) {
	const response = await fetchImpl(`${NYQUIST_ARCHIVE_BASE_URL}manifest.json`, { signal });
	const bytes = await boundedResponseBytes(response, MANIFEST_BYTES);
	if (bytes.byteLength !== MANIFEST_BYTES) throw new Error('Nyquist archive manifest length mismatch.');
	return parseNyquistArchiveManifest(bytes);
}

export async function installNyquistArchivePlugin(store, artifact, { fetchImpl = globalThis.fetch, signal } = {}) {
	validateArtifact(artifact);
	const response = await fetchImpl(artifact.publicUrl, { signal });
	const bytes = await boundedResponseBytes(response, artifact.byteLength);
	if (bytes.byteLength !== artifact.byteLength || await digest(bytes) !== artifact.sha256) {
		throw new Error('Nyquist archive plug-in length or digest mismatch.');
	}
	const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	return store.install({
		id: `nyquist:archive:${artifact.fileName}`,
		fileName: artifact.fileName,
		archiveId: NYQUIST_ARCHIVE_ID,
		source,
	});
}
