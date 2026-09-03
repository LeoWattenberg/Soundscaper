/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Replays a handbook lesson against the built editor, one Playwright step per
 * lesson step, using the same labels the handbook page tells the reader to use.
 * The step vocabulary lives in `handbook/lessons/steps.mjs`; this file is the
 * only place that knows how each kind is driven.
 */

import { expect, test } from '@playwright/test';

import { describeStep } from '../../../handbook/lessons/steps.mjs';
import { lessonFixtureFile as lessonFixtureName } from '../../../handbook/lessons/fixtures.mjs';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	chooseNestedCommandAction,
	clickClipInterior,
	clipByName,
	closeDialog,
	collectClientErrors,
	commitInput,
	disableNativeSavePicker,
	importFiles,
	openExportDialog,
} from '../audio-editor-test-helpers.js';
import {
	runDragClip,
	runExportProject,
	runOpenAudacityProject,
	runOpenProjectFile,
	runRackEffect,
	runResample,
} from './lesson-actions.js';
import { lessonFixtureClipName, lessonFixtureFile } from './lesson-fixtures.js';
import { chooseTrackMenuAction } from './track-menu.js';

const EFFECT_TIMEOUT = 30_000;
const EXPORT_TIMEOUT = 60_000;
const APPLIED_STATUS = 'Applied the Audacity effect.';
const NOISE_PROFILE_STATUS = 'Noise profile is ready.';

/** The step sentence without its Markdown, for the Playwright report. */
function plainText(markdown) {
	return markdown.replaceAll('**', '').replaceAll('`', '');
}

function status(editor) {
	return editor.locator('[data-status]');
}

async function expectSuccess(editor, timeout = EFFECT_TIMEOUT) {
	await expect(status(editor)).toHaveAttribute('data-state', 'success', { timeout });
}

/**
 * An imported clip carries its file name; the clip an effect writes back drops
 * the extension. Both are the reader's "the clip", so accept either.
 */
function lessonClip(editor, clipName) {
	const base = clipName.replace(/\.wav$/u, '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	return editor.getByRole('group', { name: new RegExp(`^${base}(?:\\.wav)? clip(?:,|$)`, 'u') }).first();
}

async function currentClip(state) {
	if (!state.clipName) throw new Error('This step needs an imported clip.');
	const clip = lessonClip(state.editor, state.clipName);
	await expect(clip).toBeVisible();
	await clip.scrollIntoViewIfNeeded();
	const box = await clip.boundingBox();
	expect(box).not.toBeNull();
	return { clip, box };
}

// A drag in the ruler above the tracks makes a time selection; the ruler is
// also where the playhead handle sits, and pressing on the handle drags the
// playhead instead. The playhead rests at the clip start, so a selection that
// begins there is dragged from its far end back to the start.
async function dragSelection(page, state, from, to) {
	const { box } = await currentClip(state);
	// The upper half of the ruler canvas is the loop band, so press below it.
	const ruler = state.editor.locator('[data-ruler-interaction] canvas.timeline-ruler').first();
	await expect(ruler).toBeVisible();
	const rulerBox = await ruler.boundingBox();
	expect(rulerBox).not.toBeNull();
	const x = (fraction) => box.x + 2 + (box.width - 4) * fraction;
	const y = rulerBox.y + rulerBox.height * 0.8;
	const [startX, endX] = from === 0 ? [x(to), x(from)] : [x(from), x(to)];
	await page.mouse.move(startX, y);
	await page.mouse.down();
	await page.mouse.move(endX, y, { steps: 8 });
	await page.mouse.up();
	await expect(state.editor.locator('[data-time-selection-overlay]').first()).toBeVisible();
}

async function openEffectDialog(page, state, group, name) {
	await chooseNestedCommandAction(page, state.editor, 'Effect', [group, name]);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

// A field is labelled by its parameter name, sometimes followed by its unit in
// parentheses ("Threshold (dB)"); the lesson names the parameter alone.
function settingGroup(dialog, label) {
	const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	return dialog.getByRole('group', { name: new RegExp(`^${escaped}(?: \\([^)]*\\))?$`, 'u') }).first();
}

async function applySetting(page, dialog, setting) {
	const group = settingGroup(dialog, setting.label);
	if ('value' in setting) {
		await commitInput(group.locator('input').first(), setting.value);
	} else if ('option' in setting) {
		await chooseDropdown(page, group, setting.option);
	} else {
		await dialog.getByRole('checkbox', { name: setting.label, exact: true }).setChecked(setting.checked);
	}
}

async function runEffect(page, state, entry) {
	if (entry.direct) {
		await chooseNestedCommandAction(page, state.editor, 'Effect', [entry.group, entry.name]);
		await expect(status(state.editor)).toHaveText(APPLIED_STATUS, { timeout: EFFECT_TIMEOUT });
		return;
	}
	const dialog = await openEffectDialog(page, state, entry.group, entry.name);
	for (const setting of entry.settings) await applySetting(page, dialog, setting);
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: EFFECT_TIMEOUT });
	await expectSuccess(state.editor);
}

