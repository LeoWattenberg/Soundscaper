/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildVideoProxyGenerationArgs,
	VIDEO_PROXY_GENERATION_OUTPUT,
	VIDEO_PROXY_GENERATION_RECIPE,
	videoProxyGenerationFilter,
} from '../src/common/editor/video-proxy-generation.ts';

test('a generated proxy keeps every frame at the presentation time the original gave it', () => {
	const args = buildVideoProxyGenerationArgs({ inputPath: 'in.mp4', outputPath: 'out.mp4' });

	// Timing conformance compares the two sources boundary by boundary, so the
	// encode must be frame-for-frame: passthrough keeps each input timestamp
	// instead of resampling the stream onto a constant rate, and no `-r`,
	// `-ss`, or `-t` may narrow or re-time what the original presented.
	const passthrough = args.indexOf('-fps_mode');
	assert.notEqual(passthrough, -1);
	assert.equal(args[passthrough + 1], 'passthrough');
	for (const forbidden of ['-r', '-ss', '-t', '-vsync']) {
		assert.ok(!args.includes(forbidden), `${forbidden} would re-time the proxy`);
	}

	// One video stream and nothing else. A proxy carrying its own audio would
	// invite a second clock into a picture-only derivative, and the attachment
	// records `ignore-proxy-container-audio-v1` precisely because the original
	// keeps owning the sound.
	assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-map') + 2), ['-map', '0:v:0']);
	for (const dropped of ['-an', '-sn', '-dn']) assert.ok(args.includes(dropped));
});

test('a proxy is generated in display geometry, because that is what carries no matrix', () => {
	const args = buildVideoProxyGenerationArgs({ inputPath: 'in.mov', outputPath: 'out.mp4' });

	// Measured against the pinned core (FFmpeg 5.1.4): `-noautorotate` copies the
	// input's display matrix onto the output stream, and `-metadata:s:v:0
	// rotate=0` does not clear it because the mov muxer prefers the side data. A
	// proxy written that way declares a rotation the preview would then apply a
	// second time. Left to autorotate, the decode turns the frames and the output
	// carries no matrix at all, which is the same convention the export follows.
	assert.ok(!args.includes('-noautorotate'));
	assert.ok(!args.some((value) => value.startsWith('rotate=')));

	// Square pixels for the same reason: Chromium applies a stored pixel aspect
	// to videoWidth and Firefox ignores it, so a proxy that kept the ratio would
	// present at two different sizes. `setsar=1` settles it in the file.
	assert.ok(videoProxyGenerationFilter().includes('setsar=1'));
});

test('a proxy is never larger than the original it stands in for', () => {
	// The height is clamped inside the filter rather than computed here, because
	// the generator sees only the bytes: it is handed the original as a Blob and
	// its identity, never a decoded size. `min` therefore has to survive the
	// filtergraph parser, where an unescaped comma would end the scale filter and
	// start a filter named `ih)`.
	const filter = videoProxyGenerationFilter();
	assert.match(filter, /min\(540\\,ih\)/u);
	assert.ok(!/min\(540,ih\)/u.test(filter));

	// Both dimensions stay even, which yuv420p requires: an odd source height
	// would otherwise produce an encode the pinned build refuses outright.
	assert.match(filter, /trunc\(/u);
	assert.match(filter, /scale=-2:/u);
});

test('the recipe names itself, so an attachment records which rule produced it', () => {
	// The recipe id and version are persisted with the attachment. A later
	// consumer compares them before trusting a body, and a regenerated proxy from
	// a newer recipe must not silently pass as one an older recipe wrote.
	assert.equal(VIDEO_PROXY_GENERATION_RECIPE.id, 'framescaper-video-proxy-h264-540-v1');
	assert.equal(VIDEO_PROXY_GENERATION_RECIPE.version, 1);
	assert.ok(Object.isFrozen(VIDEO_PROXY_GENERATION_RECIPE));
	// A recipe is an identity and nothing else: the candidate observer captures
	// exactly these two fields and refuses a record that carries more, so what
	// the recipe produces is stated separately from what it is called.
	assert.deepEqual(Object.keys(VIDEO_PROXY_GENERATION_RECIPE), ['id', 'version']);
	assert.equal(VIDEO_PROXY_GENERATION_OUTPUT.mimeType, 'video/mp4');
	assert.equal(VIDEO_PROXY_GENERATION_OUTPUT.maximumHeight, 540);

	// The encoder is one the shipped build already carries for delivery. A proxy
	// is not the place to introduce a codec whose licensing row is not cleared.
	const args = buildVideoProxyGenerationArgs({ inputPath: 'in.mp4', outputPath: 'out.mp4' });
	assert.deepEqual(args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + 2), ['-c:v', 'libx264']);
	assert.ok(args.includes('yuv420p'));
});

test('a pinned timescale is stated only when the caller knows the original had one', () => {
	// A VFR original's boundaries are exact rationals in its own timescale. The
	// mov muxer picks its own unless told, and a timescale that cannot express
	// those boundaries rounds them — which conformance then refuses. A caller
	// holding the original's timing view can pin it; one that is not sure says
	// nothing rather than guessing.
	const plain = buildVideoProxyGenerationArgs({ inputPath: 'in.mp4', outputPath: 'out.mp4' });
	assert.ok(!plain.includes('-video_track_timescale'));

	const pinned = buildVideoProxyGenerationArgs({
		inputPath: 'in.mp4', outputPath: 'out.mp4', timescale: 90_000,
	});
	const flag = pinned.indexOf('-video_track_timescale');
	assert.notEqual(flag, -1);
	assert.equal(pinned[flag + 1], '90000');

	for (const rejected of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
		assert.throws(
			() => buildVideoProxyGenerationArgs({
				inputPath: 'in.mp4', outputPath: 'out.mp4', timescale: rejected,
			}),
			/timescale/iu,
		);
	}
});

test('the arguments are refused rather than guessed at when a path is missing', () => {
	assert.throws(() => buildVideoProxyGenerationArgs({ inputPath: '', outputPath: 'out.mp4' }), /input/iu);
	assert.throws(() => buildVideoProxyGenerationArgs({ inputPath: 'in.mp4', outputPath: '' }), /output/iu);
	// The same request twice is the same argument list: a proxy that has to be
	// compared against a stored digest cannot be produced by a run that varies.
	const first = buildVideoProxyGenerationArgs({ inputPath: 'in.mp4', outputPath: 'out.mp4' });
	const second = buildVideoProxyGenerationArgs({ inputPath: 'in.mp4', outputPath: 'out.mp4' });
	assert.deepEqual(first, second);
	assert.ok(Object.isFrozen(first));
});
