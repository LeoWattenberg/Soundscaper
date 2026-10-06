/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import { registerMockModuleUrls } from './helpers/mock-module-urls.ts';

test('mock module URLs resolve exact ESM imports and delegate normal modules', async (context) => {
	const alias = 'soundscaper-test:mock-module-urls';
	const hooks = registerMockModuleUrls({ [alias]: 'data:text/javascript,export default "asset-url"' });
	context.after(() => { hooks.deregister(); });
	const esm: unknown = await import(alias);
	assert.equal((esm as { default: unknown }).default, 'asset-url');
	const require = createRequire(import.meta.url);
	assert.equal(await import('node:path'), await import('node:path'));
	assert.equal(require('node:path'), path);
	const prototypeName = 'toString';
	await assert.rejects(import(prototypeName), { code: 'ERR_MODULE_NOT_FOUND' });
});

test('later mock module hooks take precedence and deregistration restores the earlier mapping', async (context) => {
	const alias = 'soundscaper-test:mock-module-precedence';
	const first = registerMockModuleUrls({ [alias]: 'data:text/javascript,export default "first-mapping"' });
	const second = registerMockModuleUrls({ [alias]: 'data:text/javascript,export default "second-mapping"' });
	context.after(() => { second.deregister(); first.deregister(); });
	const latest: unknown = await import(alias);
	assert.equal((latest as { default: unknown }).default, 'second-mapping');
	second.deregister();
	const restored: unknown = await import(alias);
	assert.equal((restored as { default: unknown }).default, 'first-mapping');
});
