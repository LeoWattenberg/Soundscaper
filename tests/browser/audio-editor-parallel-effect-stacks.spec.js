/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction, closeDialog,
	closeEffectsPanel, collectClientErrors, commitInput, importFiles, openEffectsForTrack,
	openNestedCommandMenu, waitForEditor,
} from './audio-editor-test-helpers.js';

// Realtime deadline qualification must run without V8 coverage instrumentation.
test.use({ browserCoverage: false });

// Finite playback must outlast the 20-second readiness observation window.
const tones = [330, 660].map((frequency, index) => createWavFixture({
	name: `parallel-stack-${String(index)}.wav`, frequency, duration: 32, channelCount: 1,
}));

async function installParallelStackProbe(page) {
	await page.addInitScript(() => {
		const probe = { workers: [], generations: [], errors: [] };
		Object.defineProperty(globalThis, '__parallelStackProbe', { configurable: true, value: probe });
		Object.defineProperty(globalThis, 'soundscaperDesktop', {
			configurable: true,
			value: Object.freeze({ v1: Object.freeze({
				getEnvironment: async () => ({ platform: 'linux' }),
				getExternalFfmpegStatus: async () => ({
					state: 'unconfigured', location: null, version: null, detail: '',
					canInstall: false, canBrowse: false, canClear: false,
				}),
			}) }),
		});
		const NativeWorker = globalThis.Worker;
		globalThis.Worker = class extends NativeWorker {
			constructor(url, options) {
				super(url, options);
				this.parallelStackRecord = null;
				this.addEventListener('message', ({ data }) => {
					const record = this.parallelStackRecord;
					if (!record) return;
					if (data?.type === 'ready') record.ready = true;
					if (data?.type === 'started') record.started = true;
					if (data?.type === 'stopped') record.stopped = true;
					if (data?.type === 'error') probe.errors.push(data.message ?? 'Parallel worker failed');
				});
				this.addEventListener('error', (event) => {
					if (this.parallelStackRecord) probe.errors.push(event.message || 'Parallel worker failed');
				});
			}
			postMessage(message, transfer) {
				if (message?.type === 'prepare' && message.shared?.control instanceof SharedArrayBuffer
					&& message.plan?.tasks && Number.isInteger(message.workerIndex)) {
					this.parallelStackRecord = {
						generation: message.shared.geometry.generation, workerIndex: message.workerIndex,
						ready: false, started: false, stopped: false, terminated: false,
					};
					probe.workers.push(this.parallelStackRecord);
					if (!probe.generations.some(({ shared }) => shared.control === message.shared.control)) {
						probe.generations.push({ shared: message.shared, plan: message.plan, effectMailbox: message.effectMailbox });
					}
				}
				return super.postMessage(message, transfer);
			}
			terminate() {
				if (this.parallelStackRecord) this.parallelStackRecord.terminated = true;
				return super.terminate();
			}
		};
		// Test-only observers. Shared PCM is never changed by these probes.
		probe.completed = () => {
			const generation = probe.generations.at(-1);
			if (!generation) return [];
			const { geometry, control } = generation.shared;
			const words = new Int32Array(control);
			const latest = Array(geometry.workerCount).fill(-1);
			for (let bank = 0; bank < geometry.bankCount; bank += 1) {
				const offset = 4 + geometry.workerCount * 2 + bank * (5 + geometry.taskCount);
				const sequence = Atomics.load(words, offset + 1) >>> 0;
				for (let task = 0; task < geometry.taskCount; task += 1) {
					if (Atomics.load(words, offset + 5 + task) !== 2) continue;
					const worker = generation.plan.tasks[task].worker;
					if ((Atomics.load(words, offset + 1) >>> 0) === sequence) latest[worker] = Math.max(latest[worker], sequence);
				}
			}
			return latest;
		};
		probe.captureTrackBlocks = (durationMs) => new Promise((resolve) => {
			const generation = probe.generations.at(-1);
			if (!generation) { resolve({ sampleRate: 0, blocks: [] }); return; }
			const { shared, plan } = generation;
			const effectTracks = plan.tasks.filter((task) => task.kind === 'stack' && task.inputPlanes.length
				&& task.effects.some((effect) => effect.type === 'bitcrusher'));
			if (effectTracks.length !== 2) { resolve({ sampleRate: plan.sampleRate, blocks: [] }); return; }
			const { geometry } = shared;
			const words = new Int32Array(shared.control);
			const pcm = new Float32Array(shared.pcm);
			const captured = new Map();
			const sample = () => {
				for (let bank = 0; bank < geometry.bankCount; bank += 1) {
					const offset = 4 + geometry.workerCount * 2 + bank * (5 + geometry.taskCount);
					const sequence = (Atomics.load(words, offset + 1) >>> 0)
						+ (Atomics.load(words, offset + 2) >>> 0) * 2 ** 32;
					const state = Atomics.load(words, offset);
					if (state !== 3 && state !== 4) continue;
					if (captured.has(sequence)) continue;
					const first = (bank * geometry.planeCount + effectTracks[0].inputPlanes[0]) * geometry.blockFrames;
					const second = (bank * geometry.planeCount + effectTracks[1].inputPlanes[0]) * geometry.blockFrames;
					const block = { sequence, a: [pcm[first], pcm[first + 1]], b: [pcm[second], pcm[second + 1]] };
					const stillSame = (Atomics.load(words, offset + 1) >>> 0)
						+ (Atomics.load(words, offset + 2) >>> 0) * 2 ** 32 === sequence;
					const finalState = Atomics.load(words, offset);
					if (stillSame && (finalState === 3 || finalState === 4)) captured.set(sequence, block);
				}
			};
			const interval = setInterval(sample, 1);
			setTimeout(() => { clearInterval(interval); sample(); resolve({ sampleRate: plan.sampleRate,
				blocks: [...captured.values()].sort((a, b) => a.sequence - b.sequence) }); }, durationMs);
		});
		probe.signal = () => {
			const generation = probe.generations.at(-1);
			if (!generation) return { peak: 0, changed: false };
			const { shared, plan } = generation;
			const { geometry } = shared;
			const words = new Int32Array(shared.control);
			const samples = new Float32Array(shared.pcm);
			let peak = 0;
			let changed = false;
			for (let bank = 0; bank < geometry.bankCount; bank += 1) {
				const offset = 4 + geometry.workerCount * 2 + bank * (5 + geometry.taskCount);
				const sequence = Atomics.load(words, offset + 1);
				if (Atomics.load(words, offset + 3) !== 0) continue;
				const base = bank * geometry.planeCount * geometry.blockFrames;
				let bankChanged = false;
				let bankPeak = 0;
				for (const task of plan.tasks) {
					if (!task.effects.some((effect) => effect.type === 'bitcrusher')) continue;
					const before = base + task.inputPlanes[0] * geometry.blockFrames;
					const after = base + task.prePlanes[0] * geometry.blockFrames;
					for (let frame = 0; frame < geometry.blockFrames; frame += 1) {
						bankChanged ||= Math.abs(samples[before + frame] - samples[after + frame]) > 0.000001;
					}
				}
				for (const plane of plan.outputs[0].planes) {
					for (let frame = 0; frame < geometry.blockFrames; frame += 1) {
						bankPeak = Math.max(bankPeak, Math.abs(samples[base + plane * geometry.blockFrames + frame]));
					}
				}
				if (Atomics.load(words, offset + 1) === sequence && Atomics.load(words, offset + 3) === 0) {
					changed ||= bankChanged;
					peak = Math.max(peak, bankPeak);
				}
			}
			return { peak, changed };
		};
		probe.effectDifferences = (effectType) => {
			const generation = probe.generations.at(-1);
			if (!generation) return null;
			const { shared, plan } = generation;
			const tasks = plan.tasks.filter((task) => task.kind === 'stack' && task.inputPlanes.length
				&& task.effects.some((effect) => effect.type === effectType));
			if (tasks.length !== 2) return null;
			const { geometry } = shared;
			const words = new Int32Array(shared.control);
			const pcm = new Float32Array(shared.pcm);
			let newest = null;
			for (let bank = 0; bank < geometry.bankCount; bank += 1) {
				const offset = 4 + geometry.workerCount * 2 + bank * (5 + geometry.taskCount);
				const state = Atomics.load(words, offset);
				if (state !== 3 && state !== 4) continue;
				const sequence = (Atomics.load(words, offset + 1) >>> 0)
					+ (Atomics.load(words, offset + 2) >>> 0) * 2 ** 32;
				const differences = tasks.map((task) => {
					const before = (bank * geometry.planeCount + task.inputPlanes[0]) * geometry.blockFrames;
					const after = (bank * geometry.planeCount + task.prePlanes[0]) * geometry.blockFrames;
					let delta = 0;
					let input = 0;
					for (let frame = 0; frame < geometry.blockFrames; frame += 1) {
						delta += Math.abs(pcm[after + frame] - pcm[before + frame]);
						input += Math.abs(pcm[before + frame]);
					}
					return input > 1 ? delta / input : null;
				});
				if ((Atomics.load(words, offset + 1) >>> 0)
					+ (Atomics.load(words, offset + 2) >>> 0) * 2 ** 32 !== sequence
					|| ![3, 4].includes(Atomics.load(words, offset))) continue;
				if (!newest || sequence > newest.sequence) newest = { sequence, differences };
			}
			return newest;
		};
	});
}

