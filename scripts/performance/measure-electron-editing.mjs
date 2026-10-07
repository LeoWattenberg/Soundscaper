/* SPDX-License-Identifier: AGPL-3.0-only */
// Run after desktop preparation: xvfb-run -a node --import tsx scripts/performance/measure-electron-editing.mjs
// Add --extended after the output path to include Chirp, Normalize and dense timeline gestures.
// Add --round3 to include Click Removal, Noise gate and Loudness Normalization as well.
// Add --round4 for constant Chirp, long DTMF, De-esser and Multiband compressor.
// Fresh profiles and real desktop bridge; no CPU throttling or application stubs.
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { cpus, freemem, loadavg, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
	chooseCommandAction, chooseNestedCommandAction,
} from '../../tests/browser/audio-editor-test-helpers.js';
import { armElectronEditingCompletion } from './electron-editing-completion.ts';
import { createElectronEditingFailureReport } from './electron-editing-failure-report.ts';

const output = resolve(process.argv[2] ?? 'test-results/editing-performance/electron.json');
const round4 = process.argv.includes('--round4');
const round3 = round4 || process.argv.includes('--round3');
const extended = round3 || process.argv.includes('--extended');
const hostStart = { time: new Date().toISOString(), loadAverage: loadavg(), freeBytes: freemem(), totalBytes: totalmem() };
const profile = await mkdtemp(join(tmpdir(), 'soundscaper-editing-performance-'));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const results = [];
let application;
let runtime;
let viewport;
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
	runtime = await application.evaluate(({ app }) => ({
		versions: process.versions, gpu: app.getGPUFeatureStatus(), packaged: app.isPackaged,
	}));
	viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
	const generators = extended
		? [['Tone', 30], ['Chirp', 30], ['Noise', 30], ['Noise', 120]]
		: [['Tone', 30], ['Noise', 30], ['Noise', 120]];
	if (round4) generators.splice(2, 0, ['Chirp', 30, 'constant'], ['DTMF tones', 30]);
	for (const [type, seconds, variant] of generators) {
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
			if (variant === 'constant') {
				await dialog.locator('[data-generator-field="endFrequency"] input').fill('440');
				await dialog.locator('[data-generator-field="endFrequency"] input').blur();
			}
			await dialog.locator('[data-generator-field="durationSeconds"] input').fill(String(seconds));
			await dialog.locator('[data-generator-field="durationSeconds"] input').blur();
			await armOperation(page, 'Generate', '[data-generator-type]');
			await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
			results.push({ operation: `Generate ${type}${type === 'Noise' ? ' pink' : variant === 'constant' ? ' constant' : ''}`, seconds, trial,
				...await finishOperation(page) });
			await expect(editor).toHaveAttribute('data-clip-count', '1');
		}
	}
	const effects = extended ? ['Amplify', 'Compressor', 'Normalize'] : ['Amplify', 'Compressor'];
	if (round3) effects.push('Click Removal', 'Noise gate', 'Loudness Normalization');
	if (round4) effects.push('De-esser', 'Multiband compressor');
	for (const effect of effects) {
		for (let trial = 0; trial < 3; trial += 1) {
			await chooseCommandAction(page, editor, 'Select', 'Select all');
			const group = effect === 'Click Removal' || effect === 'Noise gate' || effect === 'De-esser'
				? 'Noise removal and repair' : 'Volume and compression';
			await chooseNestedCommandAction(page, editor, 'Effect', [group, effect]);
			const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
			await armOperation(page, 'Apply to selection', '[data-editor-surface="selection-effect"]');
			await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
			results.push({ operation: `Apply ${effect}`, seconds: 120, trial, ...await finishOperation(page) });
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', /success|info/u);
		}
	}
	const duplicationRounds = extended ? 6 : 3;
	for (let step = 0; step < duplicationRounds; step += 1) {
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseCommandAction(page, editor, 'Edit', 'Duplicate');
		await expect(editor).toHaveAttribute('data-clip-count', String(2 ** (step + 1)));
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
	if (extended) {
		await expect(editor).toHaveAttribute('data-clip-count', '64');
		results.push({ operation: 'Active dense timeline scroll and hover', clips: '64',
			...await sampleTimelineGestures(page, editor, 3_000) });
	}
	expect(errors).toEqual([]);
	const report = { node: process.version, platform: process.platform, arch: process.arch,
		revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim(),
		cpu: cpus()[0]?.model, logicalCpus: cpus().length, runtime, viewport, preference: 'speed', extended,
		round3, round4, hostStart,
		hostEnd: { time: new Date().toISOString(), loadAverage: loadavg(), freeBytes: freemem(), totalBytes: totalmem() },
		method: 'Actual Electron development app with freshly staged production renderer and real preload/SQLite/PCM path. Trial zero is the first invocation of each fixture after normal Speed prewarm; related earlier fixtures may already have used its generator or effect module. Subsequent trials repeat that fixture. Capture click to dialog closed, success status, cleared waveform pending state and a fresh successful waveform plan, then revalidate that same paint at two animation-frame boundaries. Xvfb RAF gaps are a renderer responsiveness proxy, not GPU presentation FPS. Startup excluded.',
		results };
	await writeFile(output, JSON.stringify(report, null, '\t') + '\n');
	process.stdout.write(`Saved ${results.length} observations to ${output}\n`);
} catch (error) {
	try {
		const partial = createElectronEditingFailureReport({
			node: process.version, platform: process.platform, arch: process.arch,
			cpu: cpus()[0]?.model, logicalCpus: cpus().length, runtime, viewport,
			preference: 'speed', extended, round3, round4, hostStart,
			hostEnd: { time: new Date().toISOString(), loadAverage: loadavg(), freeBytes: freemem(), totalBytes: totalmem() },
			method: 'Failed attempt; only completed observations are retained. The complete output path is written only after every assertion succeeds and may contain a superseded earlier attempt.',
		}, results, error);
		await writeFile(output + '.partial.json', JSON.stringify(partial, null, '\t') + '\n');
	} catch (diagnosticError) {
		console.error('Unable to preserve partial editing observations:', diagnosticError);
	}
	try {
		const pages = application?.windows();
		if (pages?.[0]) await writeFile(output + '.failure.txt', await pages[0].locator('body').ariaSnapshot());
	} catch (diagnosticError) {
		console.error('Unable to preserve editing failure snapshot:', diagnosticError);
	}
	throw error;
} finally {
	await application?.close();
	await rm(profile, { recursive: true, force: true });
}

