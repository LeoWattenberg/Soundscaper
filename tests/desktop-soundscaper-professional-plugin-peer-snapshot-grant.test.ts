/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import type { NativeChildIsolationArtifactDescriptor } from '../desktop/native-child-isolation-launcher.ts';
import {
	createSoundscaperProfessionalPluginPeer,
	type ProfessionalPluginPeerLauncher,
} from '../desktop/soundscaper-professional-plugin-peer.ts';

test('the professional peer grants its immutable snapshot directory for DLL path traversal', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-peer-snapshot-grant-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const candidatePath = join(root, 'fixture.clap');
	await writeFile(candidatePath, 'authenticated fixture');
	const [candidate, metadata] = await Promise.all([
		descriptor(candidatePath), stat(candidatePath),
	]);
	let request: Parameters<ProfessionalPluginPeerLauncher['launch']>[0] | undefined;
	const plugin = createSoundscaperProfessionalPluginPeer({
		launcher: {
			launch: async (value) => {
				request = value;
				throw new Error('captured snapshot launch');
			},
		},
		peerExecutable: candidate,
		runtimeReadExecute: [],
		pluginFormats: ['clap'],
	});
	await assert.rejects(plugin.inspectPluginCandidate(candidatePath, 'clap', Object.freeze({
		identity: Object.freeze({ dev: Number(metadata.dev), ino: Number(metadata.ino) }),
		byteLength: candidate.byteLength,
		sha256: candidate.sha256,
		resourcePolicy: Object.freeze({
			maximumInputBytes: candidate.byteLength,
			maximumJobDurationMs: 5_000,
			maximumRssBytes: 128 * 1024 ** 2,
			allowNetwork: false,
			allowChildProcesses: false,
			allowOutputFiles: false,
		}),
	})), /captured snapshot launch/u);
	assert.ok(request);
	assert.equal(request.readExecute.length, 2);
	const fileGrant = request.readExecute.find(({ kind }) => kind === 'file');
	const directoryGrant = request.readExecute.find(({ kind }) => kind === 'directory');
	assert.ok(fileGrant);
	assert.ok(directoryGrant);
	assert.equal(directoryGrant.path, dirname(fileGrant.path));
});

async function descriptor(path: string): Promise<NativeChildIsolationArtifactDescriptor> {
	const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
	return Object.freeze({
		path: await realpath(path), byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		identity: Object.freeze({ dev: Number(metadata.dev), ino: Number(metadata.ino) }),
	});
}