async function runNoiseProfile(page, state) {
	const dialog = await openEffectDialog(page, state, 'Noise removal and repair', 'Noise Reduction');
	await dialog.getByRole('button', { name: 'Get noise profile', exact: true }).click();
	await expect(status(state.editor)).toHaveText(NOISE_PROFILE_STATUS, { timeout: EFFECT_TIMEOUT });
	await closeDialog(dialog);
}

async function runExport(page, state, entry) {
	const dialog = await openExportDialog(page, state.editor);
	if (entry.mode) await chooseDropdown(page, dialog.locator('[data-export-field="mode"]'), entry.mode);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), entry.format);
	await dialog.getByRole('button', { name: 'Start export', exact: true }).click();
	const download = dialog.locator('[data-export-download]');
	const failure = dialog.locator('.audio-editor-field-error');
	await expect(download.or(failure)).toBeVisible({ timeout: EXPORT_TIMEOUT });
	expect(await failure.allTextContents()).toEqual([]);
	await expect(download).toHaveAttribute('download', new RegExp(`\\.${entry.extension}$`, 'u'));
	await closeDialog(dialog);
}

async function runPlay(state) {
	const { editor } = state;
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	const stop = editor.getByRole('button', { name: 'Stop', exact: true });
	await expect(stop).toBeEnabled();
	await stop.click();
}

async function runGenerate(page, state, entry) {
	await chooseCommandAction(page, state.editor, 'Generate', entry.name);
	const dialog = page.getByRole('dialog', { name: entry.name, exact: true });
	await expect(dialog).toBeVisible();
	for (const field of entry.fields) {
		await commitInput(dialog.locator(`[data-generator-field="${field.field}"] input`), field.value);
	}
	await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: EFFECT_TIMEOUT });
}

async function runMarker(page, state, entry) {
	const { editor } = state;
	await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Markers']);
	const panel = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
	await expect(panel).toBeVisible();
	await panel.getByRole('button', { name: 'Add marker at playhead', exact: true }).click();
	const layer = editor.getByRole('listbox', { name: 'Markers and named regions', exact: true });
	const marker = layer.getByRole('option').first();
	await expect(marker).toBeVisible();
	await marker.focus();
	await marker.press('Enter');
	const rename = editor.locator('.audio-editor-timeline-annotation__rename--overlay');
	await expect(rename).toBeFocused();
	await rename.fill(entry.name);
	await rename.press('Enter');
	await expect(marker).toHaveAttribute('aria-label', new RegExp(`^${entry.name}, Marker`, 'u'));
}

async function runNyquist(page, state, entry) {
	await chooseNestedCommandAction(page, state.editor, entry.menu, ['Nyquist', entry.name]);
	const dialog = page.getByRole('dialog', { name: entry.name, exact: true });
	await expect(dialog).toBeVisible();
	for (const field of entry.fields) {
		await commitInput(dialog.getByRole('spinbutton', { name: field.label, exact: true }), field.value);
	}
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	if (entry.menu === 'Analyze') {
		// An analyzer keeps its dialog open to report what it found.
		await expect(dialog).toContainText('Nyquist output', { timeout: EFFECT_TIMEOUT });
		await closeDialog(dialog);
		return;
	}
	await expect(dialog).toBeHidden({ timeout: EFFECT_TIMEOUT });
	await expectSuccess(state.editor);
}

async function runCheck(state, entry) {
	const { editor } = state;
	if (entry.startsAt !== null) {
		const clip = lessonClip(editor, lessonFixtureClipName(entry.startsAt.fixture));
		await expect(clip).toHaveAttribute('aria-label', new RegExp(`starts at ${String(entry.startsAt.seconds)} seconds`, 'u'), { timeout: EFFECT_TIMEOUT });
	}
	if (entry.clips !== null) await expect(editor).toHaveAttribute('data-clip-count', String(entry.clips), { timeout: EFFECT_TIMEOUT });
	if (entry.tracks !== null) await expect(editor).toHaveAttribute('data-track-count', String(entry.tracks), { timeout: EFFECT_TIMEOUT });
	if (entry.clip !== null) await expect(clipByName(editor, entry.clip)).toBeVisible({ timeout: EFFECT_TIMEOUT });
	if (entry.moved !== null) {
		await expect(lessonClip(editor, lessonFixtureClipName(entry.moved))).not.toHaveAttribute('aria-label', /starts at 0 seconds/u);
	}
	if (entry.track !== null) {
		await expect(editor.locator('.track-control-panel__track-name-text').filter({ hasText: entry.track }).first()).toBeVisible();
	}
	if (entry.loop !== null) {
		await expect(editor.getByRole('button', { name: 'Loop selection', exact: true })).toHaveAttribute('aria-pressed', String(entry.loop));
	}
}

