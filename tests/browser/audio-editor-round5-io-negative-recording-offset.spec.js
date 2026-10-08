/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject, recordPass } from './helpers/complex-editing-workflows.js';

test.use({ browserCoverage: false });

test('a negative recording offset delays the saved take instead of disappearing at zero latency', async ({ page }) => {
	test.setTimeout(90_000);
	await installOscillatorMicrophone(page);
	const editor = await bootEditor(page, '/embed/en/');
	const projectId = await editor.getAttribute('data-project-id');
	// Open the real device once before comparing two manual corrections; its
	// reported output latency can change when the first recording starts it.
	await recordPass(page, editor);
	const starts = [];
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
		await editor.getByRole('slider', { name: 'Playhead', exact: true }).press('Home');
		const recorded = await recordPass(page, editor, { newTrack: true });
		const clipId = await recorded.clip.getAttribute('data-clip-id');
		const project = await persistedProject(page, projectId);
		const clip = project.clips.find(candidate => candidate.id === clipId);
		expect(clip).toBeTruthy();
		starts.push(clip.timelineStartFrame / project.sampleRate);
	}
	await test.info().attach('saved-negative-offset-positions', {
		body: Buffer.from(JSON.stringify({ offsets: [-500, -400], starts })), contentType: 'application/json',
	});
	expect(starts[0]).toBeGreaterThan(0.25);
	expect(starts[1]).toBeGreaterThan(0.15);
	expect(starts[0] - starts[1]).toBeCloseTo(0.1, 3);
});
