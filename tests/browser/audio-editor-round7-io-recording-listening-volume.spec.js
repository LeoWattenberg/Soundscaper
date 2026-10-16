/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';

test.use({ browserCoverage: false });

test('ordinary input monitoring follows live Playback volume while preserving captured PCM', async ({ page }) => {
	await installOscillatorMicrophone(page);
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
				outputs.set(this, [...(outputs.get(this) ?? []), args[0]]);
			}
			return result;
		};
		globalThis.__recordingMonitorGains = () => {
			const levels = [];
			const visit = (node, level, visited) => {
				if (visited.has(node)) return;
				visited.add(node);
				const scheduled = node instanceof GainNode ? scheduledValues.get(node.gain) : null;
				const gain = node instanceof GainNode ? scheduled && scheduled.time <= node.context.currentTime
					? scheduled.value : node.gain.value : 1;
				if (node instanceof AudioDestinationNode) levels.push(level * gain);
				else for (const output of outputs.get(node) ?? []) visit(output, level * gain, visited);
			};
			for (const node of recorders) visit(node, 1, new Set());
			return levels;
		};
		globalThis.__recordingInputFrames = 0;
		globalThis.__recordingInputPeak = 0;
		const NativeWorklet = AudioWorkletNode;
		globalThis.AudioWorkletNode = class extends NativeWorklet {
			constructor(context, name, options) {
				super(context, name, options);
				if (name !== 'kw-audio-recorder') return;
				recorders.push(this);
				this.port.addEventListener('message', ({ data }) => {
					if (data.type !== 'audio-chunk') return;
					globalThis.__recordingInputFrames += data.frames;
					for (const channel of data.channels) for (const value of channel) {
						globalThis.__recordingInputPeak = Math.max(globalThis.__recordingInputPeak, Math.abs(value));
					}
				});
				this.port.start();
			}
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Record level', exact: true }).click();
	const monitoring = editor.getByRole('checkbox', { name: 'Turn on input monitoring (hear yourself while recording)', exact: true });
	await monitoring.click();
	await expect(monitoring).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await record.click();
	await expect(record).toHaveAttribute('aria-label', 'Pause recording');
	await expect.poll(() => page.evaluate(() => globalThis.__recordingInputFrames)).toBeGreaterThan(8_192);
	expect(await page.evaluate(() => globalThis.__recordingInputPeak)).toBeGreaterThan(0.05);
	await expect.poll(() => page.evaluate(() => globalThis.__recordingMonitorGains())).toEqual([1]);
	const volume = editor.getByRole('slider', { name: 'Playback volume', exact: true });
	await volume.fill('0');
	await expect(volume).toHaveAttribute('aria-valuetext', '−∞ dB');
	await expect.poll(() => page.evaluate(() => globalThis.__recordingMonitorGains())).toEqual([0]);
	const before = await page.evaluate(() => globalThis.__recordingInputFrames);
	await expect.poll(() => page.evaluate(() => globalThis.__recordingInputFrames)).toBeGreaterThan(before + 4_096);
	await volume.fill('1');
	await expect.poll(() => page.evaluate(() => globalThis.__recordingMonitorGains())).toEqual([1]);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	const project = await persistedProject(page, projectId);
	expect(project.sources[0].frameCount).toBeGreaterThan(12_288);
});
