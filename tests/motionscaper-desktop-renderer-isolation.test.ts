/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assertDesktopRendererProductIsolation,
	desktopRendererProductPublicAssetFiles,
} from '../scripts/lib/desktop-renderer-product-isolation.mjs';

function bundle(moduleId: string, code = '') {
	return { 'assets/motion.js': { type: 'chunk', fileName: 'assets/motion.js', modules: { [moduleId]: {} }, code } };
}

test('Motionscaper renderer admits its own bootstrap and shared custody modules', () => {
	for (const moduleId of [
		'/src/motionscaper/ui/MotionscaperEditorBootstrap.tsx',
		'/src/common/editor/project-schema-identity.ts',
	]) assert.doesNotThrow(() => assertDesktopRendererProductIsolation(bundle(moduleId), 'motionscaper'));
});

test('Motionscaper renderer refuses foreign product bootstraps and native entrypoints', () => {
	for (const moduleId of [
		'/src/framescaper/ui/FramescaperEditorBootstrap.tsx',
		'/src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx',
		'/src/common/editor/framescaper-native-services.ts',
	]) assert.throws(() => assertDesktopRendererProductIsolation(bundle(moduleId), 'motionscaper'), /Motionscaper.*forbidden/u);
	assert.throws(() => assertDesktopRendererProductIsolation(
		bundle('/src/motionscaper/index.ts', 'framescaperDesktop.v1.nativeServices()'), 'motionscaper',
	), /Motionscaper.*callable/u);
});

test('Motionscaper public assets retain shared peer marks without foreign runtime files', () => {
	assert.deepEqual(desktopRendererProductPublicAssetFiles('motionscaper', [
		'logo/framescaper.svg', 'logo/soundscaper.svg', 'logo/motionscaper.svg',
		'framescaper-capture.js', 'soundscaper-helper.js', 'assets/shared.css',
	]), ['logo/framescaper.svg', 'logo/soundscaper.svg', 'logo/motionscaper.svg', 'assets/shared.css']);
});
