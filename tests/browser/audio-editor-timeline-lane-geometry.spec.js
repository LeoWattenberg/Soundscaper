/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test } from './audio-editor-test-fixtures.js';

test('retained lane geometry follows scrolling and synchronous row layout changes', async ({ page }) => {
	const bundled = await build({
		entryPoints: [fileURLToPath(new URL('../../src/common/editor/ui/timeline/timeline-lane-geometry.ts', import.meta.url))],
		bundle: true, write: false, format: 'iife', globalName: 'laneGeometry', target: 'es2022',
	});
	await page.addScriptTag({ content: bundled.outputFiles[0].text });
	const result = await page.evaluate(() => {
		const root = document.createElement('div');
		root.style.cssText = 'height:300px;width:400px;overflow:auto';
		const surface = document.createElement('div'); surface.className = 'audio-editor-timeline-inner';
		const list = document.createElement('div'); list.dataset.trackList = '';
		surface.append(list); root.append(surface); document.body.append(root);
		let reads = 0;
		for (let index = 0; index < 100; index++) {
			const row = document.createElement('div'); row.className = 'audio-editor-track-row'; row.style.height = '100px';
			if (index === 1) row.dataset.labelTrack = '';
			const lane = document.createElement('div'); lane.dataset.trackLane = ''; lane.dataset.trackId = `track-${index}`;
			lane.style.height = '100%'; row.append(lane); list.append(row);
			for (const element of [row, lane]) {
				const original = element.getBoundingClientRect.bind(element);
				element.getBoundingClientRect = () => { reads++; return original(); };
			}
		}
		const owner = globalThis.laneGeometry.acquireTimelineLaneGeometry(root);
		owner.prepare();
		const initialReads = reads;
		const top = root.getBoundingClientRect().top;
		const initialHit = owner.trackAt(top + 250, 'fallback', 'new-track', 0);
		const initialSelection = owner.selection('track-0', top + 250);
		for (let index = 0; index < 100; index++) owner.trackAt(top + 50, 'fallback', 'new-track', 0);
		root.scrollTop = 500;
		const scrolledHit = owner.trackAt(top + 50, 'fallback', 'new-track', 0);
		const steadyReads = reads - initialReads;
		root.scrollTop = 0;
		list.children[1].style.height = '200px';
		// Mutation records must invalidate before their asynchronous delivery.
		const resizedHit = owner.trackAt(top + 250, 'fallback', 'new-track', 0);
		const belowResizedHit = owner.trackAt(top + 350, 'fallback', 'new-track', 0);
		const layoutReads = reads - initialReads;
		owner.dispose();
		const released = globalThis.laneGeometry.readTimelineLaneGeometry(root) === null;
		root.remove();
		return { initialHit, initialSelection, scrolledHit, steadyReads, resizedHit, belowResizedHit, layoutReads, released };
	});
	expect(result).toEqual({ initialHit: 'track-2', initialSelection: ['track-0', 'track-1', 'track-2'],
		scrolledHit: 'track-5', steadyReads: 0, resizedHit: 'fallback', belowResizedHit: 'track-2', layoutReads: 200, released: true });
});
