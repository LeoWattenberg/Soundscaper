/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import ProjectBinPanel from '../src/common/editor/ui/workspace/ProjectBinPanel.jsx';

const PANEL_URL = new URL('../src/common/editor/ui/workspace/ProjectBinPanel.jsx', import.meta.url);
(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('the Project Bin exposes the localized linked-video chooser only when its platform capability exists', () => {
	const english = renderProjectBin(ENGLISH_COPY, true);
	const german = renderProjectBin(GERMAN_COPY, true);
	const unavailable = renderProjectBin(ENGLISH_COPY, false);
	const readOnly = renderProjectBin(ENGLISH_COPY, true, true);

	assert.match(english, />Link video</u);
	assert.match(german, />Video verknüpfen</u);
	assert.doesNotMatch(unavailable, />Link video</u);
	assert.match(readOnly, /button--disabled[^>]* disabled=""[^>]*>[\s\S]*?>Link video</u);
});

test('the linked-video Project Bin action forwards only the chosen File and opaque locator snapshot', async () => {
	const source = await readFile(PANEL_URL, 'utf8');

	assert.match(source, /const chooseLinkedVideo = \(\) => run\(async \(\) => \{\s*if \(mutationBlocked\) return;\s*const choice = await fileService\.chooseLinkedVideoOriginal\(\)/u);
	assert.match(source, /if \(!choice\) return;[\s\S]*controller\.actions\.project\.importFiles\(\[choice\.file\], \{[\s\S]*destination: 'project-bin',[\s\S]*linkedVideoLocatorId: choice\.locatorId,[\s\S]*linkedVideoLocatorRevision: choice\.locatorRevision,[\s\S]*\}\)/u);
	assert.doesNotMatch(source, /releaseLinkedVideoOriginal/u);
	assert.doesNotMatch(source, /choice\.(?:name|path|mimeType|size)/u);
});

function renderProjectBin(
	copy: typeof ENGLISH_COPY,
	linkedVideoOriginalsAvailable: boolean,
	readOnly = false,
): string {
	const noop = () => undefined;
	const controller = {
		subscribeTelemetry: () => noop,
		getTelemetrySnapshot: () => ({ positionFrame: 0 }),
		actions: { project: {}, projectBin: {} },
	};
	return renderToStaticMarkup(React.createElement(ProjectBinPanel, {
		controller,
		snapshot: {
			project: { projectBin: { clips: [] }, sources: [], tracks: [] },
			missingSourceIds: [],
			readOnly,
		},
		copy,
		locale: 'en',
		fileService: { linkedVideoOriginalsAvailable },
		run: noop,
		blocked: false,
	}));
}
