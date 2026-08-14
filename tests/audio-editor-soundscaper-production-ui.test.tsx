/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createEffect } from '../src/common/editor/effects.js';
import {
	createSoundscaperProductionApplicationMenuItems,
	type SoundscaperProductionSurface,
} from '../src/common/editor/ui/soundscaper-production-application-menu.ts';
import {
	createSoundscaperProductionDialogModel,
} from '../src/common/editor/ui/soundscaper-production-dialog-model.ts';
import SoundscaperProductionDialog, {
	createSoundscaperRestorationOperation,
} from '../src/common/editor/ui/dialogs/SoundscaperProductionDialog.tsx';

const CAPABILITIES = Object.freeze({
	audioAutomation: true,
	audioMixerGraph: true,
	audioTrackFreeze: true,
	audioEffects: true,
	audioAnalysis: true,
	reviewedWebEffectPackages: true,
});

test('the production helper exposes only the contracted opt-in menu paths', () => {
	const calls: unknown[][] = [];
	const items = createSoundscaperProductionApplicationMenuItems({
		productId: 'soundscaper', capabilities: CAPABILITIES, project: project(),
		selectedTrackId: 'voice', automationMode: 'touch', editingBlocked: false,
		freezeStatus: 'none', freezeActionsAvailable: true,
	}, actions(calls));

	assert.deepEqual(items.tracks.map(({ id }) => id), ['soundscaper-automation', 'soundscaper-freeze']);
	const automation = items.tracks[0];
	assert.equal(automation?.label, 'Automation');
	assert.deepEqual(automation?.items?.map(({ id }) => id), [
		'soundscaper-automation-edit', 'soundscaper-automation-mode',
	]);
	assert.deepEqual(automation?.items?.[1]?.items?.map(({ label, checked }) => ({ label, checked })), [
		{ label: 'Read', checked: false },
		{ label: 'Trim', checked: false },
		{ label: 'Touch', checked: true },
		{ label: 'Latch', checked: false },
		{ label: 'Write', checked: false },
	]);
	assert.deepEqual(items.mixer.map(({ id }) => id), ['soundscaper-routing-graph']);
	assert.deepEqual(items.effect.map(({ id }) => id), ['soundscaper-restoration']);
	assert.deepEqual(items.analyze.map(({ id }) => id), ['soundscaper-production-meters']);
	assert.deepEqual(items.tools.map(({ id }) => id), ['soundscaper-reviewed-effects']);

	automation?.items?.[0]?.onClick?.();
	automation?.items?.[1]?.items?.[4]?.onClick?.();
	items.mixer[0]?.onClick?.();
	items.effect[0]?.onClick?.();
	items.analyze[0]?.onClick?.();
	items.tools[0]?.onClick?.();
	items.tracks[1]?.items?.[0]?.onClick?.();
	assert.deepEqual(calls, [
		['open', 'automation'], ['mode', 'write'], ['open', 'routing'],
		['open', 'restoration'], ['open', 'metering'], ['open', 'reviewed-effects'],
		['freeze', 'freeze', 'voice'],
	]);
	assert.ok(Object.isFrozen(items));
	assert.ok(Object.isFrozen(items.tracks));
	assert.ok(Object.isFrozen(automation));
	assert.ok(Object.isFrozen(automation?.items));
});

test('unsupported products and unavailable capabilities add no production surface', () => {
	const input = {
		productId: 'framescaper', capabilities: CAPABILITIES, project: project(),
		selectedTrackId: 'voice', automationMode: 'read' as const, editingBlocked: false,
		freezeStatus: 'none' as const,
	};
	const empty = createSoundscaperProductionApplicationMenuItems(input, actions([]));
	assert.deepEqual(empty, { tracks: [], mixer: [], effect: [], analyze: [], tools: [] });
	const unavailable = createSoundscaperProductionApplicationMenuItems({
		...input, productId: 'soundscaper', capabilities: {},
	}, actions([]));
	assert.deepEqual(unavailable, { tracks: [], mixer: [], effect: [], analyze: [], tools: [] });
	assert.ok(Object.isFrozen(unavailable));
});

