/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';
import { createRound7ExternalDisplayNativeFixture } from '../helpers/round7-external-display-native-fixture.ts';

test('ordinary External display switching refuses a retired actual preview MessagePort frame', async ({ page }) => {
	test.setTimeout(60_000);
	const errors = collectClientErrors(page);
	const native = createRound7ExternalDisplayNativeFixture();
	try {
		await page.exposeBinding('__round7DisplayNative', async (_context, method, request) => {
			if (method === 'presentExternalDisplay') request = { ...request, rgba: Uint8Array.from(request.rgba) };
			return await native.bridge[method](request);
		});
		await page.addInitScript(() => {
			const nativeServices = Object.fromEntries(['snapshot', 'control', 'reorder', 'remove', 'capabilities',
				'preferences', 'externalDisplays', 'setExternalDisplay', 'presentExternalDisplay'].map(method => [method,
				async request => window.__round7DisplayNative(method, method === 'presentExternalDisplay'
					? { ...request, rgba: Array.from(request.rgba) } : request)]));
			const controls = { probeHelperEnabled: false, probeHelperQuarantined: false,
				audioHelperEnabled: false, audioHelperQuarantined: false, nativeEffectDiscoveryEnabled: false };
			Object.defineProperty(window, 'framescaperDesktop', { configurable: true, enumerable: true, value: Object.freeze({ v1: Object.freeze({
				nativeServices: Object.freeze(nativeServices),
				getExternalFfmpegStatus: async () => ({ state: 'unconfigured', location: null, version: null,
					detail: '', canInstall: false, canBrowse: false, canClear: false }),
				readNativeTierControls: async () => ({ ...controls }), applyNativeTierControl: async () => ({ ...controls }),
			}) }) });
		});
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		test.skip(!await page.evaluate(hasWebGl2Capability), 'Clean display requires the real evaluated framebuffer.');
		await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
		const preview = editor.locator('[data-video-preview]');
		await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready', { timeout: 30_000 });
		await expect(preview).toHaveAttribute('data-video-preview-visual-pending', 'false');
		const selectDisplay = async name => {
			await chooseNestedCommandAction(page, editor, 'View', ['External display', name]);
		};
		await selectDisplay('Programme A');
		await seekFramescaperTimecode(page, editor, '00:00:00:01');
		await expect.poll(() => native.frames.length).toBeGreaterThan(0);
		expect(native.frames.every(({ windowId }) => windowId === 1)).toBe(true);
		native.arm();
		await seekFramescaperTimecode(page, editor, '00:00:00:02');
		await expect.poll(() => native.heldSequence()).not.toBeNull();
		const retiredSequence = native.heldSequence();
		await selectDisplay('None');
		await selectDisplay('Programme B');
		expect(native.windowCount()).toBe(2);
		native.release();
		await expect.poll(() => native.settlements.find(({ sequence }) => sequence === retiredSequence)?.outcome).toBe('failure');
		expect(native.frames.some(({ windowId, sequence }) => windowId === 2 && sequence === retiredSequence)).toBe(false);
		await seekFramescaperTimecode(page, editor, '00:00:00:03');
		await expect.poll(() => native.frames.filter(({ windowId }) => windowId === 2).length).toBeGreaterThan(0);
		await selectDisplay('None');
		expect(errors).toEqual([]);
	} finally {
		native.release();
		await native.dispose();
	}
});
