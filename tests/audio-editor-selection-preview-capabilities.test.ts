/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createGroupedEditorActions } from '../src/common/editor/controller/composition/action-facade.ts';
import type { EditorActionResources } from '../src/common/editor/controller/composition/editor-action-resources.ts';
import type { EffectControlPreviewSource } from '../src/common/editor/controller/effects/effect-controls-service.ts';
import { createActionFacadeRuntime } from './helpers/action-facade-runtime-fixture.ts';

function fixture(preview: EditorActionResources['state']['audacityPreviewSource']) {
	const runtime = createActionFacadeRuntime();
	const state = { ...runtime.state, audacityPreviewSource: preview, audacityPreviewAuditionBandId: null as string | number | null };
	const actions = createGroupedEditorActions(new Proxy(runtime, {
		get(target, key, receiver) {
			if (key === 'state') return state;
			if (key === 'effectPreviewState') return {
				auditionParametricEq(bandId: string | number | null) {
					state.audacityPreviewAuditionBandId = bandId == null ? null : String(bandId);
					return preview && 'audition' in preview
						? preview.audition?.(state.audacityPreviewAuditionBandId) ?? false
						: false;
				},
			};
			return Reflect.get(target, key, receiver);
		},
	}));
	return { actions: actions.effects, state };
}

void test('ordinary effect previews are valid state without parametric EQ capabilities', () => {
	const preview: EffectControlPreviewSource = { onended: null, onerror: null, stop() {} };
	const { actions, state } = fixture(preview);
	assert.equal(actions.readSelectionParametricEqSpectrum('input', new Float32Array(1)), null);
	assert.equal(actions.auditionSelectionParametricEq(3), false);
	assert.equal(state.audacityPreviewAuditionBandId, '3');
});

void test('parametric EQ actions preserve the capable preview receiver and output', () => {
	const metadata = { sampleRate: 48000, fftSize: 2, frequencyBinCount: 1, minDecibels: -100, maxDecibels: 0 };
	const preview = {
		readSpectrum(which: 'input' | 'output', target: Float32Array) {
			assert.equal(this, preview); assert.equal(which, 'output'); target[0] = -12; return metadata;
		},
		audition(bandId: string | null) { assert.equal(this, preview); assert.equal(bandId, 'band'); return 1; },
	};
	const { actions } = fixture(preview);
	const target = new Float32Array(1);
	assert.equal(actions.readSelectionParametricEqSpectrum('output', target), metadata);
	assert.equal(target[0], -12);
	assert.equal(actions.auditionSelectionParametricEq('band'), 1);
});
