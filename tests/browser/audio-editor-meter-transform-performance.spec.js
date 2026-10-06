/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';

test('solid meter transforms retain visible bounds without repeated layout', async ({ page }) => {
	const styles = await Promise.all(['02-overlays-search.css', '03-shell-toolbars-meters.css'].map(name =>
		readFile(new URL(`../../src/common/editor/ui/audio-editor-design-system/${name}`, import.meta.url), 'utf8')));
	await page.addStyleTag({ content: styles.join('\n') });
	const bounds = await page.evaluate(() => {
		const results = [];
		for (const orientation of ['horizontal', 'vertical']) {
			const surface = document.createElement('div');
			surface.className = `kw-audio-editor__playback-meter-surface kw-audio-editor__playback-meter-surface--${orientation}`;
			surface.dataset.meterStyle = 'default'; surface.dataset.meterType = 'db-log';
			const channel = document.createElement('div'); channel.style.cssText = 'position:relative;width:100px;height:100px';
			const fill = document.createElement('i'); fill.className = 'kw-audio-editor__playback-meter-peak';
			channel.append(fill); surface.append(channel); document.body.append(surface);
			for (const level of [0, 12.5, 55.5, 100]) {
				surface.style.setProperty('--playback-meter-peak', `${level}%`);
				surface.style.setProperty('--playback-meter-peak-transform', `${orientation === 'vertical' ? 'scaleY' : 'scaleX'}(${level / 100})`);
				surface.style.setProperty('--playback-meter-peak-origin', orientation === 'vertical' ? 'bottom' : 'left');
				fill.style.transition = 'none';
				const rect = fill.getBoundingClientRect(); const frame = channel.getBoundingClientRect();
				results.push({ orientation, level, width: rect.width, height: rect.height,
					x: rect.left - frame.left, bottom: frame.bottom - rect.bottom, layoutWidth: fill.offsetWidth, layoutHeight: fill.offsetHeight });
			}
			surface.remove();
		}
		return results;
	});
	for (const result of bounds) {
		expect(result.width).toBeCloseTo(result.orientation === 'horizontal' ? result.level : 100, 5);
		expect(result.height).toBeCloseTo(result.orientation === 'vertical' ? result.level : 100, 5);
		expect(result.x).toBe(0); expect(result.bottom).toBe(0);
		expect(result.layoutWidth).toBe(100); expect(result.layoutHeight).toBe(100);
	}
	const client = await page.context().newCDPSession(page);
	await client.send('Performance.enable');
	const layoutCount = async () => (await client.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'LayoutCount').value;
	const counts = [];
	for (const transform of [false, true]) {
		await page.evaluate(transform => {
			const frame = document.createElement('div'); frame.id = 'meter-frame'; frame.style.cssText = 'position:relative;width:20px;height:100px';
			const fill = document.createElement('div'); fill.id = 'meter-fill'; fill.style.cssText = 'position:absolute;left:0;right:0;bottom:0;background:#48b05e';
			if (transform) { fill.style.top = '0'; fill.style.height = '100%'; fill.style.transformOrigin = 'bottom'; fill.style.transform = 'scaleY(0)'; }
			else fill.style.top = '100%';
			frame.append(fill); document.body.append(frame); fill.getBoundingClientRect();
		}, transform);
		const before = await layoutCount();
		await page.evaluate(transform => {
			const fill = document.getElementById('meter-fill');
			for (let index = 0; index < 100; index++) {
				if (transform) fill.style.transform = `scaleY(${(index % 99 + 1) / 100})`;
				else fill.style.top = `${100 - (index % 99 + 1)}%`;
				fill.getBoundingClientRect();
			}
		}, transform);
		counts.push(await layoutCount() - before);
		await page.evaluate(() => document.getElementById('meter-frame').remove());
	}
	expect(counts[0]).toBe(100); expect(counts[1]).toBe(0);
	await client.detach();
});
