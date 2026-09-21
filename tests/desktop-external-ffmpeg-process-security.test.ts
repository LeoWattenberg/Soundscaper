/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	sha256ExternalFfmpegRegularFile,
	spawnExternalFfmpegProcess,
	superviseExternalFfmpegProcess,
} from '../desktop/external-ffmpeg-process-security.ts';

test('one external FFmpeg process authority launches without a shell in the private cwd and environment', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-ffmpeg-process-security-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const script = [
		'process.stdout.write(JSON.stringify({',
		'cwd: process.cwd(), token: process.env.SECURITY_TEST_TOKEN, argument: process.argv[1]',
		'}));',
	].join('');
	const child = spawnExternalFfmpegProcess(process.execPath, [
		'-e', script, 'literal;process.exit(77)',
	], {
		cwd: directory,
		env: { SECURITY_TEST_TOKEN: 'private' },
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: false,
	});
	assert.ok(child.stdout);
	const chunks: Buffer[] = [];
	child.stdout.on('data', (chunk: Buffer) => { chunks.push(chunk); });
	const [code, signal] = await once(child, 'close');
	assert.equal(code, 0);
	assert.equal(signal, null);
	assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString('utf8')), {
		cwd: directory,
		token: 'private',
		argument: 'literal;process.exit(77)',
	});
});

test('one external FFmpeg digest authority hashes regular files and preserves caller-owned refusal errors', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-ffmpeg-digest-security-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const executable = join(directory, 'ffmpeg');
	const bytes = Buffer.from('reviewed external ffmpeg executable');
	await writeFile(executable, bytes);
	assert.equal(
		await sha256ExternalFfmpegRegularFile(executable, {
			notRegularFile: () => new Error('not regular'),
		}),
		createHash('sha256').update(bytes).digest('hex'),
	);

	const refusal = Object.assign(new Error('caller-owned refusal'), { name: 'TypedDigestRefusal' });
	await assert.rejects(
		sha256ExternalFfmpegRegularFile(directory, { notRegularFile: () => refusal }),
		(error: unknown) => error === refusal,
	);
});

test('one external FFmpeg supervision authority owns cancellation escalation and terminal settlement', async () => {
	const events = new EventEmitter();
	const signals: NodeJS.Signals[] = [];
	const child = Object.assign(events, {
		kill(signal: NodeJS.Signals) { signals.push(signal); return true; },
	});
	const controller = new AbortController();
	const supervision = superviseExternalFfmpegProcess({
		child,
		signal: controller.signal,
		environment: {},
		maximumDurationMs: 1_000,
		terminationGraceMs: 1,
		killWaitMs: 1,
		timeout: () => 'timeout' as const,
		cancelled: () => 'cancelled' as const,
		terminated: (reason) => reason,
		error: () => 'spawn-failed' as const,
		close: (code, signal) => signal === null && code === 0 ? 'succeeded' as const : 'failed' as const,
	});
	assert.equal(supervision.acceptsOutput(), true);
	controller.abort();
	assert.equal(supervision.acceptsOutput(), false);
	assert.equal(await supervision.completion, 'cancelled');
	assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
	events.emit('close', 0, null);
	assert.equal(await supervision.completion, 'cancelled');
});

test('the supervision authority preserves callers whose first tree kill is already forceful', async () => {
	const events = new EventEmitter();
	const signals: NodeJS.Signals[] = [];
	const child = Object.assign(events, {
		kill(signal: NodeJS.Signals) { signals.push(signal); return true; },
	});
	const supervision = superviseExternalFfmpegProcess({
		child,
		environment: {},
		maximumDurationMs: 1_000,
		terminationGraceMs: 1,
		killWaitMs: 1,
		forceKillAfterGrace: false,
		timeout: () => 'timeout' as const,
		cancelled: () => 'cancelled' as const,
		terminated: (reason) => reason,
		error: () => 'spawn-failed' as const,
		close: () => 'closed' as const,
	});
	supervision.terminate('cancelled');
	assert.equal(await supervision.completion, 'cancelled');
	assert.deepEqual(signals, ['SIGTERM']);
});
