/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	VIDEO_PREVIEW_IDENTITY_POSITION_TRANSFORM,
	VIDEO_PREVIEW_IDENTITY_TEXTURE_TRANSFORM,
} from '../src/common/editor/ui/video-preview-geometry-shader.ts';
import {
	createVideoPreviewCompositor,
} from '../src/common/editor/ui/video-preview-compositor.js';

const AUTHORED_DESCRIPTION = Object.freeze({
	crop: Object.freeze({
		normalized: Object.freeze({ left: 0.125, top: 0.125, right: 0.375, bottom: 0.375 }),
		sourcePixels: Object.freeze({ x: 100, y: 50, width: 400, height: 200 }),
	}),
	sourceDisplayToCanvas: Object.freeze([1, 0, 0, 1, 0, 0]),
	opacityStart: 0.25,
	opacityEnd: 0.75,
	blendMode: 'multiply',
	compositingOrder: 7,
});

test('the compositor forwards canonical affine and crop geometry to shader uniforms', () => {
	const fixture = createRecordingFixture();
	const compositor = createVideoPreviewCompositor(fixture.canvas);
	fixture.recording.reset();

	try {
		const report = compositor.render([{
			blendMode: 'multiply',
			entries: [{
				...entry('clip-authored'),
				intervalProgress: 0.5,
				renderDescription: AUTHORED_DESCRIPTION,
			}],
		}], { referenceWidth: 1_000, referenceHeight: 500 });
		const geometryDraw = fixture.recording.draws.find((draw) => (
			!isBlendProgram(draw.program)
			&& approximatelyEqual(draw.uniforms.u_position_transform, [
				0.8, 0, 0,
				0, 0.8, 0,
				-0.8, 0, 1,
			])
		));

		assert.ok(geometryDraw, 'the authored source-to-canvas matrix must reach a draw');
		assert.ok(approximatelyEqual(geometryDraw.uniforms.u_texture_transform, [
			0.5, 0, 0,
			0, 0.5, 0,
			0.125, 0.375, 1,
		]));
		assert.equal(geometryDraw.uniforms.u_opacity, 0.5);
		assert.deepEqual(report.composition, {
			requested: [{ clipId: 'clip-authored', blendMode: 'multiply' }],
			rendered: ['clip-authored'],
			fallbackRendered: [],
			omitted: [],
		});
	} finally {
		compositor.dispose();
	}
});

test('a specialized blend uses the completed normal layer as its backdrop', () => {
	const fixture = createRecordingFixture();
	const compositor = createVideoPreviewCompositor(fixture.canvas);
	fixture.recording.reset();

	try {
		const report = compositor.render([
			{ blendMode: 'normal', entries: [entry('clip-bottom')] },
			{ blendMode: 'multiply', entries: [entry('clip-top')] },
		], { referenceWidth: 1_000, referenceHeight: 500 });
		const blendDraws = fixture.recording.draws.filter((draw) => isBlendProgram(draw.program));

		assert.equal(report.status, 'rendered');
		assert.equal(report.renderedEntryCount, 2);
		assert.equal(blendDraws.length, 1);
		assert.deepEqual(blendDraws.map((draw) => draw.uniforms.u_blend_mode), [1]);
		assert.deepEqual(blendDraws.map((draw) => draw.framebuffer), [
			compositor.targets.compositionSwap.framebuffer,
		]);
		assert.deepEqual(blendDraws.map((draw) => draw.textures.get(fixture.gl.TEXTURE0)), [
			compositor.targets.composition.texture,
		]);
		assert.deepEqual(blendDraws.map((draw) => draw.textures.get(fixture.gl.TEXTURE1)), [
			compositor.targets.layer.texture,
		]);
	} finally {
		compositor.dispose();
	}
});

