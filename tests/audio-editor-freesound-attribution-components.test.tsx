/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AttributionTab, {
	type AttributionReportPresentation,
} from '../src/common/editor/ui/AttributionTab.tsx';
import MetadataEditorTabs from '../src/common/editor/ui/MetadataEditorTabs.tsx';
import FreesoundPanel, {
	type FreesoundPanelState,
} from '../src/common/editor/ui/workspace/FreesoundPanel.tsx';
import ProjectAttributionTab from '../src/common/editor/ui/workspace/ProjectAttributionTab.tsx';
import {
	AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE,
	createFreesoundResultDragPayload,
	parseFreesoundResultDragPayload,
} from '../src/common/editor/project-bin-dnd.js';
import {
	WORKSPACE_DISCOVERABLE_PANEL_IDS,
	WORKSPACE_PANEL_IDS,
	workspacePanelLabel,
} from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { workspacePanelAvailable as framescaperPanelAvailable } from '../src/common/editor/ui/framescaper-capture-ui-model.ts';
import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';
import { DEFAULT_PANELS } from '../src/common/editor/workspace-layout-defaults.ts';
import { workspacePanelAvailable as soundscaperPanelAvailable } from '../src/soundscaper/editor-workspace-panel-runtime.ts';
import {
	ENGLISH_COPY as BASE_ENGLISH_COPY,
	GERMAN_COPY as BASE_GERMAN_COPY,
} from '../src/common/i18n/catalogs.js';
import { FREESOUND_ATTRIBUTION_COPY_BY_LOCALE } from '../src/common/i18n/freesound-attribution-copy.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

const render = (element: ReturnType<typeof React.createElement>): string => renderToStaticMarkup(element);
const ENGLISH_COPY = Object.freeze({
	...BASE_ENGLISH_COPY,
	...FREESOUND_ATTRIBUTION_COPY_BY_LOCALE.en,
});
const GERMAN_COPY = Object.freeze({
	...BASE_GERMAN_COPY,
	...FREESOUND_ATTRIBUTION_COPY_BY_LOCALE.de,
});

const FREESOUND_STATE: FreesoundPanelState = Object.freeze({
	query: 'forest rain',
	license: 'cc0',
	sort: 'downloads',
	page: 2,
	pageCount: 4,
	totalResults: 64,
	status: 'ready',
	previewingSoundId: 202,
	results: Object.freeze([
		Object.freeze({
			soundId: 101,
			name: 'Rain in pines.wav',
			username: 'field-recorder',
			userUrl: 'https://freesound.org/people/field-recorder/',
			soundUrl: 'https://freesound.org/s/101/',
			licenseName: 'Creative Commons 0',
			licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
			durationLabel: '0:18',
		}),
		Object.freeze({
			soundId: 202,
			name: 'Distant storm.flac',
			username: 'sound-author',
			soundUrl: 'https://freesound.org/s/202/',
			licenseName: 'Attribution 4.0',
			licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
			durationLabel: '1:04',
		}),
	]),
});

test('Freesound is a Soundscaper-only discoverable panel that remains hidden by default', () => {
	assert.ok(WORKSPACE_PANEL_IDS.includes('freesound'));
	assert.ok(WORKSPACE_DISCOVERABLE_PANEL_IDS.includes('freesound'));
	assert.deepEqual(DEFAULT_PANELS.freesound, {
		visible: false, dock: 'right', order: 11, size: 400,
	});
	assert.equal(workspacePanelLabel(ENGLISH_COPY, 'freesound'), 'Freesound');
	assert.equal(workspacePanelLabel(GERMAN_COPY, 'freesound'), 'Freesound');
	assert.equal(soundscaperPanelAvailable('soundscaper', 'freesound'), true);
	assert.equal(framescaperPanelAvailable('framescaper', 'freesound'), false);

	const menus = [{ id: 'view', items: [{ id: 'panels', items: [
		{ id: 'panel-history', label: 'History' },
		{ id: 'panel-freesound', label: 'Freesound' },
	] }] }];
	const capabilities = {
		audioGenerators: true, audioEffects: true, audioAnalysis: true,
		audioMacros: true, audioRecording: true,
	};
	assert.ok(filterProductMenus(menus, capabilities, 'soundscaper')[0].items[0].items
		.some((item: { id?: string }) => item.id === 'panel-freesound'));
	assert.ok(!filterProductMenus(menus, capabilities, 'framescaper')[0].items[0].items
		.some((item: { id?: string }) => item.id === 'panel-freesound'));
});

