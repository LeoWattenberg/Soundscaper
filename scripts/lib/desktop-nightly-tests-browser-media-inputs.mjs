/* SPDX-License-Identifier: AGPL-3.0-only */

// Browser media fixtures are opened as data, so the import closure cannot admit
// them. Keep the original encodings at the paths their module-relative URLs use.
export const NIGHTLY_BROWSER_MEDIA_INPUTS = Object.freeze([
	'bwfmetaedit-cp1252-info.wav.base64',
	'bwfmetaedit-ixml-clock.wav.base64',
	'chromium-audio-only.webm.base64',
	'ffmpeg-libmp3lame-one-second.mp3.base64',
	'libsndfile-float32.aifc.base64',
	'libsndfile-utf8-text.aiff.base64',
	'libsndfile-zero-based-cues.wav.base64',
	'python-uncompressed.aif.base64',
].map(file => ({
	source: `tests/fixtures/${file}`, destination: `tests/fixtures/${file}`,
	kind: 'file', label: 'ordinary original media browser workflow support',
})));
