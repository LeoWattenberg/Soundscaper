/* SPDX-License-Identifier: AGPL-3.0-only */
export type MaskTextureFormatCurrentV1 = 'byte' | 'uint' | 'float';
export interface MaskTextureCurrentV1 { readonly texture: WebGLTexture; readonly format: MaskTextureFormatCurrentV1; width: number; height: number; allocated: boolean; }
export interface MaskNativeCurrentV1 {
	readonly gl: WebGL2RenderingContext;
	readonly check: () => void;
	readonly unavailable: (reason: string) => never;
	texture(format: MaskTextureFormatCurrentV1, width: number, height: number, data?: Uint8Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Float32Array<ArrayBuffer>): MaskTextureCurrentV1;
	resize(texture: MaskTextureCurrentV1, width: number, height: number, data?: Uint8Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Float32Array<ArrayBuffer>): void;
	clear(texture: MaskTextureCurrentV1): void;
	attach(texture: MaskTextureCurrentV1): void;
	program(fragment: string): WebGLProgram;
	draw(program: WebGLProgram, target: MaskTextureCurrentV1, bind: () => void): void;
	wait(): Promise<void>;
	floats(length: number): Float32Array<ArrayBuffer>;
	uints(length: number): Uint32Array<ArrayBuffer>;
}
const VERTEX = '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}';
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** All admitted work settles before cleanup. Native status failures alone are
 * capability refusals. Opaque/auth/cancel and cleanup errors remain fatal. */
