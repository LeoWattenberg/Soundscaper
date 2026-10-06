/* SPDX-License-Identifier: AGPL-3.0-only */
// Run after desktop preparation: xvfb-run -a node --import tsx scripts/performance/measure-electron-editing.mjs
// Fresh profiles and real desktop bridge; no CPU throttling or application stubs.
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cpus } from 'node:os';

import {
	chooseCommandAction, chooseNestedCommandAction,
} from '../../tests/browser/audio-editor-test-helpers.js';

const output = resolve(process.argv[2] ?? 'test-results/editing-performance/electron.json');
const profile = await mkdtemp(join(tmpdir(), 'soundscaper-editing-performance-'));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const results = [];
let application;
try {
	await mkdir(resolve(output, '..'), { recursive: true });
	await writeFile(join(profile, 'desktop-settings.json'), JSON.stringify({ schemaVersion: 1, locale: 'en' }));
	application = await electron.launch({
		args: [resolve('.desktop-build/app'), `--user-data-dir=${profile}`,
			'--soundscaper-soak-debug', `--soundscaper-soak-debug-app-data=${join(profile, 'library')}`,
			`--soundscaper-soak-debug-output-directory=${resolve(output, '..')}`],
		cwd: process.cwd(), env: environment, timeout: 30_000,
	});
	const page = await application.firstWindow();
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.waitForSelector('[data-editor-ready="true"]', { timeout: 45_000 });
	await expect(page.locator('[data-desktop-speed-warmup="ready"]'))
		.toHaveAttribute('data-desktop-speed-warmup-failed', '0', { timeout: 45_000 });
	const editor = page.locator('[data-audio-editor]');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /General$/u }).click();
	await expect(preferences.getByRole('button', { name: 'Optimize for', exact: true })).toContainText('Speed');
	await preferences.locator('.audio-editor-dialog-footer').getByRole('button', { name: 'Close', exact: true }).click();
	await expect(preferences).toBeHidden();
	const runtime = await application.evaluate(({ app }) => ({
		versions: process.versions, gpu: app.getGPUFeatureStatus(), packaged: app.isPackaged,
	}));
	const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
	for (const [type, seconds] of [['Tone', 30], ['Noise', 30], ['Noise', 120]]) {
		for (let trial = 0; trial < 3; trial += 1) {
			if (Number(await editor.getAttribute('data-clip-count')) > 0) {
				await editor.getByRole('button', { name: 'Undo', exact: true }).click();
				await expect(editor).toHaveAttribute('data-clip-count', '0');
			}
			await chooseCommandAction(page, editor, 'Generate', type);
			const dialog = page.getByRole('dialog', { name: type, exact: true });
			if (type === 'Noise') {
				await dialog.getByRole('button', { name: 'Noise color', exact: true }).click();
				await page.getByRole('option', { name: 'Pink', exact: true }).click();
			}
			await dialog.locator('[data-generator-field="durationSeconds"] input').fill(String(seconds));
			await dialog.locator('[data-generator-field="durationSeconds"] input').blur();
			await armOperation(page, 'Generate', '[data-generator-type]');
			await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
			results.push({ operation: `Generate ${type}${type === 'Noise' ? ' pink' : ''}`, seconds, trial,
				...await finishOperation(page) });
			await expect(editor).toHaveAttribute('data-clip-count', '1');
		}
	}
	for (const effect of ['Amplify', 'Compressor']) {
		for (let trial = 0; trial < 3; trial += 1) {
			await chooseCommandAction(page, editor, 'Select', 'Select all');
			await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', effect]);
			const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
			await armOperation(page, 'Apply to selection', '[data-editor-surface="selection-effect"]');
			await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
			results.push({ operation: `Apply ${effect}`, seconds: 120, trial, ...await finishOperation(page) });
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', /success|info/u);
		}
	}
	for (let step = 0; step < 3; step += 1) {
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseCommandAction(page, editor, 'Edit', 'Duplicate');
	}
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	results.push({ operation: 'Idle timeline', clips: await editor.getAttribute('data-clip-count'),
		...await sampleFrames(page, 3_000) });
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	const playheadBefore = Number(await playhead.getAttribute('aria-valuenow'));
	const playbackFrames = await sampleFrames(page, 3_000);
	const playheadAfter = Number(await playhead.getAttribute('aria-valuenow'));
	expect(playheadAfter).toBeGreaterThan(playheadBefore);
	results.push({ operation: 'Playback timeline', clips: await editor.getAttribute('data-clip-count'),
		playheadBefore, playheadAfter, ...playbackFrames });
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(errors).toEqual([]);
	const report = { node: process.version, platform: process.platform, arch: process.arch,
		cpu: cpus()[0]?.model, logicalCpus: cpus().length, runtime, viewport, preference: 'speed',
		method: 'Actual Electron development app with freshly staged production renderer and real preload/SQLite/PCM path. First trial includes first-use processing engines; subsequent trials are warm. Capture click to dialog closed, success status, usable waveform and two animation frames. Xvfb RAF gaps are a renderer responsiveness proxy, not GPU presentation FPS. Startup excluded.',
		results };
	await writeFile(output, JSON.stringify(report, null, '\t') + '\n');
	process.stdout.write(`Saved ${results.length} observations to ${output}\n`);
} catch (error) {
	if (application) {
		const pages = application.windows();
		if (pages[0]) await writeFile(output + '.failure.txt', await pages[0].locator('body').ariaSnapshot());
	}
	throw error;
} finally {
	await application?.close();
	await rm(profile, { recursive: true, force: true });
}