test('disabled and malformed menu states are inert while read-only inspectors remain reachable', () => {
	const calls: unknown[][] = [];
	const blocked = createSoundscaperProductionApplicationMenuItems({
		productId: 'soundscaper', capabilities: CAPABILITIES,
		project: { ...project(), schemaVersion: 20 }, selectedTrackId: 'voice',
		automationMode: 'write', editingBlocked: true, readOnly: true,
		freezeStatus: 'none',
	}, actions(calls));
	const automation = blocked.tracks[0];
	assert.equal(automation?.items?.[0]?.disabled, true);
	for (const mode of automation?.items?.[1]?.items ?? []) {
		assert.equal(mode.disabled, true);
		mode.onClick?.();
	}
	for (const freeze of blocked.tracks[1]?.items ?? []) freeze.onClick?.();
	blocked.mixer[0]?.onClick?.();
	blocked.effect[0]?.onClick?.();
	blocked.analyze[0]?.onClick?.();
	blocked.tools[0]?.onClick?.();
	assert.deepEqual(calls, [
		['open', 'restoration'], ['open', 'metering'], ['open', 'reviewed-effects'],
	]);
});

test('freeze lifecycle enablement reflects selected-track ownership and freshness', () => {
	for (const [status, enabled] of [
		['none', ['soundscaper-freeze-track']],
		['fresh', ['soundscaper-refresh-freeze', 'soundscaper-unfreeze-track', 'soundscaper-commit-freeze']],
		['stale', ['soundscaper-refresh-freeze', 'soundscaper-unfreeze-track']],
		['verifying', []],
	] as const) {
		const value = project(status === 'none' ? null : freezeRecord());
		const menu = createSoundscaperProductionApplicationMenuItems({
				productId: 'soundscaper', capabilities: CAPABILITIES, project: value,
				selectedTrackId: 'voice', automationMode: 'read', editingBlocked: false,
				freezeStatus: status, freezeActionsAvailable: true,
		}, actions([])).tracks[1];
		assert.match(menu?.label ?? '', status === 'none' ? /^Freeze$/u : new RegExp(status, 'iu'));
		assert.deepEqual(menu?.items?.filter(({ disabled }) => !disabled).map(({ id }) => id), enabled, status);
	}

	const noRealtimeEffects = createSoundscaperProductionApplicationMenuItems({
		productId: 'soundscaper', capabilities: CAPABILITIES, project: project(null, [], []),
		selectedTrackId: 'voice', automationMode: 'read', editingBlocked: false,
		freezeStatus: 'none',
	}, actions([])).tracks;
	assert.deepEqual(noRealtimeEffects.map(({ id }) => id), ['soundscaper-automation']);
	const bypassedRealtimeEffects = createSoundscaperProductionApplicationMenuItems({
		productId: 'soundscaper', capabilities: CAPABILITIES,
		project: project(null, ['clip'], [{ enabled: true, bypassed: true }]),
		selectedTrackId: 'voice', automationMode: 'read', editingBlocked: false,
		freezeStatus: 'none',
	}, actions([])).tracks;
	assert.deepEqual(bypassedRealtimeEffects.map(({ id }) => id), ['soundscaper-automation']);
});

