// @ts-check

import { APP_ORIGIN } from './constants.js';
import { isEditorDocumentUrl } from './validation.js';

/**
 * @typedef {Readonly<{
 *   audioRequested?: boolean,
 *   frame?: Readonly<{ url?: string }> | null,
 *   securityOrigin?: unknown,
 *   userGesture?: boolean,
 *   videoRequested?: boolean,
 * }>} SystemAudioRequest
 */

/**
 * @param {SystemAudioRequest | null | undefined} request
 * @param {Readonly<{ platform?: string }>} [options]
 */
export function acceptsSystemAudioRequest(request, { platform = process.platform } = {}) {
	if (platform !== 'win32' || request?.userGesture !== true || request.audioRequested !== true || request.videoRequested !== true) return false;
	const securityOrigin = String(request.securityOrigin || '').replace(/\/+$/u, '');
	if (securityOrigin !== APP_ORIGIN) return false;
	try {
		return isEditorDocumentUrl(request.frame?.url || '');
	} catch {
		return false;
	}
}

/**
 * @template {{ id?: unknown, name?: unknown }} Source
 * @param {SystemAudioRequest | null | undefined} request
 * @param {readonly Source[] | unknown} sources
 * @param {Readonly<{ platform?: string }>} [options]
 */
export function selectSystemAudioStreams(request, sources, options = {}) {
	if (!acceptsSystemAudioRequest(request, options)) return Object.freeze({});
	const video = (Array.isArray(sources) ? sources : []).find((source) => (
		source && typeof source.id === 'string' && source.id && typeof source.name === 'string' && source.name
	));
	return video ? Object.freeze({ video, audio: 'loopback' }) : Object.freeze({});
}
