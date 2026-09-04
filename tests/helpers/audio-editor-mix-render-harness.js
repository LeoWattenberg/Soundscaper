/* SPDX-License-Identifier: AGPL-3.0-only */

// Project and engine fixtures the mix-and-render suites share. Split out of
// audio-editor-mix-render.test.js so its suites can sit in separate files.

import { register } from 'node:module';

export const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return {
				url: 'data:text/javascript,export default "mock-ffmpeg-asset"',
				shortCircuit: true,
			};
		}
		return nextResolve(specifier, context);
	}

`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

export const { createAudioEditorController } = await import('../../src/common/editor/app.js');

export const { createCurrentAudioEditorProject } = await import('../../src/common/editor/project-current.ts');

export const { WAVEFORM_PEAKS_VERSION } = await import('../../src/common/editor/waveform-peak-contract.ts');

export const {
	audioBuffer, clip, createMemoryEngine, createTestStore,
	observeMixedSourceWrites, source, storedSample, writeSource,
} = await import('./mix-render-fixtures.js');