test('the dialog model derives bounded lane, graph, selection, and blocking state', () => {
	const value = project();
	const before = structuredClone(value);
	const editable = createSoundscaperProductionDialogModel({
		productId: 'soundscaper', capabilities: CAPABILITIES, project: value,
		selectedTrackId: 'voice', requestedSurface: 'automation', automationMode: 'trim',
	});
	assert.equal(editable.surface, 'automation');
	assert.deepEqual(editable.surfaces, [
		'automation', 'routing', 'restoration', 'metering', 'reviewed-effects',
	]);
	assert.equal(editable.selectedTrack?.id, 'voice');
	assert.equal(editable.operationsBlocked, false);
	assert.equal(editable.automationMode, 'trim');
	assert.deepEqual(editable.lanes.map(({ id, pointCount }) => ({ id, pointCount })), [
		{ id: 'voice-gain', pointCount: 2 },
	]);
	assert.deepEqual(editable.selectedLaneParameter, {
		label: 'Gain', unit: 'linear-gain', minimum: 0, maximum: 4,
		step: 0.01, taper: 'decibel',
	});
	assert.deepEqual(editable.lanes[0]?.points, [
		{ id: 'p1', position: 0, value: 1 },
		{ id: 'p2', position: 48_000, value: 0.5 },
	]);
	assert.deepEqual(editable.lanes[0]?.segmentKinds, ['linear']);
	assert.deepEqual(editable.mixerCounts, {
		groups: 0, sends: 0, cues: 0, vcas: 0, outputs: 1, edges: 2,
	});
	assert.deepEqual(value, before);
	assert.ok(Object.isFrozen(editable));
	assert.ok(Object.isFrozen(editable.lanes));

	const blocked = createSoundscaperProductionDialogModel({
		productId: 'soundscaper', capabilities: CAPABILITIES, project: value,
		selectedTrackId: 'voice', requestedSurface: 'routing', readOnly: true,
	});
	assert.equal(blocked.operationsBlocked, true);
	assert.equal(blocked.blockReason, 'read-only');
	assert.equal(blocked.surface, 'routing');
	assert.equal(createSoundscaperProductionDialogModel({
		productId: 'framescaper', capabilities: CAPABILITIES, project: value,
		selectedTrackId: 'voice', requestedSurface: 'automation',
	}).surface, null);
});

test('automation selection admits existing master, bus, and edge targets without a timeline track', () => {
	const base = project();
	const value = {
		...base,
		mixer: {
			...base.mixer,
			groups: [{ id: 'dialogue' }],
			edges: [...base.mixer.edges, { id: 'dialogue-send' }],
		},
	};
	for (const [target, expectedLabel] of [
		[{ kind: 'master' }, 'Master'],
		[{ kind: 'mixer-node', id: 'dialogue' }, 'dialogue'],
		[{ kind: 'edge', edgeId: 'dialogue-send' }, 'dialogue-send'],
	] as const) {
		const model = createSoundscaperProductionDialogModel({
			productId: 'soundscaper', capabilities: CAPABILITIES, project: value,
			selectedTrackId: null, selectedAutomationTarget: target,
			requestedSurface: 'automation',
		});
		assert.equal(model.operationsBlocked, false);
		assert.equal(model.automationTarget, expectedLabel);
	}
	const calls: unknown[][] = [];
	const menu = createSoundscaperProductionApplicationMenuItems({
		productId: 'soundscaper', capabilities: CAPABILITIES, project: value,
		selectedTrackId: null, selectedAutomationTarget: { kind: 'master' },
		automationMode: 'read', editingBlocked: false, freezeStatus: 'none',
	}, actions(calls)).tracks[0];
	assert.equal(menu?.items?.[0]?.disabled, false);
	menu?.items?.[0]?.onClick?.();
	assert.deepEqual(calls, [['open', 'automation']]);
});

test('effect lanes expose the owning descriptor range, unit, step, and taper', () => {
	const base = project();
	const value = {
		...base,
		tracks: [{ ...base.tracks[0], effects: [createEffect('highpass', { id: 'voice-filter' })] }],
		automationLanes: [{
			id: 'voice-frequency',
			address: {
				kind: 'effect', strip: { kind: 'track', id: 'voice' },
				effectId: 'voice-filter', parameterId: 'frequency',
			},
			timebase: 'musical-beats',
			points: [
				{ id: 'beat-0', position: { num: 0, den: 1 }, value: 120 },
				{ id: 'beat-4', position: { num: 4, den: 1 }, value: 1_000 },
			],
			segments: [{ kind: 'eased' }],
		}],
	};
	const model = createSoundscaperProductionDialogModel({
		productId: 'soundscaper', capabilities: CAPABILITIES, project: value,
		selectedTrackId: 'voice', requestedSurface: 'automation',
	});

	assert.deepEqual(model.selectedLaneParameter, {
		label: 'Frequency', unit: 'Hz', minimum: 10, maximum: 20_000,
		step: 1, taper: 'logarithmic',
	});
	assert.deepEqual(model.lanes[0]?.points[1], {
		id: 'beat-4', position: { num: 4, den: 1 }, value: 1_000,
	});
	assert.deepEqual(model.lanes[0]?.segmentKinds, ['eased']);
});

