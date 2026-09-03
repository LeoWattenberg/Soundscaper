/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The lesson steps that reach beyond the menu bar: track effect racks, project
 * files in both directions, clip properties and clip dragging. Each function
 * drives one step kind for `lesson-runner.js`, which owns the shared state.
 */

import { readFile } from 'node:fs/promises';

import { expect } from '@playwright/test';

import { createAup3Fixture } from '../../aup3-fixture.js';
import { SCAPE_MIME_TYPE } from '../../../src/common/editor/scape-project-format.ts';
import {
	addRackEffect,
	chooseExportProjectFileAction,
	closeDialog,
	closeEffectsPanel,
	commitInput,
	openClipProperties,
	openEffectsForTrack,
} from '../audio-editor-test-helpers.js';
import { LESSON_FIXTURES } from '../../../handbook/lessons/fixtures.mjs';

const OPEN_TIMEOUT = 30_000;

/** The example Audacity project: one track named "Fixture track" holding the clip "Audio 1". */
export const AUDACITY_EXAMPLE = Object.freeze({ file: 'lesson-audacity-project.aup3', track: 'Fixture track', clip: 'Audio 1' });

let audacityProject = null;

async function audacityProjectFile() {
	if (!audacityProject) {
		audacityProject = Object.freeze({
			name: AUDACITY_EXAMPLE.file,
			mimeType: 'application/x-audacity-project',
			buffer: Buffer.from(await createAup3Fixture()),
		});
	}
	return audacityProject;
}

export async function runRackEffect(page, state, entry) {
	const { editor } = state;
	const trackCount = await editor.locator('[data-track-row]').count();
	const panel = await openEffectsForTrack(editor, trackCount - 1);
	await addRackEffect(page, panel, 'track', entry.name);
	const settings = page.getByRole('dialog', { name: entry.name, exact: true });
	await expect(settings).toBeVisible();
	await closeDialog(settings);
	await expect(panel.locator('[data-effect-rack]').getByRole('group', { name: entry.name, exact: true })).toBeVisible();
	await closeEffectsPanel(panel);
}

export async function runOpenAudacityProject(state) {
	const { editor } = state;
	await editor.locator('[data-aup4-input]').setInputFiles(await audacityProjectFile());
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: OPEN_TIMEOUT });
	state.clipName = AUDACITY_EXAMPLE.clip;
}

export async function runExportProject(page, state) {
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, state.editor);
	const download = await downloading;
	const name = download.suggestedFilename();
	expect(name).toMatch(/\.sscape$/u);
	const path = await download.path();
	expect(path).toBeTruthy();
	state.projectFile = Object.freeze({ name, mimeType: SCAPE_MIME_TYPE, buffer: await readFile(path) });
	await download.delete();
}

export async function runOpenProjectFile(page, state) {
	if (!state.projectFile) throw new Error('This step needs a project file from an earlier export step.');
	const { editor } = state;
	const originalId = await editor.getAttribute('data-project-id');
	await editor.locator('[data-aup4-input]').setInputFiles(state.projectFile);
	// The library already holds this project, so the editor asks before it
	// opens a second copy; on another computer the file opens straight away.
	const copy = page.getByRole('button', { name: /^Open as (?:read-only )?copy$/u });
	await expect(copy).toBeVisible({ timeout: OPEN_TIMEOUT });
	await copy.click();
	await expect.poll(() => editor.getAttribute('data-project-id'), { timeout: OPEN_TIMEOUT }).not.toBe(originalId);
	await expect(editor.locator('[data-editor-task-progress="import"]')).toHaveCount(0, { timeout: OPEN_TIMEOUT });
}

export async function runResample(page, state, entry, clip) {
	const properties = await openClipProperties(page, state.editor, clip);
	await properties.getByRole('button', { name: 'Resample', exact: true }).click();
	const dialog = page.locator('[data-clip-resample-dialog]');
	await expect(dialog).toBeVisible();
	await commitInput(dialog.locator('[data-clip-resample-field="sampleRate"] input'), String(entry.rate));
	await dialog.getByRole('button', { name: 'Resample', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: OPEN_TIMEOUT });
	await expect(properties.locator('[data-clip-source-fact="sampleRate"] .audio-editor-field__value'))
		.toHaveText(new RegExp(`^${String(entry.rate)}`, 'u'), { timeout: OPEN_TIMEOUT });
	await closeDialog(properties);
}

/** Drag a clip later by its name bar, scaling seconds to pixels from the clip's own width. */
export async function runDragClip(page, state, entry, clip, fixture) {
	const header = clip.locator('.clip-header');
	const clipBox = await clip.boundingBox();
	const headerBox = await header.boundingBox();
	expect(clipBox).not.toBeNull();
	expect(headerBox).not.toBeNull();
	const pixelsPerSecond = clipBox.width / LESSON_FIXTURES[fixture].seconds;
	const startX = headerBox.x + Math.min(40, headerBox.width / 3);
	const y = headerBox.y + headerBox.height / 2;
	await page.mouse.move(startX, y);
	await page.mouse.down();
	await page.mouse.move(startX + pixelsPerSecond * entry.seconds, y, { steps: 10 });
	await page.mouse.up();
	await expect(clip).not.toHaveAttribute('aria-label', /starts at 0 seconds/u);
}