async function executeStep(page, state, entry) {
	switch (entry.kind) {
		case 'open':
			state.editor = await bootEditor(page, '/embed/en/');
			return;
		case 'import':
			await importFiles(state.editor, [lessonFixtureFile(entry.fixture)]);
			state.clipName = lessonFixtureClipName(entry.fixture);
			state.fixture = entry.fixture;
			await expect(lessonClip(state.editor, state.clipName)).toBeVisible();
			return;
		case 'menu':
			if (entry.path.length === 2) await chooseCommandAction(page, state.editor, entry.path[0], entry.path[1]);
			else await chooseNestedCommandAction(page, state.editor, entry.path[0], entry.path.slice(1));
			return;
		case 'select-range':
			await dragSelection(page, state, entry.from, entry.to);
			return;
		case 'cursor': {
			const { clip } = await currentClip(state);
			await clickClipInterior(page, clip, entry.fraction);
			return;
		}
		case 'select-clips':
			for (const [index, fixture] of entry.fixtures.entries()) {
				const clip = lessonClip(state.editor, lessonFixtureClipName(fixture));
				await clip.locator('.clip-header').click({ modifiers: index === 0 ? [] : ['Shift'] });
			}
			return;
		case 'tool':
			await state.editor.getByRole('button', { name: entry.name, exact: true }).click();
			return;
		case 'effect':
			await runEffect(page, state, entry);
			return;
		case 'noise-profile':
			await runNoiseProfile(page, state);
			return;
		case 'nyquist':
			await runNyquist(page, state, entry);
			return;
		case 'analyze':
			await chooseCommandAction(page, state.editor, 'Analyze', entry.name);
			await expect(state.editor.locator(`[data-workspace-panel="${entry.panel}"]`)).toBeVisible();
			return;
		case 'save':
			await chooseCommandAction(page, state.editor, 'File', 'Save project');
			await expect(state.editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: EFFECT_TIMEOUT });
			return;
		case 'track-button': {
			const button = state.editor.locator('[data-track-row]').last().getByRole('button', { name: entry.name, exact: true });
			await button.click();
			await expect(button).toHaveAttribute('aria-pressed', 'true');
			return;
		}
		case 'add-track':
			await state.editor.getByRole('button', { name: 'Add track', exact: true }).click();
			await page.getByRole('menuitem', { name: entry.type, exact: true }).click();
			return;
		case 'export':
			await runExport(page, state, entry);
			return;
		case 'track-menu':
			await chooseTrackMenuAction(page, state.editor, state.editor.locator('[data-track-row]').last(), entry.path);
			await expectSuccess(state.editor);
			return;
		case 'play':
			await runPlay(state);
			return;
		case 'generate':
			await runGenerate(page, state, entry);
			return;
		case 'marker':
			await runMarker(page, state, entry);
			return;
		case 'check':
			await runCheck(state, entry);
			return;
		case 'rack-effect':
			await runRackEffect(page, state, entry);
			return;
		case 'open-audacity-project':
			await runOpenAudacityProject(state);
			return;
		case 'export-project':
			await runExportProject(page, state);
			return;
		case 'open-project-file':
			await runOpenProjectFile(page, state);
			return;
		case 'resample':
			await runResample(page, state, entry, (await currentClip(state)).clip);
			return;
		case 'drag-clip':
			await runDragClip(page, state, entry, (await currentClip(state)).clip, state.fixture);
			return;
		case 'note':
			return;
		default:
			throw new RangeError(`Unknown lesson step kind ${String(entry.kind)}.`);
	}
}

/** Replay every step of a lesson and fail on any client error along the way. */
export async function runLesson(page, lesson) {
	await disableNativeSavePicker(page);
	const errors = collectClientErrors(page);
	const state = { editor: null, clipName: null, fixture: null, projectFile: null };
	for (const [index, entry] of lesson.steps.entries()) {
		const title = `${String(index + 1)}. ${plainText(describeStep(entry, { fixtureFile: lessonFixtureName }))}`;
		await test.step(title, () => executeStep(page, state, entry));
	}
	expect(errors).toEqual([]);
}
