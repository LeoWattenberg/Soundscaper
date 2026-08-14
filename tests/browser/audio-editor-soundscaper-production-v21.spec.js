/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';

import {
	addRackEffect,
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseFileAction,
	chooseNestedCommandAction,
	closeDialog,
	closeEffectsPanel,
	commitInput,
	collectClientErrors,
	getMenuItem,
	importFiles,
	openClipProperties,
	openEffectsForTrack,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { longTone } from './audio-editor-test-fixtures.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';

const SOUNDSCAPER_DATABASE = 'kw-media-soundscaper-editor-v21';
const WEBKIT_AV_IMPORT_DEFERRED = 'Playwright WebKit rejects the IndexedDB Blob write that persists an imported A/V source.';
const FREEZE_SAMPLE_RATE = 48_000;
const FREEZE_INPUT_FRAMES = 256;
const FREEZE_INSERT_LATENCY_FRAMES = 240;
const FREEZE_DELAY_FRAMES = 48;
const productionTone = createProductionTone();
const freezeImpulse = createFreezeImpulse();

test.describe('Soundscaper exact V21 production UI', () => {
	registerAudioEditorHooks();

	test('keeps production surfaces lazy and reaches them through their owned menus', async ({ browserName, page }) => {
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor).toHaveAttribute('data-product', 'soundscaper');
		await expect(page.locator('[data-soundscaper-production-dialog]')).toHaveCount(0);
		await expect(editor.locator('[data-editor-surface="soundscaper-production"]')).toHaveCount(0);
		for (const label of ['Automation', 'Routing graph', 'Restoration', 'Production meters', 'Reviewed effects']) {
			await expect(editor.getByRole('button', { name: label, exact: true })).toHaveCount(0);
		}
		await expect.poll(() => page.evaluate(async () => (
			(await indexedDB.databases()).some(({ name }) => name === 'kw-media-soundscaper-editor-v21')
		))).toBe(true);

		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await expect(editor.locator('[data-track-row]')).toHaveCount(2);

		const tracksTrigger = applicationMenuTrigger(editor, 'Tracks');
		const tracks = await openMenu(page, editor, 'Tracks');
		const automation = getMenuItem(tracks, 'Automation');
		await automation.focus();
		await page.keyboard.press('ArrowRight');
		const automationMenu = automation.getByRole('menu');
		await expect(automationMenu).toBeVisible();
		const editLanes = getMenuItem(automationMenu, 'Edit lanes…');
		await expect(editLanes).toBeEnabled();
		await editLanes.focus();
		await page.keyboard.press('Enter');

		const dialog = page.getByRole('dialog', { name: 'Production audio', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAttribute('aria-modal', 'true');
		await expect(dialog.getByRole('tab', { name: 'Automation', exact: true })).toBeFocused();
		const operationStatus = dialog.getByRole('status').last();
		await expect(operationStatus).toHaveAttribute('aria-live', 'polite');
		await expect(operationStatus).toHaveAttribute('aria-atomic', 'true');
		await assertAccessibleBasics(dialog);
		await assertNoSeriousAxeViolations(page, '[data-soundscaper-production-dialog]');
		await page.emulateMedia({ forcedColors: 'active' });
		await expect(dialog).toHaveCSS('border-top-style', 'solid');
		// WebKit does not implement forced-color-adjust, so its computed value is
		// empty there rather than the inherited 'auto'.
		if (browserName !== 'webkit') {
			await expect(dialog).toHaveCSS('forced-color-adjust', 'auto');
			await expect(dialog.getByRole('tab', { name: 'Automation', exact: true }))
				.toHaveCSS('forced-color-adjust', 'auto');
		}
		await page.emulateMedia({ forcedColors: 'none' });
		await page.keyboard.press('End');
		await expect(dialog.getByRole('tab', { name: 'Reviewed effects', exact: true })).toBeFocused();
		await expect(dialog.getByRole('tabpanel')).toContainText('Utility Gain');
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(tracksTrigger).toBeFocused();

		const freezeTracks = await openMenu(page, editor, 'Tracks');
		const freeze = getMenuItem(freezeTracks, 'Freeze');
		await freeze.focus();
		await page.keyboard.press('ArrowRight');
		const freezeMenu = freeze.getByRole('menu');
		await expect(freezeMenu).toBeVisible();
		await expect(getMenuItem(freezeMenu, 'Freeze track')).toHaveAttribute('aria-disabled', 'true');
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');

		await assertMenuPath(page, editor, 'View', ['Panels', 'Mixer', 'Routing graph…']);
		await assertMenuPath(page, editor, 'Effect', ['Restoration…']);
		await assertMenuPath(page, editor, 'Analyze', ['Production meters…']);
		await assertMenuPath(page, editor, 'Tools', ['Reviewed effects…']);
		await expect(page.locator('[data-soundscaper-production-dialog]')).toHaveCount(0);
		await expect(editor.locator('[data-editor-surface="soundscaper-production"]')).toHaveCount(0);
		expect(clientErrors).toEqual([]);
	});

	test('imports exact-timing A/V with one aligned V21 media-lane duration', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'webkit', WEBKIT_AV_IMPORT_DEFERRED);
		test.setTimeout(90_000);
		await installPinnedFfmpegRuntimeRoutes(page);
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createDeterministicAvFixture('v21-exact-timing.webm')]);
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const stored = await readStoredSoundscaperProject(page, projectId);
		const videoSource = stored.sources.find(({ kind }) => kind === 'video');
		const audioSource = stored.sources.find(({ kind }) => kind === 'audio');
		const video = stored.clips.find(({ kind }) => kind === 'video');
		const audio = stored.clips.find(({ kind }) => kind === 'audio');
		const sequence = stored.sequences.find(({ id }) => id === video?.sequenceId);
		expect(stored.schemaVersion).toBe(21);
		expect(videoSource).toMatchObject({
			sourceFrameCount: 32, sampleFrameCount: 103_296, timingDecision: { mode: 'exact' },
		});
		expect(audioSource).toMatchObject({ frameCount: 104_000 });
		expect(video).toMatchObject({ sequenceStartFrame: 0, sequenceFrameCount: 65 });
		expect(audio).toMatchObject({
			timelineStartFrame: 0, durationFrames: 104_000, sourceDurationFrames: 104_000,
		});
		expect(video.avLinkId).toBeTruthy();
		expect(audio.avLinkId).toBe(video.avLinkId);
		expect(audio.durationFrames).toBe(Math.round(
			video.sequenceFrameCount * stored.sampleRate * sequence.rate.den / sequence.rate.num,
		));
		expect(clientErrors).toEqual([]);
	});

	test('authors one transport-synchronized touch gesture and reopens the durable lane', async ({ page }) => {
		test.setTimeout(90_000);
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [productionTone]);
		const track = editor.locator('[data-track-row]').last();
		await track.locator('[data-track-header]').click();
		await expect(track.locator('[data-track-lane]')).toHaveAttribute('data-selected', 'true');
		const trackId = await track.getAttribute('data-track-id');
		expect(trackId).toBeTruthy();

		const dialog = await openAutomationEditor(page, editor);
		const lane = automationLane(trackId);
		await dialog.getByText('Advanced canonical JSON', { exact: true }).click();
		await dialog.getByRole('textbox', { name: 'Canonical lane document', exact: true })
			.fill(JSON.stringify(lane, null, 2));
		await dialog.getByRole('button', { name: 'Apply lane', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Production audio change complete.');
		await expect(dialog.getByRole('combobox', { name: 'Automation lane', exact: true }))
			.toHaveValue(lane.id);
		const descriptor = dialog.locator('[data-automation-parameter-descriptor]');
		await expect(descriptor).toContainText('Gain');
		await expect(descriptor).toContainText('linear-gain');
		await expect(descriptor).toContainText('0 – 4');
		await expect(descriptor).toContainText('0.01');
		await expect(descriptor).toContainText('decibel');
		const timebase = dialog.getByRole('combobox', { name: 'Timebase', exact: true });
		await expect(timebase).toHaveValue('absolute-samples');
		await expect(timebase.getByRole('option')).toHaveText(['Absolute samples', 'Musical beats']);
		const firstPointValue = dialog.getByRole('spinbutton', { name: 'Point 1 value — Gain', exact: true });
		await expect(firstPointValue).toHaveAttribute('min', '0');
		await expect(firstPointValue).toHaveAttribute('max', '4');
		await expect(firstPointValue).toHaveAttribute('step', '0.01');
		await firstPointValue.fill('5');
		await expect(dialog.getByRole('alert')).toHaveText('The automation value is outside the descriptor range.');
		await firstPointValue.fill('0.6');
		await expect(dialog.getByText('Structured lane draft updated. Apply the lane to commit it.', { exact: true }))
			.toBeVisible();
		await dialog.getByRole('combobox', { name: 'Segment 1 curve', exact: true }).selectOption('hold');
		await dialog.getByRole('button', { name: 'Apply lane', exact: true }).click();
		await expect(dialog.getByRole('status').last()).toHaveText('Production audio change complete.');
		await closeProductionDialog(dialog);

		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		let historyDialog = await openAutomationEditor(page, editor);
		await expect(historyDialog.getByRole('spinbutton', { name: 'Point 1 value — Gain', exact: true }))
			.toHaveValue('0.5');
		await expect(historyDialog.getByRole('combobox', { name: 'Segment 1 curve', exact: true }))
			.toHaveValue('linear');
		await closeProductionDialog(historyDialog);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		historyDialog = await openAutomationEditor(page, editor);
		await expect(historyDialog.getByRole('spinbutton', { name: 'Point 1 value — Gain', exact: true }))
			.toHaveValue('0.6');
		await expect(historyDialog.getByRole('combobox', { name: 'Segment 1 curve', exact: true }))
			.toHaveValue('hold');
		await closeProductionDialog(historyDialog);

		const history = await openHistoryPanel(page, editor);
		const historyBeforeFreeze = await history.locator('[data-history-list] > li').count();
		await freezeSelectedTrack(page, editor, history, historyBeforeFreeze);
		const historyBeforeGesture = historyBeforeFreeze + 1;
		expect(historyBeforeGesture).toBeGreaterThan(0);
		const baselineDialog = await openAutomationEditor(page, editor);
		const laneBeforeGesture = await automationLaneDocument(baselineDialog);
		await closeProductionDialog(baselineDialog);

		await editor.getByRole('button', { name: 'Jump to project start', exact: true }).click();
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		const gestureDialog = await openAutomationEditor(page, editor);
		await gestureDialog.getByRole('combobox', { name: 'Mode', exact: true }).selectOption('touch');
		await expect(gestureDialog.getByRole('status')).toHaveText('Production audio change complete.');

		const gestureActions = gestureDialog.locator('[data-automation-gesture-active]');
		await gestureDialog.getByRole('button', { name: 'Begin gesture', exact: true }).click();
		await expect(gestureActions).toHaveAttribute('data-automation-gesture-active', 'true');
		const liveValue = gestureDialog.getByRole('spinbutton', { name: 'Live automation value', exact: true });
		await liveValue.fill('0.35');
		await gestureDialog.getByRole('button', { name: 'Preview value', exact: true }).click();
		await expect(gestureDialog.getByRole('status')).toHaveText('Production audio change complete.');
		await liveValue.fill('0.65');
		await gestureDialog.getByRole('button', { name: 'Release and commit', exact: true }).click();
		await expect(gestureActions).toHaveAttribute('data-automation-gesture-active', 'false');
		await expect(gestureDialog.getByRole('button', { name: 'Begin gesture', exact: true })).toBeEnabled();
		await expect(gestureDialog.getByRole('tab', { name: 'Automation', exact: true }))
			.toHaveAttribute('aria-selected', 'true');
		await expect(gestureDialog.getByRole('status')).toHaveText('Production audio change complete.');
		await closeProductionDialog(gestureDialog);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();

		await expect(history.locator('[data-history-list] > li'))
			.toHaveCount(historyBeforeGesture + 1);
		let gestureHistoryDialog = await openAutomationEditor(page, editor);
		const laneAfterGesture = await automationLaneDocument(gestureHistoryDialog);
		expect(laneAfterGesture).not.toEqual(laneBeforeGesture);
		await closeProductionDialog(gestureHistoryDialog);
		await historyButton(editor, 'Undo').click();
		gestureHistoryDialog = await openAutomationEditor(page, editor);
		expect(await automationLaneDocument(gestureHistoryDialog)).toEqual(laneBeforeGesture);
		await closeProductionDialog(gestureHistoryDialog);
		await historyButton(editor, 'Redo').click();
		gestureHistoryDialog = await openAutomationEditor(page, editor);
		expect(await automationLaneDocument(gestureHistoryDialog)).toEqual(laneAfterGesture);
		await closeProductionDialog(gestureHistoryDialog);
		await history.getByRole('button', { name: 'Close: History', exact: true }).click();
		await expect(history).toBeHidden();
		const clipDialog = await openClipProperties(page, editor, track.locator('[data-clip-id]').first());
		await commitInput(clipDialog.getByRole('spinbutton', { name: 'Clip gain (dB)', exact: true }), '-6');
		await closeDialog(clipDialog);
		await assertFreezeStatus(page, editor, 'Freeze (stale)');

		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const stored = await readStoredSoundscaperProject(page, projectId);
		expect(stored.schemaVersion).toBe(21);
		expect(stored.automationLanes).toHaveLength(1);
		expect(stored.automationLanes[0].id).toBe(lane.id);
		expect(stored.automationLanes[0]).not.toEqual(lane);
		expect(await page.evaluate(async () => (await indexedDB.databases())
			.some(({ name }) => name?.startsWith('kw-media-framescaper-editor-')))).toBe(false);

		const reopened = await bootEditor(page, `/embed/en/?project=${encodeURIComponent(projectId)}`);
		await expect(reopened).toHaveAttribute('data-project-id', projectId);
		const reopenedTrack = reopened.locator(`[data-track-row][data-track-id="${trackId}"]`);
		await reopenedTrack.locator('[data-track-header]').click();
		await expect(reopenedTrack.locator('[data-track-lane]')).toHaveAttribute('data-selected', 'true');
		const reopenedDialog = await openAutomationEditor(page, reopened);
		await expect(reopenedDialog.getByRole('combobox', { name: 'Automation lane', exact: true }))
			.toHaveValue(lane.id);
		await reopenedDialog.getByText('Advanced canonical JSON', { exact: true }).click();
		const reopenedLane = JSON.parse(await reopenedDialog
			.getByRole('textbox', { name: 'Canonical lane document', exact: true }).inputValue());
		expect(reopenedLane.id).toBe(lane.id);
		await closeProductionDialog(reopenedDialog);
		await assertFreezeStatus(page, reopened, 'Freeze (stale)');
		expect(clientErrors).toEqual([]);
	});

	test('freezes native AudioWorklet PCM with zero-boundary PDC and an exact insert tail', async ({ page }) => {
		test.setTimeout(90_000);
		await disableOpfsForRawPcmEvidence(page);
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [freezeImpulse]);
		const track = editor.locator('[data-track-row]').last();
		await track.locator('[data-track-header]').click();
		await expect(track.locator('[data-track-lane]')).toHaveAttribute('data-selected', 'true');
		const trackId = await track.getAttribute('data-track-id');
		const projectId = await editor.getAttribute('data-project-id');
		expect(trackId).toBeTruthy();
		expect(projectId).toBeTruthy();
		const history = await openHistoryPanel(page, editor);
		const historyBeforeResample = await history.locator('[data-history-list] > li').count();
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Sample rate', '48000 Hz']);
		await expect(history.locator('[data-history-list] > li'))
			.toHaveCount(historyBeforeResample + 1, { timeout: 10_000 });
		await history.getByRole('button', { name: 'Close: History', exact: true }).click();
		await expect(history).toBeHidden();

		const effectsPanel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, effectsPanel, 'track', 'Limiter');
		const limiter = page.getByRole('dialog', { name: 'Limiter', exact: true });
		await commitInput(limiter.locator('[data-effect-param="ceiling"] input'), '0');
		await commitInput(limiter.locator('[data-effect-param="lookahead"] input'), '0.005');
		await closeDialog(limiter);
		await addRackEffect(page, effectsPanel, 'track', 'Delay');
		const delay = page.getByRole('dialog', { name: 'Delay', exact: true });
		await commitInput(delay.locator('[data-effect-param="time"] input'), '0.001');
		await commitInput(delay.locator('[data-effect-param="feedback"] input'), '0');
		await commitInput(delay.locator('[data-effect-param="mix"] input'), '0.5');
		await closeDialog(delay);
		await closeEffectsPanel(effectsPanel);

		await installNativeFreezeObservation(page);
		const freezeHistory = await openHistoryPanel(page, editor);
		const historyBefore = await freezeHistory.locator('[data-history-list] > li').count();
		await freezeSelectedTrack(page, editor, freezeHistory, historyBefore);
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

		const [pcm, nativeRender] = await Promise.all([
			readFrozenRawPcm(page, projectId, trackId),
			readNativeFreezeObservation(page),
		]);
		// Decoders disagree by a frame on the same encoded input - firefox returns 257
		// frames where chromium returns 256 - so the fixture's frame count is a floor
		// rather than an exact figure. Take the clip length from what was actually
		// decoded: every invariant here is about the freeze range relative to the clip
		// and its insert tail, not about the decoder agreeing on the clip's length.
		expect(pcm.inputChannels).toHaveLength(1);
		const input = pcm.inputChannels[0];
		expect(input.length).toBeGreaterThanOrEqual(FREEZE_INPUT_FRAMES);
		expect(input.length).toBeLessThanOrEqual(FREEZE_INPUT_FRAMES + 1);
		const inputFrames = input.length;
		const expectedFrameCount = inputFrames + FREEZE_DELAY_FRAMES;
		expect(pcm.freeze).toMatchObject({
			renderStartFrame: 0,
			renderFrameCount: expectedFrameCount,
		});
		expect(pcm.source).toMatchObject({
			frameCount: expectedFrameCount,
			sampleRate: FREEZE_SAMPLE_RATE,
		});
		// The freeze captures the track pre-master and pre-pan, so it renders at the
		// track's own width. This track is mono, and rendering it at the programme width
		// upmixed it into a stereo frozen source it never had.
		expect(pcm.storage).toMatchObject({
			storage: 'indexeddb-chunks',
			frameCount: expectedFrameCount,
			channelCount: 1,
			chunkCount: 1,
		});
		expect(pcm.effects.map(({ type }) => type)).toEqual(['limiter', 'delay']);
		expect(Math.ceil(pcm.effects[0].params.lookahead * FREEZE_SAMPLE_RATE))
			.toBe(FREEZE_INSERT_LATENCY_FRAMES);
		expect(Math.round(pcm.effects[1].params.time * FREEZE_SAMPLE_RATE))
			.toBe(FREEZE_DELAY_FRAMES);

		expect(nativeRender.renderStarts).toBe(1);
		expect(nativeRender.contexts).toContainEqual({
			numberOfChannels: 1,
			length: expectedFrameCount + FREEZE_INSERT_LATENCY_FRAMES,
			sampleRate: FREEZE_SAMPLE_RATE,
		});
		expect(nativeRender.workletProcessors).toEqual([
			'kw-audio-dynamics',
			'kw-audio-delay',
		]);

		const expected = Array.from({ length: expectedFrameCount }, (_, frame) => Math.fround(
			(frame < inputFrames ? input[frame] * 0.5 : 0)
			+ (frame >= FREEZE_DELAY_FRAMES && frame - FREEZE_DELAY_FRAMES < inputFrames
				? input[frame - FREEZE_DELAY_FRAMES] * 0.5
				: 0),
		));
		const inputNonZeroFrames = input.flatMap((sample, frame) => (
			Math.abs(sample) > 0.000_001 ? [frame] : []
		));
		expect(inputNonZeroFrames[0]).toBe(0);
		expect(inputNonZeroFrames.at(-1)).toBe(inputFrames - 1);
		expect(pcm.channels).toHaveLength(1);
		for (const channel of pcm.channels) {
			expect(channel).toHaveLength(expectedFrameCount);
			const nonZeroFrames = channel.flatMap((sample, frame) => (
				Math.abs(sample) > 0.000_001 ? [frame] : []
			));
			const maximumAbsoluteSampleError = Math.max(
				...channel.map((sample, frame) => Math.abs(sample - expected[frame])),
			);
			expect(maximumAbsoluteSampleError).toBeLessThanOrEqual(0.000_000_1);
			const pdcErrorSamples = nonZeroFrames[0] - inputNonZeroFrames[0];
			expect(pdcErrorSamples).toBe(0);
			expect(nonZeroFrames.at(-1) - inputNonZeroFrames.at(-1)).toBe(FREEZE_DELAY_FRAMES);
			expect(nonZeroFrames.at(-1)).toBe(expectedFrameCount - 1);
		}
		expect(clientErrors).toEqual([]);
	});

	test('runs the fresh restoration chain and resets production meters from the keyboard', async ({ page }) => {
		test.setTimeout(90_000);
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [productionTone]);
		const track = editor.locator('[data-track-row]').last();
		await track.locator('[data-track-header]').click();
		await expect(track.locator('[data-track-lane]')).toHaveAttribute('data-selected', 'true');

		const history = await openHistoryPanel(page, editor);
		const historyBefore = await history.locator('[data-history-list] > li').count();
		const effectTrigger = applicationMenuTrigger(editor, 'Effect');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Restoration…']);
		let dialog = page.getByRole('dialog', { name: 'Production audio', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('tab', { name: 'Restoration', exact: true })).toBeFocused();
		const profileStatus = dialog.locator('[data-restoration-noise-profile="unavailable"]');
		await expect(profileStatus).toHaveText('Capture a noise profile to enable Noise Reduction.');
		await expect(profileStatus).toHaveAttribute('aria-live', 'polite');
		const noiseReduction = dialog.getByRole('checkbox', { name: 'Noise Reduction', exact: true });
		await expect(noiseReduction).toBeDisabled();
		await expect(noiseReduction).not.toBeChecked();
		await expect(dialog.getByRole('button', { name: 'Capture noise profile', exact: true })).toBeEnabled();

		const applyRestoration = dialog.getByRole('button', { name: 'Apply restoration chain', exact: true });
		await applyRestoration.focus();
		await page.keyboard.press('Enter');
		await expect(dialog.getByRole('status').last()).toHaveText(
			'Production audio change complete.', { timeout: 30_000 },
		);
		await expect(history.locator('[data-history-list] > li')).toHaveCount(historyBefore + 1);
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(effectTrigger).toBeFocused();

		const analyzeTrigger = applicationMenuTrigger(editor, 'Analyze');
		await chooseNestedCommandAction(page, editor, 'Analyze', ['Production meters…']);
		dialog = page.getByRole('dialog', { name: 'Production audio', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('tab', { name: 'Meters', exact: true })).toBeFocused();
		const resetMeters = dialog.getByRole('button', { name: 'Reset meter history', exact: true });
		await resetMeters.focus();
		await page.keyboard.press('Enter');
		await expect(dialog.getByRole('status').last()).toHaveText('Production audio change complete.');
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(analyzeTrigger).toBeFocused();
		expect(clientErrors).toEqual([]);
	});
});

