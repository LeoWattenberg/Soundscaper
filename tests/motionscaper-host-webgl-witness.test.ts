/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { probeMotionHostWebGl } from './browser/helpers/motionscaper-host-webgl.ts';

function fixture(options: { absent?: boolean; missing?: string; fault?: 'allocation' | 'framebuffer' | 'readback' | 'error' } = {}) {
	const deleted: string[] = []; let sample = new Float32Array(4);
	const gl = {
		TEXTURE_2D: 1, RGBA32F: 2, RGBA8: 3, FRAMEBUFFER: 4, COLOR_ATTACHMENT0: 5, FRAMEBUFFER_COMPLETE: 6, COLOR: 7, RGBA: 8, FLOAT: 9, UNSIGNED_BYTE: 10, NO_ERROR: 0,
		getExtension(name: string) { return name === options.missing ? null : { loseContext() { deleted.push('context'); } }; },
		createTexture: () => options.fault === 'allocation' ? null : {}, createFramebuffer: () => ({}),
		bindTexture() {}, texStorage2D() {}, bindFramebuffer() {}, framebufferTexture2D() {},
		checkFramebufferStatus: () => options.fault === 'framebuffer' ? 0 : 6,
		clearBufferfv(_buffer: number, _index: number, value: Float32Array) { sample = new Float32Array(value); },
		readPixels(_x: number, _y: number, _width: number, _height: number, _format: number, _type: number, pixels: Float32Array | Uint8Array) {
			pixels.set(pixels instanceof Uint8Array ? [32, 64, 128, 255] : sample);
			if (options.fault === 'readback') pixels[0] = 0;
		},
		getError: () => options.fault === 'error' ? 123 : 0,
		deleteFramebuffer() { deleted.push('framebuffer'); }, deleteTexture() { deleted.push('texture'); },
	} as unknown as WebGL2RenderingContext;
	return { deleted, canvas: () => ({ getContext: () => options.absent ? null : gl }) };
}

test('Motion host witness declares only native context and required extension absence unqualified', () => {
	for (const [options, requirements, reason] of [
		[{ absent: true }, {}, 'Host WebGL2 is unavailable'],
		[{ missing: 'EXT_color_buffer_float' }, { floatTarget: true }, 'Host EXT_color_buffer_float is unavailable'],
		[{ missing: 'WEBGL_lose_context' }, { contextLoss: true }, 'Host WEBGL_lose_context is unavailable'],
	] as const) {
		const host = fixture(options);
		assert.deepEqual(probeMotionHostWebGl(requirements, host.canvas), { available: false, reason });
	}
	const host = fixture({ missing: 'EXT_color_buffer_float' });
	assert.equal(probeMotionHostWebGl({}, host.canvas).available, true);
});

test('Motion host witness refuses allocated target and readback failures instead of declaring a skip', () => {
	for (const fault of ['allocation', 'framebuffer', 'readback', 'error'] as const) {
		const host = fixture({ fault });
		assert.throws(() => probeMotionHostWebGl({ floatTarget: true }, host.canvas), /Host WebGL2 witness/u);
		assert.ok(host.deleted.includes('context'));
		assert.ok(host.deleted.includes('framebuffer'));
		if (fault !== 'allocation') assert.ok(host.deleted.includes('texture'));
	}
	const error = new Error('native getContext failure');
	assert.throws(() => probeMotionHostWebGl({}, () => ({ getContext() { throw error; } })), value => value === error);
});

test('Motion host witness verifies exact float and byte targets and releases each owned resource', () => {
	for (const floatTarget of [false, true]) {
		const host = fixture();
		assert.equal(probeMotionHostWebGl({ floatTarget, contextLoss: true }, host.canvas).available, true);
		assert.deepEqual(host.deleted, ['framebuffer', 'texture', 'context']);
	}
});
