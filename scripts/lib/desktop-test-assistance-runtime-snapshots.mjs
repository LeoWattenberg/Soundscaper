/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reuse a pinned runtime handoff in diagnostic packages without compiling engines. */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

export const DESKTOP_TEST_RUNTIME_TARGETS = Object.freeze([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);

const CONFIG_FILES = Object.freeze([
	'assistance-runtime-distribution.json',
	'assistance-native-runtime-manifest.json',
	'assistance-runtime-family-supply-candidates.json',
	'assistance-kokoro-g2p-runtime-manifest.json',
]);
const FILES = Object.freeze(['handoff.json', ...CONFIG_FILES.map((name) => `config/${name}`)]);
const REVISION = /^[a-f\d]{40}(?:[a-f\d]{24})?$/u;
const SHA256 = /^[a-f\d]{64}$/u;
const MAXIMUM_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const MAXIMUM_EXPANDED_BYTES = 12 * 1024 * 1024;

function assertTarget(targetId) {
	if (!DESKTOP_TEST_RUNTIME_TARGETS.includes(targetId)) {
		throw new TypeError(`Unknown desktop test runtime target: ${String(targetId)}`);
	}
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function regularBytes(path) {
	const info = await lstat(path);
	if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) {
		throw new Error(`Desktop test runtime handoff file is not a bounded regular file: ${path}`);
	}
	return readFile(path);
}

function readIdentity(files, targetId) {
	let handoff, distribution;
	try {
		handoff = JSON.parse(files['handoff.json']);
		distribution = JSON.parse(files['config/assistance-runtime-distribution.json']);
	} catch (error) {
		throw new Error('Desktop test runtime snapshot contains invalid JSON.', { cause: error });
	}
	if (handoff?.schemaVersion !== 1 || handoff.targetId !== targetId
		|| !REVISION.test(handoff.sourceRevision ?? '')
		|| distribution?.schemaVersion !== 1 || distribution.targetId !== targetId
		|| !Array.isArray(distribution.bundles) || distribution.bundles.length !== 5) {
		throw new Error('Desktop test runtime snapshot has the wrong target or handoff identity.');
	}
	return handoff.sourceRevision;
}

export async function createDesktopTestRuntimeSnapshot({ handoffRoot, targetId }) {
	assertTarget(targetId);
	const files = {};
	for (const file of FILES) files[file] = (await regularBytes(join(handoffRoot, file))).toString('utf8');
	const sourceRevision = readIdentity(files, targetId);
	return gzipSync(Buffer.from(JSON.stringify({ schemaVersion: 1, targetId, sourceRevision, files })), {
		level: 9, mtime: 0,
	});
}

export async function stageDesktopTestRuntimeSnapshot({ targetId, snapshotRoot, outputRoot, lock }) {
	assertTarget(targetId);
	const record = lock?.schemaVersion === 1 ? lock.targets?.[targetId] : null;
	if (!record || !REVISION.test(record.sourceRevision ?? '')
		|| !Number.isSafeInteger(record.byteLength) || record.byteLength < 1
		|| record.byteLength > MAXIMUM_SNAPSHOT_BYTES || !SHA256.test(record.sha256 ?? '')) {
		throw new Error(`Desktop test runtime snapshot has no pinned ${targetId} target.`);
	}
	const compressed = await regularBytes(join(snapshotRoot, `${targetId}.json.gz`));
	if (compressed.byteLength !== record.byteLength || digest(compressed) !== record.sha256) {
		throw new Error(`Desktop test runtime snapshot digest differs for ${targetId}.`);
	}
	let snapshot;
	try {
		snapshot = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAXIMUM_EXPANDED_BYTES }).toString('utf8'));
	} catch (error) {
		throw new Error(`Desktop test runtime snapshot cannot be decoded for ${targetId}.`, { cause: error });
	}
	if (snapshot?.schemaVersion !== 1 || snapshot.targetId !== targetId
		|| snapshot.sourceRevision !== record.sourceRevision
		|| !snapshot.files || Object.keys(snapshot.files).sort().join('\n') !== [...FILES].sort().join('\n')
		|| !FILES.every((file) => typeof snapshot.files[file] === 'string')
		|| readIdentity(snapshot.files, targetId) !== record.sourceRevision) {
		throw new Error(`Desktop test runtime snapshot contents differ for ${targetId}.`);
	}
	await rm(outputRoot, { recursive: true, force: true });
	await mkdir(join(outputRoot, 'config'), { recursive: true });
	for (const file of FILES) await writeFile(join(outputRoot, file), snapshot.files[file], { flag: 'wx' });
	return { targetId, sourceRevision: record.sourceRevision };
}
