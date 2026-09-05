/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDeferredEffectRuntime,
	type DeferredEffectModuleLoaders,
	type DeferredNyquistClient,
} from '../src/common/editor/controller/deferred-effect-runtime.ts';

type NyquistModule = typeof import('../src/common/editor/nyquist/client.js');
type NyquistClient = InstanceType<NyquistModule['NyquistEvaluationClient']>;
type Assert<Value extends true> = Value;
type Exactly<Left, Right> = Left extends Right ? (Right extends Left ? true : false) : false;

/**
 * The deferred client must carry the evaluation contract, not `unknown[]`: an
 * erased rest parameter accepts any call at all, so a caller that drops the
 * abort signal or the deadline is a compile-time success and a runtime leak.
 */
export type DeferredNyquistClientKeepsTheRealSignature = Assert<
	Exactly<Parameters<DeferredNyquistClient['evaluate']>, Parameters<NyquistClient['evaluate']>>
>;

test('a deferred Nyquist evaluation forwards its request, signal and deadline unchanged', async () => {
	const calls: unknown[][] = [];
	const controller = new AbortController();
	const runtime = createDeferredEffectRuntime({
		nyquist: async () => ({
			NyquistEvaluationClient: class {
				async evaluate(...args: unknown[]) { calls.push(args); return { ok: true }; }
				dispose() { /* the fixture holds no worker */ }
			},
		}),
	} as unknown as Partial<DeferredEffectModuleLoaders>);
	const client = runtime.createNyquistClient();
	const request = { source: '(print 1)' };
	const options = { signal: controller.signal, timeoutMs: 250 };
	assert.deepEqual(await client.evaluate(request, options), { ok: true });
	assert.deepEqual(await client.evaluate(request), { ok: true });
	assert.deepEqual(calls, [[request, options], [request]]);
	client.dispose();
});
