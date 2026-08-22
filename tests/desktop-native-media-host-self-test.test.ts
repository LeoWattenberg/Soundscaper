/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { FramescaperMediaHostDescriptor } from '../desktop/framescaper-media-host-payload.ts';
import {
	assertFramescaperMediaHostSelectedV20RenderSelfTest,
	runFramescaperMediaHostSelfTest,
	runFramescaperMediaHostSelectedV20RenderSelfTest,
} from '../desktop/native-media-host-self-test.ts';

const READY_OPERATION_RECORD = Object.freeze({
	contractVersion: 1, operation: 'media-render', profile: 'selected-v20-v7-v8',
	planVersions: [7, 8] as const, exactPictureOrdinals: true,
	keyedEvaluatedRgbaExecutor: true, staticCompositionExecutor: true,
	maximumInFlightFrames: 1, evaluatedRgbaInputBound: true,
	staticGeometryAdapterBound: true, captionDeliveryAdapterBound: true,
	stagedAudioInputBound: true,
	deliveryCodecSetAvailable: true, frameCoreReady: true, ready: true,
});
const READY_OPERATION = JSON.stringify(READY_OPERATION_RECORD);
const UNREADY_OPERATION = JSON.stringify({
	...READY_OPERATION_RECORD, captionDeliveryAdapterBound: false, ready: false,
});

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

test('the selected-V20 operation self-test authenticates and accepts only status-consistent evidence', {
	skip: process.platform === 'win32' ? 'Executable script fixture is POSIX-only.' : false,
}, async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-selected-v20-self-test-'));
	try {
		const ready = await executableDescriptor(root, 'ready-host', operationScript(READY_OPERATION, 0));
		const result = await runFramescaperMediaHostSelectedV20RenderSelfTest(ready);
		assert.equal(result.ready, true);
		assert.doesNotThrow(() => assertFramescaperMediaHostSelectedV20RenderSelfTest(result));
		const unready = await executableDescriptor(
			root,
			'unready-host',
			operationScript(UNREADY_OPERATION, 78),
		);
		assert.equal(
			(await runFramescaperMediaHostSelectedV20RenderSelfTest(unready)).ready,
			false,
		);

		const inconsistent = await executableDescriptor(
			root,
			'inconsistent-host',
			operationScript(READY_OPERATION, 78),
		);
		await assert.rejects(
			runFramescaperMediaHostSelectedV20RenderSelfTest(inconsistent),
			/exit status does not match/u,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function operationScript(json: string, status: number): string {
	return `#!/bin/sh\n[ "$1" = "--self-test-operation" ] || exit 64\n`
		+ `[ "$2" = "selected-v20-render" ] || exit 64\nprintf '%s\\n' '${json}'\nexit ${String(status)}\n`;
}

async function executableDescriptor(
	root: string,
	name: string,
	source: string,
): Promise<FramescaperMediaHostDescriptor> {
	const path = join(root, name);
	const bytes = Buffer.from(source);
	await writeFile(path, bytes);
	await chmod(path, 0o700);
	const identity = await stat(path);
	return Object.freeze({
		target: 'linux-x64', runtime: 'linux-x64', path,
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		hostVersion: '1.0.0', ffmpegVersion: '9.0.1',
		identity: Object.freeze({ dev: identity.dev, ino: identity.ino }),
	});
}
