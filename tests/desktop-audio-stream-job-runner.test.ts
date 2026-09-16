/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopAudioStreamJobRunner } from '../desktop/desktop-audio-stream-job-runner.ts';
import { bundledAudioCodecSpec, type BundledAudioCodecHelperConfiguration } from '../desktop/bundled-audio-codec-helper-configuration.ts';
import type { BundledAudioCodecChild } from '../desktop/bundled-audio-codec-operation-runner.ts';
import type { DesktopAudioStreamJob } from '../desktop/desktop-audio-stream-service.ts';

const configuration: BundledAudioCodecHelperConfiguration = {
	contractVersion: 1, target: 'linux-x64', codec: 'flac', runtimeRoot: '/app/runtime',
	moduleBytes: 1000, moduleSha256: 'a'.repeat(64), wasmBytes: 1000, wasmSha256: 'b'.repeat(64),
	dependencies: bundledAudioCodecSpec('flac').dependencies.map((path) => ({ path, byteLength: 1000, sha256: 'c'.repeat(64) })),
};
const job: DesktopAudioStreamJob = { schemaVersion: 1, type: 'audio-stream-job',
	plan: { schemaVersion: 1, frameCount: 100, maximumOutputBytes: 1000,
		tuple: { operation: 'audio-encode', format: 'flac', sampleRate: 48000, channelCount: 2, settings: { compressionLevel: 5, bitDepth: 24 } } },
	inputPath: '/app/private/input.pcm', outputPath: '/app/private/output.audio', inputSha256: 'd'.repeat(64) };

class Child implements BundledAudioCodecChild {
	posted: unknown[] = []; killed = false;
	killError: Error | null = null;
	messages = new Set<(value: unknown) => void>(); exits = new Set<(code: number | null) => void>();
	postMessage(value: unknown): void { this.posted.push(value); }
	onMessage(listener: (value: unknown) => void): () => void { this.messages.add(listener); return () => { this.messages.delete(listener); }; }
	onExit(listener: (code: number | null) => void): () => void { this.exits.add(listener); return () => { this.exits.delete(listener); }; }
	kill(): void { this.killed = true; if (this.killError) throw this.killError; }
	message(value: unknown): void { for (const listener of this.messages) listener(value); }
	exit(code: number | null): void { for (const listener of this.exits) listener(code); }
}
const nextTurn = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });
function ready(child: Child): void { child.message({ contractVersion: 1, type: 'ready', target: 'linux-x64', codec: 'flac' }); }

test('stream utility result waits for successful helper exit and relays exact frame progress', async () => {
	const child = new Child(); const progress: number[] = [];
	const run = createDesktopAudioStreamJobRunner({ verifyPayload: async () => configuration, spawn: () => child });
	let settled = false; const execution = run(job, new AbortController().signal, (frames) => { progress.push(frames); });
	void execution.then(() => { settled = true; });
	await nextTurn(); ready(child); assert.deepEqual(child.posted, [job]);
	child.message({ contractVersion: 1, type: 'progress', frames: 42, frameCount: 100 });
	child.message({ contractVersion: 1, type: 'result', result: { contractVersion: 1, status: 'audio-stream-executed', outputBytes: 345 } });
	await nextTurn(); assert.equal(settled, false); assert.deepEqual(progress, [42]);
	child.exit(0); assert.equal(await execution, 345); assert.equal(child.messages.size, 0); assert.equal(child.exits.size, 0);
});

test('cancellation retains supervision until the killed utility process exits', async () => {
	const child = new Child(); const controller = new AbortController();
	const run = createDesktopAudioStreamJobRunner({ verifyPayload: async () => configuration, spawn: () => child });
	let settled = false; const execution = run(job, controller.signal);
	void execution.catch(() => { settled = true; });
	await nextTurn(); ready(child); const reason = new Error('cancel native export'); controller.abort(reason);
	assert.equal(child.killed, true); await nextTurn(); assert.equal(settled, false);
	child.exit(null); await assert.rejects(execution, (error: unknown) => error === reason);
	assert.equal(child.exits.size, 0);
});

test('malformed progress fails closed and waits for helper termination', async () => {
	const child = new Child();
	const run = createDesktopAudioStreamJobRunner({ verifyPayload: async () => configuration, spawn: () => child });
	const execution = run(job, new AbortController().signal); void execution.catch(() => undefined);
	await nextTurn(); ready(child); child.message({ contractVersion: 1, type: 'progress', frames: 101, frameCount: 100 });
	assert.equal(child.killed, true); child.exit(0); await assert.rejects(execution, /progress/u);
});

test('a failed kill retains the cancellation cause and supervision until actual exit', async () => {
	const child = new Child(); const controller = new AbortController();
	const reason = new Error('cancel native export'); const killError = new Error('kill failed'); child.killError = killError;
	const run = createDesktopAudioStreamJobRunner({ verifyPayload: async () => configuration, spawn: () => child });
	let settled = false; const execution = run(job, controller.signal); void execution.catch(() => { settled = true; });
	await nextTurn(); ready(child); controller.abort(reason); await nextTurn();
	assert.equal(settled, false); assert.equal(child.exits.size, 1);
	child.exit(null);
	await assert.rejects(execution, (error: unknown) => error instanceof AggregateError
		&& error.errors[0] === reason && error.errors[1] === killError);
	assert.equal(child.exits.size, 0);
});
