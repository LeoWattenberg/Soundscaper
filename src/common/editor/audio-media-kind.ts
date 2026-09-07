/* SPDX-License-Identifier: AGPL-3.0-only */

/** Legacy audio predates the kind discriminator; other media never supplies PCM. */
export function isAudioMediaKind(kind: unknown): kind is 'audio' | undefined {
	return kind === undefined || kind === 'audio';
}
