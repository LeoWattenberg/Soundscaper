/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createProtocolHandler } from '../desktop/protocol.js';
import {
	planDesktopSpeedWarmup,
	warmDesktopSpeedFeatures,
} from '../src/common/editor/ui/desktop-speed-warmup.ts';

function manifest() {
	return {
		'src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx': {
			file: 'assets/SoundscaperAudioEditorBootstrap-hash.js', isDynamicEntry: true,
		},
		'_editor-optional-assistance-hash.js': {
			file: 'assets/editor-optional-assistance-hash.js',
		},
		'src/common/editor/ui/inspector/ExportDialog.jsx': {
			file: 'assets/ExportDialog-hash.js', isDynamicEntry: true,
			imports: ['_editor-optional-assistance-hash.js'],
			css: ['assets/ExportDialog-hash.css'],
		},
		'src/common/editor/ui/dialogs/LocalAssistanceDialogSurface.tsx': {
			file: 'assets/LocalAssistanceDialogSurface-hash.js', isDynamicEntry: true,
			css: ['assets/LocalAssistanceDialogSurface-hash.css'],
		},
		'src/common/editor/ui/dialogs/LocalModelManagerDialog.tsx': {
			file: 'assets/LocalModelManagerDialog-hash.js', isDynamicEntry: true,
		},
		'src/common/editor/ui/dialogs/TextToSpeechDialogSurface.tsx': {
			file: 'assets/TextToSpeechDialogSurface-hash.js', isDynamicEntry: true,
		},
		'src/common/editor/ui/dialogs/DesktopMcpDialog.tsx': {
			file: 'assets/DesktopMcpDialog-hash.js', isDynamicEntry: true,
			css: ['assets/DesktopMcpDialog-hash.css'],
		},
		'src/common/editor/controller/assistance/internal/local-assistance-runtime.ts': {
			file: 'assets/local-assistance-runtime-hash.js', isDynamicEntry: true,
		},
		'src/common/editor/ui/workspace/ProjectMetadataPanel.tsx': {
			file: 'assets/ProjectMetadataPanel-hash.js', isDynamicEntry: true,
		},
		'src/common/editor/native-device-io-worklet.js?worker&url': {
			file: 'assets/native-device-io-worklet-hash.js', isDynamicEntry: true,
		},
		'src/common/i18n/translations/fr.json': {
			file: 'assets/fr-hash.js', isDynamicEntry: true,
		},
		'node_modules/mediabunny/dist/modules/src/index.js': {
			file: 'assets/mediabunny-hash.js', isDynamicEntry: true,
		},
	};
}

test('desktop speed selects ordinary dynamic features and keeps AI entry modules deferred', () => {
	const plan = planDesktopSpeedWarmup(manifest(), 'soundscaper');
	assert.deepEqual(plan.files, [
		'assets/ExportDialog-hash.js',
		'assets/ProjectMetadataPanel-hash.js',
		'assets/mediabunny-hash.js',
	]);
	assert.deepEqual(plan.stylesheets, ['assets/ExportDialog-hash.css']);
	assert.ok(plan.excludedAi.includes('src/common/editor/ui/dialogs/LocalAssistanceDialogSurface.tsx'));
	assert.ok(plan.excludedAi.includes('src/common/editor/ui/dialogs/LocalModelManagerDialog.tsx'));
	assert.ok(plan.excludedAi.includes('src/common/editor/ui/dialogs/TextToSpeechDialogSurface.tsx'));
	assert.ok(plan.excludedAi.includes('src/common/editor/ui/dialogs/DesktopMcpDialog.tsx'));
	assert.ok(plan.excludedAi.includes('src/common/editor/controller/assistance/internal/local-assistance-runtime.ts'));
	assert.deepEqual(plan.excludedWorkers, ['src/common/editor/native-device-io-worklet.js?worker&url']);
	assert.deepEqual(plan.excludedTranslations, ['src/common/i18n/translations/fr.json']);
});

test('desktop speed includes cross-product feature code but rejects the peer bootstrap', () => {
	const framescaperManifest = { ...manifest() };
	delete (framescaperManifest as Record<string, unknown>)[
		'src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx'
	];
	(framescaperManifest as Record<string, unknown>)[
		'src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx'
	] = { file: 'assets/FramescaperAudioEditorBootstrap-hash.js', isDynamicEntry: true };
	(framescaperManifest as Record<string, unknown>)[
		'src/framescaper/editor-capture-runtime.ts'
	] = { file: 'assets/editor-capture-runtime-hash.js', isDynamicEntry: true };
	(framescaperManifest as Record<string, unknown>)[
		'src/soundscaper/editor-scape-native.ts'
	] = { file: 'assets/editor-scape-native-hash.js', isDynamicEntry: true };
	const plan = planDesktopSpeedWarmup(framescaperManifest, 'framescaper');
	assert.ok(plan.files.includes('assets/editor-capture-runtime-hash.js'));
	assert.ok(plan.files.includes('assets/editor-scape-native-hash.js'));
	assert.ok(plan.files.includes('assets/ExportDialog-hash.js'));
	assert.ok(!plan.files.includes('assets/SoundscaperAudioEditorBootstrap-hash.js'));
	assert.deepEqual(plan.excludedOther, []);
});

