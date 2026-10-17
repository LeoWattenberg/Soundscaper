/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { appendDetailSharpenFfmpegOperationV1 } from '../src/common/editor/video-sharpen-ffmpeg-v1.ts';
import { appendClarityFfmpegOperationV1 } from '../src/common/editor/video-clarity-ffmpeg-v1.ts';

test('original alpha extraction preserves all prior sharpen transport filters and output-scoped labels byte-for-byte',()=>{
	const filters:string[]=[]; appendDetailSharpenFfmpegOperationV1({filters,inputLabel:'in',outputLabel:'out',operation:{kind:'detail-sharpen-v1',expression:'owning-neighborhood',preserveAlpha:true}});
	assert.deepEqual(filters,[
		'[in]format=pix_fmts=rgba,split=2[out_rgb_source][out_alpha_source]',
		'[out_rgb_source]format=pix_fmts=gbrp,extractplanes=r+g+b[out_r][out_g][out_b]',
		'[out_alpha_source]alphaextract[out_a]',
		'[out_a]split=2[out_weight_a][out_output_a]',
		'[out_g][out_b][out_r][out_weight_a]mergeplanes=mapping=0x00102030:format=gbrap[out_planar]',
		'[out_planar]owning-neighborhood,format=pix_fmts=rgb24[out_color]',
		'[out_color][out_output_a]alphamerge,format=pix_fmts=rgba,setpts=PTS-STARTPTS[out]',
	]);
	const clarity:string[]=[];appendClarityFfmpegOperationV1({filters:clarity,inputLabel:'in',outputLabel:'out',operation:{kind:'clarity-v1',expression:'owning-neighborhood',preserveAlpha:true}});
	assert.deepEqual(clarity,filters);
});

test('each owning alpha adapter refuses wrong process and incomplete compiled operations before graph mutation',()=>{
	for(const [kind,append] of [['detail-sharpen-v1',appendDetailSharpenFfmpegOperationV1],['clarity-v1',appendClarityFfmpegOperationV1]]as const)
		for(const operation of [{kind:'future',expression:'x',preserveAlpha:true},{kind,expression:1,preserveAlpha:true},{kind,expression:'x',preserveAlpha:false},{kind}]){
			const filters=['existing'];assert.throws(()=>append({filters,inputLabel:'in',outputLabel:'out',operation}));assert.deepEqual(filters,['existing']);
		}
});
