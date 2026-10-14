/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';

export async function playAndWaitForAdvance(editor) {
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	const start = Number(await playhead.getAttribute('aria-valuenow'));
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(start);
}
