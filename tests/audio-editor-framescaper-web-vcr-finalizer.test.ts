/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { CapturePhase } from '../src/common/editor/framescaper-capture-domain.ts';
import { finalizeFramescaperWebVcrCapture } from '../src/common/editor/controller/framescaper-web-vcr-finalizer.ts';

test('capture stop continues through a rejected host-finalizing transition', async () => {
	const calls: string[] = [];
	let phase: CapturePhase = 'recording';
	await assert.rejects(() => finalizeFramescaperWebVcrCapture({
		capturePhase: () => phase,
		async enterHostFinalizing() { calls.push('finalizing'); throw new Error('host finalizing rejected'); },
		async stopCapture() { calls.push('stop'); phase = 'inactive'; },
		async sealCapture() { calls.push('seal'); phase = 'recovery'; },
		async enterHostRecovery() { calls.push('recovery'); },
		async enterHostReady() { calls.push('ready'); },
		async restorePreview() { calls.push('preview'); },
	}), /host finalizing rejected/iu);
	assert.deepEqual(calls, ['finalizing', 'stop', 'recovery', 'ready', 'preview']);
});

test('a failed stop seals active capture and preserves all failures', async () => {
	const calls: string[] = [];
	let phase: CapturePhase = 'recording';
	await assert.rejects(() => finalizeFramescaperWebVcrCapture({
		capturePhase: () => phase,
		async enterHostFinalizing() { calls.push('finalizing'); },
		async stopCapture() { calls.push('stop'); throw new Error('stop failed'); },
		async sealCapture() { calls.push('seal'); phase = 'recovery'; throw new Error('seal failed'); },
		async enterHostRecovery() { calls.push('recovery'); },
		async enterHostReady() { calls.push('ready'); },
		async restorePreview() { calls.push('preview'); },
	}), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors.map(String), ['Error: stop failed', 'Error: seal failed']);
		return true;
	});
	assert.deepEqual(calls, ['finalizing', 'stop', 'seal', 'recovery']);
});

test('failed stop and seal keep the host recovery-locked while capture remains active', async () => {
	const calls: string[] = [];
	const phase: CapturePhase = 'recording';
	await assert.rejects(() => finalizeFramescaperWebVcrCapture({
		capturePhase: () => phase,
		async enterHostFinalizing() { calls.push('finalizing'); },
		async stopCapture() { calls.push('stop'); throw new Error('stop failed'); },
		async sealCapture() { calls.push('seal'); throw new Error('seal failed'); },
		async enterHostRecovery() { calls.push('recovery'); },
		async enterHostReady() { calls.push('ready'); },
		async restorePreview() { calls.push('preview'); },
	}));
	assert.deepEqual(calls, ['finalizing', 'stop', 'seal', 'recovery']);
});

test('preview is not restored until host ready is acknowledged', async () => {
	const calls: string[] = [];
	let phase: CapturePhase = 'recording';
	await assert.rejects(() => finalizeFramescaperWebVcrCapture({
		capturePhase: () => phase,
		async enterHostFinalizing() { calls.push('finalizing'); },
		async stopCapture() { calls.push('stop'); phase = 'inactive'; },
		async sealCapture() { calls.push('seal'); },
		async enterHostRecovery() { calls.push('recovery'); },
		async enterHostReady() { calls.push('ready'); throw new Error('ready failed'); },
		async restorePreview() { calls.push('preview'); },
	}), /ready failed/iu);
	assert.deepEqual(calls, ['finalizing', 'stop', 'ready']);
});
