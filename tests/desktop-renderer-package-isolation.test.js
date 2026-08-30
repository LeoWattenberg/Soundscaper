/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertDesktopRendererProductIsolation,
	desktopRendererProductPublicAssetFiles,
} from '../scripts/lib/desktop-renderer-product-isolation.mjs';

test('Soundscaper renderer package rejects callable Framescaper and capture modules', () => {
	const bundle = {
		'assets/index.js': chunk('assets/index.js', {
			'/workspace/src/main.jsx': {},
		}),
		'assets/FramescaperVisualInspectorDialog.js': chunk(
			'assets/FramescaperVisualInspectorDialog.js',
			{
				'/workspace/src/common/editor/ui/FramescaperVisualInspectorDialog.tsx': {},
				'/workspace/src/framescaper/editor-project-visual.ts': {},
			},
		),
		'assets/WebVcrPanel.js': chunk('assets/WebVcrPanel.js', {
			'/workspace/src/common/editor/ui/workspace/WebVcrPanel.tsx': {},
		}),
	};
	assert.throws(
		() => assertDesktopRendererProductIsolation(bundle, 'soundscaper'),
		/Soundscaper renderer.*FramescaperVisualInspectorDialog/iu,
	);
});

test('Soundscaper renderer package rejects callable Framescaper markers and public assets', () => {
	assert.throws(() => assertDesktopRendererProductIsolation({
		'assets/index.js': {
			...chunk('assets/index.js', { '/workspace/src/common/editor/file-service.js': {} }),
			code: 'globalThis.framescaperDesktop?.v1',
		},
	}, 'soundscaper'), /callable Framescaper marker/iu);
	assert.throws(() => assertDesktopRendererProductIsolation({
		'logo/framescaper-icon.svg': {
			type: 'asset', fileName: 'logo/framescaper-icon.svg', source: '<svg />',
		},
	}, 'soundscaper'), /forbidden asset/iu);
	assert.deepEqual(desktopRendererProductPublicAssetFiles('soundscaper', [
		'_headers',
		'logo/logo-schwarz.svg',
		'logo/framescaper-icon.svg',
	]), ['_headers', 'logo/logo-schwarz.svg']);
});

test('Soundscaper renderer package permits product-neutral foreign-family custody contracts', () => {
	assert.doesNotThrow(() => assertDesktopRendererProductIsolation({
		'assets/custody.js': chunk('assets/custody.js', {
			'/workspace/src/common/editor/project-schema-identity.ts': {},
			'/workspace/src/common/editor/scape-project-document.js': {},
			'/workspace/src/common/cross-product-handoff-intent.ts': {},
			'/workspace/src/common/editor/controller/video-export-service.ts': {},
			'/workspace/src/common/editor/video-effects.js': {},
			'/workspace/src/common/editor/video-media.js': {},
		}),
	}, 'soundscaper'));
});

function chunk(fileName, modules) {
	return {
		type: 'chunk',
		fileName,
		code: '',
		imports: [],
		dynamicImports: [],
		modules,
	};
}
