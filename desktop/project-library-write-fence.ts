/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export class DesktopProjectWriteFenceConflict extends Error {
	constructor() { super('Desktop project write fence or expected document changed'); }
}

/** A main-owned writer generation. No renderer or shadow-store state participates in admission. */
export class DesktopProjectWriteFences {
	readonly #tokens = new Map<string, string>();

	claim(projectId: string): string {
		if (typeof projectId !== 'string' || !projectId || projectId.length > 512) {
			throw new TypeError('A desktop project write fence requires a project id');
		}
		const token = randomBytes(24).toString('hex');
		this.#tokens.set(projectId, token);
		return token;
	}

	revoke(projectId: string): void {
		this.#tokens.delete(projectId);
	}

	assertCurrent(projectId: string, token: string): void {
		if (typeof token !== 'string' || !/^[a-f0-9]{48}$/u.test(token)
			|| this.#tokens.get(projectId) !== token) {
			throw new DesktopProjectWriteFenceConflict();
		}
	}
}

export function assertDesktopExpectedProjectDocument(expected: unknown, document: string): void {
	let actual: unknown;
	try { actual = JSON.parse(document) as unknown; }
	catch { throw new DesktopProjectWriteFenceConflict(); }
	if (!isDeepStrictEqual(actual, expected)) throw new DesktopProjectWriteFenceConflict();
}
