/* SPDX-License-Identifier: AGPL-3.0-only */
import { handleAudiocomProjectDownloadRequest } from '../_shared/project-handlers.ts';
import type { AudiocomOAuthFunctionContext } from '../_shared/oauth-http.ts';
export function onRequest(context: AudiocomOAuthFunctionContext): Promise<Response> { return handleAudiocomProjectDownloadRequest(context); }
