/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	HelperContractViolationError,
	normalizeHelperResourcePolicy,
	validateHelperHostMessage,
	validateHelperJobResult,
} from '../desktop/helper-contract.ts';
import { createNativeMediaOutputTreeIdentity } from '../desktop/native-media-output-tree.ts';

const JOB_ID = 'ab'.repeat(20);
const PLAN_SHA256 = '12'.repeat(32);
const SOURCE_SHA256 = '34'.repeat(32);
const treeIdentity = createNativeMediaOutputTreeIdentity({
	jobId: JOB_ID, planFingerprint: PLAN_SHA256, rootGrantId: 'de'.repeat(20),
	relativeDestination: 'renders/alpha-frames',
	sources: [{ sourceId: 'source-1', contentSha256: SOURCE_SHA256 }],
	profileId: 'encode-png-sequence', frameCount: 1,
});
const output = Object.freeze({
	kind: 'directory', rootPath: '/exports', rootIdentity: { dev: 4, ino: 20 },
	temporaryPath: '/exports/renders/.alpha-frames.partial',
	finalPath: '/exports/renders/alpha-frames', maximumBytes: 4_096, treeIdentity,
});
const grant = Object.freeze({
	executable: Object.freeze({ role: 'ffmpeg', path: '/runtime/ffmpeg', bytes: 32_768,
		sha256: '56'.repeat(32), identity: { dev: 4, ino: 18 } }),
	backend: 'native-cpu',
	plan: Object.freeze({ dataPlaneVersion: 1, transport: 'message-port',
		streamId: 'cd'.repeat(20), direction: 'host-to-helper', byteLength: 4,
		sha256: PLAN_SHA256, maximumChunkBytes: 4, maximumInFlightChunks: 1 }),
	sources: Object.freeze([Object.freeze({ type: 'file', role: 'original',
		path: '/media/source.mov', bytes: 8, sha256: SOURCE_SHA256,
		identity: { dev: 4, ino: 19 } })]),
	output,
	scratch: Object.freeze({ rootPath: '/scratch', rootIdentity: { dev: 4, ino: 21 },
		reservationId: JOB_ID, maximumBytes: 8_192 }),
});

test('image-sequence encode grants and results bind one authenticated output tree identity', () => {
	const admitted = validateHelperHostMessage({
		contractVersion: 1, type: 'job', jobId: JOB_ID, kind: 'media-render', jobContractVersion: 1,
		grant, resourcePolicy: normalizeHelperResourcePolicy(undefined, 'media-render'),
	});
	assert.equal(admitted.type, 'job');
	const result = Object.freeze({ output: Object.freeze({
		kind: 'directory', temporaryPath: output.temporaryPath, byteLength: 200,
		sha256: '9'.repeat(64), identity: { dev: 4, ino: 88 },
		tree: Object.freeze({ identity: treeIdentity, fileCount: 2,
			manifestByteLength: 100, manifestSha256: '9'.repeat(64) }),
	}) });
	assert.deepEqual(validateHelperJobResult('media-render', result, grant), result);
});

test('output-tree grants refuse path, kind, job, plan, source, and destination drift', () => {
	for (const candidate of [
		{ ...output, temporaryPath: output.finalPath },
		{ ...output, kind: 'file' },
		{ ...output, treeIdentity: { ...treeIdentity, jobId: 'ff'.repeat(20) } },
		{ ...output, treeIdentity: { ...treeIdentity, planFingerprint: '8'.repeat(64) } },
		{ ...output, treeIdentity: { ...treeIdentity, relativeDestination: '../escape' } },
	]) {
		assert.throws(() => validateHelperHostMessage({
			contractVersion: 1, type: 'job', jobId: JOB_ID, kind: 'media-render', jobContractVersion: 1,
			grant: { ...grant, output: candidate },
			resourcePolicy: normalizeHelperResourcePolicy(undefined, 'media-render'),
		}), HelperContractViolationError);
	}
});

test('output-tree results refuse path, manifest, identity, count, and aggregate drift', () => {
	const valid = Object.freeze({
		kind: 'directory', temporaryPath: output.temporaryPath, byteLength: 200,
		sha256: '9'.repeat(64), identity: { dev: 4, ino: 88 },
		tree: Object.freeze({ identity: treeIdentity, fileCount: 2,
			manifestByteLength: 100, manifestSha256: '9'.repeat(64) }),
	});
	for (const candidate of [
		{ ...valid, temporaryPath: output.finalPath },
		{ ...valid, byteLength: output.maximumBytes + 1 },
		{ ...valid, tree: { ...valid.tree, manifestSha256: '8'.repeat(64) } },
		{ ...valid, tree: { ...valid.tree,
			identity: { ...treeIdentity, planFingerprint: '8'.repeat(64) } } },
		{ ...valid, tree: { ...valid.tree, fileCount: 3 } },
	]) {
		assert.throws(() => validateHelperJobResult('media-render', { output: candidate }, grant),
			HelperContractViolationError);
	}
});
