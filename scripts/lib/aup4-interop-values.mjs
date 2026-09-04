/* SPDX-License-Identifier: AGPL-3.0-only */

// Shared primitives for the AUP4 interoperability audit: the SQLite engine it
// opens both sides with, the canonical form and digests it compares them by, and
// the gate status file that records whether a native runner was available.
// Split out of audit-aup4-interop.mjs; no behaviour changes here.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';

import initSqlJs from 'sql.js';

export const GATE_STATUS_URL = new URL('../../tests/fixtures/aup4-interop-gate.json', import.meta.url);
export const NATIVE_RUNNER_PROTOCOL_VERSION = 1;

let sqlPromise;

export async function readGateStatus() {
	return JSON.parse(await readFile(GATE_STATUS_URL, 'utf8'));
}

export function assertGateStatus(status) {
	assert.equal(status.schemaVersion, 1);
	assert.match(status.audacityCommit, /^[0-9a-f]{40}$/);
	assert.equal(status.fixtureCodecInterop.status, 'automated');
	assert.equal(status.fixtureCodecInterop.fixtureCreatedByPinnedAudacity, true);
	assert.equal(status.fixtureCodecInterop.compiledNativeCodeExecuted, false);
	assert.deepEqual(status.fixtureCodecInterop.pipeline, [
		'verify-audacity-created-fixture',
		'browser-decode',
		'browser-write',
		'browser-reopen',
	]);
	assert.equal(status.compiledNativeLoaderInterop.requiredForV2Release, true);
	assert.equal(status.compiledNativeLoaderInterop.status, 'pending');
	assert.equal(status.compiledNativeLoaderInterop.compiledNativeCodeExecuted, false);
	assert.equal(status.compiledNativeLoaderInterop.availableEvidence, null);
	assert.equal(status.compiledNativeLoaderInterop.runnerProtocol.version, NATIVE_RUNNER_PROTOCOL_VERSION);
}

export function loadSqlJs() {
	if (!sqlPromise) sqlPromise = initSqlJs();
	return sqlPromise;
}


export function canonicalize(value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== 'object') {
		return typeof value === 'number' && Number.isFinite(value)
			? Number(value.toFixed(12))
			: value;
	}
	return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function stableStringify(value) {
	return JSON.stringify(canonicalize(value));
}

export function sqlScalar(database, sql) {
	const result = database.exec(sql);
	return result[0]?.values?.[0]?.[0];
}

export function channelHash(channel) {
	return sha256(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
}

export function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

export async function sha256File(path) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest('hex');
}

