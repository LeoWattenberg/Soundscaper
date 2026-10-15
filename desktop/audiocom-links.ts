/* SPDX-License-Identifier: AGPL-3.0-only */

/** External panel links stay inside the provider and its displayed license deeds. */
export function assertAudiocomLinkUrl(value: unknown): string {
	try {
		if (typeof value !== 'string' || value.length > 8192 || value.includes('\\')) throw new TypeError();
		const url = new URL(value);
		if (url.username || url.password || url.search || url.hash) throw new TypeError();
		const match = /^https:\/\/[^/?#]+([^?#]*)$/iu.exec(value);
		if (!match) throw new TypeError();
		const rawPath = match[1] || '/';
		const provider = url.origin === 'https://audio.com' && providerPage(rawPath);
		const license = url.origin === 'https://creativecommons.org'
			&& /^(?:\/publicdomain\/zero\/1\.0\/|\/licenses\/by(?:-nc)?(?:-sa|-nd)?\/4\.0\/)$/u.test(rawPath);
		if (!provider && !license) throw new TypeError();
		return url.href;
	} catch { throw new TypeError('Invalid audio.com link'); }
}

function providerPage(path: string): boolean {
	const segments = path.split('/').slice(1);
	if (segments.at(-1) === '') segments.pop();
	if (!segments.length) return true;
	if (segments.length !== 1 && !(segments.length === 3 && segments[1] === 'audio')) return false;
	return safeSegment(segments[0] ?? '') && (segments.length === 1 || safeSegment(segments[2] ?? ''));
}

function safeSegment(value: string): boolean {
	const decoded = decodeURIComponent(value);
	return decoded.length > 0 && decoded.length <= 512 && !['.', '..'].includes(decoded)
		&& !/[\\/%]/u.test(decoded)
		&& ![...decoded].some(character => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127);
}