async function openProcessingPreferences(page, editor) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
	return preferences;
}

async function closeProcessingPreferences(preferences) {
	await preferences.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: /^Close$/u }).click();
	await expect(preferences).toBeHidden();
}

async function enableParallelStacks(page, editor) {
	const preferences = await openProcessingPreferences(page, editor);
	await preferences.getByRole('checkbox', { name: 'Parallel effect stacks', exact: true }).check();
	await preferences.getByRole('combobox', { name: 'Worker limit', exact: true }).selectOption({ label: '2 workers' });
	await preferences.getByRole('combobox', { name: 'Buffering', exact: true }).selectOption({ label: 'Recommended' });
	await closeProcessingPreferences(preferences);
}

async function requireSharedMemoryAudioWorkers(page) {
	const supported = await page.evaluate(() => globalThis.crossOriginIsolated === true
		&& typeof SharedArrayBuffer === 'function' && typeof AudioWorkletNode === 'function');
	test.skip(!supported, 'This browser cannot share audio buffers with workers.');
}

test('Audio setup processing settings live in Preferences and persist across reloads', async ({ page }) => {
	await installParallelStackProbe(page);
	const editor = await bootEditor(page, '/embed/en/');
	const tools = await openNestedCommandMenu(page, editor, 'Tools', []);
	await expect(tools.getByRole('menuitem', { name: 'Audio setup', exact: true })).toHaveCount(0);
	await page.keyboard.press('Escape');
	let preferences = await openProcessingPreferences(page, editor);
	await expect(preferences.getByRole('checkbox', { name: 'Parallel effect stacks', exact: true })).not.toBeChecked();
	await expect(preferences.getByRole('combobox', { name: 'Worker limit', exact: true })).toHaveValue('parallel-stack-workers-auto');
	await closeProcessingPreferences(preferences);
	await enableParallelStacks(page, editor);
	await page.reload();
	await waitForEditor(page);
	preferences = await openProcessingPreferences(page, editor);
	await expect(preferences.getByRole('checkbox', { name: 'Parallel effect stacks', exact: true })).toBeChecked();
	await expect(preferences.getByRole('combobox', { name: 'Worker limit', exact: true })).toHaveValue('parallel-stack-workers-2');
	await expect(preferences.getByRole('combobox', { name: 'Buffering', exact: true })).toHaveValue('parallel-stack-buffering-1536');
	await expect(preferences.getByText('Ready for the next playback', { exact: true })).toBeVisible();
	await preferences.getByRole('checkbox', { name: 'Parallel effect stacks', exact: true }).uncheck();
	await expect(preferences.getByText('Parallel processing is off', { exact: true })).toBeVisible();
});

