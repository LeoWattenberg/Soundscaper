/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioEditorWebRuntimeLifecycle,
} from '../src/common/editor/ui/audio-editor-web-bootstrap.tsx';
import type { MonoConversionConfirmation } from
	'../src/common/editor/ui/dialogs/mono-conversion-confirmation.ts';

function confirmation(log: string[]): MonoConversionConfirmation {
	return Object.freeze({
		confirm: async () => Object.freeze({ accepted: false, dontShowAgain: false }),
		dispose: () => { log.push('confirmation'); },
		getSnapshot: () => null,
		settle: () => false,
		subscribe: () => () => undefined,
	});
}

test('the shared web runtime owns attachments and disposes every product resource once', async () => {
	const log: string[] = [];
	const extensionFailure = new Error('extension failed');
	const controllerFailure = new Error('controller failed');
	const environmentFailure = new Error('environment failed');
	const projector = () => 'project';
	const environment = {
		runtime: { projectForRuntimeConsumers: projector },
		store: { assistanceDerivativeRepository: null },
		close: async () => { log.push('environment'); throw environmentFailure; },
	};
	const controller = {
		dispose: async () => { log.push('controller'); throw controllerFailure; },
	};
	const extension = {
		dispose: async () => { log.push('extension'); throw extensionFailure; },
	};
	const lifecycle = createAudioEditorWebRuntimeLifecycle({
		createFileService: () => ({ isDesktop: true, bridge: Object.freeze({}) }),
		createEnvironment: async () => environment,
		createController: () => controller,
		createExtension: () => extension,
		disposeExtension: (owned) => owned.dispose(),
		createMonoConversionConfirmation: () => confirmation(log),
		constructionCleanupMessage: 'construction cleanup failed',
		extensionAndControllerDisposalMessage: 'extension and controller failed',
		controllerAndEnvironmentDisposalMessage: 'controller and environment failed',
		controllerAndEnvironmentDisposalCause: false,
		exactRuntimeMessage: 'exact runtime required',
	});

	const runtime = await lifecycle.create(Object.freeze({ locale: 'en', copy: Object.freeze({}) }));
	assert.deepEqual(Object.keys(runtime), ['controller', 'fileService', 'dispose']);
	assert.ok(Object.isFrozen(runtime));
	assert.equal(lifecycle.projectForRuntimeConsumers(runtime), projector);
	assert.ok(lifecycle.assistanceSearchSource(runtime));
	assert.equal(lifecycle.monoConversionConfirmation(runtime).getSnapshot(), null);

	const first = runtime.dispose();
	assert.equal(runtime.dispose(), first);
	await assert.rejects(first, (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.message, 'controller and environment failed');
		assert.equal(error.cause, undefined);
		assert.equal(error.errors[1], environmentFailure);
		const prior = error.errors[0];
		assert.ok(prior instanceof AggregateError);
		assert.equal(prior.message, 'extension and controller failed');
		assert.deepEqual(prior.errors, [extensionFailure, controllerFailure]);
		return true;
	});
	assert.deepEqual(log, ['confirmation', 'extension', 'controller', 'environment']);
	await assert.rejects(runtime.dispose());
	assert.deepEqual(log, ['confirmation', 'extension', 'controller', 'environment']);
	assert.throws(
		() => lifecycle.projectForRuntimeConsumers(Object.freeze({}) as never),
		{ name: 'TypeError', message: 'exact runtime required' },
	);
});

test('construction cleanup preserves the primary failure and exact AggregateError wording', async () => {
	const primary = new Error('controller construction failed');
	const cleanup = new Error('environment cleanup failed');
	const log: string[] = [];
	const lifecycle = createAudioEditorWebRuntimeLifecycle({
		createFileService: () => ({ isDesktop: false, bridge: null }),
		createEnvironment: async () => ({
			runtime: { projectForRuntimeConsumers: () => null },
			store: { assistanceDerivativeRepository: null },
			close: async () => { log.push('environment'); throw cleanup; },
		}),
		createController: () => { throw primary; },
		createMonoConversionConfirmation: () => confirmation(log),
		constructionCleanupMessage: 'construction cleanup failed',
		controllerAndEnvironmentDisposalMessage: 'runtime cleanup failed',
		controllerAndEnvironmentDisposalCause: true,
		exactRuntimeMessage: 'exact runtime required',
	});

	await assert.rejects(
		lifecycle.create(Object.freeze({ locale: 'en', copy: Object.freeze({}) })),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.message, 'construction cleanup failed');
			assert.deepEqual(error.errors, [primary, cleanup]);
			assert.equal(error.cause, primary);
			return true;
		},
	);
	assert.deepEqual(log, ['confirmation', 'environment']);
});
