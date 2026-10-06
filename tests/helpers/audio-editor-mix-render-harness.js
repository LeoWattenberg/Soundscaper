/* SPDX-License-Identifier: AGPL-3.0-only */

// Project and engine fixtures the mix-and-render suites share. Split out of
// audio-editor-mix-render.test.js so its suites can sit in separate files.

import { registerMockModuleUrls } from './mock-module-urls.ts';

registerMockModuleUrls({
	'@ffmpeg/core?url': 'data:text/javascript,export default "mock-ffmpeg-asset"',
	'@ffmpeg/core/wasm?url': 'data:text/javascript,export default "mock-ffmpeg-asset"',
});

export const { createAudioEditorController } = await import('../../src/common/editor/app.js');

export const { createCurrentAudioEditorProject } = await import('../../src/common/editor/project-current.ts');

export const { WAVEFORM_PEAKS_VERSION } = await import('../../src/common/editor/waveform-peak-contract.ts');

export const {
	audioBuffer, clip, createMemoryEngine, createTestStore,
	observeMixedSourceWrites, source, storedSample, writeSource,
} = await import('./mix-render-fixtures.js');
