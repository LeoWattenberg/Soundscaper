/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { launchMotionSustainedApplication } from './motionscaper-sustained-launch.ts';
import { motionSustainedIdentityAlive, waitMotionSustainedGone } from './motionscaper-sustained-launch.ts';
import { prepareMotionSustainedDestination, snapshotMotionSustainedDestination } from './motionscaper-sustained-opfs.ts';
import { motionSustainedMenu, openMotionSustainedRender } from './motionscaper-sustained-ui.ts';
import { MOTION_SUSTAINED_PLAN as plan } from './motionscaper-sustained-plan.ts';

type Application = Awaited<ReturnType<typeof launchMotionSustainedApplication>>;
export async function assertMotionSustainedNativeClean(directory: string, absentOutput?: string) {
	assert.deepEqual((await readdir(directory)).filter(value => value.startsWith('.motionscaper-export-')), [], 'Native carrier custody survived terminal cleanup.');
	if (absentOutput) await assert.rejects(lstat(absentOutput), { code: 'ENOENT' });
}
/** Cancellation and retry use only public dialogs; no clock, encoder or queue replacement. */
export async function qualifyMotionSustainedCancellation(application: Application, options: Readonly<{
	directory: string; frames: 300 | 1200; revisionDigest: string; phase: 'browser' | 'native-upload' | 'native-encode';
	chooseNative?: (path: string) => Promise<void>;
}>) {
	const native = options.phase !== 'browser', format = native ? 'prores' : 'webm', name = `${options.phase}-cancel.${native ? 'mov' : 'webm'}`;
	if (!native) await prepareMotionSustainedDestination(application.page, name);
	const dialog = await openMotionSustainedRender(application.page, format, options.frames);
	await dialog.getByRole('button', { name: 'Render', exact: true }).click();
	if (native) await options.chooseNative!(join(options.directory, name));
	let helpers: Awaited<ReturnType<Application['nativeHelpers']>> = [];
	let upload: Readonly<{ completed: number; carriers: readonly { path: string; bytes: number }[] }> | null = null;
	if (options.phase === 'native-encode') {
		await expect.poll(async () => { helpers = await application.nativeHelpers(); return helpers.length; }, { timeout: plan.maximumPhaseMs, intervals: [25] }).toBe(1);
		assert.ok(helpers[0]!.rssBytes <= plan.maximumNativeHelperRssBytes && helpers[0]!.pssBytes <= plan.maximumNativeHelperPssBytes);
	} else await expect.poll(async () => {
		const progress = dialog.getByRole('progressbar'), completed = await progress.count() ? Number(await progress.getAttribute('value')) : 0;
		if (!(completed > 0 && completed < options.frames)) return false;
		if (!native) return true;
		if ((await application.nativeHelpers()).length) return false;
		const directories = (await readdir(options.directory)).filter(value => value.startsWith('.motionscaper-export-'));
		if (directories.length !== 1) return false;
		const carriers = await Promise.all(['frames.mfc', 'audio.mpc'].map(async name => {
			const path = join(options.directory, directories[0]!, name), value = await lstat(path);
			assert.ok(value.isFile() && !value.isSymbolicLink() && value.size > 0 && value.size < plan.maximumOutputBytes); return { path, bytes: value.size };
		}));
		upload = { completed, carriers }; return true;
	}, { timeout: 30000, intervals: [25] }).toBe(true);
	await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
	if (options.phase === 'native-encode') assert.ok(await motionSustainedIdentityAlive(helpers[0]!.identity), 'Encoder already disappeared before cancellation boundary.');
	if (options.phase === 'native-upload') {
		assert.equal((await application.nativeHelpers()).length, 0);
		const completed = Number(await dialog.getByRole('progressbar').getAttribute('value'));
		assert.ok(completed > 0 && completed < options.frames, 'Carrier upload boundary was missed.');
	}
	const cancellationRequestedAt = new Date().toISOString();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Render', exact: true })).toBeEnabled({ timeout: 30000 });
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	const cancelledDestination = native ? null : await snapshotMotionSustainedDestination(application.page);
	if (cancelledDestination) { assert.equal(cancelledDestination.closed, false); assert.equal(cancelledDestination.aborted, true); assert.equal(cancelledDestination.removed, true); }
	if (native) { await waitMotionSustainedGone(helpers.map(value => value.identity)); await assertMotionSustainedNativeClean(options.directory, join(options.directory, name)); }
	await motionSustainedMenu(application.page, 'File', 'Render Queue');
	const queue = application.page.getByRole('dialog', { name: 'Render Queue', exact: true }), job = queue.locator('[data-motion-render-job]');
	await expect(job).toHaveCount(1); await expect(job.getByRole('status')).toHaveText('Cancelled');
	await job.getByText('Submitted revision', { exact: true }).click(); await expect(job.locator('code')).toHaveText(options.revisionDigest);
	const jobId = await job.getAttribute('data-motion-render-job'), retryName = `${options.phase}-retry.${native ? 'mov' : 'webm'}`;
	if (!native) await prepareMotionSustainedDestination(application.page, retryName);
	await job.getByRole('button', { name: 'Retry Original Revision', exact: true }).click();
	if (native) await options.chooseNative!(join(options.directory, retryName));
	await expect(job.getByRole('status')).toHaveText('Completed', { timeout: plan.maximumPhaseMs });
	await expect(job).toHaveAttribute('data-motion-render-job', jobId!); await expect(job.locator('code')).toHaveText(options.revisionDigest);
	await expect(job.getByRole('button', { name: 'Download Again', exact: true })).toHaveCount(0);
	const retryDestination = native ? null : await snapshotMotionSustainedDestination(application.page);
	if (retryDestination) { assert.equal(retryDestination.closed, true); assert.equal(retryDestination.aborted, false); assert.equal(retryDestination.maxOutstandingWrites, 1); }
	if (native) await assertMotionSustainedNativeClean(options.directory);
	await job.getByRole('button', { name: 'Remove Job', exact: true }).click(); await expect(job).toHaveCount(0);
	await queue.getByRole('button', { name: 'Close', exact: true }).last().click();
	return { phase: options.phase, jobId, revisionDigest: options.revisionDigest, helpers, upload, cancellationRequestedAt, cancelledDestination, retryDestination, retryName };
}