test('desktop effect stacks process in parallel through a main-thread stall and release each generation', async ({ page }) => {
	test.setTimeout(120_000);
	await installParallelStackProbe(page);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await requireSharedMemoryAudioWorkers(page);
	await importFiles(editor, tones);
	for (const trackIndex of [1, 2]) {
		const panel = await openEffectsForTrack(editor, trackIndex);
		await addRackEffect(page, panel, 'track', 'Bitcrusher');
		await closeDialog(page.getByRole('dialog', { name: 'Bitcrusher', exact: true }));
		await closeEffectsPanel(panel);
	}
	await enableParallelStacks(page, editor);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => {
		const probe = globalThis.__parallelStackProbe;
		const signal = probe.signal();
		const fill = document.querySelector('[data-mixer-panel] .kw-audio-editor__mixer-channel--master .mixer-channel__meter-fill');
		const level = fill ? fill.getBoundingClientRect().height / fill.parentElement.getBoundingClientRect().height * 100 : 0;
		return probe.workers.filter((worker) => worker.ready && worker.started).length === 2
			&& signal.peak > 0.05 && signal.changed && level > 20;
	}), { timeout: 20_000, message: 'two real workers must execute audible bitcrusher stacks and drive the output meter' }).toBe(true);
	const stall = await page.evaluate(() => {
		const probe = globalThis.__parallelStackProbe;
		const before = probe.completed();
		const until = performance.now() + 500;
		while (performance.now() < until) { /* Deliberately block only the renderer UI thread. */ }
		const after = probe.completed();
		const control = new Int32Array(probe.generations.at(-1).shared.control);
		return { before, after, signal: probe.signal(), status: Atomics.load(control, 0), fault: Atomics.load(control, 1) };
	});
	expect(stall.status).toBe(1);
	expect(stall.fault).toBe(0);
	expect(stall.signal.peak).toBeGreaterThan(0.05);
	expect(stall.signal.changed).toBe(true);
	expect(stall.before).toHaveLength(2);
	for (let worker = 0; worker < 2; worker += 1) expect(stall.after[worker] - stall.before[worker]).toBeGreaterThan(10);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__parallelStackProbe.workers.every((worker) => worker.terminated))).toBe(true);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => {
		const probe = globalThis.__parallelStackProbe;
		return probe.generations.length === 2 && probe.workers.slice(2).filter((worker) => worker.ready && worker.started).length === 2
			&& probe.signal().peak > 0.05;
	}), { timeout: 20_000 }).toBe(true);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(await page.evaluate(() => globalThis.__parallelStackProbe.errors)).toEqual([]);
	expect(errors).toEqual([]);
});

