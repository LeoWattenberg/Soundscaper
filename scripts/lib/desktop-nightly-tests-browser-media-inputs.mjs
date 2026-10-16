/* SPDX-License-Identifier: AGPL-3.0-only */

// Browser media fixtures are opened as data, so the import closure cannot admit
// them. Keep the original encodings at the paths their module-relative URLs use.
export const NIGHTLY_BROWSER_MEDIA_INPUTS = Object.freeze([
	{ source: 'tests/helpers/framescaper-ordinary-animation-fixture.ts', destination: 'tests/helpers/framescaper-ordinary-animation-fixture.ts', kind: 'file', label: 'ordinary animated image browser support fixture' },
	{ source: 'tests/helpers/framescaper-ordinary-high-precision-image-fixture.ts', destination: 'tests/helpers/framescaper-ordinary-high-precision-image-fixture.ts', kind: 'file', label: 'ordinary high-precision PNG browser support fixture' },
	...['desktop-preload-source.mjs', 'ordinary-cover-mp3-fixture.ts', 'native-original-import-fixture.ts', 'ordinary-ogg-opus-fixture.ts', 'ordinary-tail-m4a-fixture.ts', 'os-audio-codec-fixtures.ts', 'round7-speech-preview-bridge.ts', 'round7-warp-drums.ts'].map(file => ({
		source: `tests/helpers/${file}`, destination: `tests/helpers/${file}`, kind: 'file', label: 'ordinary browser workflow fixture support',
	})),
	{ source: 'tests/helpers/interchange-reference.ts', destination: 'tests/helpers/interchange-reference.ts', kind: 'file', label: 'external interchange reader browser support helper' },
	{ source: 'tests/helpers/framescaper-native-sidecar-fixture.ts', destination: 'tests/helpers/framescaper-native-sidecar-fixture.ts', kind: 'file', label: 'native sidecar chooser/read/save browser support fixture' },
	{ source: 'tests/helpers/libsndfile-rifx-fixture.ts', destination: 'tests/helpers/libsndfile-rifx-fixture.ts', kind: 'file', label: 'normal RIFX browser import fixture' },

	...[
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
	})),
]);
