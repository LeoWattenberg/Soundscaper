/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	createSoundscaperDeliveryFilesystemProcessAuthority,
} from '../desktop/soundscaper-delivery-filesystem-process.ts';

const REPOSITORY = resolve(import.meta.dirname, '..');
const SOURCE = join(REPOSITORY, 'native/soundscaper-professional-host/src');

test('the main-only SDF1 adapter drives the real Linux target-native helper', {
	skip: process.platform !== 'linux', timeout: 30_000,
}, async () => {
	const temporary = await mkdtemp(join(tmpdir(), 'soundscaper-delivery-fs-adapter-'));
	try {
		const executable = join(temporary, 'soundscaper_delivery_fs');
		const compilation = spawnSync('g++', [
			'-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror', '-pthread',
			join(SOURCE, 'delivery_fs_main.cpp'), join(SOURCE, 'delivery_fs_protocol.cpp'),
			join(SOURCE, 'delivery_fs_sha256.cpp'), join(SOURCE, 'delivery_fs_linux.cpp'),
			'-o', executable,
		], { cwd: REPOSITORY, encoding: 'utf8' });
		assert.equal(compilation.status, 0, compilation.stderr || compilation.stdout);
		const outputRoot = await mkdtemp(join(temporary, 'output-'));
		const details = await stat(outputRoot, { bigint: true });
		const volumeIdentity = `device:${details.dev.toString(16)}`;
		let writeHelperPid: number | undefined;
		const authority = createSoundscaperDeliveryFilesystemProcessAuthority({
			executablePath: executable,
			spawnProcess: ((command: string, args: readonly string[], options: unknown) => {
				const child = spawn(command, args, options as never);
				if (args.length === 0) writeHelperPid = child.pid;
				return child;
			}) as never,
		});
		const session = await authority.open({
			root: Object.freeze({
				grantId: '10'.repeat(24), rootPath: outputRoot, volumeIdentity,
				directoryIdentity: `${volumeIdentity}:inode:${details.ino.toString(16)}`,
				authorizedAtMs: 1, revokedAtMs: null,
			}),
			reference: '20'.repeat(24), finalName: 'adapter.wav', maximumBytes: 64,
			finalPrefixByteLength: 32, fence: () => undefined,
		});
		const original = new Uint8Array(64).fill(3);
		const prefix = new Uint8Array(32).fill(7);
		assert.equal(await session.write(0, original), original.byteLength);
		assert.equal(await session.patch(0, prefix), prefix.byteLength);
		const finalBytes = Buffer.concat([Buffer.from(prefix), Buffer.from(original.subarray(32))]);
		const sealed = await session.seal(finalBytes.byteLength);
		assert.equal(sealed.sha256, createHash('sha256').update(finalBytes).digest('hex'));
		const published = await session.publish('adapter.wav', '30'.repeat(24));
		assert.deepEqual(published, sealed);
		assert.deepEqual(await readFile(join(outputRoot, 'adapter.wav')), finalBytes);
		assert.deepEqual(await authority.inspectFinal(
			{
				grantId: '10'.repeat(24), rootPath: outputRoot, volumeIdentity,
				directoryIdentity: `${volumeIdentity}:inode:${details.ino.toString(16)}`,
				authorizedAtMs: 1, revokedAtMs: null,
			},
			'adapter.wav', () => undefined,
		), sealed);

		const tampered = await authority.open({
			root: Object.freeze({
				grantId: '10'.repeat(24), rootPath: outputRoot, volumeIdentity,
				directoryIdentity: `${volumeIdentity}:inode:${details.ino.toString(16)}`,
				authorizedAtMs: 1, revokedAtMs: null,
			}),
			reference: '40'.repeat(24), finalName: 'tampered.wav', maximumBytes: 4,
			finalPrefixByteLength: 0, fence: () => undefined,
		});
		await tampered.write(0, new Uint8Array([1, 2, 3, 4]));
		const tamperedSeal = await tampered.seal(4);
		assert.ok(writeHelperPid, 'the production helper pid is available on this Linux host');
		const descriptor = await descriptorForIdentity(writeHelperPid!, tamperedSeal);
		const attacker = await open(descriptor, 'r+');
		try { await attacker.write(new Uint8Array([9]), 0, 1, 0); }
		finally { await attacker.close(); }
		await assert.rejects(
			tampered.publish('tampered.wav', '50'.repeat(24)),
			/sealed delivery bytes changed|content|authentication/iu,
		);
		await tampered.abandon();
		await assert.rejects(readFile(join(outputRoot, 'tampered.wav')), /ENOENT/u);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

async function descriptorForIdentity(
	processId: number,
	expected: Readonly<{ volumeIdentity: string; fileIdentity: string }>,
): Promise<string> {
	const root = `/proc/${String(processId)}/fd`;
	for (const name of await readdir(root)) {
		const candidate = join(root, name);
		const details = await stat(candidate, { bigint: true }).catch(() => null);
		if (details && expected.volumeIdentity === `device:${details.dev.toString(16)}`
			&& expected.fileIdentity === `inode:${details.ino.toString(16)}`) return candidate;
	}
	throw new Error('The retained native staging descriptor could not be located for the tamper probe.');
}