test('completed chunks keep both effect tracks sample aligned and in order', async ({ page }) => {
	test.setTimeout(90_000);
	await installParallelStackProbe(page);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await requireSharedMemoryAudioWorkers(page);
	await importFiles(editor, tones);
	for (const trackIndex of [1, 2]) {
		const panel = await openEffectsForTrack(editor, trackIndex);
		await addRackEffect(page, panel, 'track', 'Bitcrusher');
		await closeDialog(page.getByRole('dialog', { name: 'Bitcrusher', exact: true }));
		await closeEffectsPanel(panel);
	}
	await enableParallelStacks(page, editor);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => {
		const probe = globalThis.__parallelStackProbe;
		return probe.workers.filter((worker) => worker.ready && worker.started).length === 2 && probe.signal().peak > 0.05;
	}), { timeout: 20_000 }).toBe(true);
	const { sampleRate, blocks } = await page.evaluate(() => globalThis.__parallelStackProbe.captureTrackBlocks(450));
	const phase = (samples, frequency) => {
		const radians = 2 * Math.PI * frequency / sampleRate;
		return Math.atan2(samples[0], (samples[1] - samples[0] * Math.cos(radians)) / Math.sin(radians));
	};
	const phaseError = (actual, expected) => Math.abs(Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected)));
	const audibleBlocks = blocks.filter(({ a, b }) => Math.max(...a.map(Math.abs), ...b.map(Math.abs)) > 0.05);
	expect(audibleBlocks.length).toBeGreaterThan(8);
	for (const block of audibleBlocks) {
		expect(phaseError(phase(block.b, 660), 2 * phase(block.a, 330)),
			`Tracks are offset within completed block ${JSON.stringify(block)} at ${String(sampleRate)} Hz`).toBeLessThan(0.03);
	}
	let consecutive = 0;
	for (let index = 1; index < audibleBlocks.length; index += 1) {
		const previous = audibleBlocks[index - 1];
		const current = audibleBlocks[index];
		if (current.sequence !== previous.sequence + 1) continue;
		consecutive += 1;
		expect(phaseError(phase(current.a, 330), phase(previous.a, 330) + 2 * Math.PI * 330 * 256 / sampleRate),
			`Track chunks are out of order at sequence ${String(current.sequence)}`).toBeLessThan(0.03);
	}
	expect(consecutive).toBeGreaterThan(4);
	const status = await page.evaluate(() => {
		const words = new Int32Array(globalThis.__parallelStackProbe.generations.at(-1).shared.control);
		return { state: Atomics.load(words, 0), fault: Atomics.load(words, 1) };
	});
	expect(status).toEqual({ state: 1, fault: 0 });
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(errors).toEqual([]);
});

