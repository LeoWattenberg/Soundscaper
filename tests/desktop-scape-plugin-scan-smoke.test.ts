/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { runScapeOpenRendererSmoke } from '../desktop/scape-open-renderer-smoke.js';
import { runScapeReopenRendererSmoke } from '../desktop/scape-reopen-renderer-smoke.js';

const PROJECT = {
	id: 'packaged-scape-open-project',
	title: 'Packaged Scape Open',
	revision: 7,
	sourceId: 'packaged-source',
	trackId: 'packaged-track',
	clipId: 'packaged-clip',
};
const BASE_PLAN = {
	schemaVersion: 1,
	productId: 'soundscaper',
	token: '0123456789abcdef0123456789abcdef',
	project: PROJECT,
};
const OPEN_PLAN = {
	...BASE_PLAN,
	mode: 'scape-range-open-v1',
	archive: { name: 'packaged-current-schema.sscape', byteLength: 12_345 },
};
const REOPEN_PLAN = { ...BASE_PLAN, mode: 'scape-persistent-reopen-v1' };
const SCAN_SELECTOR = '[data-editor-toast^="native-plugin-scan-"] .toast--info, '
	+ '[data-editor-toast^="native-plugin-scan-"] .toast--success';
const OPEN_RESULT = {
	projectId: PROJECT.id,
	trackCount: 1,
	clipCount: 1,
	activeTabTitle: PROJECT.title,
	trackId: PROJECT.trackId,
	clipId: PROJECT.clipId,
	statusState: 'success',
	alertCount: 0,
	dialogCount: 0,
};
const REOPEN_RESULT = {
	sharedProject: {
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		revision: PROJECT.revision,
		sourceCount: 1,
		trackCount: 1,
		clipCount: 1,
	},
	renderer: {
		...OPEN_RESULT,
		waveformRenderer: 'audacity',
		waveformSource: 'pcm',
		waveformError: false,
	},
	playback: {
		transportEntered: true,
		playheadAdvanced: true,
		meterAboveFloor: true,
		transportStopped: true,
	},
};

interface FakeElement {
	textContent: string;
	getAttribute: (name: string) => string | null;
	querySelectorAll?: (selector: string) => FakeElement[];
	closest?: (selector: string) => object | null;
	click?: () => void;
	disabled?: boolean;
	style?: { getPropertyValue: (name: string) => string };
}

interface FixtureOptions {
	alertsByPoll?: FakeElement[][];
	alertsByFrame?: FakeElement[][];
	persistentAlerts?: FakeElement[];
	dialogs?: FakeElement[];
	tickMilliseconds?: number;
	initialWaveformSource?: 'peaks' | 'pcm';
}

const probes = [
	{ name: 'Scape-open', run: runScapeOpenRendererSmoke, plan: OPEN_PLAN, result: OPEN_RESULT },
	{ name: 'Scape persisted-reopen', run: runScapeReopenRendererSmoke, plan: REOPEN_PLAN, result: REOPEN_RESULT },
];

for (const probe of probes) {
	test(`${probe.name} waits for plugin scan progress and completion to disappear before success`, async () => {
		const fixture = rendererFixture({
			alertsByPoll: [
				[toast('native-plugin-scan-start', 'info')],
				[toast('native-plugin-scan-complete', 'success')],
			],
			initialWaveformSource: 'peaks',
		});
		const result: unknown = await probe.run(fixture.scope, probe.plan);

		assert.deepEqual(result, probe.result);
		assert.equal(fixture.polls, 2, 'ready project UI must still wait for both transient alerts');
		assert.equal(fixture.actions.every((action) => action.alertCount === 0), true,
			'waveform zoom and playback must begin only after every alert disappears');
		if (probe.plan.mode === 'scape-persistent-reopen-v1') {
			assert.deepEqual(fixture.actions.map((action) => action.name), ['zoom', 'play', 'stop']);
			assert.equal(fixture.animationFrames, 2);
		}
	});

	for (const tone of ['info', 'success'] as const) {
		test(`${probe.name} times out when a plugin scan ${tone} alert never disappears`, async () => {
			const fixture = rendererFixture({
				persistentAlerts: [toast('native-plugin-scan-stuck', tone)],
				tickMilliseconds: 15_000,
			});

			await assert.rejects(() => probe.run(fixture.scope, probe.plan), /timed out waiting/iu);
			assert.equal(fixture.polls, 3, 'the 45 second deadline bounds expected scan activity');
			assert.deepEqual(fixture.actions, [], 'pending scan activity cannot start playback');
		});
	}

	for (const failure of [
		{ name: 'scan warning', alert: toast('native-plugin-scan-warning', 'warning') },
		{ name: 'scan error', alert: toast('native-plugin-scan-error', 'error') },
		{ name: 'unrelated informational toast', alert: toast('other-feature', 'info') },
		{ name: 'lookalike scan identifier', alert: toast('native-plugin-scanner', 'info') },
		{ name: 'scan alertdialog', alert: toast('native-plugin-scan-alertdialog', 'info', 'alertdialog') },
	]) {
		test(`${probe.name} immediately refuses ${failure.name} during plugin scanning`, async () => {
			const fixture = rendererFixture({
				persistentAlerts: [toast('native-plugin-scan-start', 'info'), failure.alert],
			});

			await assert.rejects(() => probe.run(fixture.scope, probe.plan), /exposed an alert or dialog/iu);
			assert.equal(fixture.polls, 0);
			assert.deepEqual(fixture.actions, []);
		});
	}

	test(`${probe.name} immediately refuses a dialog during plugin scanning`, async () => {
		const fixture = rendererFixture({
			persistentAlerts: [toast('native-plugin-scan-start', 'info')],
			dialogs: [element({ role: 'dialog' }, 'Unexpected dialog')],
		});

		await assert.rejects(() => probe.run(fixture.scope, probe.plan), /exposed an alert or dialog/iu);
		assert.equal(fixture.polls, 0);
		assert.deepEqual(fixture.actions, []);
	});
}

