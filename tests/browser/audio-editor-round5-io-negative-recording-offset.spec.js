/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject, recordPass } from './helpers/complex-editing-workflows.js';

test.use({ browserCoverage: false });

test('a negative recording offset delays the saved take instead of disappearing at zero latency', async ({ page }) => {
	test.setTimeout(90_000);
	await installOscillatorMicrophone(page);
	const editor = await bootEditor(page, '/embed/en/');
	const projectId = await editor.getAttribute('data-project-id');
	// Open the real device once; its automatic latency may still change between
	// captures, so each signed placement is checked independently.
	await recordPass(page, editor);
	const starts = [];
	const savedClips = [];
	for (const offset of [-500, -400]) {
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
		const input = preferences.getByRole('spinbutton', { name: 'Recording offset (ms)', exact: true });
		await input.fill(String(offset));
		await input.press('Tab');
		await expect(input).toHaveValue(String(offset));
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(preferences).toBeHidden();
		const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
		await playhead.press('Home');
		await expect(playhead).toHaveAttribute('aria-valuenow', '0');
		const recorded = await recordPass(page, editor, { newTrack: true });
		const clipId = await recorded.clip.getAttribute('data-clip-id');
		const project = await persistedProject(page, projectId);
		const clip = project.clips.find(candidate => candidate.id === clipId);
		expect(clip).toBeTruthy();
		const source = project.sources.find(candidate => candidate.id === clip.sourceId);
		expect(source).toBeTruthy();
		expect(clip.sourceStartFrame).toBe(0);
		expect(clip.sourceDurationFrames).toBe(source.frameCount);
		expect(clip.durationFrames).toBe(Math.round(source.frameCount * project.sampleRate / source.sampleRate));
		expect(clip.trimStartFrames).toBe(0);
		expect(clip.trimEndFrames).toBe(0);
		expect(source.sampleRate).toBeGreaterThan(0);
		expect(source.frameCount).toBeGreaterThan(0);
		expect(clip.timelineStartFrame).toBeLessThanOrEqual(-offset * project.sampleRate / 1_000);
		starts.push(clip.timelineStartFrame / project.sampleRate);
		savedClips.push({ clip, source });
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect.poll(async () => (await persistedProject(page, projectId)).clips.some(
			candidate => candidate.id === clipId,
		)).toBe(false);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect.poll(async () => (await persistedProject(page, projectId)).clips.find(
			candidate => candidate.id === clipId,
		)).toEqual(clip);
	}
	await test.info().attach('saved-negative-offset-positions', {
		body: Buffer.from(JSON.stringify({ offsets: [-500, -400], starts })), contentType: 'application/json',
	});
	expect(starts[0]).toBeGreaterThan(0.25);
	expect(starts[1]).toBeGreaterThan(0.15);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	const restored = await waitForEditor(page);
	await waitForProjectActivation(restored);
	await expect(restored).toHaveAttribute('data-project-id', projectId);
	await expect(restored).toHaveAttribute('data-clip-count', '3');
	const project = await persistedProject(page, projectId);
	for (const { clip, source } of savedClips) {
		expect(project.clips.find(candidate => candidate.id === clip.id)).toEqual(clip);
		expect(project.sources.find(candidate => candidate.id === source.id)).toEqual(source);
	}
});