function createProductionTone() {
	const frameCount = 96_000;
	const dataLength = frameCount * 2;
	const buffer = Buffer.from(longTone.buffer.subarray(0, 44 + dataLength));
	buffer.writeUInt32LE(36 + dataLength, 4);
	buffer.writeUInt32LE(dataLength, 40);
	return { name: 'browser-production-tone.wav', mimeType: longTone.mimeType, buffer };
}

function createFreezeImpulse() {
	const bytesPerSample = 2;
	const dataLength = FREEZE_INPUT_FRAMES * bytesPerSample;
	const buffer = Buffer.alloc(44 + dataLength);
	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + dataLength, 4);
	buffer.write('WAVE', 8);
	buffer.write('fmt ', 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(FREEZE_SAMPLE_RATE, 24);
	buffer.writeUInt32LE(FREEZE_SAMPLE_RATE * bytesPerSample, 28);
	buffer.writeUInt16LE(bytesPerSample, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(dataLength, 40);
	buffer.writeInt16LE(16_384, 44);
	buffer.writeInt16LE(8_192, 44 + (FREEZE_INPUT_FRAMES - 1) * bytesPerSample);
	return { name: 'browser-freeze-impulse.wav', mimeType: 'audio/wav', buffer };
}

async function disableOpfsForRawPcmEvidence(page) {
	await page.addInitScript(() => {
		if (!globalThis.navigator?.storage) return;
		Object.defineProperty(globalThis.navigator.storage, 'getDirectory', {
			configurable: true,
			value: undefined,
		});
	});
}

async function installNativeFreezeObservation(page) {
	await page.evaluate(() => {
		const NativeOfflineAudioContext = globalThis.OfflineAudioContext;
		const NativeAudioWorkletNode = globalThis.AudioWorkletNode;
		if (typeof NativeOfflineAudioContext !== 'function') {
			throw new Error('Chromium did not expose OfflineAudioContext for the freeze regression.');
		}
		if (typeof NativeAudioWorkletNode !== 'function') {
			throw new Error('Chromium did not expose AudioWorkletNode for the freeze regression.');
		}
		const observation = {
			contexts: [],
			renderStarts: 0,
			workletProcessors: [],
		};
		globalThis.__soundscaperNativeFreezeObservation = observation;
		const ObservedOfflineAudioContext = new Proxy(NativeOfflineAudioContext, {
			construct(target, argumentsList) {
				const context = Reflect.construct(target, argumentsList, target);
				observation.contexts.push({
					numberOfChannels: context.destination.channelCount,
					length: context.length,
					sampleRate: context.sampleRate,
				});
				const nativeStartRendering = context.startRendering.bind(context);
				context.startRendering = (...argumentsValue) => {
					observation.renderStarts += 1;
					return nativeStartRendering(...argumentsValue);
				};
				return context;
			},
		});
		const ObservedAudioWorkletNode = new Proxy(NativeAudioWorkletNode, {
			construct(target, argumentsList) {
				const node = Reflect.construct(target, argumentsList, target);
				observation.workletProcessors.push(String(argumentsList[1]));
				return node;
			},
		});
		Object.defineProperty(globalThis, 'OfflineAudioContext', {
			configurable: true,
			value: ObservedOfflineAudioContext,
			writable: true,
		});
		Object.defineProperty(globalThis, 'AudioWorkletNode', {
			configurable: true,
			value: ObservedAudioWorkletNode,
			writable: true,
		});
	});
}

async function readNativeFreezeObservation(page) {
	return page.evaluate(() => structuredClone(globalThis.__soundscaperNativeFreezeObservation));
}

async function readFrozenRawPcm(page, projectId, trackId) {
	return page.evaluate(async ({ databaseName, requestedProjectId, requestedTrackId }) => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open(databaseName);
			request.onerror = () => reject(request.error || new Error(`Could not open ${databaseName}.`));
			request.onsuccess = () => resolve(request.result);
		});
		const requestValue = (request, message) => new Promise((resolve, reject) => {
			request.onerror = () => reject(request.error || new Error(message));
			request.onsuccess = () => resolve(request.result);
		});
		try {
			const project = await requestValue(
				database.transaction('projects').objectStore('projects').get(requestedProjectId),
				`Could not read project ${requestedProjectId}.`,
			);
			const track = project?.tracks?.find(({ id }) => id === requestedTrackId);
			if (!track?.audioFreeze?.derivedSourceId) {
				throw new Error(`Track ${requestedTrackId} did not publish a derived freeze source.`);
			}
			const derivedSourceId = track.audioFreeze.derivedSourceId;
			const source = project.sources.find(({ id }) => id === derivedSourceId);
			if (!source) throw new Error(`Project source ${derivedSourceId} is missing.`);
			const clipIds = new Set(track.clipIds);
			const inputClip = project.clips.find(({ id }) => clipIds.has(id));
			if (!inputClip?.sourceId) throw new Error(`Track ${requestedTrackId} did not retain its input clip.`);
			const readRawSource = async (sourceId) => {
				const storage = await requestValue(
					database.transaction('sources').objectStore('sources').get(sourceId),
					`Could not read source metadata ${sourceId}.`,
				);
				if (storage?.storage !== 'indexeddb-chunks' || !storage.sourceToken) {
					throw new Error(`Source ${sourceId} used unexpected storage ${String(storage?.storage)}.`);
				}
				const chunks = await requestValue(
					database.transaction('sourceChunks').objectStore('sourceChunks')
						.index('sourceToken').getAll(storage.sourceToken),
					`Could not read source chunks for ${sourceId}.`,
				);
				chunks.sort((left, right) => left.index - right.index);
				const channels = Array.from({ length: storage.channelCount }, () => []);
				for (const [expectedIndex, chunk] of chunks.entries()) {
					if (chunk.index !== expectedIndex || chunk.encoding !== 'raw-f32le'
						|| !(chunk.payload instanceof ArrayBuffer)) {
						throw new Error(`Source ${sourceId} chunk ${expectedIndex} was not contiguous raw Float32.`);
					}
					const values = new Float32Array(chunk.payload);
					for (let channel = 0; channel < channels.length; channel += 1) {
						const start = channel * chunk.frames;
						channels[channel].push(...values.subarray(start, start + chunk.frames));
					}
				}
				return { channels, storage };
			};
			const [inputPcm, frozenPcm] = await Promise.all([
				readRawSource(inputClip.sourceId),
				readRawSource(derivedSourceId),
			]);
			return {
				channels: frozenPcm.channels,
				effects: track.effects.map(({ type, params }) => ({ type, params })),
				freeze: track.audioFreeze,
				inputChannels: inputPcm.channels,
				source,
				storage: {
					storage: frozenPcm.storage.storage,
					frameCount: frozenPcm.storage.frameCount,
					channelCount: frozenPcm.storage.channelCount,
					chunkCount: frozenPcm.storage.chunkCount,
				},
			};
		} finally {
			database.close();
		}
	}, {
		databaseName: SOUNDSCAPER_DATABASE,
		requestedProjectId: projectId,
		requestedTrackId: trackId,
	});
}

