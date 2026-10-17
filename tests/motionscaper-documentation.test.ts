/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openMotionscaperDocumentation } from '../src/common/editor/ui/motionscaper/motionscaper-documentation.ts';
import { documentationUrl } from '../src/common/editor/documentation-links.ts';
import { handbookContentPlan, handbookProductEntryId } from '../scripts/lib/handbook-product-content.mjs';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import rehypeHandbookBase from '../handbook/src/plugins/rehype-handbook-base.mjs';

test('Motionscaper help names its own handbook and localized first project route', () => {
	assert.equal(documentationUrl('motionscaper', 'manual', 'en'), 'https://motionscaper.org/docs/');
	assert.equal(documentationUrl('motionscaper', 'tutorials', 'de'), 'https://motionscaper.org/docs/de/first-project/');
});
test('each handbook retains only its own product pages after adding Motion', () => {
	const motion = handbookContentPlan('motionscaper'); assert.equal(motion.includes('motionscaper/index.md'), true); assert.equal(motion.includes('de/motionscaper/first-project.md'), true);
	for (const path of ['index.md', 'framescaper/index.md', 'de/framescaper/index.md', 'soundscaper/index.md']) assert.equal(motion.includes(path), false);
	for (const product of ['soundscaper', 'framescaper']) assert.equal(handbookContentPlan(product).includes('de/motionscaper/index.md'), false);
	assert.equal(handbookProductEntryId('de/motionscaper/first-project.md', 'motionscaper'), 'de/first-project');
});
test('Motion handbook links preserve source language and cross-product ownership', () => {
	const own = { type: 'element', tagName: 'a', properties: { href: '/motionscaper/first-project/' } }, peer = { type: 'element', tagName: 'a', properties: { href: '/framescaper/first-project/' } };
	rehypeHandbookBase({ productId: 'motionscaper' })({ children: [own, peer] }, { path: '/repo/handbook/src/content/docs/de/motionscaper/index.md' });
	assert.equal(own.properties.href, '/docs/de/first-project/'); assert.equal(peer.properties.href, 'https://framescaper.org/docs/de/first-project/');
});


test('Help dispatches a fixed desktop destination, preserving launch failures for the shell', async () => {
	const original = Object.getOwnPropertyDescriptor(globalThis, 'scapeDesktop');
	const calls: unknown[] = [];
	try {
		Object.defineProperty(globalThis, 'scapeDesktop', { configurable: true, value: { v1: { documentation: { open: async (request: unknown) => { calls.push(request); } } } } });
		await openMotionscaperDocumentation('tutorials', 'de');
		assert.deepEqual(calls, [{ destination: 'tutorials', locale: 'de' }]);
		Object.defineProperty(globalThis, 'scapeDesktop', { configurable: true, value: { v1: { documentation: { open: async () => { throw new Error('Launch refused'); } } } } });
		await assert.rejects(openMotionscaperDocumentation('manual', 'en'), /Launch refused/);
	} finally { if (original) Object.defineProperty(globalThis, 'scapeDesktop', original); else Reflect.deleteProperty(globalThis, 'scapeDesktop'); }
});


test('Motion Help shares the shell metadata owner without importing the broad editor domain', () => {
	for (const path of ['src/common/editor/documentation-links.ts', 'src/common/editor/ui/motionscaper/motionscaper-documentation.ts']) {
		assert.equal(chunkGroupForModulePath(`/repo/${path}`), 'editor-shell');
	}
});
