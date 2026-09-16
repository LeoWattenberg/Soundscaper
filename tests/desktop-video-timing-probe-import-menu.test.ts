/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDesktopVideoTimingProbeStorageProfile,
	runDesktopVideoTimingProbeRendererSmoke,
} from '../desktop/video-timing-probe-smoke.js';

for (const productId of ['soundscaper', 'framescaper']) {
	test(`${productId} timing probe imports through File when the project bin is closed`, async context => {
		let clock = 0;
		context.mock.method(Date, 'now', () => clock);
		let menuClicks = 0;
		let menuMounted = false;
		const file = { textContent: 'File', click: () => { menuClicks++; } };
		const importItem = {
			getAttribute: () => null,
			querySelector: () => ({ textContent: 'Import' }),
			click: () => { throw new Error('ordinary menu Import invoked'); },
		};
		const editor = {
			getAttribute: () => 'true',
			querySelector: () => ({ getAttribute: () => 'success' }),
		};
		const scope = {
			document: {
				querySelector: (selector: string) => selector === '[data-audio-editor]' ? editor : null,
				querySelectorAll: (selector: string) => {
					if (selector.includes('menubar')) return [file];
					if (selector.includes('menuitem') && menuMounted) return [importItem];
					return [];
				},
			},
			setTimeout: (callback: () => void) => {
				clock += 100;
				menuMounted = menuClicks > 0;
				if (clock > 15_000) throw new Error('File menu Import was never invoked');
				callback();
			},
		};
		await assert.rejects(
			runDesktopVideoTimingProbeRendererSmoke(scope, { productId }, createDesktopVideoTimingProbeStorageProfile(productId)),
			/ordinary menu Import invoked/u,
		);
		assert.equal(menuClicks, 1, 'opening twice would toggle the menu closed before React renders it');
	});
}

for (const state of ['working', 'disabled']) {
	test(`timing probe leaves a ${state} File menu Import untouched`, async context => {
		let clockReads = 0;
		context.mock.method(Date, 'now', () => clockReads++ < 2 ? 0 : 20_000);
		const editor = {
			getAttribute: () => 'true',
			querySelector: () => ({ getAttribute: () => state === 'working' ? 'working' : 'success' }),
		};
		const importItem = {
			getAttribute: () => state === 'disabled' ? 'true' : null,
			querySelector: () => ({ textContent: 'Import' }),
			click: () => { throw new Error('Import must remain untouched'); },
		};
		const scope = {
			document: {
				querySelector: (selector: string) => selector === '[data-audio-editor]' ? editor : null,
				querySelectorAll: (selector: string) => selector.includes('menuitem') ? [importItem] : [],
			},
			setTimeout: (callback: () => void) => { callback(); },
		};
		await assert.rejects(
			runDesktopVideoTimingProbeRendererSmoke(scope, { productId: 'soundscaper' }, createDesktopVideoTimingProbeStorageProfile('soundscaper')),
			/ordinary Import control is unavailable/u,
		);
	});
}
