/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const css = new URL('../src/common/editor/ui/lightscaper/photo-preview.css', import.meta.url).href;
const hooks = registerHooks({ load: (url, context, next) => url === css
	? { format: 'module', source: '', shortCircuit: true } : next(url, context) });
const [{ default: PhotoPreviewPresentation }, { createPreviewPresentationBodyFixtureV1 }] = await Promise.all([
	import('../src/common/editor/ui/lightscaper/PhotoPreviewPresentation.tsx'),
	import('./helpers/lightscaper-preview-presentation-native-fixture.tsx'),
]);
hooks.deregister();

test('native fixture bodies are descriptor-bound raw RGBA with no retained source fields', async () => {
	const fixture = createPreviewPresentationBodyFixtureV1(2), bytes = new Uint8Array(await fixture.body.arrayBuffer());
	assert.equal(fixture.byteLength, 16); assert.equal(fixture.body.size, 16);
	assert.equal(fixture.outputSha256, createHash('sha256').update(bytes).digest('hex'));
	assert.deepEqual([...bytes.slice(0, 4)], [19, 47, 91, 255]);
	assert.deepEqual(Object.keys(fixture), ['descriptor', 'byteLength', 'outputSha256', 'body']);
	assert.equal(fixture.descriptor.width, 2); assert.equal(fixture.descriptor.height, 2);
});

test('server presentation remains inert and its opt-in canvases start with zero backing and no focus controls', () => {
	let calls = 0;
	const readPreview = () => { calls++; return Promise.resolve({ outcome: 'missing' as const }); };
	const inert = renderToStaticMarkup(<PhotoPreviewPresentation readPreview={readPreview} photoIds={['photo-1']}
		thumbnailsVisible={false} fitScreenPhotoId={null}>{view => <>{view.renderThumbnail('photo-1', 'Photo one')}{view.renderLoupe('Loupe')}</>}</PhotoPreviewPresentation>);
	assert.equal(inert, ''); assert.equal(calls, 0);
	const enabled = renderToStaticMarkup(<PhotoPreviewPresentation readPreview={readPreview} photoIds={['photo-1']}
		thumbnailsVisible={true} fitScreenPhotoId="photo-1">{view => <>{view.renderThumbnail('photo-1', 'Photo one')}{view.renderLoupe('Loupe')}</>}</PhotoPreviewPresentation>);
	assert.equal(calls, 0); assert.equal((enabled.match(/<canvas /gu) ?? []).length, 2);
	assert.equal((enabled.match(/width="0" height="0"/gu) ?? []).length, 2);
	assert.equal((enabled.match(/role="img"/gu) ?? []).length, 2);
	assert.doesNotMatch(enabled, /<button|tabindex|data:|blob:/iu);
});
