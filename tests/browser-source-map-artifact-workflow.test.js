/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SOURCE_MAP_DOWNLOAD_STEPS = Object.freeze([
	'Download the website build\'s source maps',
	'Download the Framescaper website build\'s source maps',
]);

test('every browser engine receives the source maps required to verify both product sites', async () => {
	for (const workflowName of ['quality.yml', 'desktop-preview.yml', 'desktop-nightly-tests.yml']) {
		const workflow = await readFile(new URL(`../.github/workflows/${workflowName}`, import.meta.url), 'utf8');
		for (const stepName of SOURCE_MAP_DOWNLOAD_STEPS) {
			const escapedName = stepName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
			const directDownloads = workflow.match(
				new RegExp(`- name: ${escapedName}\\n\\s+uses: actions/download-artifact@`, 'gu'),
			);
			assert.equal(directDownloads?.length, 2,
				`${workflowName} must download ${stepName.toLowerCase()} for both browser job families`);
		}
	}
});
