/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';

import {
	addRackEffect,
	chooseCommandAction,
	chooseNestedCommandAction,
	clickClipInterior,
	clipField,
	closeDialog,
	commitInput,
	openClipProperties,
	openEffectsForTrack,
} from '../audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './editor-databases.js';
import { chooseTrackMenuAction } from './track-menu.js';

export const selectionEffects = Object.freeze({
	amplify: { category: 'Volume and compression', name: 'Amplify' },
	bassTreble: { category: 'EQ and filters', name: 'Bass and Treble' },
	compressor: { category: 'Volume and compression', name: 'Compressor' },
	highPass: { category: 'EQ and filters', name: 'High-pass filter' },
	invert: { category: 'Special', name: 'Invert', direct: true },
	lowPass: { category: 'EQ and filters', name: 'Low-pass filter' },
	noiseGate: { category: 'Noise removal and repair', name: 'Noise gate' },
	normalize: { category: 'Volume and compression', name: 'Normalize' },
	notch: { category: 'EQ and filters', name: 'Notch filter' },
	shelf: { category: 'EQ and filters', name: 'Shelf filter' },
	tremolo: { category: 'Distortion and modulation', name: 'Tremolo' },
});

export async function installOscillatorMicrophone(page) {
	await page.addInitScript(() => {
		const streams = [];
		Object.defineProperty(globalThis, '__complexWorkflowStreams', {
			configurable: true,
			value: streams,
		});
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: {
				enumerateDevices: async () => [{
					kind: 'audioinput',
					deviceId: 'default',
					groupId: 'complex-workflow-fixture',
					label: 'Complex workflow microphone',
				}],
				async getUserMedia() {
					const context = new AudioContext({ sampleRate: 48_000 });
					const oscillator = context.createOscillator();
					const gain = context.createGain();
					const destination = context.createMediaStreamDestination();
					oscillator.frequency.value = 220 + streams.length * 55;
					gain.gain.value = 0.12;
					oscillator.connect(gain).connect(destination);
					oscillator.start();
					await context.resume();
					const [track] = destination.stream.getAudioTracks();
					const getSettings = track.getSettings.bind(track);
					Object.defineProperty(track, 'getSettings', {
						configurable: true,
						value: () => ({
							...getSettings(),
							channelCount: 1,
							latency: 0,
							sampleRate: 48_000,
						}),
					});
					streams.push({ context, destination, gain, oscillator });
					return destination.stream;
				},
			},
		});
	});
}

export async function editClipProperties(page, editor, clip, edits) {
	const dialog = await openClipProperties(page, editor, clip);
	for (const [field, value] of Object.entries(edits)) {
		if (value === undefined) continue;
		if (field === 'stretchToTempo') {
			const toggle = dialog.locator('[data-clip-field="stretchToTempo"]').getByRole('checkbox');
			if (await toggle.isChecked() !== Boolean(value)) await toggle.click();
			await expect(toggle).toHaveAttribute('aria-checked', String(Boolean(value)));
			continue;
		}
		const input = clipField(dialog, field);
		await commitInput(input, String(value));
		if (Number.isFinite(Number(value))) {
			await expect.poll(async () => Number(await input.inputValue())).toBeCloseTo(Number(value), 6);
		} else {
			await expect(input).toHaveValue(String(value));
		}
	}
	await closeDialog(dialog);
}

export function trackRow(clip) {
	return clip.locator('xpath=ancestor::*[@data-track-row][1]');
}

export async function clipCount(editor) {
	return Number(await editor.getAttribute('data-clip-count'));
}

export async function trackCount(editor) {
	return Number(await editor.getAttribute('data-track-count'));
}

export async function waitForSaved(editor) {
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
		timeout: 20_000,
	});
}

