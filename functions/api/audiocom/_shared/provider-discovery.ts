/* SPDX-License-Identifier: AGPL-3.0-only */
import type { OAuthHandlerDependencies } from './oauth-handlers.ts';
import { OAuthHttpError, readUpstreamJson, type AudiocomOAuthFunctionContext } from './oauth-http.ts';
import { providerConfiguration } from './provider-config.ts';
import { providerFetch } from './provider-fetch.ts';
import { record } from './contracts.ts';

export interface AudiocityCapabilities {
	readonly projectFormats: readonly ('aup3' | 'aup4')[];
	readonly maximumUploadBytes: number;
}
export async function discoverAudiocityCapabilities(context: AudiocomOAuthFunctionContext, dependencies: OAuthHandlerDependencies = {}): Promise<AudiocityCapabilities> {
	const provider = providerConfiguration(context.env);
	if (provider.kind !== 'audiocity') return { projectFormats: [], maximumUploadBytes: 1_073_741_824 };
	const response = await providerFetch(context, dependencies, new URL('/.well-known/audiocity', provider.apiOrigin), { headers: { Accept: 'application/json' } });
	if (!response.ok) { await response.body?.cancel(); invalid(); }
	const metadata = record(await readUpstreamJson(response));
	if (metadata.name !== 'Audiocity' || metadata.url !== provider.apiOrigin || !Array.isArray(metadata.features)
		|| metadata.features.length > 64 || !metadata.features.every((item: unknown) => typeof item === 'string' && item.length <= 64)) invalid();
	const limits = record(metadata.limits);
	if (!Number.isSafeInteger(limits.max_upload_bytes) || Number(limits.max_upload_bytes) < 1) invalid();
	return {
		projectFormats: (['aup3', 'aup4'] as const).filter(format => (metadata.features as string[]).includes(`${format}-archives`)),
		maximumUploadBytes: Number(limits.max_upload_bytes),
	};
}
function invalid(): never {
	throw new OAuthHttpError(502, 'invalid_upstream_response', 'Audiocity returned invalid service capabilities.');
}
