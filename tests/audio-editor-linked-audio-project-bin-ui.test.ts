/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import ProjectBinPanel from '../src/common/editor/ui/workspace/ProjectBinPanel.jsx';

const PANEL_URL = new URL('../src/common/editor/ui/workspace/ProjectBinPanel.jsx', import.meta.url);
const APP_URL = new URL('../src/common/editor/app.js', import.meta.url);
(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('the Project Bin exposes the localized linked-WAV chooser only when its platform capability exists', () => {
	const english = renderProjectBin(ENGLISH_COPY, true);
	const german = renderProjectBin(GERMAN_COPY, true);
	const unavailable = renderProjectBin(ENGLISH_COPY, false);
	const readOnly = renderProjectBin(ENGLISH_COPY, true, { readOnly: true });
	const busy = renderProjectBin(ENGLISH_COPY, true, { importing: true });

	assert.match(english, />Link WAV</u);
	assert.match(german, />WAV verknüpfen</u);
	assert.doesNotMatch(unavailable, />Link WAV</u);
	assert.match(readOnly, /button--disabled[^>]* disabled=""[^>]*>[\s\S]*?>Link WAV/u);
	assert.match(busy, /button--disabled[^>]* disabled=""[^>]*>[\s\S]*?>Link WAV/u);
});

test('the linked-WAV Project Bin action forwards only the chosen File and opaque locator snapshot', async () => {
	const source = await readFile(PANEL_URL, 'utf8');

	assert.match(source, /const chooseLinkedAudio = \(\) => run\(async \(\) => \{\s*if \(mutationBlocked\) return;\s*const choice = await fileService\.chooseLinkedAudioOriginal\(\)/u);
	assert.match(source, /if \(!choice\) return;[\s\S]*controller\.actions\.project\.importFiles\(\[choice\.file\], \{[\s\S]*destination: 'project-bin',[\s\S]*linkedAudioLocatorId: choice\.locatorId,[\s\S]*linkedAudioLocatorRevision: choice\.locatorRevision,[\s\S]*\}\)/u);
	assert.doesNotMatch(source, /releaseLinkedAudioOriginal/u);
	assert.doesNotMatch(source, /choice\.(?:name|path|mimeType|size)/u);
});

test('the default editor store receives the pathless generic linked-original port', async () => {
	const source = await readFile(APP_URL, 'utf8');

	assert.match(
		source,
		/createProjectStore\(\{[^}]*linkedOriginalPort: fileService\.linkedOriginalPort,/u,
	);
});

function renderProjectBin(
	copy: typeof ENGLISH_COPY,
	linkedAudioOriginalsAvailable: boolean,
	snapshotState: Readonly<{ readOnly?: boolean; importing?: boolean }> = {},
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
			...snapshotState,
		},
		copy,
		locale: 'en',
		fileService: { linkedAudioOriginalsAvailable, linkedVideoOriginalsAvailable: false },
		run: noop,
		blocked: Boolean(snapshotState.importing),
	}));
}