test('legacy entries retain contained identity geometry and default normal blending', () => {
	const fixture = createRecordingFixture();
	const compositor = createVideoPreviewCompositor(fixture.canvas);
	fixture.recording.reset();

	try {
		const report = compositor.render([{
			entries: [entry('clip-legacy')],
		}], { referenceWidth: 1_000, referenceHeight: 500 });
		const effectDraws = fixture.recording.draws.filter((draw) => !isBlendProgram(draw.program));
		const blendDraws = fixture.recording.draws.filter((draw) => isBlendProgram(draw.program));

		assert.equal(report.status, 'rendered');
		assert.equal(report.renderedEntryCount, 1);
		assert.equal('composition' in report, false);
		assert.ok(effectDraws.length >= 2);
		for (const draw of effectDraws) {
			assert.ok(approximatelyEqual(
				draw.uniforms.u_position_transform,
				VIDEO_PREVIEW_IDENTITY_POSITION_TRANSFORM,
			));
			assert.ok(approximatelyEqual(
				draw.uniforms.u_texture_transform,
				VIDEO_PREVIEW_IDENTITY_TEXTURE_TRANSFORM,
			));
		}
		assert.equal(effectDraws.length, 2, 'plain video needs one composition draw and one final pass');
		assert.equal(blendDraws.length, 0, 'normal single-entry layers blend in the composition target');
	} finally {
		compositor.dispose();
	}
});

test('plain previews allocate one full-size scratch target and preserve source-over opacity', () => {
	const fixture = createRecordingFixture();
	const compositor = createVideoPreviewCompositor(fixture.canvas);
	fixture.recording.reset();
	try {
		compositor.render([{ entries: [{ ...entry('plain'), opacity: 0.25 }] }]);
		assert.equal(fixture.recording.allocations.length, 1);
		assert.deepEqual(fixture.recording.blendFactors.at(-1), [
			fixture.gl.SRC_ALPHA, fixture.gl.ONE_MINUS_SRC_ALPHA,
			fixture.gl.ONE, fixture.gl.ONE_MINUS_SRC_ALPHA,
		]);
		assert.equal(fixture.recording.draws[0].uniforms.u_opacity, 0.25);
	} finally {
		compositor.dispose();
	}
});

test('crossfade entries retain additive layer accumulation before normal composition', () => {
	const fixture = createRecordingFixture();
	const compositor = createVideoPreviewCompositor(fixture.canvas);
	fixture.recording.reset();
	try {
		compositor.render([{ entries: [
			{ ...entry('outgoing'), opacity: 0.75 },
			{ ...entry('incoming'), opacity: 0.25 },
		] }]);
		assert.equal(fixture.recording.draws.filter((draw) => isBlendProgram(draw.program)).length, 1);
		assert.deepEqual(fixture.recording.blendFactors[0], [
			fixture.gl.SRC_ALPHA, fixture.gl.ONE, fixture.gl.ONE, fixture.gl.ONE,
		]);
		assert.equal(fixture.recording.allocations.length, 3, 'only layer and composition ping-pong targets are needed');
	} finally {
		compositor.dispose();
	}
});

test('unchanged video frames reuse effects while opacity, animated effects, and seeks keep updating', () => {
	const fixture = createRecordingFixture();
	const compositor = createVideoPreviewCompositor(fixture.canvas);
	const clip = { ...entry('cached'), effects: [{
		id: 'vignette', type: 'vignette', enabled: true, params: { amount: 0.5 },
	}] };
	Object.assign(clip.video, {
		currentTime: 0, paused: true, addEventListener() {}, removeEventListener() {},
	});
	const layers = [{ entries: [clip] }];
	try {
		compositor.render(layers);
		fixture.recording.reset();
		clip.opacity = 0.75;
		compositor.render(layers);
		assert.equal(fixture.recording.draws.length, 2, 'unchanged effects need only composition and delivery draws');
		assert.equal(fixture.recording.draws[0].uniforms.u_opacity, 0.75);
		fixture.recording.reset();
		clip.effects = [{ ...clip.effects[0], params: { amount: 0.6 } }];
		compositor.render(layers);
		assert.ok(fixture.recording.draws.length > 2, 'animated effect values must be evaluated');
		fixture.recording.reset();
		clip.video.currentTime = 1;
		compositor.render(layers);
		assert.ok(fixture.recording.draws.length > 2, 'a newly presented source frame invalidates the cached result');
	} finally {
		compositor.dispose();
	}
});

