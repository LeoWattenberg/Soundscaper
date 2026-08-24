/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { FramescaperOpenFxPluginProjectionV1 } from '../src/common/editor/native-ofx-service-contract.ts';
import {
	createFramescaperOpenFxAuthoringDraftV28,
	createFramescaperOpenFxAuthoringModelV28,
} from '../src/framescaper/editor-native-openfx-authoring-model-v28.ts';
import type { FramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';

const SHA = 'ab'.repeat(32);
const HANDLE = '12'.repeat(20);

test('selected V28 exposes concrete targets and named inputs for all six OpenFX contexts', () => {
	const model = createFramescaperOpenFxAuthoringModelV28(project(), [plugin()]);
	assert.deepEqual([...new Set(model.targets.map(({ context }) => context))].sort(), [
		'filter', 'general', 'generator', 'paint', 'retimer', 'transition',
	]);
	assert.deepEqual(model.targets.find(({ context }) => context === 'filter')?.inputs, [
		{ name: 'Source', sourceRef: 'video-source' },
	]);
	assert.deepEqual(model.targets.find(({ context }) => context === 'transition')?.inputs, [
		{ name: 'SourceFrom', sourceRef: 'video-clip' },
		{ name: 'SourceTo', sourceRef: 'incoming-clip' },
	]);
	assert.deepEqual(model.targets.find(({ context }) => context === 'paint')?.inputs, [
		{ name: 'Source', sourceRef: 'video-source' },
		{ name: 'Mask', sourceRef: 'mask-1' },
	]);
	assert.deepEqual(model.targets.find(({ context }) => context === 'general')?.inputs, [
		{ name: 'Background', sourceRef: 'video-source' },
	]);
});

test('authoring drafts preserve every typed parameter and custom encoding for every context', () => {
	const model = createFramescaperOpenFxAuthoringModelV28(project(), [plugin()]);
	for (const context of ['generator', 'filter', 'transition', 'paint', 'retimer', 'general'] as const) {
		const target = model.targets.find((candidate) => candidate.context === context)!;
		const draft = createFramescaperOpenFxAuthoringDraftV28(model, {
			pluginHandle: HANDLE,
			context,
			targetId: target.targetId,
			inputs: target.inputs,
			parameters: [
				{ name: 'enabled', type: 'boolean', value: true, keyframes: [] },
				{ name: 'radius', type: 'double', value: [2.5], keyframes: [{ frame: 4, value: 3 }] },
				{ name: 'curve', type: 'parametric', value: [[0, 0], [1, 1]], keyframes: [] },
				{ name: 'customState', type: 'custom', value: 'opaque-v1', keyframes: [] },
			],
			customEncodings: { customState: 'opaque-v1' },
		}, () => `effect-${context}`);
		assert.equal(draft.context, context);
		assert.equal(draft.instanceId, context === 'generator' || context === 'general'
			? 'external-effect' : `effect-${context}`);
		assert.equal(draft.pluginId, 'net.example.AllContexts');
		assert.equal(draft.binarySha256, SHA);
		assert.deepEqual(draft.parameters.at(-1), {
			name: 'customState', type: 'custom', value: 'opaque-v1', keyframes: [],
		});
		assert.deepEqual(draft.customEncodings, { customState: 'opaque-v1' });
	}
});

test('authoring drafts refuse stale targets, undeclared inputs, and incomplete parameter state', () => {
	const model = createFramescaperOpenFxAuthoringModelV28(project(), [plugin()]);
	const target = model.targets.find(({ context }) => context === 'filter')!;
	const request = {
		pluginHandle: HANDLE, context: 'filter' as const, targetId: target.targetId,
		inputs: target.inputs,
		parameters: [
			{ name: 'enabled', type: 'boolean' as const, value: true, keyframes: [] },
			{ name: 'radius', type: 'double' as const, value: [2.5], keyframes: [] },
			{ name: 'curve', type: 'parametric' as const, value: [[0, 0]], keyframes: [] },
			{ name: 'customState', type: 'custom' as const, value: 'opaque-v1', keyframes: [] },
		],
		customEncodings: { customState: 'opaque-v1' },
	};
	assert.throws(() => createFramescaperOpenFxAuthoringDraftV28(
		model, { ...request, targetId: 'missing' }, () => 'effect-filter',
	), /target|stale/iu);
	assert.throws(() => createFramescaperOpenFxAuthoringDraftV28(model, {
		...request, inputs: [{ name: 'Source', sourceRef: 'mask-1' }],
	}, () => 'effect-filter'), /input|source/iu);
	assert.throws(() => createFramescaperOpenFxAuthoringDraftV28(model, {
		...request, parameters: request.parameters.slice(0, -1), customEncodings: {},
	}, () => 'effect-filter'), /parameter|complete/iu);
});

function plugin(): FramescaperOpenFxPluginProjectionV1 {
	return Object.freeze({
		pluginHandle: HANDLE,
		pluginId: 'net.example.AllContexts',
		vendor: 'Example',
		version: Object.freeze({ major: 1, minor: 0 }),
		binarySha256: SHA,
		supportedContexts: Object.freeze([
			'generator', 'filter', 'transition', 'paint', 'retimer', 'general',
		] as const),
		parameters: Object.freeze([
			Object.freeze({ name: 'enabled', type: 'boolean' as const, animates: false }),
			Object.freeze({ name: 'radius', type: 'double' as const, animates: true }),
			Object.freeze({ name: 'curve', type: 'parametric' as const, animates: true }),
			Object.freeze({ name: 'customState', type: 'custom' as const, animates: false }),
		]),
		components: Object.freeze(['RGBA'] as const),
		pixelDepths: Object.freeze(['byte'] as const),
		threading: 'instance-safe', state: 'enabled', quarantined: false,
	});
}

function project(): FramescaperProjectV28 {
	return {
		schemaVersion: 28,
		sources: [{ kind: 'video', id: 'video-source', name: 'Video' }, {
			schemaVersion: 1, kind: 'generator', id: 'external-source', name: 'External',
			generator: {
				kind: 'external-generator', bindingId: 'external-effect',
				inputs: [{ name: 'Background', sourceRef: 'video-source' }],
			},
		}],
		clips: [{ kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video' },
			{ kind: 'video', id: 'incoming-clip', sourceId: 'video-source', title: 'Incoming' }],
		tracks: [{
			kind: 'video', id: 'video-track', videoTransitions: [{
				id: 'transition-1', outgoingClipId: 'video-clip', incomingClipId: 'incoming-clip',
			}],
		}],
		videoAdjustmentLayers: [{ kind: 'adjustment-layer', id: 'adjustment-1' }],
		videoMaskMattes: [{ kind: 'mask', id: 'mask-1' }],
		ofxEffects: [],
	} as unknown as FramescaperProjectV28;
}