test('parallel effect controls preview and cancel on workers without rebuilding playback', async ({ page }) => {
	test.setTimeout(90_000);
	await installParallelStackProbe(page);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await requireSharedMemoryAudioWorkers(page);
	await importFiles(editor, [330, 660].map((frequency, index) => createWavFixture({
		name: `parallel-live-${String(index)}.wav`, frequency, duration: 32, channelCount: 1,
	})));
	for (const trackIndex of [1, 2]) {
		const panel = await openEffectsForTrack(editor, trackIndex);
		await addRackEffect(page, panel, 'track', 'Tremolo');
		const dialog = page.getByRole('dialog', { name: 'Tremolo', exact: true });
		await commitInput(dialog.locator('[data-effect-param="depth"]').getByRole('spinbutton'), '100');
		await closeDialog(dialog);
		await closeEffectsPanel(panel);
	}
	const panel = await openEffectsForTrack(editor, 1);
	await enableParallelStacks(page, editor);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => {
		const probe = globalThis.__parallelStackProbe;
		const differences = probe.effectDifferences('tremolo')?.differences;
		return probe.workers.filter((worker) => worker.ready && worker.started).length === 2
			&& differences?.length === 2 && differences.every((difference) => difference > 0.1);
	}), { timeout: 20_000 }).toBe(true);
	const initialRevision = await page.evaluate(() => {
		const mailbox = globalThis.__parallelStackProbe.generations[0].effectMailbox;
		return Atomics.load(new Int32Array(mailbox.control), 0);
	});
	await panel.locator('[data-effect-rack]').getByRole('group', { name: 'Tremolo', exact: true })
		.getByRole('button', { name: 'Select effect', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Tremolo', exact: true });
	const depth = dialog.locator('[data-effect-param="depth"]').getByRole('slider');
	const bounds = await depth.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds.x + bounds.width - 8, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + 8, bounds.y + bounds.height / 2, { steps: 5 });
	await expect.poll(() => page.evaluate((revision) => {
		const probe = globalThis.__parallelStackProbe;
		const mailbox = probe.generations[0].effectMailbox;
		const current = Atomics.load(new Int32Array(mailbox.control), 0);
		const differences = probe.effectDifferences('tremolo')?.differences;
		return probe.generations.length === 1 && probe.workers.filter((worker) => worker.started && !worker.stopped).length === 2
			&& current > revision && differences?.[0] < 0.00001 && differences?.[1] > 0.1;
	}, initialRevision), { timeout: 20_000, message: 'the held Depth gesture must change only the owning worker output' }).toBe(true);
	const previewRevision = await page.evaluate(() => {
		const mailbox = globalThis.__parallelStackProbe.generations[0].effectMailbox;
		return Atomics.load(new Int32Array(mailbox.control), 0);
	});
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect.poll(() => page.evaluate((revision) => {
		const probe = globalThis.__parallelStackProbe;
		const mailbox = probe.generations[0].effectMailbox;
		const current = Atomics.load(new Int32Array(mailbox.control), 0);
		const differences = probe.effectDifferences('tremolo')?.differences;
		return probe.generations.length === 1 && current > revision
			&& differences?.[0] > 0.1 && differences?.[1] > 0.1;
	}, previewRevision), { timeout: 20_000, message: 'Escape must restore the original audible effect without replacing workers' }).toBe(true);
	await expect(dialog).toBeHidden();
	await panel.locator('[data-effect-rack]').getByRole('group', { name: 'Tremolo', exact: true })
		.getByRole('button', { name: 'Select effect', exact: true }).click();
	await expect(dialog).toBeVisible();
	await expect(dialog.locator('[data-effect-param="depth"]').getByRole('spinbutton')).toHaveValue('100');
	await closeDialog(dialog);
	await closeEffectsPanel(panel);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(await page.evaluate(() => globalThis.__parallelStackProbe.errors)).toEqual([]);
	expect(errors).toEqual([]);
});

