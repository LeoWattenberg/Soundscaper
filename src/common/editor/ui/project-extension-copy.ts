/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectFileExtensionForProduct } from '../../project-file-extensions.ts';
import { formatLocalizedTemplate } from './localization-template.ts';

/**
 * Catalog keys that name the project suffix the running product writes.
 *
 * The suffix cannot be baked into the catalogs: one catalog serves both
 * products, and a translated pack is fetched before anything knows which
 * product asked for it. Each of these strings therefore carries a
 * `{projectExtension}` placeholder, resolved here — downstream of both bundled
 * and remote translation resolution — so Soundscaper reads `.sscape` and
 * Framescaper `.fscape` from the same message.
 */
export const PROJECT_EXTENSION_COPY_KEYS = Object.freeze([
	'openScape',
	'saveScape',
	'crossProductHandoffUnavailable',
] as const);

export type ProjectExtensionCopyKey = typeof PROJECT_EXTENSION_COPY_KEYS[number];

export type ProjectExtensionCopy = Readonly<Record<ProjectExtensionCopyKey, string>>;

/**
 * Resolve every project-suffix template for `productId`. A message that has no
 * placeholder — an older remote pack, a partial test double — is passed through
 * unchanged rather than being rejected at render time.
 */
export function resolveProjectExtensionCopy(
	copy: Readonly<Record<string, unknown>>,
	productId: unknown,
): ProjectExtensionCopy {
	if (!copy || typeof copy !== 'object') throw new TypeError('Editor copy is required.');
	const projectExtension = projectFileExtensionForProduct(productId);
	const resolved: Record<string, string> = {};
	for (const key of PROJECT_EXTENSION_COPY_KEYS) {
		const template = copy[key];
		resolved[key] = typeof template === 'string' && template.includes('{projectExtension}')
			? formatLocalizedTemplate(template, { projectExtension })
			: String(template ?? '');
	}
	return Object.freeze(resolved) as ProjectExtensionCopy;
}