export async function selectClipHeader(clip) {
	await clip.locator('.clip-header').click();
	await expect(clip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
}

export async function copyClipAndPaste(page, editor, clip, pasteAction) {
	await selectClipHeader(clip);
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', pasteAction]);
}

export async function authorClipGainPoint(page, editor, clip, position) {
	const points = await addClipGainPoint(page, editor, clip, position);
	const tool = editor.getByRole('button', { name: 'Clip gain', exact: true });
	if (await tool.getAttribute('aria-pressed') === 'true') await tool.click();
	await expect(tool).toHaveAttribute('aria-pressed', 'false');
	return points;
}

export async function duplicateClip(page, editor, clip) {
	const existing = new Set(await editor.locator('[data-clip-id]').evaluateAll(
		(nodes) => nodes.map((node) => node.getAttribute('data-clip-id')),
	));
	const before = await clipCount(editor);
	await selectClipHeader(clip);
	await chooseCommandAction(page, editor, 'Edit', 'Duplicate');
	await expect(editor).toHaveAttribute('data-clip-count', String(before + 1));
	const duplicateId = await editor.locator('[data-clip-id]').evaluateAll((nodes, ids) => (
		nodes.map((node) => node.getAttribute('data-clip-id')).find((id) => !ids.includes(id)) ?? null
	), [...existing]);
	expect(duplicateId).toBeTruthy();
	const duplicate = editor.locator(`[data-clip-id="${duplicateId}"]`);
	await expect(duplicate).toBeVisible();
	return duplicate;
}

export async function clipDurationFrames(page, editor, clip) {
	const dialog = await openClipProperties(page, editor, clip);
	const duration = Number(await clipField(dialog, 'durationFrame').inputValue());
	await closeDialog(dialog);
	return duration;
}

export async function splitClip(page, editor, clip, position) {
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	await expect(clip).toBeVisible();
	const row = clip.locator('xpath=ancestor::*[@data-track-row][1]');
	const clips = row.locator('[data-clip-id]');
	const before = await clips.count();
	const splitTool = editor.getByRole('button', { name: 'Split tool', exact: true });
	if (await splitTool.getAttribute('aria-pressed') !== 'true') await splitTool.click();
	await clickClipInterior(page, clip, position);
	await expect(clips).toHaveCount(before + 1);
	if (await splitTool.getAttribute('aria-pressed') === 'true') await splitTool.click();
	return clips;
}

export async function addClipGainPoint(page, editor, clip, position, verticalOffset = 0) {
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	await clip.locator('.clip-header').click();
	await expect(clip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	const tool = editor.getByRole('button', { name: 'Clip gain', exact: true });
	if (await tool.getAttribute('aria-pressed') !== 'true') await tool.click();
	const envelope = clip.locator('.envelope-overlay');
	await expect(envelope).toBeVisible();
	const before = await clip.locator('.envelope-point').count();
	const bounds = await envelope.boundingBox();
	expect(bounds).not.toBeNull();
	const curvePoint = await envelope.locator('path').evaluateAll((paths, targetX) => {
		let closest = null;
		for (const path of paths) {
			const matrix = path.getScreenCTM();
			if (!matrix) continue;
			const length = path.getTotalLength();
			for (let step = 0; step <= 100; step += 1) {
				const point = path.getPointAtLength(length * step / 100);
				const client = new DOMPoint(point.x, point.y).matrixTransform(matrix);
				const distance = Math.abs(client.x - targetX);
				if (!closest || distance < closest.distance) {
					closest = { distance, x: client.x, y: client.y };
				}
			}
		}
		return closest && { x: closest.x, y: closest.y };
	}, bounds.x + bounds.width * position);
	expect(curvePoint).not.toBeNull();
	await page.mouse.click(curvePoint.x, curvePoint.y + verticalOffset);
	await expect(clip.locator('.envelope-point')).toHaveCount(before + 1);
	return clip.locator('.envelope-point');
}

export async function addTrackAutomation(page, editor, row, {
	mode = 'read',
	parameter = null,
	nudge = 0,
} = {}) {
	const controls = row.locator('[data-track-automation-controls]');
	if (!await controls.isVisible()) await chooseTrackMenuAction(page, editor, row, 'Add automation');
	await expect(controls).toBeVisible();
	if (parameter) {
		await controls.getByRole('combobox', { name: 'Automation parameter', exact: true })
		.selectOption({ label: parameter });
	}
	const overlay = row.locator('[data-track-automation-overlay]');
	const insert = overlay.locator('[data-automation-insert-point]').first();
	await insert.focus();
	await page.keyboard.press('i');
	await expect(overlay.locator('[data-automation-point-id]')).toHaveCount(2);
	const point = overlay.locator('[data-automation-point-id]').last();
	if (nudge !== 0) {
		await point.focus();
		const key = nudge > 0 ? 'ArrowUp' : 'ArrowDown';
		for (let step = 0; step < Math.abs(nudge); step += 1) await page.keyboard.press(key);
	}
	const modeSelect = controls.getByRole('combobox', { name: 'Automation mode', exact: true });
	await modeSelect.selectOption(mode);
	await expect(modeSelect).toHaveValue(mode);
	return { controls, modeSelect, overlay, row };
}

export async function setProjectTempo(page, editor, bpm) {
	const workspace = page.locator('[data-sidebar] [data-workspace-select]');
	if (await workspace.inputValue() !== 'music') await workspace.selectOption('music');
	await expect(editor).toHaveAttribute('data-workspace-preset', 'music');
	const tempo = editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true });
	await tempo.fill(String(bpm));
	await tempo.blur();
	await expect(tempo).toHaveValue(String(bpm));
}

