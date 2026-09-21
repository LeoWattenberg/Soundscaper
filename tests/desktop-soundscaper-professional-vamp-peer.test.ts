/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { NativeChildIsolationArtifactDescriptor } from '../desktop/native-child-isolation-launcher.ts';
import {
	VAMP_PEER_CHILD_CRASH_CODE,
	createSoundscaperProfessionalVampPeer,
	type ProfessionalVampPeerLauncher,
} from '../desktop/soundscaper-professional-vamp-peer.ts';

test('the Vamp peer snapshots one exact library and launches M5A1 on the authenticated peer artifact', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-vamp-peer-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const libraryPath = join(root, 'fixture.so');
	await writeFile(libraryPath, 'authenticated Vamp fixture');
	const [library, metadata] = await Promise.all([descriptor(libraryPath), stat(libraryPath)]);
	type LaunchRequest = Parameters<ProfessionalVampPeerLauncher['launch']>[0];
	let launchRequest: LaunchRequest | null = null;
	const peer = createSoundscaperProfessionalVampPeer({
		launcher: { launch: async (request) => {
			launchRequest = request;
			throw new Error('captured Vamp launch');
		} },
		peerExecutable: library,
		runtimeReadExecute: [],
	});
	await assert.rejects(peer.scanExactLibrary(libraryPath, 48_000, Object.freeze({
		identity: Object.freeze({ dev: Number(metadata.dev), ino: Number(metadata.ino) }),
		byteLength: library.byteLength,
		sha256: library.sha256,
		resourcePolicy: Object.freeze({
			maximumInputBytes: library.byteLength,
			maximumJobDurationMs: 5_000,
			maximumRssBytes: 128 * 1_024 ** 2,
			allowNetwork: false,
			allowChildProcesses: false,
			allowOutputFiles: false,
		}),
	})), /captured Vamp launch/u);
	assert.ok(launchRequest);
	const captured = launchRequest as unknown as LaunchRequest;
	assert.deepEqual(captured.framedControl, {
		protocolFamily: 'M5A', protocolVersion: 1,
		maximumMessageBytes: 16 * 1_024 ** 2, maximumInFlightMessages: 1,
	});
	assert.deepEqual(captured.arguments, ['--vamp-analyzer']);
	assert.equal(captured.readExecute.length, 1);
	assert.equal(captured.readExecute[0].kind, 'file');
	assert.notEqual(captured.readExecute[0].path, libraryPath,
		'the isolated child receives immutable snapshot custody, not the mutable source');
	assert.equal(JSON.stringify(captured).includes('VAMP_PATH'), false);
});

test('the Vamp peer admits only exact Vamp analyzer operations', async () => {
	assert.equal(VAMP_PEER_CHILD_CRASH_CODE, 'vamp-peer-crash');
	const peer = createSoundscaperProfessionalVampPeer({
		launcher: { launch: async () => { throw new Error('must not launch'); } },
		peerExecutable: Object.freeze({
			path: '/peer', byteLength: 1, sha256: 'a'.repeat(64),
			identity: Object.freeze({ dev: 1, ino: 1 }),
		}),
		runtimeReadExecute: [],
	});
	await assert.rejects(peer.inspectPluginCandidate('/tmp/example.so', 'vst3' as never, {} as never),
		/Vamp format/iu);
	await assert.rejects(peer.scanExactLibrary('/tmp/example.so', 44_100.5, {} as never),
		/sample rate/iu);
});

test('the Vamp candidate lister excludes suffix-matching bundle directories', async (context) => {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'soundscaper-vamp-candidates-')));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'effect-bundle.so'));
	await writeFile(join(root, 'analyzer.so'), 'Vamp library fixture');
	const peer = createSoundscaperProfessionalVampPeer({
		launcher: { launch: async () => { throw new Error('must not launch'); } },
		peerExecutable: Object.freeze({
			path: '/peer', byteLength: 1, sha256: 'a'.repeat(64),
			identity: Object.freeze({ dev: 1, ino: 1 }),
		}),
		runtimeReadExecute: [],
	});
	assert.deepEqual(await peer.listPluginCandidates(root, '.so'), [join(root, 'analyzer.so')]);
});

async function descriptor(path: string): Promise<NativeChildIsolationArtifactDescriptor> {
	const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
	return Object.freeze({
		path: await realpath(path), byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		identity: Object.freeze({ dev: Number(metadata.dev), ino: Number(metadata.ino) }),
	});
}
