/* SPDX-License-Identifier: AGPL-3.0-only */

export function motionDocumentFileName(title: string): string {
	const safeTitle = Array.from(title, (character) => character.charCodeAt(0) < 32
		|| /[\\/:*?"<>|]/u.test(character) ? '_' : character).join('').slice(0, 160);
	return `${safeTitle || 'Motionscaper'}.mscape`;
}