export async function selectClipRange(page, editor, clip, start, end) {
	for (const label of ['Clip gain', 'Split tool']) {
		const tool = editor.getByRole('button', { name: label, exact: true });
		if (await tool.getAttribute('aria-pressed') === 'true') await tool.click();
	}
	const row = clip.locator('xpath=ancestor::*[@data-track-row][1]');
	if (await row.locator('[data-track-automation-controls]').isVisible()) {
		await chooseTrackMenuAction(page, editor, row, 'Add automation');
		await expect(row.locator('[data-track-automation-controls]')).toHaveCount(0);
	}
	const bounds = await clip.boundingBox();
	expect(bounds).not.toBeNull();
	const y = bounds.y + bounds.height * 0.58;
	await page.mouse.move(bounds.x + bounds.width * start, y);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width * end, y, { steps: 5 });
	await page.mouse.up();
	await expect(editor.locator('[data-time-selection-overlay]')).not.toHaveCount(0);
}

export async function deleteClipRange(page, editor, clip, {
	start = 0.3,
	end = 0.55,
	mode = 'Delete and leave gap',
} = {}) {
	await selectClipRange(page, editor, clip, start, end);
	const before = Number(await editor.getAttribute('data-clip-count'));
	await chooseNestedCommandAction(page, editor, 'Edit', ['Delete', mode]);
	await expect.poll(async () => Number(await editor.getAttribute('data-clip-count')))
		.not.toBe(before);
}

