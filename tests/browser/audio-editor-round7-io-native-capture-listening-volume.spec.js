/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { expectCapturePhase, openRecordingSetup, selectSourceRoles } from './helpers/framescaper-capture-harness.js';

test.use({ browserCoverage: false });

for (const mute of [false, true]) test(`Recording setup microphone monitoring ${mute ? 'follows listening mute' : 'preserves full-level monitoring'} without muting captured PCM`, async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
			configurable: true,
			value: async () => {
				const context = new AudioContext({ sampleRate: 48_000 });
				const oscillator = context.createOscillator();
				const gain = context.createGain();
				const destination = context.createMediaStreamDestination();
				oscillator.frequency.value = 220;
				gain.gain.value = 0.12;
				oscillator.connect(gain).connect(destination);
				oscillator.start();
				await context.resume();
				globalThis.__captureMicrophoneSource = { context, oscillator, gain, destination };
				return destination.stream;
			},
		});
	});
	await page.addInitScript(() => {
		const outputs = new WeakMap();
		const recorders = [];
		const scheduledValues = new WeakMap();
		const setValue = AudioParam.prototype.setValueAtTime;
		AudioParam.prototype.setValueAtTime = function (value, time) {
			const result = Reflect.apply(setValue, this, [value, time]);
			scheduledValues.set(this, { value, time });
			return result;
		};
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (...args) {
			const result = Reflect.apply(connect, this, args);
			if (args[0] instanceof AudioNode) {
				const edges = outputs.get(this) ?? [];
				const edge = { destination: args[0], output: args[1] ?? 0, input: args[2] ?? 0 };
				if (!edges.some(candidate => candidate.destination === edge.destination
					&& candidate.output === edge.output && candidate.input === edge.input)) outputs.set(this, [...edges, edge]);
			}
			return result;
		};
		const disconnect = AudioNode.prototype.disconnect;
		AudioNode.prototype.disconnect = function (...args) {
			const result = Reflect.apply(disconnect, this, args);
			outputs.set(this, (outputs.get(this) ?? []).filter(edge => {
				if (args.length === 0) return false;
				if (typeof args[0] === 'number') return edge.output !== args[0];
				return edge.destination !== args[0] || (args.length > 1 && edge.output !== args[1])
					|| (args.length > 2 && edge.input !== args[2]);
			}));
			return result;
		};
		globalThis.__captureMonitorGains = () => {
			const levels = [];
			const visit = (node, level, visited) => {
				if (visited.has(node)) return;
				visited.add(node);
				const scheduled = node instanceof GainNode ? scheduledValues.get(node.gain) : null;
				const gain = node instanceof GainNode ? scheduled && scheduled.time <= node.context.currentTime
					? scheduled.value : node.gain.value : 1;
				if (node instanceof AudioDestinationNode) levels.push(level * gain);
				else for (const output of outputs.get(node) ?? []) visit(output.destination, level * gain, visited);
			};
			for (const recorder of recorders) visit(recorder, 1, new Set());
			return levels;
		};
		globalThis.__captureFrames = 0;
		globalThis.__capturePeak = 0;
		const NativeWorklet = AudioWorkletNode;
		globalThis.AudioWorkletNode = class extends NativeWorklet {
			constructor(context, name, options) {
				super(context, name, options);
				if (name !== 'kw-audio-recorder') return;
				recorders.push(this);
				this.port.addEventListener('message', ({ data }) => {
					if (data.type !== 'audio-chunk') return;
					globalThis.__captureFrames += data.frames;
					for (const channel of data.channels) for (const value of channel) {
						globalThis.__capturePeak = Math.max(globalThis.__capturePeak, Math.abs(value));
					}
				});
				this.port.start();
			}
		};
	});
	const editor = await bootEditor(page, '/framescaper/en/');
	const panel = await openRecordingSetup(page, editor);
	await selectSourceRoles(panel, ['microphone']);
	await panel.getByRole('button', { name: 'Preview sources', exact: true }).click();
	await expectCapturePhase(panel, 'previewing');
	await panel.getByRole('combobox', { name: 'Countdown', exact: true }).selectOption('0');
	await panel.getByRole('checkbox', { name: 'Monitor microphone', exact: true }).check();
	await panel.getByRole('button', { name: 'Arm capture', exact: true }).click();
	await expectCapturePhase(panel, 'armed');
	await panel.getByRole('button', { name: 'Start capture', exact: true }).click();
	await expectCapturePhase(panel, 'recording');
	await expect.poll(() => page.evaluate(() => globalThis.__captureFrames)).toBeGreaterThan(8_192);
	expect(await page.evaluate(() => globalThis.__capturePeak)).toBeGreaterThan(0.05);
	await expect.poll(() => page.evaluate(() => globalThis.__captureMonitorGains())).toEqual([1]);
	const volume = editor.getByRole('slider', { name: 'Playback volume', exact: true });
	if (mute) {
		await volume.fill('0');
		await expect(volume).toHaveAttribute('aria-valuetext', '−∞ dB');
		await expect.poll(() => page.evaluate(() => globalThis.__captureMonitorGains())).toEqual([0]);
	}
	const before = await page.evaluate(() => globalThis.__captureFrames);
	await expect.poll(() => page.evaluate(() => globalThis.__captureFrames)).toBeGreaterThan(before + 4_096);
	await volume.fill('1');
	await expect.poll(() => page.evaluate(() => globalThis.__captureMonitorGains())).toEqual([1]);
	await panel.getByRole('button', { name: 'Stop and import', exact: true }).click();
	await expectCapturePhase(panel, 'inactive', 30_000);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await expect(editor.locator('[data-project-bin-item]')).toHaveCount(1);
});