test('Scape persisted-reopen waits for scan alerts that return during playback and stopping', async () => {
	const fixture = rendererFixture({
		alertsByFrame: [
			[toast('native-plugin-scan-start', 'info')],
			[toast('native-plugin-scan-complete', 'success')],
			[],
			[toast('native-plugin-scan-complete', 'success')],
		],
	});
	const result: unknown = await runScapeReopenRendererSmoke(fixture.scope, REOPEN_PLAN);

	assert.deepEqual(result, REOPEN_RESULT);
	assert.equal(fixture.animationFrames, 5, 'playback and stopped success must wait for alerts to clear');
	assert.deepEqual(fixture.actions.map((action) => action.name), ['play', 'stop']);
	assert.equal(fixture.actions.every((action) => action.alertCount === 0), true);
});

test('Scape persisted-reopen bounds plugin scan activity throughout playback', async () => {
	const fixture = rendererFixture({
		alertsByFrame: Array.from({ length: 512 }, () => [toast('native-plugin-scan-stuck', 'info')]),
	});

	await assert.rejects(() => runScapeReopenRendererSmoke(fixture.scope, REOPEN_PLAN),
		/playback evidence timed out/iu);
	assert.equal(fixture.animationFrames, 512);
	assert.deepEqual(fixture.actions.map((action) => action.name), ['play']);
});

for (const tone of ['warning', 'error'] as const) {
	test(`Scape persisted-reopen immediately refuses a scan ${tone} that arrives during playback`, async () => {
		const fixture = rendererFixture({ alertsByFrame: [[toast('native-plugin-scan-failed', tone)]] });

		await assert.rejects(() => runScapeReopenRendererSmoke(fixture.scope, REOPEN_PLAN),
			/exposed an alert or dialog/iu);
		assert.equal(fixture.animationFrames, 1);
		assert.deepEqual(fixture.actions.map((action) => action.name), ['play']);
	});
}

function element(attributes: Record<string, string>, textContent = ''): FakeElement {
	return { textContent, getAttribute: (name) => attributes[name] ?? null };
}

function toast(id: string, tone: string, role = 'alert'): FakeElement {
	return {
		...element({ role }, `${tone}: ${id}`),
		closest: (selector) => selector === SCAN_SELECTOR && id.startsWith('native-plugin-scan-')
			&& (tone === 'info' || tone === 'success') ? {} : null,
	};
}

