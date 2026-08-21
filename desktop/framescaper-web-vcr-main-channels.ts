/* SPDX-License-Identifier: AGPL-3.0-only */

/** Fixed pathless channels for the trusted Framescaper application document. */
export const FRAMESCAPER_WEB_VCR_CHANNELS = Object.freeze({
	handshake: 'framescaper:web-vcr:v1:handshake',
	open: 'framescaper:web-vcr:v1:open',
	dispatch: 'framescaper:web-vcr:v1:dispatch',
	prepareCapture: 'framescaper:web-vcr:v1:capture:prepare',
	setCaptureState: 'framescaper:web-vcr:v1:capture:state',
	snapshot: 'framescaper:web-vcr:v1:snapshot',
	dispose: 'framescaper:web-vcr:v1:dispose',
});
