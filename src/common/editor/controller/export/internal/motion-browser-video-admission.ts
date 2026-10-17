/* SPDX-License-Identifier: AGPL-3.0-only */
/** Linux WebKit's native GStreamer probe can abort the page before rejecting.
 * Keep this platform unqualified; PNG uses the independent CanvasKit renderer.
 * The measured boundary and standalone reproducer are recorded in the platform qualification document.
 */
export function assertMotionBrowserVideoProbeSafe(identity: Pick<Navigator, 'platform' | 'userAgent'> | undefined = globalThis.navigator): void {
	if (identity && /^Linux\b/u.test(identity.platform) && /\bAppleWebKit\//u.test(identity.userAgent)
		&& !/\b(?:Chrome|Chromium|HeadlessChrome|Edg|OPR)\//u.test(identity.userAgent)) {
		throw new Error('Video encoding is unavailable in Linux WebKit. Choose a PNG sequence or another qualified browser.');
	}
}
