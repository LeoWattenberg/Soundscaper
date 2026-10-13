/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SelectionEffectsDialog } from '../src/common/editor/ui/inspector/SelectionEffectsDialog.jsx';
import { createEffectControlsService, type EffectControlsState } from '../src/common/editor/controller/effects/effect-controls-service.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const parameter of ['gainDb', 'newPeakAmplitude']) {
	test(`Amplify ${parameter} draft survives a late headroom scan without committing before blur`, async () => {
		const fixture = await mount();
		try {
			await fixture.type(parameter, '6');
			assert.equal(fixture.params().gainDb, 0, 'typing reserves the authored value; it does not commit the draft');
			await fixture.finishScan();
			assert.equal(fixture.field(parameter).value, '6', 'late automatic headroom must not replace typed text');
			assert.equal(fixture.params().gainDb, 0);
			await act(async () => { reactProps(fixture.field(parameter)).onBlur(); });
			assert.equal(fixture.params().gainDb, 6);
		} finally { await fixture.close(); }
	});
}

test('untouched Amplify accepts scanned headroom; invalid text does not author gain and a later model value still wins', async () => {
	const fixture = await mount();
	try {
		await fixture.finishScan();
		const headroom = 20 * Math.log10(1 / new Float32Array([.05])[0]!);
		assert.equal(Number(fixture.field('gainDb').value), headroom);
		assert.equal(fixture.state.audacityEffectTouchedParams.size, 0);
		await fixture.type('gainDb', '100');
		await act(async () => { reactProps(fixture.field('gainDb')).onBlur(); });
		assert.equal(fixture.field('gainDb').getAttribute('aria-invalid'), 'true');
		assert.equal(fixture.params().gainDb, headroom);
		await fixture.authoritative({ gainDb: 9 });
		assert.equal(fixture.field('gainDb').value, '9');
		assert.equal(fixture.field('gainDb').getAttribute('aria-invalid'), null);
	} finally { await fixture.close(); }
});

test('Escape cancels only the typed Amplify draft, retaining the previous authored gain after a pending scan', async () => {
	const fixture = await mount();
	try {
		await fixture.type('gainDb', '6');
		await fixture.finishScan();
		await fixture.key('gainDb', 'Escape');
		assert.equal(fixture.field('gainDb').value, '0');
		assert.equal(fixture.params().gainDb, 0);
		await fixture.type('gainDb', '-5');
		await fixture.key('gainDb', 'Enter');
		assert.equal(fixture.params().gainDb, -5);
	} finally { await fixture.close(); }
});

test('an Amplify draft belongs to its project and effect, including equal-valued replacements', async () => {
	const fixture = await mount();
	try {
		await fixture.type('gainDb', '6');
		await fixture.replace('project-b', 'audacity-amplify');
		assert.equal(fixture.field('gainDb').value, '0');
		await fixture.type('gainDb', '7');
		await fixture.replace('project-b', 'audacity-bass-treble');
		await fixture.replace('project-b', 'audacity-amplify');
		assert.equal(fixture.field('gainDb').value, '0');
	} finally { await fixture.close(); }
});

test('non-Amplify text edits do not reserve selection parameters, and blocked Amplify cannot mark or commit', async () => {
	const fixture = await mount();
	try {
		await fixture.replace('project-a', 'audacity-bass-treble');
		await fixture.type('bassDb', '6');
		assert.equal(fixture.state.audacityEffectTouchedParams.size, 0);
		await fixture.authoritative({ bassDb: 3 });
		assert.equal(fixture.field('bassDb').value, '3');
		await fixture.replace('project-b', 'audacity-amplify');
		await fixture.block();
		assert.notEqual(fixture.field('gainDb').getAttribute('disabled'), null);
		await fixture.type('gainDb', '6');
		await act(async () => { reactProps(fixture.field('gainDb')).onBlur(); });
		assert.equal(fixture.state.audacityEffectTouchedParams.size, 0);
		assert.equal(fixture.params().gainDb, 0);
	} finally { await fixture.close(); }
});

async function mount() {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = globals.React;
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let project = { id: 'project-a', sampleRate: 48000, clips: [], tracks: [], master: { effects: [] } };
	let readOnly = false;
	const state: EffectControlsState = {
		audacityEffectType: 'audacity-amplify', audacityEffectParams: {}, audacityEffectTouchedParams: new Map(),
		audacityPreviewSource: null, audacityPreviewAuditionBandId: null, audacityPreviewGeneration: 0,
		audacityControlTrackId: null, effectPresets: { schemaVersion: 1, presets: [] }, lastAudacityEffect: null,
	};
	const service = createEffectControlsService({
		state, copy: ENGLISH_COPY, getProject: () => project, createId: () => 'unused',
		persistSetting: async () => undefined, publishDocumentSnapshot: () => render(),
		setStatus: () => undefined, applySelectedAudacityEffect: async () => undefined,
		captureRackNoiseProfile: () => undefined,
	});
	const controller = {
		get project() { return project; },
		actions: { effects: {
			setSelectionParams: service.setAudacityEffectParamsFromController,
			setControlTrack: service.setAudacityControlTrack, cancelPreview: service.cancelAudacityEffectPreview,
			presets: {},
		} },
	};
	function render() {
		root.render(<SelectionEffectsDialog isOpen controller={controller} copy={ENGLISH_COPY} fileService={null}
			onClose={() => undefined} snapshot={{ ready: true, project, readOnly, effects: {
				selectionType: state.audacityEffectType, selectionParams: service.currentAudacityEffectParams(), presets: [],
			} }} />);
	}
	const field = (name: string) => {
		const input = dom.one(`[data-effect-number-input="${name}"]`).querySelector('input');
		assert.ok(input);
		return input;
	};
	await act(async () => { render(); });
	return {
		state, field, params: service.currentAudacityEffectParams,
		type: async (name: string, value: string) => {
			await act(async () => { reactProps(field(name)).onChange({ target: { value } }); });
		},
		key: async (name: string, key: string) => {
			await act(async () => { reactProps(dom.one(`[data-effect-number-input="${name}"]`)).onKeyDown({
				key, target: { blur() { reactProps(field(name)).onBlur(); } }, preventDefault() {}, stopPropagation() {},
			}); });
		},
		finishScan: async () => {
			await act(async () => {
				service.resolveInteractiveAudacityParams('audacity-amplify', service.currentAudacityEffectParams(), [new Float32Array([.05])]);
				render();
			});
		},
		authoritative: async (params: Readonly<Record<string, unknown>>) => {
			await act(async () => { service.setAudacityEffectParamsFromController(params); });
		},
		replace: async (id: string, type: string) => {
			project = { ...project, id };
			state.audacityEffectType = type;
			state.audacityEffectParams = {};
			state.audacityEffectTouchedParams.clear();
			await act(async () => { render(); });
		},
		block: async () => { readOnly = true; await act(async () => { render(); }); },
		close: async () => {
			await act(async () => root.unmount());
			globals.React = priorReact;
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}
