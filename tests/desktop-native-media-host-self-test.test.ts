/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { FramescaperMediaHostDescriptor } from '../desktop/framescaper-media-host-payload.ts';
import {
	runFramescaperMediaHostSelfTest,
} from '../desktop/native-media-host-self-test.ts';

test('a hung authenticated media-host self-test is killed within its exact timeout', {
	skip: process.platform === 'win32' ? 'Executable script fixture is POSIX-only.' : false,
}, async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-media-self-test-timeout-'));
	const path = join(root, 'hung-media-host');
	try {
		const bytes = Buffer.from('#!/bin/sh\nexec sleep 60\n');
		await writeFile(path, bytes);
		await chmod(path, 0o700);
		const identity = await stat(path);
		const descriptor: FramescaperMediaHostDescriptor = Object.freeze({
			target: 'linux-x64', runtime: 'linux-x64', path,
			byteLength: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			hostVersion: '1.0.0', ffmpegVersion: '9.0.1',
			identity: Object.freeze({ dev: identity.dev, ino: identity.ino }),
		});
		const startedAt = Date.now();
		await assert.rejects(
			runFramescaperMediaHostSelfTest(descriptor, { timeoutMs: 25 }),
			/self-test timed out/u,
		);
		assert.ok(Date.now() - startedAt < 2_000, 'timeout must not wait for the child process');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
