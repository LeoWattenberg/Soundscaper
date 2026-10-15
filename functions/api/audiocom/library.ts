/* SPDX-License-Identifier: AGPL-3.0-only */
import { handleAudiocomLibraryRequest } from './_shared/handlers.ts';
import type { AudiocomOAuthFunctionContext } from './_shared/oauth-http.ts';
export function onRequest(context: AudiocomOAuthFunctionContext): Promise<Response> { return handleAudiocomLibraryRequest(context); }
