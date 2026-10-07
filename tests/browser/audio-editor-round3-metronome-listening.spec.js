/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

test('Playback volume also mutes the enabled metronome', async ({ page }) => {
	await page.addInitScript(() => {
		const outputs = new WeakMap();
		const values = new WeakMap();
		const setValueAtTime = AudioParam.prototype.setValueAtTime;
		AudioParam.prototype.setValueAtTime = function (value, time) {
			const result = Reflect.apply(setValueAtTime, this, [value, time]);
			values.set(this, { value, time });
			return result;
		};
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (...args) {
			const result = Reflect.apply(connect, this, args);
			if (args[0] instanceof AudioNode) outputs.set(this, [...(outputs.get(this) ?? []), args[0]]);
			return result;
		};
		window.__round3MetronomeGains = [];
		const start = OscillatorNode.prototype.start;
		OscillatorNode.prototype.start = function (...args) {
			const seen = new Set();
			const visit = (node, level) => {
				if (seen.has(node)) return;
				seen.add(node);
				const scheduled = node instanceof GainNode ? values.get(node.gain) : null;
				const value = node instanceof GainNode ? scheduled && scheduled.time <= node.context.currentTime
					? scheduled.value : node.gain.value : 1;
				const gain = level * value;
				if (node instanceof AudioDestinationNode) window.__round3MetronomeGains.push(gain);
				else for (const next of outputs.get(node) ?? []) visit(next, gain);
			};
			visit(this, 1);
			return Reflect.apply(start, this, args);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [longTone]);
	await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
	const customize = page.getByRole('dialog', { name: 'Customize toolbar', exact: true });
	await customize.getByRole('checkbox', { name: 'Metronome', exact: true }).click();
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Metronome', exact: true }).click();
	await editor.getByRole('slider', { name: 'Playback volume', exact: true }).fill('0');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__round3MetronomeGains.length)).toBeGreaterThan(0);
	expect(await page.evaluate(() => window.__round3MetronomeGains.every(gain => gain === 0))).toBe(true);
	await editor.getByRole('slider', { name: 'Playback volume', exact: true }).fill('1');
	await expect.poll(() => page.evaluate(() => window.__round3MetronomeGains.some(gain => gain > 0))).toBe(true);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
