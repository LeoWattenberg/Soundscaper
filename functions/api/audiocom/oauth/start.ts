/* SPDX-License-Identifier: AGPL-3.0-only */
import { handleAudiocomOAuthStartRequest } from '../_shared/oauth-handlers.ts';
import type { AudiocomOAuthFunctionContext } from '../_shared/oauth-http.ts';
export function onRequest(context: AudiocomOAuthFunctionContext): Promise<Response> { return handleAudiocomOAuthStartRequest(context); }
