/* SPDX-License-Identifier: AGPL-3.0-only */
import { documentationUrl, type DocumentationDestination } from '../../documentation-links.ts';
import type { MotionDesktopDocumentation } from '../../../../motionscaper/desktop-documentation-contract.ts';
/** Desktop receives only fixed destinations; browser navigation preserves the click gesture. */
export async function openMotionscaperDocumentation(destination: DocumentationDestination, locale: string): Promise<void> {
	const scope = globalThis as typeof globalThis & { scapeDesktop?: { v1?: { documentation?: MotionDesktopDocumentation } } };
	const bridge = scope.scapeDesktop?.v1?.documentation;
	if (bridge) await bridge.open({ destination, locale });
	else globalThis.open(documentationUrl('motionscaper', destination, locale), '_blank', 'noopener,noreferrer');
}