async function armOperation(page, buttonLabel, surface) {
	await page.evaluate(armElectronEditingCompletion, { buttonLabel, surface });
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

async function sampleTimelineGestures(page, editor, durationMs) {
	for (let step = 0; step < 3; step += 1) await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
	const scroll = editor.locator('.audio-editor-timeline-scroll');
	const scrollBounds = await scroll.boundingBox();
	const rulerBounds = await editor.locator('[data-ruler]').boundingBox();
	if (!scrollBounds || !rulerBounds) throw new Error('The dense timeline must expose its scroll viewport and ruler.');
	const xMin = Math.max(scrollBounds.x + 20, rulerBounds.x + 20);
	const xMax = scrollBounds.x + scrollBounds.width - 24;
	const yMin = Math.max(scrollBounds.y + 50, rulerBounds.y + rulerBounds.height + 24);
	const yMax = scrollBounds.y + scrollBounds.height - 32;
	expect(xMax).toBeGreaterThan(xMin);
	expect(yMax).toBeGreaterThan(yMin);
	const maximumScroll = await scroll.evaluate(element => Math.max(
		element.scrollWidth - element.clientWidth, element.scrollHeight - element.clientHeight,
	));
	expect(maximumScroll).toBeGreaterThan(0);
	await page.mouse.move(xMin, yMin);
	await expect(editor.locator('[data-time-ruler-pointer-position]')).toBeVisible();
	let gestures = 0;
	const [sample] = await Promise.all([
		page.evaluate(duration => new Promise(resolvePromise => {
			const timeline = document.querySelector('.audio-editor-timeline-scroll');
			const pointer = document.querySelector('[data-time-ruler-pointer-position]');
			if (!timeline || !pointer) throw new Error('Timeline gesture sampling requires mounted rendering targets.');
			const frames = [];
			const scrollPositions = new Set();
			const hoverPositions = new Set();
			let first;
			let previous;
			let minScrollLeft = timeline.scrollLeft;
			let maxScrollLeft = minScrollLeft;
			let minScrollTop = timeline.scrollTop;
			let maxScrollTop = minScrollTop;
			const frame = time => {
				first ??= time;
				if (previous !== undefined) frames.push(time - previous);
				previous = time;
				minScrollLeft = Math.min(minScrollLeft, timeline.scrollLeft);
				maxScrollLeft = Math.max(maxScrollLeft, timeline.scrollLeft);
				minScrollTop = Math.min(minScrollTop, timeline.scrollTop);
				maxScrollTop = Math.max(maxScrollTop, timeline.scrollTop);
				scrollPositions.add(`${timeline.scrollLeft},${timeline.scrollTop}`);
				if (!pointer.hidden) hoverPositions.add(pointer.style.transform);
				if (time - first >= duration) resolvePromise({ frames, durationMs: time - first,
					minScrollLeft, maxScrollLeft, minScrollTop, maxScrollTop,
					scrollPositions: scrollPositions.size, hoverPositions: hoverPositions.size });
				else requestAnimationFrame(frame);
			};
			requestAnimationFrame(frame);
		}), durationMs),
		(async () => {
			const started = Date.now();
			while (Date.now() - started < durationMs) {
				const phase = gestures % 7 / 6;
				await page.mouse.move(xMin + (xMax - xMin) * phase,
					yMin + (yMax - yMin) * (1 - phase), { steps: 3 });
				const direction = Math.floor(gestures / 6) % 2 ? -1 : 1;
				await page.mouse.wheel(direction * 320, direction * 240);
				gestures += 1;
				await page.waitForTimeout(Math.max(0, started + gestures * 60 - Date.now()));
			}
		})(),
	]);
	expect(gestures).toBeGreaterThan(3);
	expect(sample.scrollPositions).toBeGreaterThan(3);
	expect(sample.hoverPositions).toBeGreaterThan(3);
	expect(Math.max(sample.maxScrollLeft - sample.minScrollLeft,
		sample.maxScrollTop - sample.minScrollTop)).toBeGreaterThan(100);
	const { frames, ...interaction } = sample;
	return { ...summarizeFrames(frames), ...interaction, gestures,
		gesture: 'Trusted mouse sweeps and bidirectional wheel scrolling on a zoomed timeline with 64 clips' };
}

function summarizeFrames(frames) {
	const ordered = frames.slice().sort((a, b) => a - b);
	return { frames: frames.length, medianFrameMs: ordered[Math.floor(ordered.length / 2)] ?? null,
		p95FrameMs: ordered[Math.floor(ordered.length * .95)] ?? null,
		maxFrameMs: Math.max(0, ...frames), framesOver33Ms: frames.filter(value => value > 33.4).length };
}
