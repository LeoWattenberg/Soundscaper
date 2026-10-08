/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

import { assertDesktopRendererProductIsolation }
	from '../scripts/lib/desktop-renderer-product-isolation.mjs';
import { createFramescaperEditControlMenuItems as createSoundscaperEditControls }
	from '../src/soundscaper/editor-application-menu-product-runtime.js';
import { createPersistedVideoProject } from './helpers/persisted-video-project-fixture.ts';

test('Soundscaper linked-audio recovery keeps the shipped menu graph free of Framescaper implementation', async () => {
	const result = await build({
		entryPoints: [resolve(import.meta.dirname, '../src/soundscaper/editor-application-menu-product-runtime.js')],
		bundle: true,
		write: false,
		metafile: true,
		format: 'esm',
		platform: 'browser',
	});
	const modules = Object.fromEntries(Object.keys(result.metafile.inputs)
		.map(path => [resolve(path), {}]));
	assert.doesNotThrow(() => assertDesktopRendererProductIsolation({
		'assets/editor-shell.js': {
			type: 'chunk', fileName: 'assets/editor-shell.js', modules,
			code: result.outputFiles[0]?.text ?? '',
		},
	}, 'soundscaper'));
});

test('the Soundscaper menu adapter cannot dispatch picture authoring for a foreign product', () => {
	const fail = () => assert.fail('Soundscaper must not dispatch foreign picture controls');
	const input = {
		productId: 'framescaper', project: {
			...createPersistedVideoProject({ timeline: true }).project, schemaFamily: 'framescaper', schemaVersion: 1,
		},
		selectedClipId: 'persisted-timeline-video', selectedTrackId: 'persisted-video-track',
		editBlocked: false,
		copy: { linkAudio: 'Link audio', unlinkAudio: 'Unlink audio', showVideo: 'Show video', hideVideo: 'Hide video' },
	};
	const actions = { link: fail, unlink: fail, setVideoHidden: fail };
	const items = createSoundscaperEditControls(input, actions);
	assert.deepEqual(items, { link: null, visibility: null });
});
