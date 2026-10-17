/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { motionChunkGroups } from '../scripts/lib/build-motion-chunks.mjs';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { EAGER_CHUNK_GROUPS, eagerlyReachableModules, isEagerlyLoadedModule } from './helpers/eager-chunk-group-crossings.ts';
import { resolve } from 'node:path';

test('motion scene and lazy raster runtime have distinct semantic chunk owners', () => {
	const owner = (path: string) => motionChunkGroups.find((group) => group.test.test(path))?.name;
	assert.equal(owner('/src/common/editor/motion-composition.ts'), 'motion-domain');
	assert.equal(owner('/src/common/editor/motion-canvaskit-browser.ts'), 'motion-raster');
	assert.equal(owner('/src/common/editor/controller/composition/motion-raster-runtime.ts'), 'motion-raster');
	assert.equal(owner('/config/motionscaper-raster-runtime.json'), 'motion-raster');
	assert.equal(owner('/node_modules/canvaskit-wasm/bin/canvaskit.js'), 'motion-raster');
	assert.equal(owner('/node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2?url'), 'motion-raster');
	assert.equal(owner('/src/common/editor/ui/motionscaper/MotionscaperShell.tsx'), undefined);
});

test('Motionscaper menu surfaces cannot move their dynamic entry into the eager shell', async () => {
	const { chunkGroupForModulePath } = await import('../scripts/lib/build-chunk-groups.mjs');
	for (const name of ['MotionscaperShell.tsx', 'shell-menu.ts', 'motionscaper-copy.ts', 'motionscaper-shell.css']) assert.equal(chunkGroupForModulePath(`src/common/editor/ui/motionscaper/${name}`), 'editor-shell', name);
	for (const name of ['MotionOperatorsDialog.tsx', 'MotionOperatorForm.tsx', 'MotionShapeCollection.tsx', 'MotionPathsDialog.tsx', 'MotionPropertyGraph.tsx', 'motion-plane-geometry.ts', 'MotionscaperDocumentRuntime.tsx', 'MotionPreviewDialog.tsx']) {
		assert.equal(chunkGroupForModulePath(`src/common/editor/ui/motionscaper/${name}`), null, name);
	}
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/AudioEditorApplicationHeader.jsx'), 'editor-shell');
});

test('successor model and controller modules keep explicit owners after portable archive hydration', async () => {
	const owner = (path: string) => motionChunkGroups.find(group => group.test.test(`/src/framescaper/${path}.ts`))?.name;
	for (const name of ['editor-project-successor', 'editor-project-successor-link', 'editor-project-successor-database', 'editor-project-successor-commands', 'editor-composition-link-source']) assert.equal(owner(name), 'framescaper-successor-foundations');
	assert.equal(owner('editor-composition-link-preview-project'), 'framescaper-successor-runtime');
	assert.equal(owner('editor-project-successor-portable-import'), undefined);
	const { chunkGroupForModulePath } = await import('../scripts/lib/build-chunk-groups.mjs');
	assert.equal(chunkGroupForModulePath('src/framescaper/editor-project-commands.ts'), 'framescaper-project-commands');
});

test('successor native export stays behind its File menu boundary with its own dialog and Frame adapters', async () => {
	const { chunkGroupForModulePath } = await import('../scripts/lib/build-chunk-groups.mjs');
	for (const path of ['src/common/editor/ui/FramescaperNativeDeliveryDialog.tsx', 'src/common/i18n/framescaper-native-delivery-copy.ts',
		'src/framescaper/editor-successor-native-export.ts', 'src/framescaper/editor-successor-native-picture.ts', 'src/framescaper/editor-successor-native-audio.ts',
		'src/framescaper/editor-successor-native-delivery-adapter.ts', 'src/framescaper/editor-successor-native-delivery-contract.ts']) assert.equal(chunkGroupForModulePath(path), 'framescaper-successor-native-delivery', path);
});

test('Motion controller and storage modules retain their deferred semantic owners', () => {
	for (const [owner, paths] of [
		['motion-domain', ['controller/composition/motion-preview-client.ts', 'controller/export/motion-render-pipeline.ts',
			'controller/export/motion-browser-video.ts', 'controller/export/motion-png-sequence.ts',
			'controller/export/internal/motion-browser-audio-writer.ts', 'controller/export/internal/motion-render-audio.ts',
			'controller/track-audio/motion-audio-preview.ts', 'storage/motion-asset-repository.ts', 'storage/motion-asset-staging.ts']],
		['motion-raster', ['controller/composition/motion-preview-backend.ts', 'controller/composition/motion-preview-render-session.ts',
			'controller/composition/motion-preview-worker-backend.ts']],
		['motion-link-bridge', ['controller/composition/motion-link-connection.ts', 'controller/composition/motion-link-port.ts',
			'controller/composition/internal/motion-link-rpc.ts']],
		['framescaper-composition-links-dialog', ['ui/FramescaperCompositionConformReview.tsx', 'ui/framescaper-composition-native-connection.ts']],
		['framescaper-successor-migration', ['ui/framescaper-successor-migration-dialog.tsx']],
	] as const) {
		assert.equal(EAGER_CHUNK_GROUPS.has(owner), false, owner);
		for (const path of paths) {
			const module = `src/common/editor/${path}`;
			assert.equal(chunkGroupForModulePath(module), owner, module);
			assert.equal(chunkGroupForModulePath(module.replaceAll('/', '\\')), owner, module);
			assert.equal(isEagerlyLoadedModule(module), false, module);
		}
	}
});

test('shared Framescaper runtime ownership is independently eager while successor composition stays separate', () => {
	const reached = eagerlyReachableModules();
	for (const name of ['editor-project-history', 'editor-project-runtime', 'editor-capture-storage-runtime',
		'editor-project-store-foundation', 'editor-project-repository', 'editor-project-store', 'editor-project-runtime-selection',
		'editor-project-playback-projection', 'editor-project-playback-retime', 'editor-project-playback-admission',
		'editor-project-playback-finishing', 'editor-project-playback-native-media', 'editor-project-playback-assistance',
		'editor-project-playback', 'editor-capture-deferred-binding', 'editor-capture-runtime',
		'editor-project-sequence-sequence-actions', 'editor-project-sequence-multicam-actions', 'editor-project-retime-retime-actions']) {
		const path = `src/framescaper/${name}.ts`;
		assert.equal(chunkGroupForModulePath(path), 'framescaper-shared-runtime', path);
		assert.equal(isEagerlyLoadedModule(path), true, path);
		assert.ok(reached.has(resolve(import.meta.dirname, '..', path)), `${path} is actually reached during baseline bootstrap`);
	}
	assert.equal(chunkGroupForModulePath('src/framescaper/editor-project-successor-runtime.ts'), 'framescaper-successor-runtime');
	assert.equal(chunkGroupForModulePath('src/framescaper/editor-project-finishing-source-rebind.ts'), 'framescaper-source-rebind');
	assert.equal(isEagerlyLoadedModule('src/framescaper/editor-project-finishing-source-rebind.ts'), true);
	assert.equal(chunkGroupForModulePath('src/framescaper/selected-finishing-exact-frame-support.ts'), 'framescaper-timeline-images');
	assert.equal(isEagerlyLoadedModule('src/framescaper/selected-finishing-exact-frame-support.ts'), true);
	assert.equal(chunkGroupForModulePath('src/framescaper/visual-finishing-kernel.ts'), 'framescaper-timeline-images');
	assert.ok(reached.has(resolve(import.meta.dirname, '../src/common/i18n/site-copy.js')));
});