test('the lazy dialog is keyboard-native, labelled, status-announcing, and inert when read-only', async () => {
	const markup = renderToStaticMarkup(<SoundscaperProductionDialog
		productId="soundscaper"
		capabilities={CAPABILITIES}
		snapshot={{ project: project(), selectedTrackId: 'voice', readOnly: true }}
		initialSurface="automation"
		automationMode="read"
		actions={{ execute: () => undefined }}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.match(markup, /role="dialog"[^>]*aria-label="Production audio"/u);
	assert.match(markup, /data-soundscaper-production-dialog="true"/u);
	assert.match(markup, /role="tablist"[^>]*aria-label="Production audio workflows"/u);
	for (const tab of ['Automation', 'Routing graph', 'Restoration', 'Meters', 'Reviewed effects']) {
		assert.match(markup, new RegExp(`role="tab"[^>]*>${tab}</button>`, 'u'), tab);
	}
	assert.match(markup, /role="tabpanel"[^>]*aria-labelledby="soundscaper-production-tab-automation"/u);
	assert.match(markup, /<fieldset[^>]*disabled=""[^>]*>[\s\S]*<legend>Lane editor<\/legend>/u);
	for (const control of ['Begin gesture', 'Preview value', 'Release and commit', 'Cancel gesture']) {
		assert.match(markup, new RegExp(`>${control}</button>`, 'u'), control);
	}
	assert.match(markup, /Read-only projects can be inspected, but production changes are disabled/u);
	assert.match(markup, /role="status" aria-live="polite" aria-atomic="true"/u);
	assert.match(markup, /data-automation-parameter-descriptor="true"/u);
	assert.match(markup, /<dt>Parameter<\/dt><dd>Gain<\/dd>/u);
	assert.match(markup, /<dt>Unit<\/dt><dd>linear-gain<\/dd>/u);
	assert.match(markup, /<dt>Range<\/dt><dd>0 – 4<\/dd>/u);
	assert.match(markup, /<select[^>]*><option value="absolute-samples" selected="">Absolute samples<\/option>/u);
	assert.match(markup, /<input type="number" min="0" max="4" step="0\.01" value="1"/u);
	assert.match(markup, /<summary>Advanced canonical JSON<\/summary>/u);

	const source = await readFile(new URL(
		'../src/common/editor/ui/dialogs/SoundscaperProductionDialog.tsx', import.meta.url,
	), 'utf8');
	assert.match(source, /initialFocus=\{`\[data-production-surface-tab="\$\{model\.surface\}"\]`\}/u);
	assert.match(source, /event\.key === 'ArrowRight'/u);
	assert.match(source, /event\.key === 'ArrowLeft'/u);
	assert.doesNotMatch(source, /localStorage|sessionStorage|setInterval/u);
});

test('restoration keeps Noise Reduction unavailable until a live profile is ready', () => {
	const unavailable = renderToStaticMarkup(<SoundscaperProductionDialog
		productId="soundscaper"
		capabilities={CAPABILITIES}
		snapshot={{ project: project(), selectedTrackId: 'voice', noiseProfileReady: false }}
		initialSurface="restoration"
		actions={{ execute: () => undefined }}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.match(unavailable, /Capture a noise profile to enable Noise Reduction\./u);
	assert.match(unavailable, /<input type="checkbox" disabled=""\/> Noise Reduction/u);
	assert.match(unavailable, /<button type="button">Capture noise profile<\/button>/u);

	const ready = renderToStaticMarkup(<SoundscaperProductionDialog
		productId="soundscaper"
		capabilities={CAPABILITIES}
		snapshot={{ project: project(), selectedTrackId: 'voice', noiseProfileReady: true }}
		initialSurface="restoration"
		actions={{ execute: () => undefined }}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.match(ready, /Noise profile ready\. Noise Reduction is available\./u);
	assert.match(ready, /<input type="checkbox" checked=""\/> Noise Reduction/u);
	assert.match(ready, /<button type="button">Recapture noise profile<\/button>/u);

	const freshApply = createSoundscaperRestorationOperation({
		clickRemoval: true, noiseReduction: true, filterCurveEq: true,
	}, false);
	assert.deepEqual(freshApply.workflow.stages.map(({ tool }) => tool), [
		'click-removal', 'filter-curve-eq',
	]);
	const profiledApply = createSoundscaperRestorationOperation({
		clickRemoval: true, noiseReduction: true, filterCurveEq: true,
	}, true);
	assert.deepEqual(profiledApply.workflow.stages.map(({ tool }) => tool), [
		'click-removal', 'noise-reduction', 'filter-curve-eq',
	]);
});

test('the metering surface renders session-only channel geometry and EBU history', () => {
	const markup = renderToStaticMarkup(<SoundscaperProductionDialog
		productId="soundscaper"
		capabilities={CAPABILITIES}
		snapshot={{
			project: project(),
			selectedTrackId: 'voice',
			productionMeters: [{
				strip: { kind: 'track', id: 'voice' }, sequence: 1, channelCount: 2,
				channels: [
					{ label: 'L', peak: 0.5, rms: 0.25 },
					{ label: 'R', peak: 0.25, rms: 0.125 },
				],
				correlation: 1,
				phaseDegrees: 0,
			}],
			loudnessHistory: {
				policy: {
					authority: 'runtime-session', lifecycle: 'project-or-runtime-reset',
					scheduling: 'shared-budgeted-tick', projectFields: [], historyFields: [], exportTransforms: [],
				},
				current: {
					peak: 0.5, rms: 0.25, dbfs: -6,
					loudness: {
						standard: 'ebu-r128', momentaryLufs: -18, shortTermLufs: -19,
						integratedLufs: -20, maximumMomentaryLufs: -18, maximumShortTermLufs: -19,
						loudnessRangeLu: 1, loudnessRangeStable: false, truePeakDbtp: -6,
						maximumTruePeakDbtp: -6, measuredSeconds: 1, state: 'running',
					},
				},
				history: [{
					sequence: 7, measuredSeconds: 0.7, momentaryLufs: -21,
					shortTermLufs: -22, integratedLufs: -23, loudnessRangeLu: 1.5,
					truePeakDbtp: -7,
				}, {
					sequence: 8, measuredSeconds: 0.8, momentaryLufs: -20,
					shortTermLufs: -21, integratedLufs: -22, loudnessRangeLu: 2,
					truePeakDbtp: -6.5,
				}],
			},
		}}
		initialSurface="metering"
		actions={{ execute: () => undefined }}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.match(markup, /data-production-meter-readings="session-only"/u);
	assert.match(markup, /L: 0\.50 peak, 0\.25 RMS/u);
	assert.match(markup, /<dd>-20\.00<\/dd>/u);
	assert.match(markup, /<table[^>]*aria-label="Loudness history"/u);
	assert.match(markup, /<td>7<\/td><td>0\.70<\/td><td>-21\.00<\/td><td>-22\.00<\/td><td>-23\.00<\/td><td>1\.50<\/td><td>-7\.00<\/td>/u);
	assert.match(markup, /<td>8<\/td><td>0\.80<\/td><td>-20\.00<\/td><td>-21\.00<\/td><td>-22\.00<\/td><td>2\.00<\/td><td>-6\.50<\/td>/u);
});

test('the routing surface exposes structured graph controls before its collapsed canonical fallback', () => {
	const base = project();
	const routingProject = {
		...base,
		masterChannels: 2,
		master: { effects: [] },
		tracks: base.tracks.map((track) => ({ ...track, effects: [] })),
		mixer: {
			...base.mixer,
			edges: [
				{
					id: 'voice-master', kind: 'assignment', source: { kind: 'track', id: 'voice' },
					destination: { kind: 'master' }, position: 'post-fader', level: 1,
					enabled: true, channelMap: [0, 1],
				},
				{
					id: 'master-main', kind: 'assignment', source: { kind: 'master' },
					destination: { kind: 'output', id: 'main' }, position: 'post-fader', level: 1,
					enabled: true, channelMap: [0, 1],
				},
			],
		},
	};
	const markup = renderToStaticMarkup(<SoundscaperProductionDialog
		productId="soundscaper"
		capabilities={CAPABILITIES}
		snapshot={{ project: routingProject, selectedTrackId: 'voice' }}
		initialSurface="routing"
		actions={{ execute: () => undefined }}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);

	assert.match(markup, /data-soundscaper-routing-editor="structured"/u);
	for (const heading of ['Mixer node collections', 'Groups', 'Sends', 'Cues', 'Output placeholders', 'VCA membership', 'Routing edges']) {
		assert.match(markup, new RegExp(`>${heading}<`, 'u'), heading);
	}
	assert.match(markup, /aria-label="Add Groups node"/u);
	assert.match(markup, /aria-label="Update output Main output"/u);
	assert.match(markup, /<span>Source endpoint<\/span>|>Source endpoint<select/u);
	assert.match(markup, /<option value="[^"]+">Track: Voice<\/option>/u);
	assert.match(markup, /<option value="[^"]+">Output: Main output<\/option>/u);
	assert.match(markup, />Edge position<select/u);
	assert.match(markup, />Channel map \(destination channels, comma-separated\)<input/u);
	assert.match(markup, /<legend>VCA members<\/legend>/u);
	assert.match(markup, /<details><summary>Advanced canonical JSON<\/summary>/u);
	assert.doesNotMatch(markup, /<details open/u);
	assert.match(markup, /<button type="button">Apply routing graph<\/button>/u);
});

function actions(calls: unknown[][]): Readonly<{
	open(surface: SoundscaperProductionSurface): void;
	setAutomationMode(mode: 'read' | 'trim' | 'touch' | 'latch' | 'write'): void;
	freeze(operation: 'freeze' | 'refresh' | 'unfreeze' | 'commit', trackId: string): void;
}> {
	return {
		open: (surface) => { calls.push(['open', surface]); },
		setAutomationMode: (mode) => { calls.push(['mode', mode]); },
		freeze: (operation, trackId) => { calls.push(['freeze', operation, trackId]); },
	};
}

function project(
	audioFreeze: Readonly<Record<string, unknown>> | null = null,
	clipIds: readonly string[] = ['clip'],
	effects: readonly Readonly<Record<string, unknown>>[] = [{ id: 'voice-filter', enabled: true }],
) {
	return {
		schemaVersion: 21,
		sampleRate: 48_000,
		tracks: [{
			id: 'voice', type: 'audio', name: 'Voice', locked: false, clipIds, effects,
			...(audioFreeze ? { audioFreeze } : {}),
		}],
		automationLanes: [{
			id: 'voice-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: 'absolute-samples',
			points: [
				{ id: 'p1', position: 0, value: 1 },
				{ id: 'p2', position: 48_000, value: 0.5 },
			],
			segments: [{ kind: 'linear' }],
		}, {
			id: 'master-gain',
			address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
			timebase: 'absolute-samples',
			points: [{ id: 'master-p1', position: 0, value: 1 }],
			segments: [],
		}],
		mixer: {
			schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main output', role: 'main', channelCount: 2 }],
			edges: [
				{ id: 'voice-master', source: { kind: 'track', id: 'voice' }, destination: { kind: 'master' } },
				{ id: 'master-main', source: { kind: 'master' }, destination: { kind: 'output', id: 'main' } },
			],
		},
	};
}

function freezeRecord() {
	return {
		schemaVersion: 1, derivedSourceId: 'freeze-source',
		inputDigestSha256: 'a'.repeat(64), rackDigestSha256: 'b'.repeat(64),
		automationDigestSha256: 'c'.repeat(64), freshnessDigestSha256: 'd'.repeat(64),
		renderStartFrame: 0, renderFrameCount: 48_000,
		capturePosition: 'post-insert-pre-strip',
	};
}