export async function recordPass(page, editor, {
	adjust = null,
	newTrack = false,
	pause = false,
} = {}) {
	await page.evaluate(async () => {
		await Promise.all((globalThis.__complexWorkflowStreams ?? []).map(({ context }) => (
			context.state === 'suspended' ? context.resume() : undefined
		)));
	});
	const projectId = await editor.getAttribute('data-project-id');
	expect(projectId).toBeTruthy();
	const beforeIds = new Set(await persistedClipIds(page, projectId));
	const beforeTracks = Number(await editor.getAttribute('data-track-count'));
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	if (newTrack) {
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await expect(editor).toHaveAttribute('data-track-count', String(beforeTracks + 1));
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 20_000,
		});
	}
	await record.click();
	await expect(record).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
	const recordingPreview = editor.locator('[data-clip-id^="recording-preview-"]');
	const recordingStartFrame = Number(await playhead.getAttribute('aria-valuenow'));
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow')), {
		timeout: 30_000,
	}).toBeGreaterThanOrEqual(recordingStartFrame + 24_000);
	await expect(record).toHaveAttribute('aria-pressed', 'true');
	if (adjust) {
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		await adjust();
	}
	if (pause) {
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		const frameBeforePause = Number(await playhead.getAttribute('aria-valuenow'));
		await record.click();
		await expect(record).toHaveAccessibleName('Resume recording');
		await record.click();
		await expect(record).toHaveAccessibleName('Pause recording');
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow')), {
			timeout: 15_000,
		}).toBeGreaterThan(frameBeforePause + 1_200);
	}
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(record).toHaveAttribute('aria-pressed', 'false', { timeout: 20_000 });
	await expect(recordingPreview).toHaveCount(0, { timeout: 20_000 });
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 20_000 });
	if (newTrack) await expect(editor).toHaveAttribute('data-track-count', String(beforeTracks + 1));
	let newId = null;
	await expect.poll(async () => {
		newId = (await persistedClipIds(page, projectId)).find((id) => !beforeIds.has(id)) ?? null;
		return newId;
	}, { timeout: 20_000 }).not.toBeNull();
	await revealTimelineClip(page, editor, newId);
	const clip = editor.locator(`[data-clip-id="${newId}"]`);
	await expect(clip).toBeVisible();
	return {
		clip,
		row: clip.locator('xpath=ancestor::*[@data-track-row][1]'),
	};
}

export async function persistedClipIds(page, projectId) {
	const project = await persistedProject(page, projectId);
	return (project?.clips ?? []).map(({ id }) => String(id));
}

export async function persistedClipIdsByName(page, projectId, name) {
	return (await persistedClipsByName(page, projectId, name)).map(({ id }) => String(id));
}

export async function persistedClipsByName(page, projectId, name) {
	const project = await persistedProject(page, projectId);
	const sources = new Map((project?.sources ?? []).map((source) => [String(source.id), source]));
	return (project?.clips ?? [])
		.filter((clip) => {
			const source = sources.get(String(clip.sourceId));
			return [clip.title, source?.name, source?.fileName, source?.filename, source?.originalName]
				.includes(name);
		})
		.toSorted((left, right) => left.timelineStartFrame - right.timelineStartFrame);
}

export async function expectContiguousSourceClips(page, projectId, name, count) {
	await expect.poll(async () => {
		const clips = await persistedClipsByName(page, projectId, name);
		return {
			count: clips.length,
			gaps: clips.slice(1).map((clip, index) => (
				clip.timelineStartFrame
					- clips[index].timelineStartFrame
					- clips[index].durationFrames
			)),
		};
	}).toEqual({ count, gaps: Array.from({ length: count - 1 }, () => 0) });
	return persistedClipsByName(page, projectId, name);
}

export function clipEditingState(clip) {
	const {
		sourceId, timelineStartFrame, sourceStartFrame, sourceDurationFrames, durationFrames,
		trimStartFrames, trimEndFrames, gain, fadeInFrames, fadeOutFrames, envelope,
		reversed, inverted, pitchCents, speedRatio, preserveFormants, stretchToTempo,
	} = clip;
	return {
		sourceId, timelineStartFrame, sourceStartFrame, sourceDurationFrames, durationFrames,
		trimStartFrames, trimEndFrames, gain, fadeInFrames, fadeOutFrames, envelope,
		reversed, inverted, pitchCents, speedRatio, preserveFormants, stretchToTempo,
	};
}

export function clipContentState(clip) {
	const { timelineStartFrame, ...state } = clipEditingState(clip);
	return state;
}

export function clipProcessingState(clip) {
	const { sourceId, ...state } = clipContentState(clip);
	return state;
}

export async function setTrackMuteSolo(row, { mute = false, solo = false }) {
	for (const [label, enabled] of [['Mute', mute], ['Solo', solo]]) {
		if (!enabled) continue;
		const button = row.getByRole('button', { name: label, exact: true });
		await button.click();
		await expect(button).toHaveAttribute('aria-pressed', 'true');
	}
}