test('browsers without shared audio memory play through the standard engine', async ({ page }) => {
	test.setTimeout(90_000);
	await installParallelStackProbe(page);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const supported = await page.evaluate(() => globalThis.crossOriginIsolated === true
		&& typeof SharedArrayBuffer === 'function' && typeof AudioWorkletNode === 'function');
	test.skip(supported, 'Shared-memory audio workers are available in this browser.');
	await importFiles(editor, [tones[0]]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Bitcrusher');
	await closeDialog(page.getByRole('dialog', { name: 'Bitcrusher', exact: true }));
	await closeEffectsPanel(panel);
	await enableParallelStacks(page, editor);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect.poll(() => page.evaluate(() => {
		const fill = document.querySelector('[data-mixer-panel] .kw-audio-editor__mixer-channel--master .mixer-channel__meter-fill');
		return fill ? fill.getBoundingClientRect().height / fill.parentElement.getBoundingClientRect().height * 100 : 0;
	}), { timeout: 10_000 }).toBeGreaterThan(20);
	const preferences = await openProcessingPreferences(page, editor);
	await expect(preferences.getByText(/Using standard processing: Shared-memory audio workers are unavailable/)).toBeVisible();
	expect(await page.evaluate(() => globalThis.__parallelStackProbe.workers.length)).toBe(0);
	await closeProcessingPreferences(preferences);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(errors).toEqual([]);
});

test('unsupported desktop racks explain the conventional playback fallback', async ({ page }) => {
	test.setTimeout(90_000);
	await installParallelStackProbe(page);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [tones[0]]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Reverb');
	await closeDialog(page.getByRole('dialog', { name: 'Reverb', exact: true }));
	await closeEffectsPanel(panel);
	await enableParallelStacks(page, editor);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	const preferences = await openProcessingPreferences(page, editor);
	await expect(preferences.getByText(/Using standard processing:/)).toBeVisible();
	await expect(preferences.getByRole('checkbox', { name: 'Parallel effect stacks', exact: true })).toBeDisabled();
	await expect(preferences.getByRole('combobox', { name: 'Worker limit', exact: true })).toBeDisabled();
	await expect(preferences.getByRole('combobox', { name: 'Buffering', exact: true })).toBeDisabled();
	await expect(preferences.getByText('Stop playback and recording to change processing settings.', { exact: true })).toBeVisible();
	expect(await page.evaluate(() => globalThis.__parallelStackProbe.workers.length)).toBe(0);
	await closeProcessingPreferences(preferences);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(errors).toEqual([]);
});
