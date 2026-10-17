/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, type Locator } from '@playwright/test';
import type { launchMotionSustainedApplication } from '../scripts/performance/motionscaper-sustained-launch.ts';
import { waitMotionSustainedGone } from '../scripts/performance/motionscaper-sustained-launch.ts';
import { motionSustainedMenu } from '../scripts/performance/motionscaper-sustained-ui.ts';
import { assertMotionSustainedNativeClean } from '../scripts/performance/motionscaper-sustained-cancel.ts';
import { startMotionSustainedEncoderSampler } from '../scripts/performance/motionscaper-sustained-encoder-sampler.ts';
import { startMotionMaximumObservation } from './motionscaper-native-maximum-observation.ts';
import { inspectMotionMaximumPreview } from './motionscaper-native-maximum-pictures.ts';
import { motionMaximumNativeProfile, type MotionMaximumNativeKind } from './motionscaper-native-maximum-profile.ts';

type Application = Awaited<ReturnType<typeof launchMotionSustainedApplication>>;
type Choose = (path: string) => Promise<void>;
async function waitFor(check: () => Promise<boolean>, timeout: number, signal: AbortSignal) {
	const deadline = performance.now() + timeout;
	for (;;) {
		signal.throwIfAborted(); const ready = await check(); signal.throwIfAborted(); if (ready) return;
		if (performance.now() >= deadline) throw new Error('Maximum-workload UI deadline exceeded.');
		await delay(25, undefined, { signal });
	}
}
async function close(dialog: Locator) { await dialog.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(dialog).toHaveCount(0); }
async function progress(job: Locator, frames: number) {
	const status = job.getByRole('status');
	if (await status.textContent() === 'Completed') return frames;
	const bar = job.getByRole('progressbar'); return await bar.count() ? Number(await bar.getAttribute('value')) : 0;
}
export async function previewMotionMaximum(application: Application, kind: MotionMaximumNativeKind, directory: string) {
	const profile = motionMaximumNativeProfile(kind), actual: Uint8Array[] = []; let completed = 0;
	const cancellation = new AbortController(); let pending: Promise<void> | undefined;
	const observer = await startMotionMaximumObservation(application, { logPath: join(directory, 'preview-memory.jsonl'), frames: profile.selectedFrames.length, deadline: 600000, progress: () => Promise.resolve(completed) });
	let primary: unknown, measurement: unknown;
	try {
		await motionSustainedMenu(application.page, 'View', 'Composition Preview');
		const dialog = application.page.getByRole('dialog', { name: 'Composition Preview', exact: true }), canvas = dialog.locator('canvas');
		for (const index of profile.selectedFrames) {
			const frame = profile.firstFrame + index;
			await dialog.getByLabel('Frame', { exact: true }).fill(String(frame));
			pending = waitFor(async () => await canvas.getAttribute('data-motion-frame', { timeout: 1000 }) === String(frame), 600000, cancellation.signal);
			await Promise.race([pending, observer.failed]);
			const pixels = new Uint8Array(profile.width * profile.height * 4), tileHeight = Math.max(1, Math.floor(16384 / (profile.width * 4)));
			for (let y = 0; y < profile.height; y += tileHeight) {
				const rows = Math.min(tileHeight, profile.height - y);
				const tile = await canvas.evaluate((element: HTMLCanvasElement, input) => {
					if (element.width !== input.width || element.height !== input.height || element.getAttribute('data-motion-frame') !== String(input.frame)) throw new Error('Maximum preview identity changed during bounded pixel read.');
					return Array.from(element.getContext('2d')!.getImageData(0, input.y, input.width, input.rows).data);
				}, { width: profile.width, height: profile.height, frame, y, rows });
				assert.equal(tile.length, profile.width * rows * 4); pixels.set(tile, y * profile.width * 4); await delay(0);
			}
			actual.push(pixels); completed++;
		}
		const workers = (await application.cdp.sample()).filter(target => target.type === 'worker' && target.workerName === 'motionscaper-composition-preview');
		assert.equal(workers.length, 1); assert.ok(workers[0]!.workerFrames >= profile.selectedFrames.length);
		assert.ok(workers[0]!.wasmCapacityBytes.length > 0 && ['worker-cpu', 'worker-webgl2'].includes(workers[0]!.backend ?? ''));
		measurement = await observer.stop(); await close(dialog);
	} catch (error) { primary = error; }
	cancellation.abort(); if (pending) await Promise.allSettled([pending]);
	try { await observer.stop(); } catch (error) { if (!primary) primary = error; }
	if (primary) throw primary;
	// The expensive independent mathematical comparison runs after the observed preview work.
	const pixels = profile.selectedFrames.map((index, selected) => inspectMotionMaximumPreview(kind, profile.firstFrame + index, actual[selected]!));
	return { measurement, pixels, memoryScope: 'Selected full-quality preview and bounded 16KiB pixel tiles' };
}
/** One early upload cancellation followed by one full same-job/revision retry; no second full upload. */
export async function renderMotionMaximum(application: Application, kind: MotionMaximumNativeKind, directory: string, digest: string, helperPath: string, choose: Choose) {
	const profile = motionMaximumNativeProfile(kind), movie = join(directory, 'output.mov');
	await motionSustainedMenu(application.page, 'File', 'Render');
	const dialog = application.page.getByRole('dialog', { name: 'Render Composition', exact: true });
	await expect(dialog.getByLabel('Output format', { exact: true }).locator('option[value="prores"]')).toHaveCount(1, { timeout: 30000 });
	await dialog.getByLabel('Output format', { exact: true }).selectOption('prores');
	await dialog.getByLabel('First frame', { exact: true }).fill(String(profile.firstFrame));
	await dialog.getByLabel('End frame (exclusive)', { exact: true }).fill(String(profile.firstFrame + profile.frames));
	let cancellation: unknown = null, refusal: unknown = null;
	if (kind === 'index') {
		await dialog.getByLabel('End frame (exclusive)', { exact: true }).fill('32769');
		await dialog.getByRole('button', { name: 'Render', exact: true }).click();
		await expect(dialog.getByRole('alert')).toContainText('bounded delivery profile', { timeout: 30000 });
		await expect(dialog.getByRole('button', { name: 'Render', exact: true })).toBeEnabled();
		await assertMotionSustainedNativeClean(directory, movie); assert.equal((await application.nativeHelpers()).length, 0);
		refusal = { frames: 32769, message: await dialog.getByRole('alert').textContent(), outputAbsent: true, helpers: [] };
		await close(dialog); await motionSustainedMenu(application.page, 'File', 'Render Queue');
		const refusedQueue = application.page.getByRole('dialog', { name: 'Render Queue', exact: true }), refusedJob = refusedQueue.locator('[data-motion-render-job]');
		await expect(refusedJob).toHaveCount(1); await expect(refusedJob.getByRole('status')).toHaveText('Failed');
		await refusedJob.getByRole('button', { name: 'Remove Job', exact: true }).click(); await close(refusedQueue);
		await motionSustainedMenu(application.page, 'File', 'Render');
		await dialog.getByLabel('Output format', { exact: true }).selectOption('prores');
		await dialog.getByLabel('End frame (exclusive)', { exact: true }).fill('32768');
		await dialog.getByRole('button', { name: 'Render', exact: true }).click(); await choose(movie);
		await expect.poll(async () => {
			const bar = dialog.getByRole('progressbar'); return await bar.count() ? Number(await bar.getAttribute('value')) : 0;
		}, { timeout: 30000, intervals: [25] }).toBeGreaterThan(0);
		const completed = Number(await dialog.getByRole('progressbar').getAttribute('value')); assert.ok(completed < 32768);
		assert.equal((await application.nativeHelpers()).length, 0);
		const custody = (await readdir(directory)).filter(name => name.startsWith('.motionscaper-export-')); assert.equal(custody.length, 1);
		const carriers = await Promise.all(['frames.mfc', 'audio.mpc'].map(async name => { const path = join(directory, custody[0]!, name), value = await lstat(path); assert.ok(value.isFile() && !value.isSymbolicLink() && value.size > 0); return { path, bytes: value.size }; }));
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Render', exact: true })).toBeEnabled({ timeout: 30000 });
		await assertMotionSustainedNativeClean(directory, movie); cancellation = { completedFrames: completed, carriers, outputAbsent: true };
		await close(dialog);
	}
	const queue = application.page.getByRole('dialog', { name: 'Render Queue', exact: true }), job = queue.locator('[data-motion-render-job]');
	if (kind === 'index') { await motionSustainedMenu(application.page, 'File', 'Render Queue'); await expect(job).toHaveCount(1); await expect(job.getByRole('status')).toHaveText('Cancelled'); }
	let selectedJob = job;
	const observer = await startMotionMaximumObservation(application, { logPath: join(directory, 'render-memory.jsonl'), frames: profile.frames, deadline: profile.timeoutMs, progress: async () => {
		if (kind !== 'index' && await dialog.count()) {
			const status = dialog.getByRole('status'); if (await status.count() && await status.textContent() === 'Render complete') return profile.frames;
			const bar = dialog.getByRole('progressbar'); return await bar.count() ? Number(await bar.getAttribute('value')) : 0;
		}
		return progress(selectedJob, profile.frames);
	} });
	let encoder: Awaited<ReturnType<typeof startMotionSustainedEncoderSampler>> | undefined;
	let encoderResult: Awaited<ReturnType<NonNullable<typeof encoder>['stop']>> | null = null, measurement: unknown, primary: unknown;
	const interrupt = new AbortController(); const pending: Promise<unknown>[] = [];
	try {
		let jobId: string | null = null;
		if (kind === 'index') {
			await job.getByText('Submitted revision', { exact: true }).click(); await expect(job.locator('code')).toHaveText(digest); jobId = await job.getAttribute('data-motion-render-job');
			await job.getByRole('button', { name: 'Retry Original Revision', exact: true }).click(); await choose(movie);
			const complete = waitFor(async () => {
				const status = await job.getByRole('status').textContent({ timeout: 1000 });
				if (status === 'Failed' || status === 'Cancelled') throw new Error(`Maximum index retry ${status}: ${await job.textContent()}`);
				return status === 'Completed';
			}, profile.timeoutMs, interrupt.signal); pending.push(complete);
			const observeEncoder = async () => {
				await waitFor(async () => await progress(job, profile.frames) === profile.frames, profile.timeoutMs, interrupt.signal);
				encoder = await startMotionSustainedEncoderSampler({ owner: application.owner, helperPath, logPath: join(directory, 'encoder-memory.jsonl'), retainProcesses: values => application.retainProcessIdentities(values) });
				await Promise.race([complete, encoder.failed]); return encoder.stop();
			};
			const observed = observeEncoder(); pending.push(observed);
			[, encoderResult] = await Promise.race([Promise.all([complete, observed]), observer.failed]);
			await expect(job).toHaveAttribute('data-motion-render-job', jobId!); await expect(job.locator('code')).toHaveText(digest);
			measurement = await observer.stop();
			await job.getByRole('button', { name: 'Remove Job', exact: true }).click(); await expect(job).toHaveCount(0); await close(queue);
		} else {
			await dialog.getByRole('button', { name: 'Render', exact: true }).click(); await choose(movie);
			const complete = waitFor(async () => {
				const alert = dialog.getByRole('alert'); if (await alert.count()) throw new Error(await alert.innerText());
				return await dialog.getByRole('status').textContent({ timeout: 1000 }) === 'Render complete';
			}, profile.timeoutMs, interrupt.signal); pending.push(complete);
			await Promise.race([complete, observer.failed]);
			measurement = await observer.stop();
		}
		if (kind !== 'index') { await close(dialog); await motionSustainedMenu(application.page, 'File', 'Render Queue'); selectedJob = queue.locator('[data-motion-render-job]'); await expect(selectedJob).toHaveCount(1); await selectedJob.getByRole('button', { name: 'Remove Job', exact: true }).click(); await close(queue); }
		await assertMotionSustainedNativeClean(directory);
		if (encoderResult) await waitMotionSustainedGone(encoderResult.observations.flatMap(row => row.helpers.map(helper => helper.identity)));
	} catch (error) { primary = error; }
	interrupt.abort(); await Promise.allSettled(pending);
	const cleanup = await Promise.allSettled([observer.stop(), ...(encoder ? [encoder.stop()] : [])]);
	const errors = cleanup.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
	if (primary || errors.length) throw new AggregateError([...(primary ? [primary] : []), ...errors], 'Maximum render or observation failed.');
	return { movie, refusal, cancellation, measurement, encoder: encoderResult,
		memoryScope: 'Full publication/retry only; early refusal/cancellation has custody checks, not a sampled memory-peak claim' };
}