export async function persistedProject(page, projectId) {
	return page.evaluate(({ databaseName, id }) => new Promise((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => {
			const database = opening.result;
			const request = database.transaction('projects', 'readonly').objectStore('projects').get(id);
			request.onerror = () => {
				database.close();
				reject(request.error);
			};
			request.onsuccess = () => {
				database.close();
				resolve(request.result ?? null);
			};
		};
	}), { databaseName: SOUNDSCAPER_DATABASE_NAME, id: projectId });
}

export async function revealTimelineClip(page, editor, clipId) {
	await page.keyboard.press('Control+k');
	const search = editor.locator('[data-editor-search-input]');
	await search.fill(clipId);
	const result = editor.locator(
		`[data-editor-search-option][data-editor-search-key="timeline:${clipId}"]`,
	);
	await expect(result).toHaveCount(1);
	await result.click();
	await expect(editor.locator(`[data-clip-id="${clipId}"]`)).toBeVisible();
}

export async function writeAutomationGesture(page, row, direction = 'ArrowDown') {
	const volume = row.getByRole('slider', { name: 'Volume', exact: true });
	const bounds = await volume.boundingBox();
	expect(bounds).not.toBeNull();
	const minimum = Number(await volume.getAttribute('min') ?? 0);
	const maximum = Number(await volume.getAttribute('max') ?? 100);
	const value = Number(await volume.inputValue());
	const fraction = (value - minimum) / Math.max(1, maximum - minimum);
	const startX = bounds.x + Math.max(2, Math.min(bounds.width - 2, bounds.width * fraction));
	const distance = Math.max(8, bounds.width * 0.08) * (direction === 'ArrowUp' ? 1 : -1);
	const endX = Math.max(bounds.x + 2, Math.min(bounds.x + bounds.width - 2, startX + distance));
	const y = bounds.y + bounds.height / 2;
	await page.mouse.move(startX, y);
	await page.mouse.down();
	await page.mouse.move(endX, y, { steps: 4 });
	await page.mouse.up();
}

export async function applySelectionEffect(page, editor, clip, effect) {
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', [effect.category, effect.name]);
	if (!effect.direct) {
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 30_000 });
	}
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', {
		timeout: 30_000,
	});
}

export async function addTrackRackEffect(page, editor, row, effectName = 'Invert') {
	const index = await editor.locator('[data-track-row]').evaluateAll(
		(nodes, trackId) => nodes.findIndex((node) => node.dataset.trackId === trackId),
		await row.getAttribute('data-track-id'),
	);
	expect(index).toBeGreaterThanOrEqual(0);
	const panel = await openEffectsForTrack(editor, index);
	const picker = page.getByRole('menu', { name: 'Choose an effect', exact: true });
	await addRackEffect(page, panel, 'track', effectName);
	await expect(picker).toBeHidden();
	const rackEffect = panel.locator('[data-effect-rack]').getByRole('group', {
		name: effectName,
		exact: true,
	});
	await expect(rackEffect).toBeVisible();
	const host = page.locator('[data-effects-window-host]');
	if (await host.count()) {
		const dialog = host.getByRole('dialog', { name: effectName, exact: true });
		await expect(dialog).toBeVisible();
		await closeDialog(dialog);
		await expect(host).toHaveCount(0);
	}
	return panel;
}

export async function deleteWholeClip(page, editor, clipOrId) {
	const id = typeof clipOrId === 'string'
		? clipOrId
		: await clipOrId.getAttribute('data-clip-id');
	expect(id).toBeTruthy();
	await revealTimelineClip(page, editor, id);
	const clip = editor.locator(`[data-clip-id="${id}"]`);
	await clip.locator('.clip-header').click();
	await editor.getByRole('region', { name: 'Timeline', exact: true }).first().press('Delete');
	await expect(editor.locator(`[data-clip-id="${id}"]`)).toHaveCount(0);
}
