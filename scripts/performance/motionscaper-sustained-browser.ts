/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { launchMotionSustainedApplication } from './motionscaper-sustained-launch.ts';
import { startMotionSustainedSampler } from './motionscaper-sustained-sampler.ts';
import { prepareMotionSustainedDestination, readMotionSustainedDestination, snapshotMotionSustainedDestination } from './motionscaper-sustained-opfs.ts';
import { finishMotionSustainedRender, motionSustainedRenderProgress, openMotionSustainedRender, removeMotionSustainedJob } from './motionscaper-sustained-ui.ts';
import { verifyMotionSustainedPng } from './motionscaper-sustained-png.ts';
export { verifyMotionSustainedBrowserVideo } from './motionscaper-sustained-browser-reference.ts';

type Application = Awaited<ReturnType<typeof launchMotionSustainedApplication>>;
export async function renderMotionSustainedBrowser(application: Application, options: Readonly<{
	format: 'png' | 'webm'; frames: 300 | 1200; directory: string; revisionDigest: string;
}>) {
	const name = `output.${options.format === 'png' ? 'tar' : 'webm'}`;
	await prepareMotionSustainedDestination(application.page, name);
	const dialog = await openMotionSustainedRender(application.page, options.format, options.frames);
	const sampler = await startMotionSustainedSampler({ phase: options.format, owner: application.owner, cdp: application.cdp,
		logPath: join(options.directory, `${options.format}-memory.jsonl`), progress: () => motionSustainedRenderProgress(dialog, options.frames),
		retainProcesses: values => application.retainProcessIdentities(values) });
	let stopped = false;
	try {
		await dialog.getByRole('button', { name: 'Render', exact: true }).click();
		await Promise.race([dialog.getByRole('status').waitFor({ state: 'visible', timeout: 600000 }).then(async () => {
			const { expect } = await import('@playwright/test'); await expect(dialog.getByRole('status')).toHaveText('Render complete', { timeout: 600000 });
		}), sampler.failed]);
		const measured = await sampler.stop(); stopped = true;
		const destination = await snapshotMotionSustainedDestination(application.page);
		assert.equal(destination.closed, true); assert.equal(destination.aborted, false); assert.equal(destination.maxOutstandingWrites, 1);
		assert.ok(destination.bytes > 0 && destination.writes > 0);
		await finishMotionSustainedRender(dialog); await removeMotionSustainedJob(application.page, options.revisionDigest);
		const path = join(options.directory, name), transfer = await readMotionSustainedDestination(application.page, name, path);
		let png: Awaited<ReturnType<typeof verifyMotionSustainedPng>> | null = null;
		if (options.format === 'png') {
			png = await verifyMotionSustainedPng(path, { frames: options.frames, revisionDigest: options.revisionDigest, projectId: 'sustained-duration-v1', compositionId: 'main' });
			assert.equal(png.sha256, transfer.sha256); assert.equal(png.byteLength, transfer.byteLength);
		}
		return { measured, destination, transfer, path, png };
	} finally { if (!stopped) await sampler.stop(); }
}
