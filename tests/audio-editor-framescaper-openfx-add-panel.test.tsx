/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	FramescaperOpenFxAddForm,
	buildFramescaperOpenFxAuthoringRequestNativeMedia,
	createFramescaperOpenFxFormState,
} from '../src/common/editor/ui/dialogs/FramescaperOpenFxAddPanel.tsx';
import {
	createFramescaperOpenFxAuthoringModelNativeMedia,
	type FramescaperOpenFxAuthoringModelNativeMedia,
} from '../src/framescaper/editor-native-openfx-authoring-model.ts';
import type { FramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';

const TYPES = [
	'integer', 'integer2d', 'integer3d', 'double', 'double2d', 'double3d',
	'rgb', 'rgba', 'boolean', 'choice', 'string', 'group', 'page',
	'pushbutton', 'parametric', 'custom',
] as const;

test('the menu-opened OpenFX form exposes every 1.5.1 parameter type and exact named inputs', () => {
	const markup = renderToStaticMarkup(<FramescaperOpenFxAddForm
		model={model()}
		onAuthor={() => undefined}
	/>);
	assert.match(markup, /data-framescaper-openfx-add-form="true"/u);
	assert.match(markup, /SourceFrom/u);
	assert.match(markup, /SourceTo/u);
	for (const type of TYPES) assert.match(markup, new RegExp(`data-openfx-parameter-type="${type}"`, 'u'));
	assert.match(markup, /Custom encoding/u);
	assert.match(markup, /Keyframes/u);
});

test('OpenFX form state becomes one complete typed authoring request', () => {
	const source = createFramescaperOpenFxFormState(model());
	const values = { ...source.values,
		integer: '7', integer2d: '[1,2]', integer3d: '[1,2,3]', double: '[1.5]',
		double2d: '[1.5,2.5]', double3d: '[1,2,3]', rgb: '[0.1,0.2,0.3]',
		rgba: '[0.1,0.2,0.3,1]', boolean: true, choice: '2', string: 'caption',
		parametric: '[[0,0],[1,1]]', custom: 'opaque',
	};
	const keyframes = { ...source.keyframes, double: '[{"frame":4,"value":2.5}]' };
	const request = buildFramescaperOpenFxAuthoringRequestNativeMedia(model(), {
		...source, values, keyframes, customEncodings: { custom: 'vendor-v1' },
	});
	assert.equal(request.context, 'transition');
	assert.deepEqual(request.inputs, [
		{ name: 'SourceFrom', sourceRef: 'clip-a' },
		{ name: 'SourceTo', sourceRef: 'clip-b' },
	]);
	assert.deepEqual(request.parameters.find(({ name }) => name === 'integer2d')?.value, [1, 2]);
	assert.deepEqual(request.parameters.find(({ name }) => name === 'double')?.keyframes, [
		{ frame: 4, value: 2.5 },
	]);
	assert.deepEqual(request.customEncodings, { custom: 'vendor-v1' });
});

test('OpenFX form request parsing refuses malformed vectors and stale targets', () => {
	const source = createFramescaperOpenFxFormState(model());
	assert.throws(() => buildFramescaperOpenFxAuthoringRequestNativeMedia(model(), {
		...source, values: { ...source.values, rgba: '[1, 2]' },
	}), /rgba|parameter|component/iu);
	assert.throws(() => buildFramescaperOpenFxAuthoringRequestNativeMedia(model(), {
		...source, targetId: 'missing-target',
	}), /target|stale/iu);
});

test('OpenFX form excludes plug-ins without a compatible project target', () => {
	const compatible = model();
	const incompatible = Object.freeze({
		...compatible.plugins[0]!,
		pluginHandle: '34'.repeat(20),
		pluginId: 'net.example.Incompatible',
		supportedContexts: Object.freeze(['filter'] as const),
	});
	const mixed = Object.freeze({
		...compatible,
		plugins: Object.freeze([incompatible, ...compatible.plugins]),
	});
	const markup = renderToStaticMarkup(<FramescaperOpenFxAddForm
		model={mixed}
		onAuthor={() => undefined}
	/>);
	assert.doesNotMatch(markup, /net\.example\.Incompatible/u);
	assert.match(markup, /net\.example\.AllParameters/u);
});

test('OpenFX Paint targets bind the mask attached to each clip presentation', () => {
	const project = {
		sources: [],
		clips: [
			{ id: 'clip-a', kind: 'video', sourceId: 'source-a', name: 'A' },
			{ id: 'clip-b', kind: 'video', sourceId: 'source-b', name: 'B' },
		],
		videoMaskMattes: [{ id: 'mask-a' }, { id: 'mask-b' }],
		videoVisualPresentations: [
			{ id: 'presentation-a', owner: { kind: 'clip', id: 'clip-a' }, maskMatteIds: ['mask-b'] },
			{ id: 'presentation-b', owner: { kind: 'clip', id: 'clip-b' }, maskMatteIds: ['mask-a'] },
		],
		videoAdjustmentLayers: [],
		tracks: [],
	} as unknown as FramescaperProjectNativeMedia;
	const targets = createFramescaperOpenFxAuthoringModelNativeMedia(project, []).targets
		.filter(({ context }) => context === 'paint');
	assert.deepEqual(targets.map(({ targetId, inputs }) => ({ targetId, mask: inputs[1]?.sourceRef })), [
		{ targetId: 'clip-a', mask: 'mask-b' },
		{ targetId: 'clip-b', mask: 'mask-a' },
	]);
});

function model(): FramescaperOpenFxAuthoringModelNativeMedia {
	return Object.freeze({
		plugins: Object.freeze([Object.freeze({
			pluginHandle: '12'.repeat(20), pluginId: 'net.example.AllParameters', vendor: 'Example',
			version: Object.freeze({ major: 1, minor: 0 }), binarySha256: 'ab'.repeat(32),
			supportedContexts: Object.freeze(['transition'] as const),
			parameters: Object.freeze(TYPES.map((type) => Object.freeze({
				name: type, type, animates: type === 'double',
			}))),
			components: Object.freeze(['RGBA'] as const), pixelDepths: Object.freeze(['byte'] as const),
			threading: 'instance-safe', state: 'enabled', quarantined: false,
		})]),
		targets: Object.freeze([Object.freeze({
			context: 'transition', targetId: 'transition-1', label: 'Cross dissolve', instanceId: null,
			inputs: Object.freeze([
				Object.freeze({ name: 'SourceFrom', sourceRef: 'clip-a' }),
				Object.freeze({ name: 'SourceTo', sourceRef: 'clip-b' }),
			]),
		})]),
	});
}