test('the optional Freesound surface stays behind the editor lazy-module boundary', () => {
	const source = readFileSync(new URL(
		'../src/common/editor/ui/workspace/WorkspacePanelContent.jsx', import.meta.url,
	), 'utf8');
	assert.match(source, /\.\.\.\(SOUNDSCAPER_BUILD \? \{\s*freesound: lazyEditorModule\(\(\) => import\('\.\/FreesoundPanelContainer\.tsx'\)\)/u);
	assert.doesNotMatch(source, /^import .*FreesoundPanelContainer/mu);
});

test('the eager copy inventory owns only the Freesound menu label', () => {
	const inventory = readFileSync(new URL(
		'../src/common/i18n/editor-copy-inventory.ts', import.meta.url,
	), 'utf8');
	const labels = readFileSync(new URL(
		'../src/common/i18n/editor-freesound-attribution-inventory-copy.ts', import.meta.url,
	), 'utf8');
	assert.match(inventory, /editor-freesound-attribution-inventory-copy\.ts/u);
	assert.doesNotMatch(inventory, /from ['"]\.\/freesound-attribution-copy\.js['"]/u);
	assert.match(labels, /panel: 'Freesound'/u);
	assert.doesNotMatch(labels, /Attribution|Search Freesound|Export CSV/u);
});

test('Freesound drag payloads contain only their version and sound id', () => {
	assert.equal(AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE, 'application/x-soundscaper-freesound-result');
	const encoded = createFreesoundResultDragPayload(42);
	assert.equal(encoded, '42');
	assert.equal(parseFreesoundResultDragPayload(encoded), 42);
	assert.equal(parseFreesoundResultDragPayload('042'), null);
	assert.equal(parseFreesoundResultDragPayload('42e0'), null);
	assert.equal(parseFreesoundResultDragPayload('0'), null);
	assert.equal(parseFreesoundResultDragPayload('not a sound ID'), null);
});

test('Freesound search results expose filters, one active preview and keyboard actions', () => {
	const markup = render(<FreesoundPanel
		copy={ENGLISH_COPY}
		state={FREESOUND_STATE}
		disabled={false}
		onSearch={() => undefined}
		onPreview={() => undefined}
		onStopPreview={() => undefined}
		onInsertAtPlayhead={() => undefined}
		onAddToProjectBin={() => undefined}
	/>);

	assert.match(markup, /data-freesound-panel="true"/u);
	assert.match(markup, /type="search"[^>]*value="forest rain"/u);
	assert.match(markup, /aria-label="License"/u);
	assert.match(markup, /value="cc0" selected=""/u);
	assert.match(markup, /aria-label="Sort by"/u);
	assert.match(markup, /value="downloads" selected=""/u);
	assert.equal(markup.match(/draggable="true"/gu)?.length, 2);
	assert.equal(markup.match(/>Stop preview</gu)?.length, 1);
	assert.equal(markup.match(/>Preview</gu)?.length, 1);
	assert.equal(markup.match(/>Insert at playhead</gu)?.length, 2);
	assert.equal(markup.match(/>Add to Project Bin</gu)?.length, 2);
	assert.match(markup, /Page 2 of 4/u);
	assert.match(markup, /href="https:\/\/freesound\.org\/s\/101\/"/u);
	assert.match(markup, /href="https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/"/u);
});

test('Freesound loading, errors and empty results are announced', () => {
	const idle = render(<FreesoundPanel
		copy={ENGLISH_COPY}
		state={{ ...FREESOUND_STATE, query: '', status: 'idle', results: [] }}
		disabled={false}
		onSearch={() => undefined}
		onPreview={() => undefined}
		onStopPreview={() => undefined}
		onInsertAtPlayhead={() => undefined}
		onAddToProjectBin={() => undefined}
	/>);
	assert.equal(idle.match(/<select[^>]*disabled=""/gu)?.length, 2);

	const loading = render(<FreesoundPanel
		copy={ENGLISH_COPY}
		state={{ ...FREESOUND_STATE, status: 'loading', results: [] }}
		disabled={false}
		onSearch={() => undefined}
		onPreview={() => undefined}
		onStopPreview={() => undefined}
		onInsertAtPlayhead={() => undefined}
		onAddToProjectBin={() => undefined}
	/>);
	assert.match(loading, /role="status"/u);
	assert.match(loading, /Searching Freesound/u);

	const error = render(<FreesoundPanel
		copy={GERMAN_COPY}
		state={{ ...FREESOUND_STATE, status: 'error', errorMessage: 'Offline', results: [] }}
		disabled={false}
		onSearch={() => undefined}
		onPreview={() => undefined}
		onStopPreview={() => undefined}
		onInsertAtPlayhead={() => undefined}
		onAddToProjectBin={() => undefined}
	/>);
	assert.match(error, /role="alert"/u);
	assert.match(error, /Offline/u);
});

test('Freesound gestures submit current criteria and expose the minimal drag transfer', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const calls: Array<readonly [string, unknown?]> = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<FreesoundPanel
			copy={ENGLISH_COPY}
			state={FREESOUND_STATE}
			disabled={false}
			onSearch={(request) => calls.push(['search', request])}
			onPreview={(soundId) => calls.push(['preview', soundId])}
			onStopPreview={() => calls.push(['stop'])}
			onInsertAtPlayhead={(soundId) => calls.push(['insert', soundId])}
			onAddToProjectBin={(soundId) => calls.push(['bin', soundId])}
		/>));

		const query = dom.one('input');
		await act(async () => reactProps(query).onChange({ currentTarget: { value: 'ocean waves' } }));
		await act(async () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} }));
		assert.deepEqual(calls.shift(), ['search', {
			query: 'ocean waves', license: 'cc0', sort: 'downloads', page: 1,
		}]);

		const selects = dom.container.querySelectorAll('select');
		await act(async () => reactProps(selects[0]!).onChange({ currentTarget: { value: 'cc-by' } }));
		assert.deepEqual(calls.shift(), ['search', {
			query: 'ocean waves', license: 'cc-by', sort: 'downloads', page: 1,
		}]);

		const button = (label: string): ReactTestElement => {
			const match = dom.container.querySelectorAll('button').find((candidate) => candidate.textContent.startsWith(label));
			assert.ok(match, `Missing ${label} button`);
			return match;
		};
		await act(async () => reactProps(button('Next')).onClick());
		assert.deepEqual(calls.shift(), ['search', {
			query: 'ocean waves', license: 'cc0', sort: 'downloads', page: 3,
		}]);
		await act(async () => reactProps(button('Preview')).onClick());
		await act(async () => reactProps(button('Stop preview')).onClick());
		await act(async () => reactProps(button('Insert at playhead')).onClick());
		await act(async () => reactProps(button('Add to Project Bin')).onClick());
		assert.deepEqual(calls.splice(0), [
			['preview', 101], ['stop'], ['insert', 101], ['bin', 101],
		]);

		const transfers: Array<readonly [string, string]> = [];
		const dataTransfer = {
			effectAllowed: 'none',
			clearData: () => transfers.splice(0),
			setData: (type: string, value: string) => transfers.push([type, value]),
		};
		await act(async () => reactProps(dom.one('[data-freesound-sound-id="101"]')).onDragStart({
			dataTransfer, preventDefault() {},
		}));
		assert.equal(dataTransfer.effectAllowed, 'copy');
		assert.deepEqual(transfers, [[
			AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE,
			'101',
		]]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

const ATTRIBUTION_REPORT: AttributionReportPresentation = Object.freeze({
	occurrences: Object.freeze([{
		key: 'clip-1:forest',
		clipName: 'Forest bed',
		trackName: 'Ambience',
		sequenceId: 'main',
		sequenceName: 'Main sequence',
		useTimeLabel: '00:00:12.500–00:00:30.500',
		sources: Object.freeze([{
			key: 'origin-freesound-101',
			name: 'Rain in pines.wav',
			url: 'https://freesound.org/s/101/',
			creator: 'field-recorder',
			creatorUrl: 'https://freesound.org/people/field-recorder/',
			licenseName: 'Creative Commons 0',
			licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
			modified: true,
			metadata: Object.freeze([
				{ key: 'sample-rate', label: 'Sample rate', value: '48000' },
				{ key: 'binary-picture', label: 'Picture', value: 'image/jpeg · 12,345 bytes · SHA-256 abc' },
			]),
		}]),
	}]),
});

test('Attribution presents each current clip occurrence and its complete source details read-only', () => {
	const markup = render(<AttributionTab
		copy={ENGLISH_COPY}
		report={ATTRIBUTION_REPORT}
		onExportCsv={() => undefined}
	/>);

	assert.match(markup, /data-attribution-tab="true"/u);
	assert.match(markup, /timeline or held in the Project Bin/u);
	assert.match(markup, />Export CSV</u);
	assert.match(markup, /Forest bed/u);
	assert.match(markup, /Sequence/u);
	assert.match(markup, /Main sequence \(main\)/u);
	assert.match(markup, /Ambience/u);
	assert.match(markup, /00:00:12\.500–00:00:30\.500/u);
	assert.match(markup, /Rain in pines\.wav/u);
	assert.match(markup, /field-recorder/u);
	assert.match(markup, /Creative Commons 0/u);
	assert.match(markup, /Modified from imported source/u);
	assert.match(markup, /Sample rate/u);
	assert.match(markup, /48000/u);
	assert.match(markup, /Picture/u);
	assert.match(markup, /SHA-256 abc/u);
	assert.doesNotMatch(markup, /<(?:input|textarea|select)\b/u);
});

test('Attribution lists Project Bin imports without presenting a made-up timeline use', () => {
	const markup = render(<AttributionTab
		copy={ENGLISH_COPY}
		report={{ occurrences: [{
			...ATTRIBUTION_REPORT.occurrences[0]!,
			key: 'bin-clip:forest',
			clipName: 'Unused forest bed',
			trackName: '',
			useTimeLabel: '',
			projectBin: true,
		}] }}
	/>);

	assert.match(markup, /Unused forest bed/u);
	assert.match(markup, /Project bin/u);
	assert.doesNotMatch(markup, /Current use/u);
	assert.doesNotMatch(markup, /00:00:/u);
});

test('Project attribution contains invalid semantic provenance without exposing its error', () => {
	const markup = render(<ProjectAttributionTab
		project={{
			title: 'Damaged project', sampleRate: 48_000, clips: [], tracks: [], sequences: [],
			projectBin: { clips: [{ id: 'bin-clip', sourceId: 'source-a', title: 'Imported audio' }] },
			sources: [{
				id: 'source-a', kind: 'audio', mimeType: 'audio/wav',
				provenance: { schemaVersion: 1, classification: 'imported', contributions: [] },
			}],
		}}
		copy={GERMAN_COPY}
		locale="de"
		fileService={{ saveFile: () => { throw new Error('CSV must stay disabled'); } }}
	/>);

	assert.match(markup, /role="alert"/u);
	assert.match(markup, /Attributionsdetails sind für dieses Projekt nicht verfügbar/u);
	assert.doesNotMatch(markup, /must carry at least one contribution/u);
	assert.match(markup, />CSV exportieren</u);
	assert.match(markup, /disabled=""/u);
});

test('Attribution export delegates through its presentation callback', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let exportCount = 0;
	try {
		await act(async () => root.render(<AttributionTab
			copy={ENGLISH_COPY}
			report={ATTRIBUTION_REPORT}
			onExportCsv={() => { exportCount += 1; }}
		/>));
		const button = dom.one('button');
		assert.equal(button.textContent, 'Export CSV');
		await act(async () => reactProps(button).onClick());
		assert.equal(exportCount, 1);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('Attribution is an opt-in metadata tab and is absent from the shared export-tab default', () => {
	const shared = render(<MetadataEditorTabs
		activeTab="general"
		showBext
		showAdm
		copy={ENGLISH_COPY}
		onChange={() => undefined}
	/>);
	assert.doesNotMatch(shared, />Attribution</u);

	const projectPanelTabs = render(<MetadataEditorTabs
		activeTab="attribution"
		showBext
		showAdm
		showAttribution
		copy={ENGLISH_COPY}
		onChange={() => undefined}
	/>);
	assert.match(projectPanelTabs, /aria-selected="true"[^>]*>Attribution</u);
	assert.equal(projectPanelTabs.match(/role="tab"/gu)?.length, 4);

	const empty = render(<AttributionTab copy={GERMAN_COPY} report={{ occurrences: [] }} />);
	assert.match(empty, /Keine importierten Quellen werden aktuell verwendet oder in der Projektablage aufbewahrt/u);
	assert.match(empty, /disabled=""/u);
});
