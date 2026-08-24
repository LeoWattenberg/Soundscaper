/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed CLI projection for the separately isolated media host. */

import type {
	NativeMediaHostInvocation,
} from './native-media-helper-job.ts';

export const NATIVE_MEDIA_HOST_CONTROL_MAXIMUM_BYTES = 64 * 1024;

export function nativeMediaHostArguments(invocation: NativeMediaHostInvocation): readonly string[] {
	const args = ['--operation', invocation.operation];
	if (invocation.plan !== null) args.push('--plan', invocation.plan.path,
		'--plan-sha256', invocation.plan.sha256);
	let liveIndex = 0;
	for (const source of invocation.sources) {
		if (source.liveInput) {
			args.push(liveIndex === 0 ? '--source-stream' : '--source-stream-fd',
				liveIndex === 0 ? 'stdin' : String(liveIndex + 2));
			liveIndex += 1;
		}
		else args.push('--source', source.path!, '--source-sha256', source.sha256!);
		if (invocation.operation !== 'probe-video-source') args.push(
			'--source-byte-length', String(source.byteLength), '--source-role', source.role,
		);
	}
	for (const timing of invocation.videoTimingAssets) args.push(
		'--video-timing-asset', timing.path, '--video-timing-sha256', timing.sha256,
		'--video-timing-byte-length', String(timing.byteLength),
	);
	if (invocation.operation !== 'probe-video-source') {
		args.push('--backend', invocation.backend, '--maximum-output-bytes',
			String(invocation.maximumOutputBytes), '--scratch', invocation.scratchPath!);
		if (invocation.decodeOutputPath !== null) args.push('--decode-output', invocation.decodeOutputPath);
		else args.push('--destination-root', invocation.destinationRoot!,
			'--temporary-output', invocation.temporaryOutputPath!);
		if (invocation.proxyRecipe !== null) args.push(
			'--proxy-recipe', invocation.proxyRecipe.id,
			'--proxy-width', String(invocation.proxyRecipe.width),
			'--proxy-height', String(invocation.proxyRecipe.height),
		);
		if (invocation.imageSequence !== null) args.push(
			'--sequence-profile', invocation.imageSequence.profileId,
			'--sequence-rate-num', String(invocation.imageSequence.frameRate.num),
			'--sequence-rate-den', String(invocation.imageSequence.frameRate.den),
		);
	}
	return Object.freeze(args);
}