function automationLane(trackId) {
	return {
		id: 'browser-track-gain',
		address: { kind: 'strip', strip: { kind: 'track', id: trackId }, parameterId: 'gain' },
		timebase: 'absolute-samples',
		points: [
			{ id: 'gain-start', position: 0, value: 0.5 },
			{ id: 'gain-end', position: 384_000, value: 1 },
		],
		segments: [{ kind: 'linear' }],
	};
}

async function openAutomationEditor(page, editor) {
	const tracks = await openMenu(page, editor, 'Tracks');
	const automation = getMenuItem(tracks, 'Automation');
	await automation.focus();
	await page.keyboard.press('ArrowRight');
	const automationMenu = automation.getByRole('menu');
	await expect(automationMenu).toBeVisible();
	await getMenuItem(automationMenu, 'Edit lanes…').click();
	const dialog = page.getByRole('dialog', { name: 'Production audio', exact: true });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('tab', { name: 'Automation', exact: true })).toBeFocused();
	return dialog;
}

async function closeProductionDialog(dialog) {
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(dialog).toBeHidden();
}

async function automationLaneDocument(dialog) {
	const document = dialog.getByRole('textbox', { name: 'Canonical lane document', exact: true });
	if (!(await document.isVisible())) {
		await dialog.getByText('Advanced canonical JSON', { exact: true }).click();
	}
	return JSON.parse(await document.inputValue());
}

