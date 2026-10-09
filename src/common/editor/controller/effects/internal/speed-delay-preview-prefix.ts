/* SPDX-License-Identifier: AGPL-3.0-only */

import { delayEchoOffsetFrames } from '../../../first-party-effects/standard/delay-selection-contract.ts';

/** Constant speed echoes need later source samples without needing the rest of
 * a long recording. Carry the pinned StaffPad FFT, block and resampler support
 * backwards through every audible echo stage before cropping the source.
 */
export function speedDelayPreviewInputFrames(params: Readonly<Record<string, unknown>>,
	sampleRate: number, auditionFrames: number): number {
	if (params.pitchMode !== 'speed' || Number(params.pitchShift) <= 0 || Number(params.mix) === 0) return auditionFrames;
	const rate = 2 ** (Number(params.pitchShift) / 12);
	const fftFrames = 2 ** (12 + Math.round(Math.log2(sampleRate / 44_100)));
	// One analysis/synthesis window and two native 1024-frame blocks, with
	// the six-sample interpolation stencil at each boundary.
	const support = 2 * fftFrames + 2 * 1024 + 12;
	let required = auditionFrames;
	for (let echo = 1; echo <= Number(params.echoes); echo++) {
		const offset = delayEchoOffsetFrames(params, sampleRate, echo);
		if (offset >= auditionFrames) break;
		let echoInput = auditionFrames - offset;
		for (let stage = 0; stage < echo; stage++) echoInput = Math.ceil((echoInput + support) * rate);
		required = Math.max(required, echoInput);
	}
	return required;
}
