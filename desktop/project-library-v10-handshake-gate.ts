/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperDesktopProjectLibraryV10Handshake,
	validateFramescaperDesktopProjectLibraryV10Handshake,
	type FramescaperDesktopProjectLibraryV10Handshake,
} from './project-library-v10-contract.ts';

export type FramescaperDesktopProjectLibraryV10HandshakeState =
	| 'pending'
	| 'admitted'
	| 'refused';

export interface FramescaperDesktopProjectLibraryV10HandshakeGate {
	readonly local: Readonly<FramescaperDesktopProjectLibraryV10Handshake>;
	state(): FramescaperDesktopProjectLibraryV10HandshakeState;
	accept(value: unknown): Readonly<FramescaperDesktopProjectLibraryV10Handshake>;
	assertOperational(): void;
}

/** A one-shot fail-closed gate shared by main, preload, renderer, and worker adapters. */
export function createFramescaperDesktopProjectLibraryV10HandshakeGate():
	FramescaperDesktopProjectLibraryV10HandshakeGate {
	const local = createFramescaperDesktopProjectLibraryV10Handshake();
	let state: FramescaperDesktopProjectLibraryV10HandshakeState = 'pending';
	return Object.freeze({
		local,
		state: () => state,
		accept(value: unknown) {
			if (state !== 'pending') {
				throw new Error(state === 'refused'
					? 'Framescaper desktop V10 handshake was refused.'
					: 'Framescaper desktop V10 handshake is already settled.');
			}
			try {
				const remote = validateFramescaperDesktopProjectLibraryV10Handshake(value);
				state = 'admitted';
				return remote;
			} catch (error) {
				state = 'refused';
				throw new TypeError('Framescaper desktop V10 handshake was refused.', { cause: error });
			}
		},
		assertOperational() {
			if (state === 'pending') {
				throw new Error('Framescaper desktop V10 handshake is required before operational I/O.');
			}
			if (state === 'refused') {
				throw new Error('Framescaper desktop V10 handshake was refused.');
			}
		},
	});
}