async function openHistoryPanel(page, editor) {
	await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
	const panel = editor.locator('[data-workspace-panel="history"]');
	await expect(panel).toBeVisible();
	return panel;
}

async function freezeSelectedTrack(page, editor, history, historyBefore) {
	const tracks = await openMenu(page, editor, 'Tracks');
	const freeze = getMenuItem(tracks, 'Freeze');
	await freeze.focus();
	await page.keyboard.press('ArrowRight');
	const freezeMenu = freeze.getByRole('menu');
	await expect(freezeMenu).toBeVisible();
	const action = getMenuItem(freezeMenu, 'Freeze track');
	await expect(action).toBeEnabled();
	await action.click();
	await expect(history.locator('[data-history-list] > li')).toHaveCount(historyBefore + 1, { timeout: 10_000 });
	await assertFreezeStatus(page, editor, 'Freeze (fresh)');
}

async function assertFreezeStatus(page, editor, label) {
	const tracks = await openMenu(page, editor, 'Tracks');
	await expect(getMenuItem(tracks, label)).toBeVisible();
	await page.keyboard.press('Escape');
}

async function readStoredSoundscaperProject(page, projectId) {
	return page.evaluate(({ databaseName, id }) => new Promise((resolve, reject) => {
		const open = indexedDB.open(databaseName);
		open.onerror = () => reject(open.error || new Error(`Could not open ${databaseName}.`));
		open.onsuccess = () => {
			const database = open.result;
			const request = database.transaction('projects').objectStore('projects').get(id);
			request.onerror = () => {
				database.close();
				reject(request.error || new Error(`Could not read ${id}.`));
			};
			request.onsuccess = () => {
				database.close();
				resolve(request.result ?? null);
			};
		};
	}), { databaseName: SOUNDSCAPER_DATABASE, id: projectId });
}

