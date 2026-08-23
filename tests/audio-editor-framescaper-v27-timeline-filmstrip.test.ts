/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { createFramescaperSelectedTimelineFilmstripV27 } from '../src/framescaper/editor-selected-v27-timeline-filmstrip.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('selected V27 timeline filmstrip consumes the exact presentation session', async () => {
	const options = framescaperV20Options();
	const source = (options.sources as Record<string, unknown>[])[0]!;
	source.width = 2;
	source.height = 2;
	const project = createFramescaperProjectV27(PROFILE, {
		...options,
		videoTransitionsByTrackId: { 'video-track': [] },
		finishing: {
			colorContexts: [{
				schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65',
				outputSpace: 'srgb', alphaMode: 'straight-authored-premultiplied-working',
				toneMapping: 'none',
			}],
			sourceColorInterpretations: [{
				schemaVersion: 1, sourceId: 'video-source', sourceKind: 'video',
				primaries: 'srgb', transfer: 'srgb', matrix: 'rgb', range: 'full',
				provenance: 'user-override',
			}],
			visualPresentations: [{
				schemaVersion: 1, id: 'filmstrip-presentation',
				owner: { kind: 'clip', id: 'video-clip' }, enabled: true,
				opacity: 0.5, blendMode: 'normal', maskMatteIds: [],
				grade: {
					schemaVersion: 1, exposureStops: 1, contrast: 1, pivot: 0.18,
					lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
					saturation: 1, lut: null,
				},
				processorStackId: null,
			}],
			processorStacks: [], motionAnalyses: [],
		},
	});
	const restore = installCanvasDocument();
	try {
		const result = await createFramescaperSelectedTimelineFilmstripV27({
			profile: PROFILE,
			project,
			store: {} as AudioEditorProjectStore,
			width: 2,
			height: 2,
			frames: [{
				key: 'video-clip:0', clipId: 'video-clip', sourceId: 'video-source',
				timelineSample: 0, sourceUrl: 'memory:video-clip:0',
			}],
			decodeSource: async () => decodedRedFrame(),
		});
		assert.ok(result);
		assert.equal(result.length, 1);
		assert.equal(result[0]?.key, 'video-clip:0');
		assert.deepEqual([...result[0]!.pixels.subarray(0, 4)], [128, 0, 0, 255]);
	} finally {
		restore();
	}
});

test('timeline filmstrip publishes exact canvases only while a product runtime owns the route', async () => {
	const filmstrip = await readFile(new URL(
		'../src/common/editor/ui/timeline/VideoFilmstrip.jsx', import.meta.url,
	), 'utf8');
	assert.match(filmstrip, /productVideoVisualPreviewRuntimeFor/u);
	assert.match(filmstrip, /createTimelineFilmstrip/u);
	assert.match(filmstrip, /ProductTimelineFilmstripCanvas/u);
	assert.match(filmstrip, /presentationThumbnails\.supported/u);
});

interface FakeImageData {
	readonly data: Uint8ClampedArray;
}

class FakeCanvas {
	width = 0;
	height = 0;
	pixels = new Uint8ClampedArray();

	getContext(kind: string): object | null {
		if (kind !== '2d') return null;
		return {
			clearRect: () => { this.pixels = new Uint8ClampedArray(this.width * this.height * 4); },
			drawImage: (source: FakeCanvas) => {
				this.pixels = new Uint8ClampedArray(source.pixels);
			},
			getImageData: () => ({ data: new Uint8ClampedArray(this.pixels) }),
			putImageData: (image: FakeImageData) => {
				this.pixels = new Uint8ClampedArray(image.data);
			},
		};
	}
}

function decodedRedFrame() {
	const drawable = new FakeCanvas();
	drawable.width = 2;
	drawable.height = 2;
	drawable.pixels = Uint8ClampedArray.from(
		{ length: 16 }, (_, index) => index % 4 === 0 ? 128 : index % 4 === 3 ? 255 : 0,
	);
	return Object.freeze({ drawable, width: 2, height: 2, dispose() {} });
}

function installCanvasDocument(): () => void {
	const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
	const imageDataDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ImageData');
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: { createElement: (name: string) => {
			if (name !== 'canvas') throw new TypeError('Only canvas creation is expected.');
			return new FakeCanvas();
		} },
	});
	Object.defineProperty(globalThis, 'ImageData', {
		configurable: true,
		value: class ImageData {
			readonly data: Uint8ClampedArray;
			constructor(data: Uint8ClampedArray) { this.data = data; }
		},
	});
	return () => {
		if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
		else Reflect.deleteProperty(globalThis, 'document');
		if (imageDataDescriptor) Object.defineProperty(globalThis, 'ImageData', imageDataDescriptor);
		else Reflect.deleteProperty(globalThis, 'ImageData');
	};
}
