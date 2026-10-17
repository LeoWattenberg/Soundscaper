/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	classifyNodeTestFile, parseNodeTestSelection, selectNodeTestFiles,
} from '../scripts/lib/node-test-shards.mjs';
import {
	assertPlan, ordinaryBrowserProductSitePlan, siteFor,
} from '../scripts/lib/browser-product-site-plan.mjs';

test('Motionscaper tests have a selectable owner and retain cross-product ownership', () => {
	const root = mkdtempSync(join(tmpdir(), 'motionscaper-test-selection-'));
	try {
		mkdirSync(join(root, 'tests'));
		const motion = join(root, 'tests', 'composition.test.ts');
		const shared = join(root, 'tests', 'exchange.test.ts');
		writeFileSync(motion, "import '../src/motionscaper/composition.ts';\n");
		const peer = 'frame' + 'scaper';
		writeFileSync(shared, `import '../src/motionscaper/composition.ts';\nimport '../src/${peer}/project.ts';\n`);
		assert.equal(classifyNodeTestFile(root, motion), 'motionscaper');
		assert.equal(classifyNodeTestFile(root, shared), 'common');
		assert.deepEqual(parseNodeTestSelection(['--shard=motionscaper']), { shard: 'motionscaper' });
		assert.deepEqual(selectNodeTestFiles(root, { shard: 'motionscaper' }), [motion]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('Motionscaper browser fixtures use a separate configurable loopback origin', () => {
	const plan = ordinaryBrowserProductSitePlan({ PLAYWRIGHT_PORT: '4322' });
	const motion = siteFor(plan, 'motionscaper');
	assert.equal(motion.origin, 'http://127.0.0.1:4324');
	assert.equal(motion.peerOrigin, 'http://127.0.0.1:4323');
	assert.equal(motion.outputDirectory, '.wrangler/browser-products/motionscaper');
	assert.equal(siteFor(ordinaryBrowserProductSitePlan({
		PLAYWRIGHT_MOTIONSCAPER_PORT: '4500',
	}), 'motionscaper').origin, 'http://127.0.0.1:4500');
	assert.throws(() => ordinaryBrowserProductSitePlan({
		PLAYWRIGHT_MOTIONSCAPER_PORT: '4323',
	}), /different ports/u);
});

test('browser plans refuse duplicate products and shared origins', () => {
	const plan = ordinaryBrowserProductSitePlan({});
	assert.throws(() => assertPlan({
		...plan, sites: [plan.sites[0], plan.sites[1], plan.sites[1]],
	}), /exactly once/u);
	assert.throws(() => assertPlan({
		...plan, sites: plan.sites.map((site: { productId: string; origin: string }) => (
			site.productId === 'motionscaper' ? { ...site, origin: plan.sites[0].origin } : site
		)),
	}), /distinct/u);
});
