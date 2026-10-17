/* SPDX-License-Identifier: AGPL-3.0-only */

export const MASK_BLEND_COMPONENT_PAGE_SOURCE = String.raw`(input) => {
	if(input.width<1 || input.width>256 || input.before.length!==input.width*4 || input.candidate.length!==input.before.length || input.coverage.length!==input.width) throw new Error('Invalid bounded blend fixture.');
	const canvas=document.createElement('canvas');canvas.width=input.width;canvas.height=1;
	const gl=canvas.getContext('webgl2',{antialias:false,premultipliedAlpha:false,preserveDrawingBuffer:false});
	if(!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('Mandatory native float component context unavailable.');
	const shaders=[],textures=[],framebuffers=[],failures=[];
	const incomingWords=Uint32Array.from(input.before),candidateWords=Uint32Array.from(input.candidate);
	const incoming=new Float32Array(incomingWords.buffer),candidate=new Float32Array(candidateWords.buffer);
	const coverage=Uint8Array.from(input.coverage),output=new Float32Array(input.width*4);
	const cleanupWords=new Uint32Array(4),cleanupFloats=new Float32Array(4);
	let program,vao,result;
	const shader=(type,source)=>{const object=gl.createShader(type);if(!object)throw new Error('Shader allocation refused.');shaders.push(object);gl.shaderSource(object,source);gl.compileShader(object);if(!gl.getShaderParameter(object,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(object)||'Shader compilation refused.');return object;};
	const texture=(unit,format,type,data)=>{const object=gl.createTexture();if(!object)throw new Error('Texture allocation refused.');textures.push({object,integer:format===gl.R8UI});gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,object);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,format,input.width,1,0,format===gl.R8UI?gl.RED_INTEGER:gl.RGBA,type,data);return object;};
	try {
		const vertex=shader(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}');
		const fragment=shader(gl.FRAGMENT_SHADER,input.fragment);program=gl.createProgram();if(!program)throw new Error('Program allocation refused.');
		gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Program link refused.');gl.useProgram(program);
		vao=gl.createVertexArray();if(!vao)throw new Error('Vertex array allocation refused.');gl.bindVertexArray(vao);
		gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
		texture(0,gl.RGBA32F,gl.FLOAT,incoming);texture(1,gl.RGBA32F,gl.FLOAT,candidate);texture(2,gl.R8UI,gl.UNSIGNED_BYTE,coverage);
		const destination=texture(3,gl.RGBA32F,gl.FLOAT,null),fbo=gl.createFramebuffer();if(!fbo)throw new Error('Framebuffer allocation refused.');framebuffers.push(fbo);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,destination,0);
		if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Native blend framebuffer incomplete.');
		gl.uniform1i(gl.getUniformLocation(program,'uIncoming'),0);gl.uniform1i(gl.getUniformLocation(program,'uCandidate'),1);gl.uniform1i(gl.getUniformLocation(program,'uCoverage'),2);
		gl.uniform1i(gl.getUniformLocation(program,'uBlendPolicy'),input.uniforms.policy);gl.uniform1i(gl.getUniformLocation(program,'uCopyRed'),input.uniforms.copyRed);gl.uniform1i(gl.getUniformLocation(program,'uCopyBlue'),input.uniforms.copyBlue);
		gl.disable(gl.BLEND);gl.disable(gl.DITHER);gl.viewport(0,0,input.width,1);gl.drawArrays(gl.TRIANGLES,0,3);
		gl.readPixels(0,0,input.width,1,gl.RGBA,gl.FLOAT,output);if(gl.getError()!==gl.NO_ERROR)throw new Error('Native blend upload/draw/readback error.');
		const debug=gl.getExtension('WEBGL_debug_renderer_info');
		result={bits:Array.from(new Uint32Array(output.buffer)),draws:1,floatReadbacks:1,context:{version:String(gl.getParameter(gl.VERSION)),renderer:String(gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER))}};
	} catch(error) {failures.push(error);}
	finally {
		try {
			if(gl.isContextLost())throw new Error('Component context was lost before retirement.');
			const cleanup=gl.createFramebuffer();if(!cleanup)throw new Error('Cleanup framebuffer allocation refused.');framebuffers.push(cleanup);gl.bindFramebuffer(gl.FRAMEBUFFER,cleanup);
			for(const entry of textures){gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,entry.object,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Retirement framebuffer incomplete.');if(entry.integer)gl.clearBufferuiv(gl.COLOR,0,cleanupWords);else gl.clearBufferfv(gl.COLOR,0,cleanupFloats);}
			if(gl.getError()!==gl.NO_ERROR)throw new Error('Native component clear failed.');
		} catch(error) {failures.push(error);}
		gl.useProgram(null);gl.bindVertexArray(null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
		for(let unit=0;unit<4;unit++){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,null);}
		for(const object of framebuffers)gl.deleteFramebuffer(object);
		for(const entry of textures)gl.deleteTexture(entry.object);
		if(vao)gl.deleteVertexArray(vao);if(program)gl.deleteProgram(program);for(const object of shaders)gl.deleteShader(object);
		incoming.fill(0);candidate.fill(0);coverage.fill(0);output.fill(0);cleanupWords.fill(0);cleanupFloats.fill(0);
		if(result)result.retired={textures:textures.every(entry=>!gl.isTexture(entry.object)),framebuffers:framebuffers.every(object=>!gl.isFramebuffer(object)),program:!program||!gl.isProgram(program),shaders:shaders.every(object=>!gl.isShader(object)),vao:!vao||!gl.isVertexArray(vao),host:[incoming,candidate,coverage,output].every(view=>new Uint8Array(view.buffer).every(byte=>byte===0))};
		canvas.width=0;canvas.height=0;
	}
	if(failures.length===1)throw failures[0];if(failures.length>1)throw new AggregateError(failures,'Blend diagnostic and retirement failed.',{cause:failures[0]});return result;
}`;