async function openMenu(page, editor, label) {
	const trigger = applicationMenuTrigger(editor, label);
	await trigger.click();
	const menu = page.getByRole('menu', { name: label, exact: true });
	await expect(menu).toBeVisible();
	return menu;
}

function applicationMenuTrigger(editor, label) {
	return editor.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: label, exact: true });
}

function historyButton(editor, label) {
	return editor.locator('[data-action-bar]')
		.getByRole('button', { name: label, exact: true });
}

async function assertMenuPath(page, editor, owner, labels) {
	const trigger = applicationMenuTrigger(editor, owner);
	await expect(async () => {
		let menu = await openMenu(page, editor, owner);
		try {
			for (const [index, label] of labels.entries()) {
				const item = getMenuItem(menu, label);
				await expect(item).toBeVisible();
				await expect(item).toBeEnabled();
				if (index < labels.length - 1) {
					if (!await item.locator(':scope > .context-menu-item-content .context-menu-item-arrow').count()) {
						throw new Error(`${label} has not materialized as a submenu.`);
					}
					await item.focus();
					await page.keyboard.press('ArrowRight');
					menu = item.getByRole('menu');
					await expect(menu).toBeVisible();
				}
			}
		} catch (error) {
			await closeApplicationMenus(page);
			throw error;
		}
	}).toPass({ timeout: 10_000 });
	await closeApplicationMenus(page);
	await expect(trigger).toBeFocused();
}

async function closeApplicationMenus(page) {
	for (let depth = 0; depth < 3; depth += 1) await page.keyboard.press('Escape');
}
