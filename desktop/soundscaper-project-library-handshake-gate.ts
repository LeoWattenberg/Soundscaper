/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSoundscaperDesktopProjectLibraryHandshake,
	validateSoundscaperDesktopProjectLibraryHandshake,
	type SoundscaperDesktopProjectLibraryHandshake,
} from './soundscaper-project-library-contract.ts';

export type SoundscaperDesktopProjectLibraryHandshakeState =
	| 'pending'
	| 'admitted'
	| 'refused';

export interface SoundscaperDesktopProjectLibraryHandshakeGate {
	readonly local: Readonly<SoundscaperDesktopProjectLibraryHandshake>;
	state(): SoundscaperDesktopProjectLibraryHandshakeState;
	accept(value: unknown): Readonly<SoundscaperDesktopProjectLibraryHandshake>;
	assertOperational(): void;
}

/** A one-shot fail-closed gate shared by main, preload, renderer, and worker adapters. */
export function createSoundscaperDesktopProjectLibraryHandshakeGate():
	SoundscaperDesktopProjectLibraryHandshakeGate {
	const local = createSoundscaperDesktopProjectLibraryHandshake();
	let state: SoundscaperDesktopProjectLibraryHandshakeState = 'pending';
	return Object.freeze({
		local,
		state: () => state,
		accept(value: unknown) {
			if (state !== 'pending') {
				throw new Error(state === 'refused'
					? 'Soundscaper desktop baseline handshake was refused.'
					: 'Soundscaper desktop baseline handshake is already settled.');
			}
			try {
				const remote = validateSoundscaperDesktopProjectLibraryHandshake(value);
				state = 'admitted';
				return remote;
			} catch (error) {
				state = 'refused';
				throw new TypeError('Soundscaper desktop baseline handshake was refused.', { cause: error });
			}
		},
		assertOperational() {
			if (state === 'pending') {
				throw new Error('Soundscaper desktop baseline handshake is required before operational I/O.');
			}
			if (state === 'refused') {
				throw new Error('Soundscaper desktop baseline handshake was refused.');
			}
		},
	});
}
