/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	adaptFramescaperNativeRenderInputAuthorityAssistance,
	createFramescaperControllerFoundationViewAssistance,
} from '../src/framescaper/editor-controller-assistance-foundation-view.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

function project(): Data {
	return createFramescaperProject(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		framescaperV20Options() as never,
	) as unknown as Data;
}

function controller(overrides: Data = {}): Data {
	return {
		project: project(),
		actions: { rename: () => undefined },
		getSnapshot() { return { snapshot: true }; },
		getTelemetrySnapshot() { return { telemetry: true }; },
		...overrides,
	};
}

test('the foundation view passes actions through and is itself frozen', () => {
	const source = controller();

	const view = createFramescaperControllerFoundationViewAssistance(source);

	assert.ok(Object.isFrozen(view));
	assert.equal(view.actions, source.actions);
});

test('snapshot readers are invoked against the controller that owns them', () => {
	const receivers: unknown[] = [];
	const source = controller({
		getSnapshot(this: unknown) { receivers.push(this); return { snapshot: true }; },
	});

	const view = createFramescaperControllerFoundationViewAssistance(source);

	assert.deepEqual(view.getSnapshot(), { snapshot: true });
	assert.deepEqual(receivers, [source], 'a detached reader must still see its own controller');
	assert.deepEqual(view.getTelemetrySnapshot(), { telemetry: true });
});

test('the projected project is reshaped on every access rather than captured once', () => {
	const source = controller();

	const view = createFramescaperControllerFoundationViewAssistance(source);

	assert.notEqual(view.project, source.project, 'the view must expose the foundation shape');
	assert.notEqual(
		view.project,
		view.project,
		'each access must reshape so a later controller revision is never served stale',
	);
});

test('the optional native render input preparation appears only when supplied', () => {
	const source = controller();
	const prepare = async () => 'prepared';

	assert.equal(
		'prepareNativeRenderInputStreamNativeMedia' in createFramescaperControllerFoundationViewAssistance(source),
		false,
	);
	assert.equal(
		createFramescaperControllerFoundationViewAssistance(source, prepare)
			.prepareNativeRenderInputStreamNativeMedia,
		prepare,
	);
});

test('controller members reached through the prototype chain are accepted', () => {
	const prototype = {
		actions: {},
		getSnapshot: () => ({}),
		getTelemetrySnapshot: () => ({}),
	};
	const source = Object.create(prototype) as Data;
	source.project = project();

	assert.doesNotThrow(() => createFramescaperControllerFoundationViewAssistance(source));
});

test('an incomplete assistance controller is refused', () => {
	assert.throws(() => createFramescaperControllerFoundationViewAssistance(null), TypeError);
	assert.throws(() => createFramescaperControllerFoundationViewAssistance([]), TypeError);
	assert.throws(
		() => createFramescaperControllerFoundationViewAssistance({
			project: project(), getSnapshot: () => ({}), getTelemetrySnapshot: () => ({}),
		}),
		/actions is unavailable/u,
	);
	assert.throws(
		() => createFramescaperControllerFoundationViewAssistance(controller({ getSnapshot: 1 })),
		/getSnapshot must be a function/u,
	);
});

test('an adapted render operation reshapes its project while delegating every call', () => {
	const calls: string[] = [];
	const signal = new AbortController().signal;
	const source = project();
	const adapted = adaptFramescaperNativeRenderInputAuthorityAssistance({
		begin: () => ({
			project: source,
			signal,
			assertCurrent: () => { calls.push('assertCurrent'); },
			renderAudio: () => { calls.push('renderAudio'); return 'audio'; },
			finish: () => { calls.push('finish'); return 'finished'; },
		}),
	} as never);

	const operation = adapted.begin();

	assert.ok(Object.isFrozen(operation));
	assert.equal(operation.signal, signal);
	assert.notEqual(operation.project, source);
	operation.assertCurrent();
	assert.equal(operation.renderAudio({} as never, {} as never), 'audio');
	assert.equal(operation.finish(), 'finished');
	assert.deepEqual(calls, ['assertCurrent', 'renderAudio', 'finish']);
});

test('the optional sink renderer is forwarded only when the operation offers one', () => {
	const base = {
		project: project(),
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
		renderAudio: () => 'audio',
		finish: () => 'finished',
	};

	const without = adaptFramescaperNativeRenderInputAuthorityAssistance(
		{ begin: () => base } as never,
	).begin();
	assert.equal('renderAudioToSink' in without, false);

	const withSink = adaptFramescaperNativeRenderInputAuthorityAssistance({
		begin: () => ({ ...base, renderAudioToSink: (_p: unknown, _r: unknown, sink: unknown) => sink }),
	} as never).begin();
	assert.equal(withSink.renderAudioToSink!({} as never, {} as never, 'sink' as never), 'sink');
});

test('a render input authority without a begin port is refused', () => {
	for (const value of [null, {}, { begin: 1 }]) {
		assert.throws(
			() => adaptFramescaperNativeRenderInputAuthorityAssistance(value as never),
			TypeError,
		);
	}
});
