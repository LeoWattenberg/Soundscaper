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

test('the Project Bin resolves placement at click time without subscribing the panel to playback telemetry', async () => {
	const source = await readFile(PANEL_URL, 'utf8');

	assert.doesNotMatch(source, /useAudioEditorTelemetrySelector/u);
	assert.doesNotMatch(source, /positionFrame=/u);
	assert.doesNotMatch(source, /timelineStartFrame:/u);
	assert.doesNotThrow(() => renderProjectBin(ENGLISH_COPY, false));
});

test('a project change retires a destructive Project Bin confirmation', async () => {
	const source = await readFile(PANEL_URL, 'utf8');
	const projectEffect = /useEffect\(\(\) => \{([\s\S]*?)\n\t\}, \[fileService, projectId, projectRevision, run\]\);/u.exec(source);
	assert.ok(projectEffect, 'the project-identity effect is present');
	assert.match(projectEffect[1]!, /setRemoveConfirmation\(null\)/u);
});

test('the linked-WAV Project Bin action forwards only the chosen File and opaque locator snapshot', async () => {
	const source = await readFile(PANEL_URL, 'utf8');
	const importAction = source.slice(source.indexOf('const chooseLinkedAudio'), source.indexOf('const relinkLinkedAudio'));

	assert.match(source, /const chooseLinkedAudio = \(\) => run\(async \(\) => \{\s*if \(mutationBlocked\) return;\s*const choice = await fileService\.chooseLinkedAudioOriginal\(\)/u);
	assert.match(source, /if \(!choice\) return;[\s\S]*controller\.actions\.project\.importFiles\(\[choice\.file\], \{[\s\S]*destination: 'project-bin',[\s\S]*linkedAudioLocatorId: choice\.locatorId,[\s\S]*linkedAudioLocatorRevision: choice\.locatorRevision,[\s\S]*\}\)/u);
	assert.doesNotMatch(importAction, /releaseLinkedAudioOriginal/u);
	assert.doesNotMatch(source, /choice\.(?:name|path|mimeType|size)/u);
});

test('a binding-backed Project Bin audio member exposes exact-content relink without trusting missing-source state', async () => {
	const source = await readFile(PANEL_URL, 'utf8');

	assert.equal(ENGLISH_COPY.projectBinRelink, 'Relink');
	assert.equal(GERMAN_COPY.projectBinRelink, 'Neu verknüpfen');
	assert.match(source, /const menuAudioClip = menuItem\?\.clips\.find\(\(clip\) => clip\.kind !== 'video'\) \|\| null;/u);
	assert.match(source, /const audioClip = item\.clips\.find\(\(clip\) => clip\.kind !== 'video'\) \|\| null;/u);
	assert.match(source, /controller\.actions\.projectBin\.canRelinkLinkedAudio\(audioClip\.id\)/u);
	assert.match(source, /const closeItemMenu = \(\) => \{\s*linkedAudioRelinkRequestRef\.current \+= 1;\s*setItemMenu\(null\);/u);
	assert.match(source, /useEffect\(\(\) => \{\s*linkedAudioRelinkRequestRef\.current \+= 1;\s*setItemMenu\(null\);[\s\S]*\}, \[fileService, projectId, projectRevision, run\]\);/u);
	assert.match(source, /linkedAudioRelinkProjectRef\.current === relinkScope/u);
	assert.match(source, /requestId !== linkedAudioRelinkRequestRef\.current/u);
	assert.match(source, /current\.itemId === item\.id[\s\S]*current\.projectId === requestedProjectId[\s\S]*current\.projectRevision === requestedProjectRevision/u);
	assert.match(source, /!currentMenuRequest\(current\) \|\| current\.audioClipId !== audioClip\.id/u);
	assert.match(source, /fileService\.linkedAudioOriginalsAvailable && menuAudioRelinkEligible[\s\S]*label=\{copy\.projectBinRelink\}/u);
	assert.doesNotMatch(source, /linkedAudioOriginalsAvailable && menuAudioMissing/u);
});

test('linked-audio relink classifies a scoped choice and transfers changed content only after confirmation', async () => {
	const source = await readFile(PANEL_URL, 'utf8');

	assert.match(source, /const relinkScope = linkedAudioRelinkProjectRef\.current;\s*if \(!relinkScope\) return;/u);
	assert.match(source, /prepareLinkedAudioChoice\(\{\s*choose: \(\) => fileService\.chooseLinkedAudioOriginal\(\),\s*isCurrent: \(scope\) => linkedAudioRelinkProjectRef\.current === scope,\s*release: \(reference\) => fileService\.releaseLinkedAudioOriginal\(reference\),/u);
	assert.match(source, /classify: \(file\) => controller\.actions\.projectBin\.classifyLinkedAudioRelink\(clipId, file, relinkScope\)/u);
	assert.match(source, /prepared\.classification === 'changed-content'[\s\S]{0,250}kind: 'audio'/u);
	assert.match(source, /dispatchLinkedAudioChoice\([\s\S]{0,450}relinkLinkedAudio\(\s*clipId,\s*file,\s*reference,\s*relinkScope/u);
	assert.match(source, /accepted\.kind === 'audio'[\s\S]{0,550}\{ allowChangedContent: true \}/u);
	assert.match(source, /releaseRelinkChangedChoice[\s\S]{0,350}releaseLinkedAudioOriginal\(choice\.locator\)/u);
	assert.match(source, /onClick=\{\(\) => menuAudioClip && relinkLinkedAudio\(menuAudioClip\.id\)\}/u);
	assert.doesNotMatch(source, /relinkLinkedAudio[\s\S]{0,500}choice\.(?:name|path|mimeType|size|lastModified)/u);
	assert.equal(ENGLISH_COPY.projectBinRelinkAudioChangedTitle, 'Replace linked audio');
	assert.equal(GERMAN_COPY.projectBinRelinkAudioChangedTitle, 'Verknüpfte Audiodatei ersetzen');
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
