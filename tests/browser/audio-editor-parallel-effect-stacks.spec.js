/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseNestedCommandAction, closeDialog,
	closeEffectsPanel, collectClientErrors, importFiles, openEffectsForTrack,
	openNestedCommandMenu,
} from './audio-editor-test-helpers.js';

// Realtime deadline qualification must run without V8 coverage instrumentation.
test.use({ browserCoverage: false });

const tones = [330, 660].map((frequency, index) => createWavFixture({
	name: `parallel-stack-${String(index)}.wav`, frequency, duration: 16, channelCount: 1,
}));

async function installParallelStackProbe(page) {
	await page.addInitScript(() => {
		const probe = { workers: [], generations: [], errors: [] };
		Object.defineProperty(globalThis, '__parallelStackProbe', { configurable: true, value: probe });
		Object.defineProperty(globalThis, 'soundscaperDesktop', {
			configurable: true,
			value: Object.freeze({ v1: Object.freeze({ getEnvironment: async () => ({ platform: 'linux' }) }) }),
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
						probe.generations.push({ shared: message.shared, plan: message.plan });
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
					const state = Atomics.load(words, offset);
					if (state !== 3 && state !== 4) continue;
					const sequence = (Atomics.load(words, offset + 1) >>> 0)
						+ (Atomics.load(words, offset + 2) >>> 0) * 2 ** 32;
					if (captured.has(sequence)) continue;
					const first = (bank * geometry.planeCount + effectTracks[0].inputPlanes[0]) * geometry.blockFrames;
					const second = (bank * geometry.planeCount + effectTracks[1].inputPlanes[0]) * geometry.blockFrames;
					const block = { sequence, a: [pcm[first], pcm[first + 1]], b: [pcm[second], pcm[second + 1]] };
					const stillSame = (Atomics.load(words, offset + 1) >>> 0)
						+ (Atomics.load(words, offset + 2) >>> 0) * 2 ** 32 === sequence;
					if (stillSame && Atomics.load(words, offset) >= 2) captured.set(sequence, block);
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
	});
}

async function enableParallelStacks(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Tools', ['Audio setup', 'Processing', 'Parallel effect stacks']);
	await chooseNestedCommandAction(page, editor, 'Tools', ['Audio setup', 'Processing', 'Worker limit', '2 workers']);
	await chooseNestedCommandAction(page, editor, 'Tools', ['Audio setup', 'Processing', 'Buffering', 'Recommended']);
}

test('desktop effect stacks process in parallel through a main-thread stall and release each generation', async ({ page }) => {
	test.setTimeout(120_000);
	await installParallelStackProbe(page);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, tones);
	for (const trackIndex of [1, 2]) {
		const panel = await openEffectsForTrack(editor, trackIndex);
		await addRackEffect(page, panel, 'track', 'Bitcrusher');
		await closeDialog(page.getByRole('dialog', { name: 'Bitcrusher', exact: true }));
		await closeEffectsPanel(panel);
	}
	await enableParallelStacks(page, editor);
	await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => {
		const probe = globalThis.__parallelStackProbe;
		const signal = probe.signal();
		const fill = document.querySelector('[data-mixer-panel] .kw-audio-editor__mixer-channel--master .mixer-channel__meter-fill');
		return probe.workers.filter((worker) => worker.ready && worker.started).length === 2
			&& signal.peak > 0.05 && signal.changed && 100 - Number.parseFloat(fill?.style.top ?? '100') > 20;
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
	const menu = await openNestedCommandMenu(page, editor, 'Tools', ['Audio setup', 'Processing']);
	await expect(menu.getByRole('menuitem', { name: /Using standard processing:/ })).toBeVisible();
	await expect(menu.getByRole('menuitemcheckbox', { name: /Parallel effect stacks/ })).toBeDisabled();
	expect(await page.evaluate(() => globalThis.__parallelStackProbe.workers.length)).toBe(0);
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(errors).toEqual([]);
});
