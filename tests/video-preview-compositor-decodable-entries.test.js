import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoPreviewCompositor } from '../src/common/editor/ui/video-preview-compositor.js';

function createStubContext() {
	let nextConstant = 1;
	const constants = new Map();
	const constant = (name) => {
		if (!constants.has(name)) constants.set(name, nextConstant += 1);
		return constants.get(name);
	};
	const target = {
		getShaderParameter: () => true,
		getProgramParameter: () => true,
		getShaderInfoLog: () => '',
		getProgramInfoLog: () => '',
		getAttribLocation: () => 0,
		getUniformLocation: () => ({}),
		createShader: () => ({}),
		createProgram: () => ({}),
		createBuffer: () => ({}),
		createTexture: () => ({}),
		createFramebuffer: () => ({}),
		createVertexArray: () => ({}),
		checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'),
		uploads: [],
		texImage2D: (...args) => { if (args.length === 6) target.uploads.push(args[5]); },
		texSubImage2D: (...args) => { target.uploads.push(args.at(-1)); },
	};
	return new Proxy(target, {
		get(source, property) {
			if (property in source) return source[property];
			if (typeof property === 'string' && /^[A-Z][A-Z0-9_]*$/u.test(property)) return constant(property);
			const noop = () => undefined;
			source[property] = noop;
			return noop;
		},
	});
}

function createStubCanvas() {
	const gl = createStubContext();
	return {
		gl,
		width: 640,
		height: 360,
		addEventListener() {},
		removeEventListener() {},
		getBoundingClientRect: () => ({ width: 640, height: 360 }),
		getContext: () => gl,
	};
}

function createEntry(readyState, effectId) {
	return {
		video: { readyState, videoWidth: readyState >= 2 ? 1_920 : 0, videoHeight: readyState >= 2 ? 1_080 : 0 },
		effects: [{ id: effectId, type: 'vignette', enabled: true, params: { amount: 0.5 } }],
		opacity: 1,
	};
}

test('defers effects on entries that are not decodable yet instead of reporting fallback', () => {
	const compositor = createVideoPreviewCompositor(createStubCanvas());
	const buffering = createEntry(0, 'effect-buffering');
	const report = compositor.render([{ entries: [buffering] }], {
		referenceWidth: 1_920,
		referenceHeight: 1_080,
	});
	assert.equal(report.rendererStatus, 'available');
	assert.deepEqual(report.effects.fallbackRendered, []);
	assert.deepEqual(report.effects.omitted, []);
	assert.deepEqual(report.effects.requested, []);
	assert.equal(report.status, 'rendered');
	assert.equal(report.renderedEntryCount, 0);
	compositor.dispose();
});

test('still reports fallback for an entry whose frame cannot be uploaded', () => {
	const compositor = createVideoPreviewCompositor(createStubCanvas());
	const decodable = createEntry(4, 'effect-broken');
	compositor.uploadVideo = () => { throw new Error('upload failed'); };
	const report = compositor.render([{ entries: [decodable] }], {
		referenceWidth: 1_920,
		referenceHeight: 1_080,
	});
	assert.deepEqual(report.effects.requested, ['effect-broken']);
	assert.deepEqual(report.effects.fallbackRendered, ['effect-broken']);
	assert.equal(report.status, 'fallback');
	compositor.dispose();
});

test('keeps rendering the decodable entries while a sibling entry buffers', () => {
	const compositor = createVideoPreviewCompositor(createStubCanvas());
	const report = compositor.render([{
		entries: [createEntry(0, 'effect-buffering'), createEntry(4, 'effect-ready')],
	}], { referenceWidth: 1_920, referenceHeight: 1_080 });
	assert.deepEqual(report.effects.requested, ['effect-ready']);
	assert.deepEqual(report.effects.rendered, ['effect-ready']);
	assert.equal(report.status, 'rendered');
	assert.equal(report.renderedEntryCount, 1);
	compositor.dispose();
});

test('keeps preview YUV simulation by default and exposes one raw RGBA final pass offline', () => {
	const compositor = createVideoPreviewCompositor(createStubCanvas());
	const finalPasses = [];
	compositor.draw = (_texture, target, pass) => {
		if (target === null) finalPasses.push(pass.code ?? null);
	};
	compositor.render([], { referenceWidth: 640, referenceHeight: 360 });
	compositor.render([], {
		referenceWidth: 640,
		referenceHeight: 360,
		outputWidth: 640,
		outputHeight: 360,
		outputColorModel: 'rgba',
	});
	assert.deepEqual(finalPasses, [7, null]);
	compositor.dispose();
});
