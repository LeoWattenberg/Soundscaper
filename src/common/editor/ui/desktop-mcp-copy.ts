/* SPDX-License-Identifier: AGPL-3.0-only */

import { DESKTOP_MCP_COPY_BY_LOCALE } from '../../i18n/editor-desktop-mcp-copy.ts';

export type DesktopMcpCopy = Readonly<{ [Key in keyof typeof DESKTOP_MCP_COPY_BY_LOCALE.en]: string }>;

export function resolveDesktopMcpCopy(
	copy: Readonly<Record<string, string | undefined>> = {},
): DesktopMcpCopy {
	const resolved: Record<string, string> = {};
	for (const [key, fallback] of Object.entries(DESKTOP_MCP_COPY_BY_LOCALE.en)) {
		const translated = copy[`ui.desktopMcp.${key}`];
		resolved[key] = typeof translated === 'string' && translated.trim() ? translated : fallback;
	}
	return Object.freeze(resolved) as DesktopMcpCopy;
}
