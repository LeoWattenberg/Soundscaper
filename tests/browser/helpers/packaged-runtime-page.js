/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveBrowserProductTestUrl } from './browser-product-test-url.js';

const DIAGNOSTIC_PAGE_SPECS = new Set([
	'audio-editor-longform-editorial-benchmark.spec.js',
	'audio-editor-m4-production-parity.spec.js',
	'audio-editor-m4b2-keyframe-parity.spec.js',
	'audio-editor-video-preview-benchmark.spec.js',
]);

export function usesPackagedRuntimeDiagnosticPage(file) {
	if (typeof file !== 'string') throw new TypeError('Packaged-runtime spec path must be a string.');
	return DIAGNOSTIC_PAGE_SPECS.has(file.split(/[\\/]/u).at(-1));
}

export function packagedRuntimeProductBaseURL(productId, environment = process.env) {
	if (!['soundscaper', 'framescaper'].includes(productId)) {
		throw new TypeError('Packaged-runtime product ID is invalid.');
	}
	const path = productId === 'framescaper' ? '/framescaper/' : '/';
	const value = resolveBrowserProductTestUrl(path, environment);
	if (!/^https?:\/\//u.test(value)) {
		throw new Error('Packaged-runtime product origins are required.');
	}
	const url = new URL(value);
	if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
		|| url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new Error('Packaged-runtime product origins must be HTTP 127.0.0.1 roots.');
	}
	return url.href;
}
