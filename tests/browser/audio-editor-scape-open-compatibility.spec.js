import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	BlobReader,
	BlobWriter,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { asymmetricStereoTone, expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	addRackEffect,
	bootEditor,
	chooseFileAction,
	clipByName,
	closeEffectsPanel,
	collectClientErrors,
	importFiles,
	openEffectsForTrack,
	registerAudioEditorHooks,
	stubStorageEstimate,
} from './audio-editor-test-helpers.js';
import { hasMediaRecorderCapability } from './helpers/media-recorder-capability.js';

const SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES = 32 * 1024 * 1024;
const OVERSIZED_FALLBACK_FRAME_COUNT = SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES
	/ (2 * Float32Array.BYTES_PER_ELEMENT) + 1;
const FALLBACK_SAMPLE_RATE = 48_000;
const SCAPE_AUDIO_CHUNK_FRAMES = 65_536;
const CHUNK_STREAM_PACKET_FRAMES = 1_024;

test.describe('Scape open feature decisions', () => {
	registerAudioEditorHooks();

	test('cancels or opens a unique incompatible project read-only', async ({ page }) => {
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const originalId = await editor.getAttribute('data-project-id');
		await expect(editor.locator('[data-project-feature-compatibility]')).toHaveCount(0);
		await importFiles(editor, [toneA]);
		const exported = await captureScapeArchive(page, editor);
		const incomingId = `${originalId}-incompatible`;
		const archive = await incompatibleArchive(exported, {
			id: incomingId,
			title: 'Feature decision project',
		});
		const input = editor.locator('[data-aup4-input]');
		const fileMenu = editor.getByRole('menuitem', { name: 'File', exact: true });

		await fileMenu.focus();
		await setScapeInput(input, archive);
		const dialog = page.getByRole('dialog', { name: 'Project features unavailable', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAttribute('data-scape-open-decision', 'compatibility');
		await expect(dialog).toHaveAccessibleDescription(/Feature decision project.*requires features.*read-only/iu);
		await expect(dialog.getByText('Video effects', { exact: true })).toBeVisible();
		await expect(dialog.getByText('org.soundscaper.capability.video-effects', { exact: true })).toBeVisible();
		await expect(dialog.getByText(/Unavailable.*Bypass declared/iu)).toBeVisible();
		await expect(dialog.getByText('Future mixer', { exact: true })).toBeVisible();
		await expect(dialog.getByText('org.example.future-mixer', { exact: true })).toBeVisible();
		await expect(dialog.getByText(/Unknown.*Rendered fallback declared/iu)).toBeVisible();
		const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
		await expect(cancel).toBeFocused();
		await assertAccessibleBasics(dialog);
		await assertNoSeriousAxeViolations(page, '[data-scape-open-decision]');
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(fileMenu).toBeFocused();
		await expect(editor).toHaveAttribute('data-project-id', originalId);

		await setScapeInput(input, archive);
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Open read-only', exact: true }).click();
		await expect(editor).toHaveAttribute('data-project-id', incomingId);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		const capacity = editor.locator('[data-storage-capacity]');
		await capacity.locator('summary').click();
		await expect(capacity).toContainText(/(?:Import|Project saving): .+ requested · .+ required free · Ready/u);

		const notice = editor.locator('[data-project-feature-compatibility]');
		await expect(notice).toBeVisible();
		await expect(notice).toHaveAccessibleName('Project features unavailable');
		await expect(notice.locator('[data-project-feature-unavailable-count]')).toHaveText('1');
		await expect(notice.locator('[data-project-feature-unknown-count]')).toHaveText('1');
		const bypassed = notice.locator('[data-project-feature-requirement="org.soundscaper.capability.video-effects"]');
		await expect(bypassed).toBeVisible();
		await expect(bypassed).toContainText('Video effects');
		await expect(bypassed).toContainText('Unavailable · Bypass declared');
		await expect(bypassed).toHaveAttribute('data-declared-disposition', 'bypass');
		await expect(bypassed).toHaveAttribute('data-effective-disposition', 'bypassed');
		const rendered = notice.locator('[data-project-feature-requirement="org.example.future-mixer"]');
		await expect(rendered).toBeVisible();
		await expect(rendered).toContainText('Future mixer');
		await expect(rendered).toContainText('Unknown · Rendered fallback declared');
		await expect(rendered).toHaveAttribute('data-declared-disposition', 'rendered-fallback');
		await expect(rendered).toHaveAttribute('data-effective-disposition', 'rendered-fallback');
		await expect(rendered.locator('[data-project-feature-audio-rendered-fallback]'))
			.toHaveText('Rendered fallback active during editor playback');
		await expect(notice.getByRole('button')).toHaveCount(0);
		await expect(notice).not.toContainText(/plug-?in|third-party|feature code/iu);
		await notice.focus();
		await expect(notice).toBeFocused();
		await assertAccessibleBasics(notice);
		await assertNoSeriousAxeViolations(page, '[data-project-feature-compatibility]');

		const originalTab = editor.getByRole('tab', { name: 'Untitled project', exact: true });
		await originalTab.focus();
		await page.keyboard.press('Enter');
		await expect(editor).toHaveAttribute('data-project-id', originalId);
		await expect(notice).toHaveCount(0);
		const incomingTab = editor.getByRole('tab', { name: 'Feature decision project', exact: true });
		await incomingTab.focus();
		await page.keyboard.press('Enter');
		await expect(editor).toHaveAttribute('data-project-id', incomingId);
		await expect(notice).toBeVisible();
		await expect(rendered).toBeVisible();
		await expect(rendered).toContainText('Future mixer');
		expect(errors).toEqual([]);
	});

	test('combines collision and compatibility consent into one read-only-copy decision', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const originalId = await editor.getAttribute('data-project-id');
		await importFiles(editor, [toneA]);
		const exported = await captureScapeArchive(page, editor);
		const archive = await incompatibleArchive(exported, {
			id: originalId,
			title: 'Colliding feature project',
		});
		const input = editor.locator('[data-aup4-input]');

		await setScapeInput(input, archive);
		const dialog = page.getByRole('dialog', { name: 'Project features unavailable', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAttribute('data-scape-open-decision', 'compatibility-collision');
		await expect(dialog).toHaveAccessibleDescription(/requires features.*same ID/iu);
		await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
		await expect(dialog.getByRole('button', { name: 'Replace', exact: true })).toHaveCount(0);
		await expect(editor).toHaveAttribute('data-project-id', originalId);
		await assertAccessibleBasics(dialog);
		await assertNoSeriousAxeViolations(page, '[data-scape-open-decision]');

		await dialog.getByRole('button', { name: 'Open as read-only copy', exact: true }).click();
		await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(originalId);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		expect(errors).toEqual([]);
	});

	test('opens Soundscaper rack effects in Framescaper as persistent control-free bypass placeholders', async ({ page }) => {
		const errors = collectClientErrors(page);
		const soundscaper = await bootEditor(page, '/embed/en/');
		await expect(soundscaper).toHaveAttribute('data-product', 'soundscaper');
		const originalId = await soundscaper.getAttribute('data-project-id');
		expect(originalId).toBeTruthy();
		await importFiles(soundscaper, [toneA]);
		const effectsPanel = await openEffectsForTrack(soundscaper, 1);
		await addRackEffect(page, effectsPanel, 'track', 'Invert');
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Invert' })).toHaveCount(1);
		await closeEffectsPanel(effectsPanel);

		const exported = await captureScapeArchive(page, soundscaper);
		const incomingId = `${originalId}-framescaper-audio-effect`;
		const archive = await rewriteArchive(exported, ({ project }) => {
			project.id = incomingId;
			project.title = 'Soundscaper effect handoff';
		});
		const framescaper = await bootEditor(page, '/framescaper/embed/en/');
		await expect(framescaper).toHaveAttribute('data-product', 'framescaper');
		await setScapeInput(framescaper.locator('[data-aup4-input]'), archive);

		const dialog = page.getByRole('dialog', { name: 'Project features unavailable', exact: true });
		await expect(dialog).toHaveAttribute('data-scape-open-decision', 'compatibility');
		await expect(dialog.getByText('Audio effects', { exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: 'Open read-only', exact: true }).click();
		await expect(framescaper).toHaveAttribute('data-project-id', incomingId);
		await expect(framescaper).toHaveAttribute('data-edit-block-reason', 'read-only');

		await assertAffectedInvertPlaceholder(framescaper);
		expect(errors).toEqual([]);
	});

	test('plays an admitted Soundscaper audio-effects render in Framescaper', async ({ page }) => {
		const errors = collectClientErrors(page);
		const soundscaper = await bootEditor(page, '/embed/en/');
		await expect(soundscaper).toHaveAttribute('data-product', 'soundscaper');
		const originalId = await soundscaper.getAttribute('data-project-id');
		expect(originalId).toBeTruthy();
		await importFiles(soundscaper, [toneA, asymmetricStereoTone]);
		const effectsPanel = await openEffectsForTrack(soundscaper, 1);
		await addRackEffect(page, effectsPanel, 'track', 'Invert');
		await closeEffectsPanel(effectsPanel);

		const exported = await captureScapeArchive(page, soundscaper);
		const incomingId = `${originalId}-framescaper-audio-render`;
		const archive = await audioEffectsRenderedFallbackArchive(exported, {
			id: incomingId,
			title: 'Soundscaper rendered fallback handoff',
			fallbackSourceName: asymmetricStereoTone.name,
		});
		const framescaper = await bootEditor(page, '/framescaper/embed/en/');
		await expect(framescaper).toHaveAttribute('data-product', 'framescaper');
		await setScapeInput(framescaper.locator('[data-aup4-input]'), archive);

		const dialog = page.getByRole('dialog', { name: 'Project features unavailable', exact: true });
		await expect(dialog).toHaveAttribute('data-scape-open-decision', 'compatibility');
		await expect(dialog.getByText('Audio effects', { exact: true })).toBeVisible();
		await expect(dialog.getByText(/Unavailable.*Rendered fallback declared/iu)).toBeVisible();
		await dialog.getByRole('button', { name: 'Open read-only', exact: true }).click();
		await expect(framescaper).toHaveAttribute('data-project-id', incomingId);
		await expect(framescaper).toHaveAttribute('data-edit-block-reason', 'read-only');

		const notice = framescaper.locator('[data-project-feature-compatibility]');
		const requirement = notice.locator(
			'[data-project-feature-requirement="org.soundscaper.capability.audio-effects"]',
		);
		await expect(requirement).toHaveAttribute('data-declared-disposition', 'rendered-fallback');
		await expect(requirement).toHaveAttribute('data-effective-disposition', 'rendered-fallback');
		await expect(requirement.locator('[data-project-feature-audio-rendered-fallback]'))
			.toHaveText('Rendered fallback active during editor playback');
		await expect(notice.locator('[data-project-feature-audio-effect-placeholders]')).toHaveCount(0);
		await expect(clipByName(framescaper, toneA.name)).toBeVisible();
		await expect(clipByName(framescaper, asymmetricStereoTone.name)).toHaveCount(0);

		await installAudioBufferScheduleProbe(page);
		await framescaper.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(framescaper.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect.poll(() => scheduledAudioBufferCount(page)).toBe(1);
		await framescaper.getByRole('button', { name: 'Stop', exact: true }).click();
		const [scheduled] = await scheduledAudioBuffers(page);
		expect(scheduled).toMatchObject({ sampleRate: 48_000, channelCount: 2 });
		expect(scheduled.frameCount).toBeGreaterThan(0);
		expect(scheduled.channelPeaks[0]).toBeGreaterThan(0.09);
		expect(scheduled.channelPeaks[0]).toBeLessThan(0.11);
		expect(scheduled.channelPeaks[1]).toBeGreaterThan(0.69);
		expect(scheduled.channelPeaks[1]).toBeLessThan(0.71);
		expect(errors).toEqual([]);
	});

	test('streams an oversized admitted Soundscaper audio-effects render in Framescaper', async ({ page }) => {
		test.setTimeout(120_000);
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		const errors = collectClientErrors(page);
		const soundscaper = await bootEditor(page, '/embed/en/');
		const originalId = await soundscaper.getAttribute('data-project-id');
		expect(originalId).toBeTruthy();
		await importFiles(soundscaper, [toneA, asymmetricStereoTone]);
		const effectsPanel = await openEffectsForTrack(soundscaper, 1);
		await addRackEffect(page, effectsPanel, 'track', 'Invert');
		await closeEffectsPanel(effectsPanel);

		const exported = await captureScapeArchive(page, soundscaper);
		const incomingId = `${originalId}-framescaper-streamed-audio-render`;
		const archive = await audioEffectsRenderedFallbackArchive(exported, {
			id: incomingId,
			title: 'Soundscaper streamed fallback handoff',
			fallbackSourceName: asymmetricStereoTone.name,
			fallbackFrameCount: OVERSIZED_FALLBACK_FRAME_COUNT,
		});
		const framescaper = await bootEditor(page, '/framescaper/embed/en/');
		const dialog = page.getByRole('dialog', { name: 'Project features unavailable', exact: true });
		const temporaryArchive = await createTemporaryScapeArchive(archive);
		try {
			await framescaper.locator('[data-aup4-input]').setInputFiles(temporaryArchive.path);
			await expect(dialog).toHaveAttribute('data-scape-open-decision', 'compatibility');
			await installChunkStreamProtocolProbe(page);
			await dialog.getByRole('button', { name: 'Open read-only', exact: true }).click();
			await expect(framescaper).toHaveAttribute('data-project-id', incomingId, { timeout: 60_000 });
		} finally {
			await temporaryArchive.cleanup();
		}
		await expect(framescaper).toHaveAttribute('data-edit-block-reason', 'read-only');
		const requirement = framescaper.locator(
			'[data-project-feature-requirement="org.soundscaper.capability.audio-effects"]',
		);
		await expect(requirement.locator('[data-project-feature-audio-rendered-fallback]'))
			.toHaveText('Rendered fallback active during editor playback');

		// Direct provider no-prefetch behavior remains covered at the source-lifecycle boundary.
		await page.waitForTimeout(250);
		const ready = await chunkStreamProtocolProbe(page);
		expect(ready.opened).toEqual([]);
		expect(ready.storageChunks).toEqual([]);
		expect(ready.oversizedAudioBuffers).toEqual([]);

		await framescaper.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(framescaper.getByRole('button', { name: 'Pause', exact: true }))
			.toBeVisible({ timeout: 30_000 });
		await expect.poll(
			async () => (await chunkStreamProtocolProbe(page)).playStreamIds.length,
			{ timeout: 30_000 },
		).toBeGreaterThan(0);
		await framescaper.getByRole('button', { name: 'Stop', exact: true }).click();

		const playback = await chunkStreamProtocolProbe(page);
		expect(playback.opened).toHaveLength(1);
		expect(playback.contextSampleRates).toHaveLength(1);
		const contextSampleRate = playback.contextSampleRates[0];
		const outputFrameCount = Math.round(OVERSIZED_FALLBACK_FRAME_COUNT / FALLBACK_SAMPLE_RATE * contextSampleRate);
		const resampling = contextSampleRate !== FALLBACK_SAMPLE_RATE;
		const streamId = playback.opened[0].streamId;
		expect(playback.opened[0]).toMatchObject({
			channelCount: 2,
			frameCount: OVERSIZED_FALLBACK_FRAME_COUNT,
			chunkFrames: SCAPE_AUDIO_CHUNK_FRAMES,
			startFrame: 0,
			endFrame: outputFrameCount,
			sourceStartFrame: 0,
			sourceEndFrame: OVERSIZED_FALLBACK_FRAME_COUNT,
			resample: resampling,
			resampleInputFrames: resampling ? OVERSIZED_FALLBACK_FRAME_COUNT : null,
			resampleInputOffset: resampling ? 0 : null,
			packetFrames: CHUNK_STREAM_PACKET_FRAMES,
		});
		expect(playback.storageChunks.length).toBeGreaterThan(0);
		expect(playback.storageChunks[0]).toMatchObject({
			streamId,
			chunkIndex: 0,
			channelFrames: [SCAPE_AUDIO_CHUNK_FRAMES, SCAPE_AUDIO_CHUNK_FRAMES],
		});
		expect(playback.storageChunks[0].channelPeaks[0]).toBeCloseTo(0.125, 5);
		expect(playback.storageChunks[0].channelPeaks[1]).toBeCloseTo(0.75, 5);
		expect(playback.audioPackets.length).toBeGreaterThan(0);
		expect(playback.audioPackets[0]).toMatchObject({
			streamId,
			frames: CHUNK_STREAM_PACKET_FRAMES,
			channelFrames: [CHUNK_STREAM_PACKET_FRAMES, CHUNK_STREAM_PACKET_FRAMES],
		});
		expect(playback.audioPackets[0].channelPeaks[0]).toBeCloseTo(0.125, 5);
		expect(playback.audioPackets[0].channelPeaks[1]).toBeCloseTo(0.75, 5);
		expect(playback.playStreamIds).toContain(streamId);
		expect(playback.oversizedAudioBuffers).toEqual([]);
		expect(errors).toEqual([]);
	});

	test('opens Framescaper video effects in Soundscaper as persistent control-free bypass placeholders', async ({ page }) => {
		test.skip(!await page.evaluate(hasMediaRecorderCapability), 'Generated WebM fixtures require MediaRecorder.');
		test.setTimeout(90_000);
		const fixture = await createGeneratedVideoFixture(page, {
			name: 'compatibility-video.webm',
			color: '#4f46e5',
			accent: '#fef3c7',
			frequency: 330,
			width: 96,
			height: 54,
			frameCount: 6,
		});
		const errors = collectClientErrors(page);
		const framescaper = await bootEditor(page, '/framescaper/embed/en/');
		await expect(framescaper).toHaveAttribute('data-product', 'framescaper');
		await importFiles(framescaper, [fixture]);

		const videoClip = framescaper.locator('[data-clip-kind="video"]').first();
		await expect(videoClip).toBeVisible();
		await videoClip.click({ button: 'right' });
		const clipMenu = page.locator('.audio-editor-clip-context-menu');
		await expect(clipMenu).toBeVisible();
		await clipMenu.locator('[data-action-id="clip-properties"]').click();
		const clipDialog = page.getByRole('dialog', { name: 'Clip properties', exact: true });
		const rack = clipDialog.locator('[data-video-effect-rack]');
		await expect(rack).toBeVisible();
		const picker = rack.locator('[data-video-effect-picker]');
		await picker.getByRole('button').click();
		await page.getByRole('option', { name: 'Pixelate', exact: true }).click();
		await rack.getByRole('button', { name: 'Add effect', exact: true }).click();
		const pixelate = rack.locator('[data-video-effect-type="pixelate"]');
		await expect(pixelate).toHaveCount(1);
		const effectId = await pixelate.getAttribute('data-video-effect-id');
		expect(effectId).toBeTruthy();
		await clipDialog.getByRole('button', { name: 'Close', exact: true }).click();

		const exported = await captureScapeArchive(page, framescaper);
		const originalFramescaperId = await framescaper.getAttribute('data-project-id');
		const incomingId = `${originalFramescaperId}-soundscaper-video-effect`;
		const archive = await rewriteArchive(exported, ({ project }) => {
			project.id = incomingId;
			project.title = 'Framescaper effect handoff';
		});
		const soundscaper = await bootEditor(page, '/embed/en/');
		await expect(soundscaper).toHaveAttribute('data-product', 'soundscaper');
		const originalSoundscaperId = await soundscaper.getAttribute('data-project-id');
		await setScapeInput(soundscaper.locator('[data-aup4-input]'), archive);

		const decision = page.getByRole('dialog', { name: 'Project features unavailable', exact: true });
		await expect(decision).toHaveAttribute('data-scape-open-decision', 'compatibility');
		await expect(decision.getByText('Video effects', { exact: true })).toBeVisible();
		await decision.getByRole('button', { name: 'Open read-only', exact: true }).click();
		await expect(soundscaper).toHaveAttribute('data-project-id', incomingId);
		await expect(soundscaper).toHaveAttribute('data-edit-block-reason', 'read-only');

		await assertAffectedPixelatePlaceholder(soundscaper, effectId);
		const originalTab = soundscaper.getByRole('tab', { name: 'Untitled project', exact: true });
		await originalTab.focus();
		await page.keyboard.press('Enter');
		await expect(soundscaper).toHaveAttribute('data-project-id', originalSoundscaperId);
		await expect(soundscaper.locator('[data-project-feature-video-effect-placeholders]')).toHaveCount(0);
		const incomingTab = soundscaper.getByRole('tab', { name: 'Framescaper effect handoff', exact: true });
		await incomingTab.focus();
		await page.keyboard.press('Enter');
		await expect(soundscaper).toHaveAttribute('data-project-id', incomingId);
		await assertAffectedPixelatePlaceholder(soundscaper, effectId);
		expect(errors).toEqual([]);
	});
});

async function captureScapeArchive(page, editor) {
	await page.evaluate(() => {
		globalThis.__scapeCompatibilitySave = { chunks: [], closes: 0 };
		Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: async () => ({
				name: 'compatibility.scape',
				async createWritable() {
					return {
						async write(chunk) { globalThis.__scapeCompatibilitySave.chunks.push(chunk.slice()); },
						async close() { globalThis.__scapeCompatibilitySave.closes += 1; },
						async abort() {},
					};
				},
			}),
		});
	});
	await chooseFileAction(page, editor, 'Export project file (.scape)');
	await expect.poll(() => page.evaluate(() => globalThis.__scapeCompatibilitySave.closes)).toBe(1);
	const chunks = await page.evaluate(() => globalThis.__scapeCompatibilitySave.chunks.map((chunk) => [...chunk]));
	return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function incompatibleArchive(input, { id, title }) {
	return rewriteArchive(input, ({ project, manifest }) => {
		project.id = id;
		project.title = title;
		const audioAsset = manifest.assets.find((asset) => asset.kind === 'audio');
		const audioSource = project.sources.find((source) => source.id === audioAsset?.sourceId);
		if (!audioAsset || !audioSource) throw new Error('Compatibility fixture requires one exported audio source.');
		audioSource.sampleRate = project.sampleRate;
		project.masterChannels = audioSource.channelCount;
		project.featureRequirements = {
			schemaVersion: 1,
			requirements: [{
				id: 'video-effects',
				featureId: 'org.soundscaper.capability.video-effects',
				displayName: 'Video effects',
				disposition: 'bypass',
				fallback: null,
			}, {
				id: 'future-mixer',
				featureId: 'org.example.future-mixer',
				displayName: 'Future mixer',
				disposition: 'rendered-fallback',
				fallback: { kind: 'audio', sourceId: audioSource.id, sha256: audioAsset.sha256 },
			}],
		};
	});
}

async function audioEffectsRenderedFallbackArchive(input, {
	id,
	title,
	fallbackSourceName,
	fallbackFrameCount = null,
}) {
	return rewriteArchive(input, ({ project, manifest, payloads }) => {
		if (project.schemaVersion !== 9) throw new Error('Rendered fallback fixture requires schema 10.');
		project.id = id;
		project.title = title;
		const source = project.sources.find((candidate) => (
			candidate.kind === 'audio' && candidate.name === fallbackSourceName
		));
		const asset = manifest.assets.find((candidate) => (
			candidate.kind === 'audio' && candidate.sourceId === source?.id
		));
		if (!source || !asset) throw new Error('Rendered fallback fixture requires its exported audio asset.');
		// The archive asset is raw PCM. Author it at the project rate even when the
		// host AudioContext decoded the WAV fixture at a different device rate.
		source.sampleRate = project.sampleRate;
		if (fallbackFrameCount != null) {
			if (source.channelCount !== 2) throw new Error('Oversized fallback fixture requires stereo PCM.');
			source.frameCount = fallbackFrameCount;
			source.chunkFrames = SCAPE_AUDIO_CHUNK_FRAMES;
			const payload = createScapePcmPayload(source);
			payloads.set(asset.entry, payload);
			asset.size = payload.byteLength;
			asset.sha256 = createHash('sha256').update(payload).digest('hex');
		}
		const clipIds = new Set(project.clips
			.filter((clip) => clip.kind === 'audio' && clip.sourceId === source.id)
			.map((clip) => clip.id));
		if (!clipIds.size) throw new Error('Rendered fallback fixture requires one timeline fallback clip.');
		project.clips = project.clips.filter((clip) => !clipIds.has(clip.id));
		for (const track of project.tracks) {
			if (Array.isArray(track.clipIds)) track.clipIds = track.clipIds.filter((clipId) => !clipIds.has(clipId));
		}
		project.featureRequirements = {
			schemaVersion: 1,
			requirements: [{
				id: 'publisher-audio-render',
				featureId: 'org.soundscaper.capability.audio-effects',
				displayName: 'Audio effects',
				disposition: 'rendered-fallback',
				fallback: { kind: 'audio', sourceId: source.id, sha256: asset.sha256 },
			}],
		};
	});
}

async function rewriteArchive(input, mutate) {
	const reader = new ZipReader(new BlobReader(new Blob([input])), { useWebWorkers: false });
	const entries = await reader.getEntries();
	const payloads = new Map();
	for (const entry of entries) payloads.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
	await reader.close();

	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const project = JSON.parse(decoder.decode(payloads.get('project.json')));
	const manifest = JSON.parse(decoder.decode(payloads.get('manifest.json')));
	mutate({ project, manifest, payloads });
	const projectBytes = encoder.encode(JSON.stringify(project));
	payloads.set('project.json', projectBytes);
	manifest.project.schemaVersion = project.schemaVersion;
	manifest.project.size = projectBytes.byteLength;
	manifest.project.sha256 = createHash('sha256').update(projectBytes).digest('hex');
	payloads.set('manifest.json', encoder.encode(JSON.stringify(manifest)));

	const writer = new ZipWriter(new BlobWriter('application/vnd.soundscaper.scape+zip'), {
		level: 0,
		useWebWorkers: false,
		zip64: true,
	});
	for (const entry of entries) {
		await writer.add(entry.filename, new Uint8ArrayReader(payloads.get(entry.filename)), { level: 0, zip64: true });
	}
	const output = await writer.close(undefined, { zip64: true });
	return Buffer.from(await output.arrayBuffer());
}

async function setScapeInput(input, buffer) {
	await input.setInputFiles({
		name: 'incompatible.scape',
		mimeType: 'application/vnd.soundscaper.scape+zip',
		buffer,
	});
}

async function createTemporaryScapeArchive(buffer) {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-browser-scape-'));
	const path = join(directory, 'oversized-render.scape');
	await writeFile(path, buffer).catch(async (error) => {
		await rm(directory, { recursive: true, force: true });
		throw error;
	});
	return {
		path,
		cleanup: () => rm(directory, { recursive: true, force: true }),
	};
}

async function installAudioBufferScheduleProbe(page) {
	await page.evaluate(() => {
		globalThis.__scapeCompatibilityScheduledAudio = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function captureScheduledAudio(...args) {
			const buffer = this.buffer;
			if (buffer) {
				const channelPeaks = Array.from({ length: buffer.numberOfChannels }, (_value, channel) => {
					let peak = 0;
					for (const sample of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
					return peak;
				});
				globalThis.__scapeCompatibilityScheduledAudio.push({
					frameCount: buffer.length,
					sampleRate: buffer.sampleRate,
					channelCount: buffer.numberOfChannels,
					channelPeaks,
				});
			}
			return start.apply(this, args);
		};
	});
}

async function scheduledAudioBufferCount(page) {
	return page.evaluate(() => globalThis.__scapeCompatibilityScheduledAudio.length);
}

async function scheduledAudioBuffers(page) {
	return page.evaluate(() => globalThis.__scapeCompatibilityScheduledAudio);
}

function createScapePcmPayload(source) {
	const chunkCount = Math.ceil(source.frameCount / source.chunkFrames);
	const output = Buffer.alloc(
		source.frameCount * source.channelCount * Float32Array.BYTES_PER_ELEMENT + chunkCount * 4,
	);
	let frameOffset = 0;
	let byteOffset = 0;
	while (frameOffset < source.frameCount) {
		const frames = Math.min(source.chunkFrames, source.frameCount - frameOffset);
		output.writeUInt32LE(frames, byteOffset);
		byteOffset += 4;
		for (let channel = 0; channel < source.channelCount; channel += 1) {
			if (frameOffset === 0) {
				const value = channel === 0 ? 0.125 : 0.75;
				for (let frame = 0; frame < Math.min(frames, 2_048); frame += 1) {
					output.writeFloatLE(value, byteOffset + frame * Float32Array.BYTES_PER_ELEMENT);
				}
			}
			byteOffset += frames * Float32Array.BYTES_PER_ELEMENT;
		}
		frameOffset += frames;
	}
	return output;
}

async function installChunkStreamProtocolProbe(page) {
	await page.evaluate((maximumAudioBufferBytes) => {
		const state = globalThis.__scapeCompatibilityChunkStream = {
			audioPackets: [],
			contextSampleRates: [],
			opened: [],
			oversizedAudioBuffers: [],
			playStreamIds: [],
			storageChunks: [],
		};
		const workerPostMessage = Worker.prototype.postMessage;
		Worker.prototype.postMessage = function observeChunkWorker(message, ...rest) {
			if (message?.type === 'open-stream') {
				state.opened.push({
					streamId: message.streamId,
					channelCount: message.source?.channelCount,
					frameCount: message.source?.frameCount,
					chunkFrames: message.source?.chunkFrames,
					startFrame: message.startFrame,
					endFrame: message.endFrame,
					sourceStartFrame: message.sourceStartFrame,
					sourceEndFrame: message.sourceEndFrame,
					resample: message.resample,
					resampleInputFrames: message.resampleInputFrames,
					resampleInputOffset: message.resampleInputOffset,
					packetFrames: message.packetFrames,
				});
			} else if (message?.type === 'storage-chunk') {
				if (state.storageChunks.length < 4) {
					state.storageChunks.push({ streamId: message.streamId, chunkIndex: message.chunkIndex,
						...channelSummary(message.channels) });
				}
			}
			return workerPostMessage.call(this, message, ...rest);
		};
		const portPostMessage = MessagePort.prototype.postMessage;
		MessagePort.prototype.postMessage = function observeChunkPort(message, ...rest) {
			if (message?.type === 'audio-packet') {
				if (state.audioPackets.length < 16) {
					state.audioPackets.push({ streamId: message.streamId, frames: message.frames,
						...channelSummary(message.channels) });
				}
			} else if (message?.type === 'play-stream') {
				state.playStreamIds.push(message.streamId);
			}
			return portPostMessage.call(this, message, ...rest);
		};
		const createGain = BaseAudioContext.prototype.createGain;
		BaseAudioContext.prototype.createGain = function observeAudioContext(...args) {
			if (!state.contextSampleRates.includes(this.sampleRate)) state.contextSampleRates.push(this.sampleRate);
			return createGain.apply(this, args);
		};
		const createBuffer = BaseAudioContext.prototype.createBuffer;
		BaseAudioContext.prototype.createBuffer = function observeAudioBuffer(channelCount, frameCount, ...rest) {
			const byteLength = channelCount * frameCount * Float32Array.BYTES_PER_ELEMENT;
			if (byteLength > maximumAudioBufferBytes) {
				state.oversizedAudioBuffers.push({ channelCount, frameCount, byteLength });
			}
			return createBuffer.call(this, channelCount, frameCount, ...rest);
		};
		function channelSummary(channels) {
			return {
				channelFrames: channels.map((channel) => channel.length),
				channelPeaks: channels.map((channel) => {
					let peak = 0;
					for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
					return peak;
				}),
			};
		}
	}, SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES);
}

async function chunkStreamProtocolProbe(page) {
	return page.evaluate(() => structuredClone(globalThis.__scapeCompatibilityChunkStream));
}

async function assertAffectedInvertPlaceholder(editor) {
	const placeholders = editor.locator('[data-project-feature-audio-effect-placeholders]');
	await expect(placeholders).toBeVisible();
	await expect(placeholders.locator('h4')).toHaveText('Affected audio effects');
	const placeholder = placeholders.locator('[data-audio-effect-placeholder]');
	await expect(placeholder).toHaveCount(1);
	await expect(placeholder).toHaveAttribute('data-audio-effect-placeholder', /.+/u);
	await expect(placeholder).toHaveAttribute('data-scope', 'track');
	await expect(placeholder).toHaveAttribute('data-owner-id', /.+/u);
	await expect(placeholder).toHaveAttribute('data-effect-type', 'audacity-invert');
	await expect(placeholder).toHaveAttribute('data-effective-disposition', 'bypassed');
	await expect(placeholder).toContainText(/Invert\s*Track · .+\s*Bypassed during editor playback/su);
	await expect(placeholder.locator('button, input, select, textarea, a[href]')).toHaveCount(0);
}

async function assertAffectedPixelatePlaceholder(editor, effectId) {
	const placeholders = editor.locator('[data-project-feature-video-effect-placeholders]');
	await expect(placeholders).toBeVisible();
	await expect(placeholders.locator('h4')).toHaveText('Affected video effects');
	const placeholder = placeholders.locator('[data-video-effect-placeholder]');
	await expect(placeholder).toHaveCount(1);
	await expect(placeholder).toHaveAttribute('data-video-effect-placeholder', effectId);
	await expect(placeholder).toHaveAttribute('data-location', 'timeline');
	await expect(placeholder).toHaveAttribute('data-clip-id', /.+/u);
	await expect(placeholder).toHaveAttribute('data-effect-type', 'pixelate');
	await expect(placeholder).toHaveAttribute('data-effective-disposition', 'bypassed');
	await expect(placeholder).toContainText(/Pixelate\s*Timeline · .+\s*Bypassed during editor playback/su);
	await expect(placeholder.locator('button, input, select, textarea, a[href]')).toHaveCount(0);
}

async function createGeneratedVideoFixture(page, options) {
	const base64 = await page.evaluate(async (fixture) => {
		const frameCount = Math.max(2, Number(fixture.frameCount) || 6);
		const canvas = document.createElement('canvas');
		canvas.width = fixture.width;
		canvas.height = fixture.height;
		const context = canvas.getContext('2d');
		const videoStream = canvas.captureStream(15);
		const audioContext = new AudioContext({ sampleRate: 48_000 });
		const oscillator = audioContext.createOscillator();
		const gain = audioContext.createGain();
		const audioDestination = audioContext.createMediaStreamDestination();
		oscillator.frequency.value = fixture.frequency;
		gain.gain.value = 0.04;
		oscillator.connect(gain).connect(audioDestination);
		oscillator.start();
		await audioContext.resume();
		const stream = new MediaStream([
			...videoStream.getVideoTracks(),
			...audioDestination.stream.getAudioTracks(),
		]);
		const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
			? 'video/webm;codecs=vp8,opus'
			: 'video/webm';
		const recorder = new MediaRecorder(stream, {
			mimeType,
			videoBitsPerSecond: 120_000,
			audioBitsPerSecond: 32_000,
		});
		const chunks = [];
		recorder.addEventListener('dataavailable', (event) => {
			if (event.data.size) chunks.push(event.data);
		});
		const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
		recorder.start();
		for (let frame = 0; frame < frameCount; frame += 1) {
			context.fillStyle = fixture.color;
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = fixture.accent;
			const markerSize = Math.max(5, Math.round(Math.min(canvas.width, canvas.height) / 5));
			const markerX = Math.round((canvas.width - markerSize) * frame / (frameCount - 1));
			context.fillRect(markerX, Math.round((canvas.height - markerSize) / 2), markerSize, markerSize);
			await new Promise((resolve) => setTimeout(resolve, 65));
		}
		recorder.stop();
		await stopped;
		stream.getTracks().forEach((track) => track.stop());
		oscillator.stop();
		await audioContext.close();
		const blob = new Blob(chunks, { type: 'video/webm' });
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let binary = '';
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return btoa(binary);
	}, options);
	return {
		name: options.name,
		mimeType: 'video/webm',
		buffer: Buffer.from(base64, 'base64'),
	};
}
