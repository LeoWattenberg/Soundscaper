/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { launchMotionSustainedApplication } from './motionscaper-sustained-launch.ts';
import { startMotionSustainedSampler } from './motionscaper-sustained-sampler.ts';
import { openMotionSustainedPreview, seekMotionSustainedPreview } from './motionscaper-sustained-ui.ts';

type Application = Awaited<ReturnType<typeof launchMotionSustainedApplication>>;
async function worker(application: Application) {
	const deadline = performance.now() + 30000;
	for (;;) {
		const targets = (await application.cdp.sample()).filter(value => value.type === 'worker' && value.workerName === 'motionscaper-composition-preview');
		if (targets.length === 1 && targets[0]!.workerFrames > 0) {
			const value = targets[0]!; assert.ok(['worker-cpu', 'worker-webgl2'].includes(value.backend ?? ''));
			assert.ok(value.wasmCapacityBytes.length > 0, 'Actual preview worker must own observed CanvasKit WASM.'); return value;
		}
		if (targets.length > 1 || performance.now() >= deadline) throw new Error('Exactly one live rendered preview worker was not observed.');
		await delay(100);
	}
}
async function gone(application: Application, sessionId: string) {
	await expect.poll(() => application.cdp.identities().find(value => value.sessionId === sessionId)?.detachedAt, { timeout: 10000 }).toBeTruthy();
	assert.ok(!(await application.cdp.sample()).some(value => value.sessionId === sessionId));
}
export async function qualifyMotionSustainedPreview(application: Application, directory: string, frames: 300 | 1200, revisionDigest: string) {
	let progress = 0, expected: Readonly<{ targetId: string; sessionId: string; revision: number; backend: string }> | null = null;
	const sampler = await startMotionSustainedSampler({ phase: 'preview', owner: application.owner, cdp: application.cdp,
		logPath: join(directory, 'preview-memory.jsonl'), progress: () => Promise.resolve(progress), expectedWorker: () => expected,
		retainProcesses: values => application.retainProcessIdentities(values) });
	let stopped = false;
	try {
		const dialog = await openMotionSustainedPreview(application.page), initial = await worker(application);
		assert.ok(initial.revision !== null && initial.backend !== null); expected = { ...initial, revision: initial.revision, backend: initial.backend };
		await expect(dialog.locator('canvas')).toHaveAttribute('data-motion-rendered', String(initial.revision));
		const selected = await Promise.race([seekMotionSustainedPreview(dialog, frames, value => { progress = value; }, () => sampler.assertHealthy()), sampler.failed]);
		const measured = await sampler.stop(); stopped = true;
		let final = initial;
		for (const value of measured.telemetry) if (value.sessionId === initial.sessionId) final = value;
		assert.ok(final && final.workerFrames >= initial.workerFrames + frames - 1, 'Actual worker did not deliver the distinct frame seeks.');
		await dialog.getByRole('button', { name: 'Close', exact: true }).last().click(); await gone(application, initial.sessionId);
		const reopened = await openMotionSustainedPreview(application.page), replacement = await worker(application);
		assert.notEqual(replacement.targetId, initial.targetId); assert.notEqual(replacement.sessionId, initial.sessionId);
		await reopened.getByRole('button', { name: 'Close', exact: true }).last().click(); await gone(application, replacement.sessionId);
		return { measured, selected, importedRevisionDigest: revisionDigest, lifecycle: { initial, replacement, targets: application.cdp.identities() } };
	} finally { if (!stopped) await sampler.stop(); }
}
