/* SPDX-License-Identifier: AGPL-3.0-only */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { resolveFramescaperBuildLine } from './product-build-line.mjs';

export const MOTION_LINK_BRIDGE_ENTRY = 'src/common/editor/ui/composition-link/bridge-page-entry.tsx';
export function motionLinkWebRoute(productId, environment) {
	const line = resolveFramescaperBuildLine(productId, environment.SCAPE_FRAMESCAPER_LINE);
	if (productId === 'motionscaper') return Object.freeze({ path: '/composition-link/send/', role: 'send', opener: 'same-origin-allow-popups' });
	if (productId === 'framescaper' && line === 'successor') return Object.freeze({ path: '/composition-link/receive/', role: 'receive', opener: 'unsafe-none' });
	return null;
}
export function motionLinkHeaderRule(route) {
	if (!route) return '';
	return `\n${route.path}\n\t! Cross-Origin-Opener-Policy\n\tCross-Origin-Opener-Policy: ${route.opener}\n\tPermissions-Policy: microphone=(), speaker-selection=(), display-capture=(), camera=(), geolocation=()\n\tCache-Control: no-cache\n`;
}
export async function emitMotionLinkBridgeRoute(outputRoot, routing) {
	const route = routing.compositionLink; if (!route) return;
	let moduleUrl = `/${MOTION_LINK_BRIDGE_ENTRY}`; const styles = new Set();
	try {
		const manifest = JSON.parse(await readFile(resolve(outputRoot, '.offline-build-manifest.json'), 'utf8'));
		const entry = manifest[MOTION_LINK_BRIDGE_ENTRY]; if (!entry?.file) throw new Error('Motion composition bridge entry is missing from the build.'); moduleUrl = `/${entry.file}`;
		const pending = [MOTION_LINK_BRIDGE_ENTRY]; const seen = new Set();
		while (pending.length) { const key = pending.pop(); if (seen.has(key)) continue; seen.add(key); const item = manifest[key]; for (const css of item?.css ?? []) styles.add(`/${css}`); pending.push(...item?.imports ?? []); }
	} catch (error) { if (error.code !== 'ENOENT') throw error; }
	if (![moduleUrl, ...styles].every((path) => /^\/[A-Za-z0-9/_\-.]+$/u.test(path))) throw new Error('Motion bridge module URL is invalid.');
	const html = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Composition Link</title>' + [...styles].map((path) => `<link rel="stylesheet" href="${path}">`).join('') + '</head><body><main id="composition-link-bridge"></main>'
		+ `<script type="module" src="${moduleUrl}"></script></body></html>\n`;
	const path = resolve(outputRoot, `.${route.path}index.html`); await mkdir(dirname(path), { recursive: true }); await writeFile(path, html);
}
