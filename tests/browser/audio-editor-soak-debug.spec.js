/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import {
	createSoundscaperSoakPageSession,
	openSoundscaperSoakSession,
	prepareSoundscaperSoakContext,
} from '../../scripts/lib/soundscaper-soak-playwright.mjs';

test.describe('Soundscaper soak-debug UI driver', () => {
	registerAudioEditorHooks();

	test('executes every browser operation and samples the live renderer', async ({
		browserName, context, page,
	}, testInfo) => {
		test.skip(browserName !== 'chromium', 'Forced-GC heap sampling uses the Chromium DevTools protocol.');
		test.setTimeout(300_000);
		await prepareSoundscaperSoakContext(context);
		await bootEditor(page, '/embed/en/');
		const runtimeEvents = [];
		const session = await createSoundscaperSoakPageSession({
			page,
			context,
			target: 'browser',
			outputDirectory: testInfo.outputPath('soak-output'),
			onRuntimeEvent: async (type, details) => { runtimeEvents.push({ type, details }); },
			closeRuntime: async () => undefined,
		});
		try {
			const before = await session.sample();
			for (const [index, operationId] of [
				'media-import',
				'edit-history',
				'simulated-record-playback',
				'autosave-reload',
				'wav-render',
				'foreign-project-custody',
				'decoded-media-probe',
				'streamed-playback-diagnostics',
				'interrupted-take-recovery',
			].entries()) {
				const measurements = await session.execute(operationId, { variant: index + 1 });
				if (operationId === 'decoded-media-probe') {
					expect(measurements.decodedMediaAvDriftMaximumMs).toBeGreaterThanOrEqual(0);
					expect(measurements.decodedVideoDroppedFrames).toBeGreaterThanOrEqual(0);
				}
				if (operationId === 'streamed-playback-diagnostics') {
					expect(measurements.streamedPlaybackObserved).toBe(true);
					expect(measurements.streamUnderrunFrames).toBeGreaterThanOrEqual(0);
				}
			}
			const after = await session.sample();
			expect(before.usedJsHeapBytes).toBeGreaterThan(0);
			expect(after.usedJsHeapBytes).toBeGreaterThan(0);
			expect(before.electronWorkingSetBytes).toBeNull();
			expect(runtimeEvents.filter(({ type }) => type === 'page-error')).toEqual([]);
			expect(runtimeEvents.every(({ type, details }) => (
				type === 'console-error' && typeof details.message === 'string' && details.message.length > 0
			))).toBe(true);
		} finally {
			await session.close({ failed: false });
		}
	});

	test('aborts old UI work and resets onto a fresh page before continuing', async ({
		browserName, context, page,
	}, testInfo) => {
		test.skip(browserName !== 'chromium', 'The soak debugger uses the Chromium DevTools protocol.');
		test.setTimeout(120_000);
		await prepareSoundscaperSoakContext(context);
		await bootEditor(page, '/embed/en/');
		const session = await createSoundscaperSoakPageSession({
			page,
			context,
			target: 'browser',
			outputDirectory: testInfo.outputPath('soak-cancellation-output'),
			onRuntimeEvent: async () => undefined,
			closeRuntime: async () => undefined,
		});
		try {
			const operationAbort = new AbortController();
			const pending = session.execute('media-import', {
				variant: 41,
				signal: operationAbort.signal,
			});
			operationAbort.abort(new Error('test operation timed out'));
			await expect(pending).rejects.toThrow('test operation timed out');
			await session.reset({ reason: 'operation-timeout' });
			expect(page.isClosed()).toBe(true);
			await session.execute('media-import', { variant: 42 });
		} finally {
			await session.close({ failed: false });
		}
	});
});

test.describe('Soundscaper packaged soak-debug UI driver', () => {
	test('executes the current-host packaged operations and reads process metrics', async ({ browserName }, testInfo) => {
		test.skip(browserName !== 'chromium', 'Packaged Electron diagnostics require Chromium CDP.');
		const desktopExecutable = process.env.SOUNDSCAPER_SOAK_PACKAGED_EXECUTABLE;
		test.skip(!desktopExecutable, 'Set SOUNDSCAPER_SOAK_PACKAGED_EXECUTABLE to exercise a current-host package.');
		test.setTimeout(360_000);
		const runtimeEvents = [];
		let failed = true;
		const session = await openSoundscaperSoakSession({
			target: 'desktop', desktopExecutable, keepProfileOnFailure: false,
			outputDirectory: testInfo.outputPath('soak-output'),
			onRuntimeEvent: async (type, details) => { runtimeEvents.push({ type, details }); },
		});
		try {
			const before = await session.sample();
			for (const [index, operationId] of [
				'media-import',
				'edit-history',
				'simulated-record-playback',
				'autosave-reload',
				'wav-render',
				'foreign-project-custody',
				'decoded-media-probe',
				'streamed-playback-diagnostics',
				'interrupted-take-recovery',
			].entries()) await session.execute(operationId, { variant: index + 1 });
			const after = await session.sample();
			expect(before.electronWorkingSetBytes).toBeGreaterThan(0);
			expect(after.electronWorkingSetBytes).toBeGreaterThan(0);
			expect(runtimeEvents.filter(({ type }) => type === 'page-error')).toEqual([]);
			expect(runtimeEvents.every(({ type, details }) => (
				type === 'console-error' && typeof details.message === 'string' && details.message.length > 0
			))).toBe(true);
			failed = false;
		} finally {
			await session.close({ failed });
		}
	});

	test('recovers a real persistent delivery job in a packaged app with the native helper', async ({ browserName }, testInfo) => {
		test.skip(browserName !== 'chromium', 'Packaged Electron diagnostics require Chromium CDP.');
		const desktopExecutable = process.env.SOUNDSCAPER_SOAK_PERSISTENT_DELIVERY_EXECUTABLE;
		test.skip(!desktopExecutable,
			'Set SOUNDSCAPER_SOAK_PERSISTENT_DELIVERY_EXECUTABLE to an app with a verified delivery helper.');
		test.setTimeout(300_000);
		let failed = true;
		const session = await openSoundscaperSoakSession({
			target: 'desktop', desktopExecutable, keepProfileOnFailure: false,
			outputDirectory: testInfo.outputPath('delivery-soak-output'),
			onRuntimeEvent: async () => undefined,
		});
		try {
			await session.execute('media-import', { variant: 1 });
			await session.execute('autosave-reload', { variant: 2 });
			await session.execute('streamed-playback-diagnostics', { variant: 3 });
			await session.execute('desktop-persistent-delivery-recovery', { variant: 4 });
			failed = false;
		} finally {
			await session.close({ failed });
		}
	});
});