test('each reusable effected clip retains its own completed result', () => {
	for (const opaqueFirst of [false, true]) {
		const fixture = createRecordingFixture();
		const compositor = createVideoPreviewCompositor(fixture.canvas);
		const effects = [{ id: 'vignette', type: 'vignette', enabled: true, params: { amount: 0.5 } }];
		const layers = ['bottom', 'top'].map((id, index) => {
			const clip = { ...entry(id), effects: effects.map((effect) => ({ ...effect, id: `${id}-vignette` })) };
			if (opaqueFirst && index === 0) clip.video.drawable = {};
			else Object.assign(clip.video, {
				currentTime: 0, paused: true, addEventListener() {}, removeEventListener() {},
			});
			return { entries: [clip] };
		});
		try {
			compositor.render(layers);
			fixture.recording.reset();
			compositor.render(layers);
			assert.equal(fixture.recording.draws.length, opaqueFirst ? 5 : 3,
				'reusable clips need only composition draws; opaque drawables still evaluate their effects');
		} finally {
			compositor.dispose();
		}
	}
});

test('a changed second clip invalidates only its effects and reuses its allocated result target', () => {
	const fixture = createRecordingFixture();
	const compositor = createVideoPreviewCompositor(fixture.canvas);
	const layers = ['bottom', 'top'].map((id) => ({ entries: [cachedEntry(id)] }));
	const second = layers[1].entries[0];
	try {
		compositor.render(layers);
		const retainedTextures = [fixture.recording.draws[2], fixture.recording.draws[6]]
			.map((draw) => draw.framebuffer);
		for (const change of [
			() => { second.video.currentTime = 1; },
			() => { second.video.src = 'replacement.webm'; },
			() => { second.effects = [{ ...second.effects[0], params: { amount: 0.8 } }]; },
		]) {
			change();
			fixture.recording.reset();
			compositor.render(layers);
			assert.equal(fixture.recording.draws.length, 6, 'only the changed clip runs its stack and cache copy');
			assert.equal(fixture.recording.draws[3].framebuffer, retainedTextures[1]);
			assert.equal(fixture.recording.allocations.length, 0, 'source and effect edits reuse owned targets');
			fixture.recording.reset();
			compositor.render(layers);
			assert.equal(fixture.recording.draws.length, 3, 'the refreshed second result is retained');
		}
	} finally {
		compositor.dispose();
	}
});

test('the compositor releases departed effect targets, resizes them and disposes each once', () => {
	const fixture = createRecordingFixture();
	const compositor = createVideoPreviewCompositor(fixture.canvas);
	const layers = ['bottom', 'top'].map((id) => ({ entries: [cachedEntry(id)] }));
	try {
		compositor.render(layers);
		const firstTarget = fixture.recording.draws[2].framebuffer;
		const secondTarget = fixture.recording.draws[6].framebuffer;
		fixture.recording.reset();
		compositor.render(layers.slice(0, 1));
		assert.deepEqual(fixture.recording.deletedFramebuffers, [secondTarget]);
		fixture.recording.reset();
		compositor.render(layers.slice(0, 1), { outputWidth: 320, outputHeight: 180 });
		assert.ok(fixture.recording.deletedFramebuffers.includes(firstTarget), 'resizing releases the old cache target');
		const resizedTarget = fixture.recording.draws[2].framebuffer;
		fixture.recording.reset();
		compositor.dispose();
		compositor.dispose();
		assert.equal(fixture.recording.deletedFramebuffers.filter((target) => target === resizedTarget).length, 1);
		assert.equal(new Set(fixture.recording.deletedFramebuffers).size, fixture.recording.deletedFramebuffers.length);
	} finally {
		compositor.dispose();
	}
});