test('desktop speed does no loading for the web or Memory preference', async () => {
	let reads = 0;
	const loadManifest = () => { reads += 1; return Promise.resolve(manifest()); };
	const options = {
		productId: 'soundscaper' as const,
		performance: { optimizeFor: 'speed' as const },
		loadManifest,
		importModule: async (_path: string) => undefined,
	};
	assert.equal(await warmDesktopSpeedFeatures({ ...options, desktop: false }), null);
	assert.equal(await warmDesktopSpeedFeatures({
		...options, desktop: true, performance: { optimizeFor: 'memory' },
	}), null);
	assert.equal(reads, 0);
});

test('desktop speed evaluates selected modules and contains individual import failures', async () => {
	const imported: string[] = [];
	const stylesheets: string[] = [];
	const result = await warmDesktopSpeedFeatures({
		desktop: true,
		productId: 'soundscaper',
		performance: { optimizeFor: 'speed' },
		loadManifest: () => Promise.resolve(manifest()),
		importModule: async (path) => {
			imported.push(path);
			if (path.includes('ExportDialog')) throw new Error('chunk unavailable');
		},
		loadStylesheet: async (path) => { stylesheets.push(path); },
	});
	assert.deepEqual(imported, [
		'/assets/ExportDialog-hash.js',
		'/assets/ProjectMetadataPanel-hash.js',
		'/assets/mediabunny-hash.js',
	]);
	assert.equal(result?.loaded, 2);
	assert.equal(result?.loadedStylesheets, 1);
	assert.deepEqual(stylesheets, ['/assets/ExportDialog-hash.css']);
	assert.deepEqual(result?.failed.map(({ file }) => file), ['assets/ExportDialog-hash.js']);
});

test('desktop speed rejects a manifest for the wrong product and untrusted asset paths', () => {
	assert.throws(() => planDesktopSpeedWarmup(manifest(), 'framescaper'), /bootstrap/u);
	for (const file of ['../outside.js', 'https://other.invalid/x.js', 'assets/../outside.js',
		'assets/%2e%2e/outside.js', '//other.invalid/x.js']) {
		assert.throws(() => planDesktopSpeedWarmup({
			...manifest(),
			'src/common/editor/ui/inspector/ExportDialog.jsx': {
				file, isDynamicEntry: true,
			},
		}, 'soundscaper'), /asset path/u, file);
	}
	assert.throws(() => planDesktopSpeedWarmup({
		...manifest(),
		'src/common/editor/ui/inspector/ExportDialog.jsx': {
			file: 'assets/ExportDialog-hash.js', isDynamicEntry: true,
			css: ['assets/../outside.css'],
		},
	}, 'soundscaper'), /asset path/u);
});

test('desktop speed bounds concurrent imports while completing the full manifest', async () => {
	const many: Record<string, unknown> = { ...manifest() };
	for (let index = 0; index < 24; index += 1) {
		many[`src/common/editor/feature-${index}.ts`] = {
			file: `assets/feature-${index}.js`, isDynamicEntry: true,
		};
	}
	let active = 0;
	let maximumActive = 0;
	const result = await warmDesktopSpeedFeatures({
		desktop: true,
		productId: 'soundscaper',
		performance: { optimizeFor: 'speed' },
		loadManifest: () => Promise.resolve(many),
		importModule: async () => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			await new Promise((resolve) => setTimeout(resolve, 1));
			active -= 1;
		},
		loadStylesheet: async () => undefined,
	});
	assert.equal(result?.loaded, 27);
	assert.equal(result?.failed.length, 0);
	assert.ok(maximumActive > 1 && maximumActive <= 8);
});

test('the desktop app protocol serves the packaged dotfile manifest', async () => {
	const root = await mkdtemp(join(tmpdir(), 'scape-desktop-speed-manifest-'));
	try {
		const content = JSON.stringify(manifest());
		await writeFile(join(root, '.offline-build-manifest.json'), content);
		const handler = createProtocolHandler({
			productId: 'soundscaper', rendererRoot: root, runtimeRoot: root, readCapabilities: null,
		});
		const response = await handler(new Request('soundscaper-app://bundle/.offline-build-manifest.json'));
		assert.equal(response.status, 200);
		assert.match(response.headers.get('content-type') ?? '', /application\/json/u);
		assert.equal(await response.text(), content);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
