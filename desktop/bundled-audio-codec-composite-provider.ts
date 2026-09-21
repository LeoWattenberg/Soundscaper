/* SPDX-License-Identifier: AGPL-3.0-only */

/** Transport-neutral identity and capability fold for the reviewed bundled audio tier. */

import { createHash } from 'node:crypto';

import type {
	DesktopCodecOperation,
	DesktopCodecPreflightResult,
	DesktopCodecProvider,
} from '../src/common/editor/desktop-codec-coordinator.js';
import type { DesktopCodecTarget } from
	'../src/common/editor/desktop-codec-provider-catalog.js';

const IMPLEMENTATION_LABELS = Object.freeze([
	Object.freeze({ fragment: 'libflac', label: 'libflac' }),
	Object.freeze({ fragment: 'lame', label: 'lame' }),
	Object.freeze({ fragment: 'libmpg123', label: 'mpg123' }),
	Object.freeze({ fragment: 'libopus', label: 'libopus-libogg' }),
	Object.freeze({ fragment: 'twolame', label: 'twolame' }),
	Object.freeze({ fragment: 'libvorbis', label: 'libvorbis-libogg' }),
	Object.freeze({ fragment: 'wavpack', label: 'wavpack' }),
]);

export function createBundledAudioCodecCompositeProvider(options: Readonly<{
	readonly target: DesktopCodecTarget;
	readonly providers: readonly DesktopCodecProvider[];
	readonly unsupportedReason: string;
}>): DesktopCodecProvider {
	const { target, unsupportedReason } = options;
	const providers = Object.freeze([...options.providers]);
	const implementations = providers.map(({ implementation }) => implementation).sort();
	const versions = providers.map(({ version }) => version).sort();
	const generations = providers.map(({ capabilityGeneration }) => capabilityGeneration).sort();
	const labels = IMPLEMENTATION_LABELS
		.filter(({ fragment }) => implementations.some((value) => value.includes(fragment)))
		.map(({ label }) => label);
	return Object.freeze({
		kind: 'bundled',
		id: `bundled-reviewed-audio-${target}`,
		implementation: 'soundscaper-reviewed-audio-codecs',
		version: versions.join('+'),
		capabilityGeneration: `${labels.join('-')}-${digest(generations.join('\n'))}`,
		async preflight(
			operation: DesktopCodecOperation,
			preflightOptions: Readonly<{ readonly signal?: AbortSignal }>,
		): Promise<DesktopCodecPreflightResult> {
			for (const provider of providers) {
				const result = await provider.preflight(operation, preflightOptions);
				if (result.disposition === 'supported' || result.disposition === 'rejected') return result;
			}
			return Object.freeze({ disposition: 'unsupported', reason: unsupportedReason });
		},
	});
}

function digest(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
