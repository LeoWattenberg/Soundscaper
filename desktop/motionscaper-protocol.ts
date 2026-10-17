/* SPDX-License-Identifier: AGPL-3.0-only */
import { MOTIONSCAPER_DESKTOP } from './motionscaper-desktop-contract.ts';
import { createIsolatedRendererProtocolHandler } from './isolated-renderer-protocol.ts';
export { isolatedRendererSecurityHeaders as motionscaperSecurityHeaders } from './isolated-renderer-protocol.ts';
/** Keep Motionscaper's renderer mount bound to its independently registered scheme. */
export function createMotionscaperProtocolHandler(rendererRoot: string) { return createIsolatedRendererProtocolHandler(rendererRoot, MOTIONSCAPER_DESKTOP.scheme); }