test('fresh exact drawables and conservative playing frames omit the unusable effect cache copy', () => {
	for (const opaque of [true, false]) {
		const fixture = createRecordingFixture();
		const compositor = createVideoPreviewCompositor(fixture.canvas);
		const clip = { ...entry('uncacheable'), effects: [{
			id: 'vignette', type: 'vignette', enabled: true, params: { amount: 0.5 },
		}] };
		if (opaque) clip.video.drawable = {};
		else Object.assign(clip.video, {
			currentTime: 0, paused: false, addEventListener() {}, removeEventListener() {},
		});
		try {
			compositor.render([{ entries: [clip] }]);
			fixture.recording.reset();
			compositor.render([{ entries: [clip] }]);
			assert.equal(fixture.recording.draws.length, 4,
				'uncacheable frames need the source copy, effect, composition and delivery draws');
			assert.equal(fixture.recording.allocations.length, 0, 'scratch targets remain reusable');
		} finally {
			compositor.dispose();
		}
	}
});

test('the compositor rejects malformed layer blend modes before a blend draw', () => {
	const fixture = createRecordingFixture();
	const compositor = createVideoPreviewCompositor(fixture.canvas);
	fixture.recording.reset();

	try {
		assert.throws(
			() => compositor.render([{
				blendMode: 'source-over',
				entries: [entry('clip-invalid-blend')],
			}], { referenceWidth: 1_000, referenceHeight: 500 }),
			/unsupported video preview blend mode/iu,
		);
		assert.equal(
			fixture.recording.draws.some((draw) => isBlendProgram(draw.program)),
			false,
		);
	} finally {
		compositor.dispose();
	}
});

test('the outline shader samples its complete high-DPI radius with a bounded adaptive stride', () => {
	const fixture = createRecordingFixture();
	const compositor = createVideoPreviewCompositor(fixture.canvas);
	try {
		const outlineProgram = compositor.programs[13];
		const source = outlineProgram.shaders.map((shader) => shader.source).join('\n');
		assert.match(source, /float sample_stride = max\(radius \/ 16\.0, 1\.0\)/u);
		assert.match(source, /sample_offset = float\(sample_x\) \* sample_stride/u);
		assert.match(source, /sample_offset = float\(sample_y\) \* sample_stride/u);
	} finally {
		compositor.dispose();
	}
});

function entry(clipId) {
	return {
		clipId,
		video: { readyState: 4, videoWidth: 800, videoHeight: 400 },
		displayWidth: 800,
		displayHeight: 400,
		effects: [],
		opacity: 1,
	};
}

function cachedEntry(clipId) {
	const clip = { ...entry(clipId), effects: [{
		id: `${clipId}-vignette`, type: 'vignette', enabled: true, params: { amount: 0.5 },
	}] };
	Object.assign(clip.video, {
		currentTime: 0, paused: true, addEventListener() {}, removeEventListener() {},
	});
	return clip;
}

function isBlendProgram(program) {
	return program.shaders.some((shader) => shader.source.includes('uniform sampler2D u_backdrop'));
}

function approximatelyEqual(actual, expected) {
	return Array.isArray(actual)
		&& actual.length === expected.length
		&& actual.every((value, index) => Math.abs(value - expected[index]) < 1e-12);
}

function createRecordingFixture() {
	const gl = createRecordingContext();
	return {
		gl,
		recording: gl.recording,
		canvas: {
			width: 640,
			height: 360,
			addEventListener() {},
			removeEventListener() {},
			getBoundingClientRect: () => ({ width: 640, height: 360 }),
			getContext: () => gl,
		},
	};
}

