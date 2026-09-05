/* SPDX-License-Identifier: AGPL-3.0-only */

// One table for every Node process that serves a built site or a staged
// payload, so a browser suite and the packaged nightly runtime label the same
// file the same way.
export const STATIC_SITE_CONTENT_TYPES = Object.freeze({
	'.avif': 'image/avif', '.css': 'text/css; charset=utf-8',
	'.gif': 'image/gif', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
	'.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
	'.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.png': 'image/png', '.svg': 'image/svg+xml',
	'.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
	'.wav': 'audio/wav', '.webm': 'video/webm',
	'.webmanifest': 'application/manifest+json; charset=utf-8', '.webp': 'image/webp',
	'.woff': 'font/woff', '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8',
});

/** The content type for one file extension, falling back to an opaque byte stream. */
export function staticSiteContentType(extension) {
	return STATIC_SITE_CONTENT_TYPES[String(extension).toLowerCase()] ?? 'application/octet-stream';
}
