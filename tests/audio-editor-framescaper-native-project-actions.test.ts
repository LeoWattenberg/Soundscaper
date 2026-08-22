/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	bindFramescaperNativeProjectActionRuntime,
	createFramescaperNativeProjectActionRuntime,
	FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES,
	framescaperNativeProjectActionRuntimeFor,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';

test('the candidate action runtime snapshots an exact closed action surface', async () => {
	const calls: string[] = [];
	const runtime = createFramescaperNativeProjectActionRuntime({
		'image-sequence-import': async () => { calls.push('image-sequence-import'); },
		'render-queue-enqueue': async () => { calls.push('render-queue-enqueue'); },
		'proxy-generate': async () => { calls.push('proxy-generate'); },
		'proxy-attach': async () => { calls.push('proxy-attach'); },
		'proxy-detach': async () => { calls.push('proxy-detach'); },
		'proxy-relink': async () => { calls.push('proxy-relink'); },
		'ofx-add': async () => { calls.push('ofx-add'); },
	});

	assert.deepEqual(runtime.surfaces, FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES);
	for (const surface of runtime.surfaces) await runtime.run(surface);
	assert.deepEqual(calls, FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES);
});

test('missing and extra action methods fail closed before a surface is advertised', () => {
	assert.throws(
		() => createFramescaperNativeProjectActionRuntime({
			'image-sequence-import': async () => undefined,
		} as never),
		/complete closed action set/u,
	);
	assert.throws(
		() => createFramescaperNativeProjectActionRuntime({
			...completeActions(), forged: async () => undefined,
		} as never),
		/unsupported action/u,
	);
});

test('an unsupported surface is rejected without invoking an action', async () => {
	let calls = 0;
	const runtime = createFramescaperNativeProjectActionRuntime(completeActions(() => { calls += 1; }));
	await assert.rejects(() => runtime.run('background-jobs' as never), /unsupported/u);
	assert.equal(calls, 0);
});

test('a candidate controller receives a nominal runtime without a public property', () => {
	const controller = Object.freeze({ id: 'candidate-controller' });
	const runtime = createFramescaperNativeProjectActionRuntime(completeActions());
	bindFramescaperNativeProjectActionRuntime(controller, runtime);

	assert.equal(framescaperNativeProjectActionRuntimeFor(controller), runtime);
	assert.equal(framescaperNativeProjectActionRuntimeFor({ ...controller }), null);
	assert.equal(Object.hasOwn(controller, 'framescaperNativeProjectActions'), false);
	assert.throws(
		() => bindFramescaperNativeProjectActionRuntime(controller, { ...runtime } as never),
		/exact Framescaper candidate action runtime/u,
	);
});

function completeActions(hit: () => void = () => undefined) {
	return {
		'image-sequence-import': async () => { hit(); },
		'render-queue-enqueue': async () => { hit(); },
		'proxy-generate': async () => { hit(); },
		'proxy-attach': async () => { hit(); },
		'proxy-detach': async () => { hit(); },
		'proxy-relink': async () => { hit(); },
		'ofx-add': async () => { hit(); },
	};
}