function createRecordingContext() {
	let nextId = 0;
	let nextConstant = 100;
	const constants = new Map();
	const constant = (name) => {
		if (!constants.has(name)) constants.set(name, nextConstant += 1);
		return constants.get(name);
	};
	const state = {
		activeTexture: null,
		framebuffer: null,
		program: null,
		textures: new Map(),
		uniforms: new Map(),
	};
	const draws = [];
	const clears = [];
	const allocations = [];
	const blendFactors = [];
	const deletedFramebuffers = [];
	const recording = {
		draws,
		clears,
		allocations,
		blendFactors,
		deletedFramebuffers,
		reset() {
			draws.length = 0;
			clears.length = 0;
			allocations.length = 0;
			blendFactors.length = 0;
			deletedFramebuffers.length = 0;
			state.uniforms.clear();
			state.textures.clear();
		},
	};
	const target = {
		recording,
		getShaderParameter: () => true,
		getProgramParameter: () => true,
		getShaderInfoLog: () => '',
		getProgramInfoLog: () => '',
		getAttribLocation: () => 0,
		getUniformLocation: (program, name) => ({ program, name }),
		createShader: (type) => ({ id: nextId += 1, type, source: '' }),
		shaderSource: (shader, source) => { shader.source = source; },
		createProgram: () => ({ id: nextId += 1, shaders: [] }),
		attachShader: (program, shader) => { program.shaders.push(shader); },
		createBuffer: () => ({ id: nextId += 1 }),
		createTexture: () => ({ id: nextId += 1 }),
		createFramebuffer: () => ({ id: nextId += 1 }),
		deleteFramebuffer: (framebuffer) => { deletedFramebuffers.push(framebuffer); },
		createVertexArray: () => ({ id: nextId += 1 }),
		checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'),
		useProgram: (program) => { state.program = program; },
		clearColor: (red, green, blue, alpha) => {
			clears.push({ framebuffer: state.framebuffer, color: [red, green, blue, alpha] });
		},
		bindFramebuffer: (_target, framebuffer) => { state.framebuffer = framebuffer; },
		texImage2D: (...args) => { if (args.length === 9) allocations.push([args[3], args[4]]); },
		blendFuncSeparate: (...factors) => { blendFactors.push(factors); },
		activeTexture: (textureUnit) => { state.activeTexture = textureUnit; },
		bindTexture: (_target, texture) => { state.textures.set(state.activeTexture, texture); },
		uniform1i: (location, value) => setUniform(state, location, value),
		uniform1f: (location, value) => setUniform(state, location, value),
		uniform2f: (location, first, second) => setUniform(state, location, [first, second]),
		uniform2fv: (location, value) => setUniform(state, location, Array.from(value)),
		uniform4f: (location, ...value) => setUniform(state, location, value),
		uniform4fv: (location, value) => setUniform(state, location, Array.from(value)),
		uniformMatrix3fv: (location, _transpose, value) => (
			setUniform(state, location, Array.from(value))
		),
		drawArrays: () => {
			draws.push({
				program: state.program,
				framebuffer: state.framebuffer,
				textures: new Map(state.textures),
				uniforms: Object.fromEntries(
					[...state.uniforms]
						.filter(([location]) => location.program === state.program)
						.map(([location, value]) => [location.name, value]),
				),
			});
		},
	};
	return new Proxy(target, {
		get(source, property) {
			if (property in source) return source[property];
			if (typeof property === 'string' && /^[A-Z][A-Z0-9_]*$/u.test(property)) {
				return constant(property);
			}
			const noop = () => undefined;
			source[property] = noop;
			return noop;
		},
	});
}

function setUniform(state, location, value) {
	state.uniforms.set(location, value);
}

test('the composition is cleared to the background the delivery states', () => {
	const fixture = createRecordingFixture();
	const compositor = createVideoPreviewCompositor(fixture.canvas);

	// A `contain` delivery shows this colour in its bars, and the composed-graph
	// path has always painted them with it. The keyed renderer clears the canvas
	// itself, so it had to be told; before that a stated background failed the
	// whole keyed export rather than being delivered.
	fixture.recording.reset();
	compositor.render([], { outputWidth: 640, outputHeight: 360 });
	assert.deepEqual(fixture.recording.clears[0].color, [0, 0, 0, 1], 'black unless a delivery says otherwise');

	fixture.recording.reset();
	compositor.render([], { outputWidth: 640, outputHeight: 360, backgroundColor: '#ff8000' });
	assert.deepEqual(
		fixture.recording.clears[0].color.map((channel) => Math.round(channel * 255)),
		[255, 128, 0, 255],
	);

	fixture.recording.reset();
	compositor.render([], { outputWidth: 640, outputHeight: 360, backgroundColor: '#10203080' });
	assert.deepEqual(
		fixture.recording.clears[0].color.map((channel) => Math.round(channel * 255)),
		[16, 32, 48, 128],
		'an alpha suffix preserves the specified RGB channels too',
	);
});
