/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { VideoFilmstripClip } from '../src/common/editor/ui/timeline/VideoFilmstrip.jsx';
import {
	selectProductVisualThumbnailPoints,
} from '../src/common/editor/ui/timeline/product-visual-thumbnail-points.ts';
import {
	bindProductVideoVisualPreviewRuntime,
	createProductVideoVisualPreviewRuntime,
} from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';

test('image filmstrips sample product-owned timeline frames without video source geometry', () => {
	const points = selectProductVisualThumbnailPoints({
		clip: { kind: 'image', timelineStartFrame: 48_000, durationFrames: 480_000 },
		visibleStartFrame: 96_000,
		visibleEndFrame: 480_000,
		projectSampleRate: 48_000,
		pixelsPerSecond: 48,
	});
	assert.deepEqual(points, [{
		gridIndex: 0,
		timelineFrame: 96_000,
		sourceFrame: 0,
		sourceTimeSeconds: 1,
	}, {
		gridIndex: 1,
		timelineFrame: 336_000,
		sourceFrame: 0,
		sourceTimeSeconds: 6,
	}]);
});

test('timeline and Project Bin route image clips through product visual thumbnails', async () => {
	const reactDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const controller = {
		actions: { video: { getClipVisualData: () => null } },
	};
	bindProductVideoVisualPreviewRuntime(controller, createProductVideoVisualPreviewRuntime(
		async () => null,
		async () => null,
		async () => [],
	));
	let markup: string;
	try {
		markup = renderToStaticMarkup(<VideoFilmstripClip
			controller={controller}
			project={{ schemaVersion: 30 }}
			clip={{
				kind: 'image', id: 'image-clip', sourceId: 'image-source', title: 'Poster',
				timelineStartFrame: 0, durationFrames: 240_000,
			}}
			source={{ kind: 'image', id: 'image-source' }}
			overscanStartFrame={0}
			overscanEndFrame={240_000}
			pixelsPerSecond={100}
			sampleRate={48_000}
			selected={false}
			dragging={false}
			invalidOverlap={false}
			hidden={false}
				blocked={false}
				copy={{ videoClip: 'Video clip', clipName: 'Clip name' }}
				onOpenMenu={() => undefined}
				onRename={() => undefined}
				renameRequestId={undefined}
				onRenameFinished={() => undefined}
			/>);
	} finally {
		if (reactDescriptor) Object.defineProperty(globalThis, 'React', reactDescriptor);
		else Reflect.deleteProperty(globalThis, 'React');
	}
	assert.match(markup, /data-clip-kind="image"/u);
	assert.match(markup, /aria-label="Image clip: Poster"/u);
	assert.match(markup, /data-product-visual-thumbnail="true"/u);

	const projectBin = await readFile(new URL(
		'../src/common/editor/ui/workspace/ProjectBinCard.jsx', import.meta.url,
	), 'utf8');
	assert.match(projectBin, /itemClip\.kind === 'image'/u);
});