async function armOperation(page, buttonLabel, surface) {
	await page.evaluate(({ buttonLabel, surface }) => {
		const metrics = { start: null, finished: false, frames: [], longTasks: [], completion: null };
		globalThis.__editingPerformance = metrics;
		const observer = new PerformanceObserver(list => {
			for (const entry of list.getEntries()) if (metrics.start !== null
				&& entry.startTime + entry.duration >= metrics.start) metrics.longTasks.push(entry.duration);
		});
		observer.observe({ type: 'longtask', buffered: false });
		let previous = null;
		const frame = time => {
			if (metrics.finished) { observer.disconnect(); return; }
			if (metrics.start !== null) {
				if (previous !== null) metrics.frames.push(time - previous);
				previous = time;
			}
			requestAnimationFrame(frame);
		};
		requestAnimationFrame(frame);
		const changed = () => {
			if (metrics.start === null || metrics.finished || document.querySelector(surface)) return;
			if (document.querySelector('[data-status]')?.dataset.state !== 'success') return;
			if (document.querySelector('[data-waveform-pending="true"]')) return;
			if (metrics.completion !== null) return;
			metrics.completion = performance.now();
			requestAnimationFrame(() => requestAnimationFrame(() => {
				metrics.durationMs = performance.now() - metrics.start;
				metrics.finished = true;
				mutations.disconnect();
			}));
		};
		const mutations = new MutationObserver(changed);
		mutations.observe(document.body, { subtree: true, childList: true, attributes: true });
		const click = event => {
			if (event.target.closest('button')?.textContent.trim() !== buttonLabel) return;
			metrics.start = performance.now();
			previous = metrics.start;
			document.removeEventListener('click', click, true);
		};
		document.addEventListener('click', click, true);
	}, { buttonLabel, surface });
}

async function finishOperation(page) {
	await page.waitForFunction(() => globalThis.__editingPerformance?.finished === true, null, { timeout: 120_000 });
	const result = await page.evaluate(() => globalThis.__editingPerformance);
	return { durationMs: result.durationMs, ...summarizeFrames(result.frames),
		longTaskCount: result.longTasks.length, maxLongTaskMs: Math.max(0, ...result.longTasks) };
}

async function sampleFrames(page, durationMs) {
	const result = await page.evaluate(durationMs => new Promise(resolvePromise => {
		const frames = [];
		let first;
		let previous;
		const frame = time => {
			first ??= time;
			if (previous !== undefined) frames.push(time - previous);
			previous = time;
			if (time - first >= durationMs) resolvePromise(frames);
			else requestAnimationFrame(frame);
		};
		requestAnimationFrame(frame);
	}), durationMs);
	return summarizeFrames(result);
}

function summarizeFrames(frames) {
	const ordered = frames.slice().sort((a, b) => a - b);
	return { frames: frames.length, medianFrameMs: ordered[Math.floor(ordered.length / 2)] ?? null,
		p95FrameMs: ordered[Math.floor(ordered.length * .95)] ?? null,
		maxFrameMs: Math.max(0, ...frames), framesOver33Ms: frames.filter(value => value > 33.4).length };
}