export async function withMaskNativeCurrentV1<Result>(gl: WebGL2RenderingContext, checkValue: () => void,
	unavailable: (reason: string) => never, consume: (owner: Readonly<MaskNativeCurrentV1>) => Result | Promise<Result>): Promise<Result> {
	const textures: MaskTextureCurrentV1[] = [], shaders: WebGLShader[] = [], programs: WebGLProgram[] = [], fences: WebGLSync[] = [];
	const arrays: { readonly array: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>; readonly backing: ArrayBuffer; readonly length: number }[] = [], failures: unknown[] = [];
	checkValue();
	const zeroFloat = new Float32Array(4), zeroUint = new Uint32Array(4);
	arrays.push({ array: zeroFloat, backing: zeroFloat.buffer, length: 16 }, { array: zeroUint, backing: zeroUint.buffer, length: 16 });
	const saved = { program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null, vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
		draw: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null, read: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
		viewport: gl.getParameter(gl.VIEWPORT) as Int32Array, mask: gl.getParameter(gl.COLOR_WRITEMASK) as boolean[],
		flags: [gl.BLEND, gl.DITHER, gl.DEPTH_TEST, gl.SCISSOR_TEST].map(flag => ({ flag, enabled: gl.isEnabled(flag) })),
		active: Number(gl.getParameter(gl.ACTIVE_TEXTURE)), pack: Number(gl.getParameter(gl.PACK_ALIGNMENT)), unpack: Number(gl.getParameter(gl.UNPACK_ALIGNMENT)) };
	const savedTextures: (WebGLTexture | null)[] = [];
	for (let unit = 0; unit < 4; unit++) { gl.activeTexture(gl.TEXTURE0 + unit); savedTextures.push(gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null); } gl.activeTexture(saved.active);
	let live = true, framebuffer: WebGLFramebuffer | undefined, vao: WebGLVertexArrayObject | undefined, result!: Result;
	const fail = (reason: unknown) => { if (!failures.some(previous => Object.is(previous, reason))) failures.push(reason); };
	const check = () => { if (!live) throw new TypeError('Mask GL owner retired.'); checkValue(); if (gl.isContextLost()) unavailable('mask-context-lost'); if (gl.getError() !== gl.NO_ERROR) unavailable('mask-execution-unavailable'); };
	const bind = () => { if (!framebuffer) { framebuffer = gl.createFramebuffer() ?? undefined; if (!framebuffer) unavailable('mask-framebuffer-unavailable'); } gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); };
	const attach = (entry: MaskTextureCurrentV1) => {
		check(); bind(); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, entry.texture, 0);
		if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) unavailable('mask-format-unavailable');
	};
	const clear = (entry: MaskTextureCurrentV1) => {
		if (!entry.allocated) return; attach(entry);
		gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
		if (entry.format === 'float') gl.clearBufferfv(gl.COLOR, 0, zeroFloat); else gl.clearBufferuiv(gl.COLOR, 0, zeroUint);
		check();
	};
	const resize = (entry: MaskTextureCurrentV1, width: number, height: number, data?: Uint8Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Float32Array<ArrayBuffer>) => {
		check(); if (!textures.includes(entry)) throw new TypeError('Mask resize requires its owned bank.');
		if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) throw new RangeError('Mask bank requires admitted positive extent.');
		if (entry.allocated) clear(entry);
		gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, entry.texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, entry.format === 'float' ? gl.RGBA32F : entry.format === 'byte' ? gl.R8UI : gl.R32UI,
			width, height, 0, entry.format === 'float' ? gl.RGBA : gl.RED_INTEGER,
			entry.format === 'float' ? gl.FLOAT : entry.format === 'byte' ? gl.UNSIGNED_BYTE : gl.UNSIGNED_INT, data ?? null);
		entry.width = width; entry.height = height; entry.allocated = true; check();
	};
	const texture: MaskNativeCurrentV1['texture'] = (format, width, height, data) => {
		check(); const object = gl.createTexture(); if (!object) unavailable('mask-texture-unavailable');
		const entry = { texture: object, format, width: 0, height: 0, allocated: false }; textures.push(entry);
		gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, object);
		for (const name of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, name, gl.NEAREST);
		for (const name of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, name, gl.CLAMP_TO_EDGE);
		resize(entry, width, height, data); return entry;
	};
	const shader = (type: number, source: string) => {
		check(); const object = gl.createShader(type); if (!object) unavailable('mask-shader-unavailable'); shaders.push(object);
		gl.shaderSource(object, source); gl.compileShader(object);
		if (!gl.getShaderParameter(object, gl.COMPILE_STATUS)) unavailable('mask-program-unavailable'); return object;
	};
	const owner: Readonly<MaskNativeCurrentV1> = Object.freeze({ gl, check, unavailable, texture, resize, clear, attach,
		program(fragment: string) {
			const vertex = shader(gl.VERTEX_SHADER, VERTEX), pixel = shader(gl.FRAGMENT_SHADER, fragment), object = gl.createProgram();
			if (!object) unavailable('mask-program-unavailable'); programs.push(object); gl.attachShader(object, vertex); gl.attachShader(object, pixel); gl.linkProgram(object);
			if (!gl.getProgramParameter(object, gl.LINK_STATUS)) unavailable('mask-program-unavailable'); check(); return object;
		},
		draw(program: WebGLProgram, target: MaskTextureCurrentV1, upload: () => void) {
			attach(target); const previous = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
			if (!vao) { vao = gl.createVertexArray() ?? undefined; if (!vao) unavailable('mask-vao-unavailable'); }
			gl.bindVertexArray(vao); gl.useProgram(program); gl.viewport(0, 0, target.width, target.height);
			gl.disable(gl.BLEND); gl.disable(gl.DITHER); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
			try { upload(); gl.drawArrays(gl.TRIANGLES, 0, 3); check(); } finally { gl.bindVertexArray(previous); }
		},
		async wait() {
			check(); const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); if (!fence) unavailable('mask-fence-unavailable'); fences.push(fence); gl.flush();
			for (;;) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); check(); const status = gl.clientWaitSync(fence, 0, 0);
				if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) break;
				if (status !== gl.TIMEOUT_EXPIRED) unavailable('mask-fence-unavailable'); }
			gl.deleteSync(fence); fences.splice(fences.indexOf(fence), 1); check();
		},
		floats(length: number) { check(); const array = new Float32Array(length); arrays.push({ array, backing: array.buffer, length: array.byteLength }); return array; },
		uints(length: number) { check(); const array = new Uint32Array(length); arrays.push({ array, backing: array.buffer, length: array.byteLength }); return array; },
	});
	try { check(); gl.pixelStorei(gl.PACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); result = await consume(owner); check(); }
	catch (error) { fail(error); }
	const attempt = (work: () => void) => { try { work(); } catch (error) { fail(error); } };
	for (const entry of textures) if (entry.allocated && !gl.isContextLost()) attempt(() => {
		// Cleanup never converts failures into retryable capability refusals.
		bind(); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, entry.texture, 0);
		if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new TypeError('Mask bank retirement attachment failed.');
		gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
		if (entry.format === 'float') gl.clearBufferfv(gl.COLOR, 0, zeroFloat); else gl.clearBufferuiv(gl.COLOR, 0, zeroUint);
		if (gl.getError() !== gl.NO_ERROR) throw new TypeError('Mask bank retirement clear failed.');
	});
	// Join submitted zeroing before another checkpoint or the CPU proof can
	// rely on this pool's retirement. Cancellation cannot skip physical cleanup.
	if (!gl.isContextLost() && textures.some(entry => entry.allocated)) attempt(() => {
		gl.finish(); if (gl.getError() !== gl.NO_ERROR) throw new TypeError('Mask bank retirement did not complete.');
	});
	attempt(() => { gl.useProgram(null); gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null); });
	for (let unit = 0; unit < 4; unit++) attempt(() => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, null); });
	for (const fence of fences) attempt(() => { gl.deleteSync(fence); });
	if (framebuffer) attempt(() => { gl.deleteFramebuffer(framebuffer!); });
	for (const entry of textures) attempt(() => { gl.deleteTexture(entry.texture); });
	for (const program of programs) attempt(() => { gl.deleteProgram(program); });
	for (const shader of shaders) attempt(() => { gl.deleteShader(shader); });
	if (vao) attempt(() => { gl.deleteVertexArray(vao!); });
	for (const { backing, length } of arrays) attempt(() => {
		if (Reflect.apply(SIZE, backing, []) !== length) throw new TypeError('Mask native scratch detached before retirement.'); new Uint8Array(backing).fill(0);
	});
	attempt(() => {
		gl.useProgram(saved.program); gl.bindVertexArray(saved.vao); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, saved.draw); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, saved.read);
		for (let unit = 0; unit < 4; unit++) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, savedTextures[unit]!); }
		gl.viewport(saved.viewport[0]!, saved.viewport[1]!, saved.viewport[2]!, saved.viewport[3]!); gl.colorMask(saved.mask[0]!, saved.mask[1]!, saved.mask[2]!, saved.mask[3]!);
		for (const entry of saved.flags) { if (entry.enabled) gl.enable(entry.flag); else gl.disable(entry.flag); }
		gl.activeTexture(saved.active); gl.pixelStorei(gl.PACK_ALIGNMENT, saved.pack); gl.pixelStorei(gl.UNPACK_ALIGNMENT, saved.unpack);
	});
	live = false;
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Mask GL work and retirement failed.', { cause: failures[0] });
	return result;
}
