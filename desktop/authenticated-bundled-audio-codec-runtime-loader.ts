/* SPDX-License-Identifier: AGPL-3.0-only */

/** Fail-closed authenticated loading sequence shared by the seven reviewed codecs. */

import {
	bundledAudioCodecSha256,
	yieldBundledAudioCodecMainLoop,
} from './bundled-audio-codec-runtime-support.ts';

export interface AuthenticatedBundledAudioCodecRuntimeLoadOptions<Target> {
	readonly target: Target;
	readonly readPayload?: () => Promise<Uint8Array>;
	readonly yieldControl?: () => Promise<void>;
}

export async function loadAuthenticatedBundledAudioCodecRuntime<Target, Loaded, Codec, Runtime>(
	options: AuthenticatedBundledAudioCodecRuntimeLoadOptions<Target>,
	authority: Readonly<{
		readonly codecLabel: string;
		readonly admitTarget: (value: unknown) => Target;
		readonly expectedByteLength: number;
		readonly expectedSha256: string;
		readonly readPayload: () => Promise<Uint8Array>;
		readonly instantiate: (source: Uint8Array) => Promise<Loaded>;
		readonly createCodec: (loaded: Loaded) => Codec;
		readonly verifyCanary: (codec: Codec) => void;
		readonly createRuntime: (
			target: Target, codec: Codec, yieldControl: () => Promise<void>,
		) => Runtime;
	}>,
): Promise<Runtime | null> {
	const target = authority.admitTarget(options?.target);
	if (options?.readPayload !== undefined && typeof options.readPayload !== 'function') {
		throw new TypeError(`The bundled ${authority.codecLabel} payload reader is invalid.`);
	}
	if (options?.yieldControl !== undefined && typeof options.yieldControl !== 'function') {
		throw new TypeError(`The bundled ${authority.codecLabel} scheduler is invalid.`);
	}
	try {
		const source = await (options.readPayload ?? authority.readPayload)();
		if (!(source instanceof Uint8Array) || source.byteLength !== authority.expectedByteLength
			|| bundledAudioCodecSha256(source) !== authority.expectedSha256) return null;
		const loaded = await authority.instantiate(source);
		const codec = authority.createCodec(loaded);
		authority.verifyCanary(codec);
		return authority.createRuntime(
			target, codec, options.yieldControl ?? yieldBundledAudioCodecMainLoop,
		);
	} catch {
		return null;
	}
}
