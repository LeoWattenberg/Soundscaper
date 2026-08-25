/* SPDX-License-Identifier: AGPL-3.0-only */

/** Own desktop audio and video codec registrations as one lifecycle service. */

import { registerDesktopAudioCodecs } from './desktop-audio-codec-registration.mjs';
import { registerDesktopVideoCodecs } from './desktop-video-codec-registration.mjs';

export async function registerDesktopCodecProviders(options, dependencies = {}) {
	const registerAudio = dependencies.registerAudioCodecs ?? registerDesktopAudioCodecs;
	const registerVideo = dependencies.registerVideoCodecs ?? registerDesktopVideoCodecs;
	if (typeof registerAudio !== 'function' || typeof registerVideo !== 'function') {
		throw new TypeError('Desktop codec provider registration dependencies are invalid.');
	}
	const providers = [];
	try {
		providers.push(validateProvider(await registerAudio(options), 'audio'));
		providers.push(validateProvider(await registerVideo(options), 'video'));
	} catch (error) {
		const rollback = await settleProviders(providers, 'dispose');
		if (rollback.length > 0) throw new AggregateError(
			[error, ...rollback], 'Desktop codec provider registration rollback failed.', { cause: error },
		);
		throw error;
	}
	let disposal = null;
	return Object.freeze({
		async revokeOwner(owner) {
			const results = await Promise.allSettled(providers.map((provider) => provider.revokeOwner(owner)));
			const failures = rejectedReasons(results);
			if (failures.length > 0) throw new AggregateError(
				failures, 'Desktop codec provider owner revocation failed.',
			);
			return results.some((result) => result.status === 'fulfilled' && result.value === true);
		},
		dispose() {
			if (disposal !== null) return disposal;
			disposal = settleProviders(providers, 'dispose').then((failures) => {
				if (failures.length > 0) throw new AggregateError(
					failures, 'Desktop codec provider cleanup failed.',
				);
			});
			return disposal;
		},
	});
}

function validateProvider(provider, name) {
	if (!provider || typeof provider !== 'object'
		|| typeof provider.revokeOwner !== 'function' || typeof provider.dispose !== 'function') {
		throw new TypeError(`The desktop ${name} codec provider registration is invalid.`);
	}
	return provider;
}

async function settleProviders(providers, method) {
	return rejectedReasons(await Promise.allSettled(providers.map((provider) => provider[method]())));
}

function rejectedReasons(results) {
	return results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
}
