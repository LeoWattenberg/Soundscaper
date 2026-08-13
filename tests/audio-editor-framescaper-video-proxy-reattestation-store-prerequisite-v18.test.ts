/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createFramescaperEditorProjectEnvironmentV18,
	type FramescaperEditorProjectEnvironmentV18,
} from '../src/framescaper/editor-project-environment-v18.ts';
import {
	FramescaperVideoProxyReattestationStorePrerequisiteErrorV18,
	assertFramescaperVideoProxyReattestationStorePrerequisiteV18,
	auditFramescaperVideoProxyReattestationStorePrerequisiteV18,
} from '../src/framescaper/editor-video-proxy-reattestation-store-prerequisite-v18.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('reports the exact missing product-owned repository seams and hard-stops composition', async (context) => {
	const environment = await createEnvironment(context);
	const audit = auditFramescaperVideoProxyReattestationStorePrerequisiteV18(environment);

	assert.deepEqual(audit, {
		kind: 'framescaper-video-proxy-reattestation-store-prerequisite-audit',
		version: 1,
		rule: 'exact-private-generation-bound-read-leases-v1',
		status: 'blocked',
		storeAuthorityFields: ['opfs', 'port'],
		missing: [{
			capability: 'active-project-task-fence',
			owner: 'controller-session',
			requiredOperation: 'capture and synchronously reassert one exact active project/source task generation',
		}, {
			capability: 'local-media-generation-read-lease',
			owner: 'media-repository',
			requiredOperation: 'hold full unsanitized row identity and body with assertCurrent and release',
		}, {
			capability: 'linked-original-generation-read-lease',
			owner: 'linked-video-original-repository',
			requiredOperation: 'hold exact binding and locator generation with bytes, assertCurrent, and release',
		}, {
			capability: 'trusted-original-timing-view',
			owner: 'video-timing-runtime',
			requiredOperation: 'bind current original timing under the same project, source, and media fences',
		}],
	});
	assertDeepFrozen(audit);

	assert.throws(
		() => assertFramescaperVideoProxyReattestationStorePrerequisiteV18(environment),
		(error: unknown) => {
			assert.ok(error instanceof FramescaperVideoProxyReattestationStorePrerequisiteErrorV18);
			assert.strictEqual(error.audit, audit);
			assert.match(error.message, /generation-bound|repository|prerequisite|blocked/iu);
			return true;
		},
	);
});

test('authenticates the exact product environment before touching foreign objects', () => {
	let reads = 0;
	const forged = Object.defineProperties({}, {
		store: { enumerable: true, get: () => { reads += 1; return {}; } },
		runtime: { enumerable: true, get: () => { reads += 1; return {}; } },
	});

	assert.throws(
		() => auditFramescaperVideoProxyReattestationStorePrerequisiteV18(forged),
		/exact|product-created|environment|authentic/iu,
	);
	assert.equal(reads, 0);
});

test('accepts no callback, port, repository, or override injection', async (context) => {
	const environment = await createEnvironment(context);
	for (const operation of [
		auditFramescaperVideoProxyReattestationStorePrerequisiteV18,
		assertFramescaperVideoProxyReattestationStorePrerequisiteV18,
	]) {
		assert.throws(
			() => (operation as (...values: unknown[]) => unknown)(environment, {
				acquireBody: () => { throw new Error('must not run'); },
				observeOriginal: () => { throw new Error('must not run'); },
			}),
			/callback|override|argument|injection|one exact environment/iu,
		);
	}
});

async function createEnvironment(
	context: TestContext,
): Promise<Readonly<FramescaperEditorProjectEnvironmentV18>> {
	const environment = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());
	return environment;
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
	if (!value || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	assert.equal(Object.isFrozen(value), true);
	for (const nested of Object.values(value)) assertDeepFrozen(nested, seen);
}