function rendererFixture(options: FixtureOptions = {}) {
	let polls = 0;
	let time = 0;
	let animationFrames = 0;
	let waveformSource = options.initialWaveformSource ?? 'pcm';
	let playing = false;
	let playheadFrame = 0;
	let playheadX = 16;
	let meterValue = -60;
	const actions: { name: string; alertCount: number }[] = [];
	const alerts = () => animationFrames > 0 && options.alertsByFrame
		? options.alertsByFrame[animationFrames - 1] ?? []
		: options.alertsByPoll?.[polls] ?? options.persistentAlerts ?? [];
	const recordAction = (name: string) => { actions.push({ name, alertCount: alerts().length }); };
	const waveform: FakeElement = {
		textContent: '',
		getAttribute(name) {
			if (name === 'data-waveform-renderer') return 'audacity';
			if (name === 'data-waveform-source') return waveformSource;
			return null;
		},
	};
	const clip: FakeElement = {
		...element({ 'data-clip-id': PROJECT.clipId }),
		querySelectorAll: (selector) => selector === 'canvas.clip-body__waveform' ? [waveform] : [],
	};
	const track: FakeElement = {
		...element({ 'data-track-id': PROJECT.trackId, 'data-track-row': '' }),
		querySelectorAll: (selector) => selector === `[data-clip-id="${PROJECT.clipId}"]` ? [clip] : [],
	};
	const tab = element({ role: 'tab', 'aria-selected': 'true' }, PROJECT.title);
	const status = element({ 'data-editor-status': '', 'data-state': 'success' }, 'Ready');
	const zoom: FakeElement = {
		...element({}),
		click() { recordAction('zoom'); waveformSource = 'pcm'; },
	};
	const play: FakeElement = {
		...element({ 'aria-label': 'Play', 'aria-pressed': 'false' }),
		disabled: false,
		click() { recordAction('play'); playing = true; },
	};
	const pause: FakeElement = {
		...element({ 'aria-label': 'Pause', 'aria-pressed': 'true' }),
		disabled: false,
	};
	const stop: FakeElement = {
		...element({}),
		disabled: false,
		click() { recordAction('stop'); playing = false; playheadFrame = 0; },
	};
	const playhead: FakeElement = {
		textContent: '',
		getAttribute: (name) => name === 'aria-valuenow' ? String(playheadFrame) : null,
	};
	const meter: FakeElement = {
		textContent: '',
		getAttribute: (name) => name === 'aria-valuemin' ? '-60'
			: name === 'aria-valuenow' ? String(meterValue) : null,
	};
	const timeline: FakeElement = {
		...element({}),
		style: { getPropertyValue: (name) => name === '--timeline-playhead-x' ? `${playheadX}px` : '' },
	};
	const root: FakeElement = {
		...element({
			'data-project-id': PROJECT.id,
			'data-track-count': '1',
			'data-clip-count': '1',
		}),
		querySelectorAll(selector) {
			if (selector === '.kw-audio-editor__project-tabs [role="tab"][aria-selected="true"]') return [tab];
			if (selector === `[data-track-row][data-track-id="${PROJECT.trackId}"]`) return [track];
			if (selector === '[data-editor-status][data-state="success"]') return [status];
			if (selector === '.kw-audio-editor__zoom-actions button[aria-label="Zoom in"]') return [zoom];
			if (selector === '.audio-editor-timeline-panel') return [timeline];
			if (selector === '.kw-audio-editor__transport-play .kw-audio-editor__split-button-main button[aria-label="Play"]') {
				return playing ? [] : [play];
			}
			if (selector === '.kw-audio-editor__transport-play .kw-audio-editor__split-button-main button[aria-label="Pause"]') {
				return playing ? [pause] : [];
			}
			if (selector === '.kw-audio-editor__transport button[aria-label="Stop"]') return [stop];
			if (selector === '[data-playhead][role="slider"]') return [playhead];
			if (selector === '[data-side-playback-meter] [data-playback-meter][data-meter-kind="playback"]'
				+ '[data-meter-type="db-log"][data-meter-db-range="60"] [role="meter"]') return [meter];
			return [];
		},
	};
	const scope = {
		CSS: { escape: (value: string) => value },
		Date: { now: () => time },
		document: {
			querySelectorAll(selector: string) {
				if (selector === '[data-audio-editor][data-audio-editor-bound="true"]') return [root];
				if (selector === '[role="alert"], [role="alertdialog"]') return alerts();
				if (selector === '[role="dialog"], [role="alertdialog"]') {
					return [...(options.dialogs ?? []), ...alerts().filter((alert) => alert.getAttribute('role') === 'alertdialog')];
				}
				return [];
			},
		},
		soundscaperProjectLibraryDesktop: {
			v1: {
				connect: async () => {},
				readProjectBundle: async () => ({ document: JSON.stringify({
					schemaFamily: 'soundscaper',
					schemaVersion: 1,
					id: PROJECT.id,
					title: PROJECT.title,
					revision: PROJECT.revision,
					sources: [{ id: PROJECT.sourceId, kind: 'audio' }],
					tracks: [{ id: PROJECT.trackId, type: 'audio', clipIds: [PROJECT.clipId] }],
					clips: [{ id: PROJECT.clipId, kind: 'audio', sourceId: PROJECT.sourceId }],
					timelineAnnotations: [],
				}) }),
			},
		},
		setTimeout(callback: () => void) {
			polls += 1;
			time += options.tickMilliseconds ?? 25;
			callback();
		},
		requestAnimationFrame(callback: (timestamp: number) => void) {
			animationFrames += 1;
			if (playing) {
				playheadFrame = 1_024;
				playheadX = 32;
				meterValue = -12;
			}
			callback(animationFrames * 16);
		},
	};
	return {
		scope,
		actions,
		get polls() { return polls; },
		get animationFrames() { return animationFrames; },
	};
}
