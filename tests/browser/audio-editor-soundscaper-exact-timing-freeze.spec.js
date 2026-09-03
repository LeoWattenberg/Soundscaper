/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';

import { PROJECT_SCHEMA_VERSION } from '../../src/common/editor/project-schema-version.ts';
import {
	addRackEffect,
	bootEditor,
	chooseNestedCommandAction,
	chooseFileAction,
	closeDialog,
	closeEffectsPanel,
	closeWorkspacePanel,
	commitInput,
	collectClientErrors,
	clipByName,
	importFiles,
	getMenuItem,
	openClipProperties,
	openEffectsForTrack,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const WEBKIT_AV_IMPORT_DEFERRED = 'Playwright WebKit rejects the IndexedDB Blob write that persists an imported A/V source.';
const FREEZE_SAMPLE_RATE = 48_000;
const FREEZE_INPUT_FRAMES = 256;
const FREEZE_INSERT_LATENCY_FRAMES = 240;
const FREEZE_DELAY_FRAMES = 48;
const freezeImpulse = createFreezeImpulse();

test.describe('Soundscaper exact timing and freeze workflows', () => {
	registerAudioEditorHooks();

	test('imports exact-timing A/V with one aligned V30 media-lane duration', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'webkit', WEBKIT_AV_IMPORT_DEFERRED);
		test.setTimeout(90_000);
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createDeterministicAvFixture('v30-exact-timing.webm')]);
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
		expect(stored.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
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
		// Import decodes through the device AudioContext, so the material arrives at
		// whatever rate that clock runs at: CI drives Firefox from a 48 kHz null sink and
		// this machine from a 44.1 kHz one. The rate is a clip property rather than a
		// track menu entry, and resampling to the rate the source already carries commits
		// nothing, so only claim the entry where the command had work to do.
		const properties = await openClipProperties(page, editor, clipByName(editor, freezeImpulse.name));
		const sourceRate = Number(await properties
			.locator('[data-clip-source-fact="sampleRate"] .audio-editor-field__value').innerText());
		expect(Number.isFinite(sourceRate)).toBe(true);
		if (sourceRate !== FREEZE_SAMPLE_RATE) {
			await properties.getByRole('button', { name: 'Resample', exact: true }).click();
			const resampleDialog = page.locator('[data-clip-resample-dialog]');
			await expect(resampleDialog).toBeVisible();
			await commitInput(
				resampleDialog.locator('[data-clip-resample-field="sampleRate"] input'),
				String(FREEZE_SAMPLE_RATE),
			);
			await resampleDialog.getByRole('button', { name: 'Resample', exact: true }).click();
			await expect(resampleDialog).toBeHidden();
			await expect(history.locator('[data-history-list] > li'))
				.toHaveCount(historyBeforeResample + 1, { timeout: 10_000 });
		}
		await closeDialog(properties);
		await track.locator('[data-track-header]').click();
		await expect(track.locator('[data-track-lane]')).toHaveAttribute('data-selected', 'true');
		await closeWorkspacePanel(editor, 'history');

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
});

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
		databaseName: SOUNDSCAPER_DATABASE_NAME,
		requestedProjectId: projectId,
		requestedTrackId: trackId,
	});
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
	}), { databaseName: SOUNDSCAPER_DATABASE_NAME, id: projectId });
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
