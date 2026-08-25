/* SPDX-License-Identifier: AGPL-3.0-only */

import { isFramescaperVideoProxyProjectSchema } from '../project-schema-version.ts';

export interface FramescaperVideoProxyApplicationMenuInput {
	readonly productId: string;
	readonly project: unknown;
	readonly copy: Readonly<Record<string, string>>;
	readonly open: () => unknown;
}

export interface FramescaperVideoProxyApplicationMenuItem {
	readonly id: 'video-proxy-manager';
	readonly label: string;
	readonly disabled: boolean;
	onClick(): unknown;
}

/** One opt-in entry in Edit > Clip Boundaries; never an always-visible control. */
export function createFramescaperVideoProxyApplicationMenuItems(
	input: FramescaperVideoProxyApplicationMenuInput,
): readonly FramescaperVideoProxyApplicationMenuItem[] {
	if (input.productId !== 'framescaper' || !supportedProject(input.project)) {
		return Object.freeze([]);
	}
	return Object.freeze([Object.freeze({
		id: 'video-proxy-manager' as const,
		label: input.copy.videoProxyManager || 'Video proxies…',
		disabled: false,
		onClick: input.open,
	})]);
}

function supportedProject(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const project = value as Readonly<Record<string, unknown>>;
	if (!isFramescaperVideoProxyProjectSchema(project.schemaVersion)) return false;
	return Array.isArray(project.sources) && project.sources.some((source) => (
		source && typeof source === 'object'
		&& (source as Readonly<Record<string, unknown>>).kind === 'video'
		&& Object.hasOwn(source, 'proxyAttachment')
	));
}
