/* SPDX-License-Identifier: AGPL-3.0-only */

import { handleFreesoundOAuthPollRequest } from '../_shared/oauth-handlers.ts';
import type { FreesoundOAuthFunctionContext } from '../_shared/oauth-http.ts';

export function onRequest(context: FreesoundOAuthFunctionContext): Promise<Response> {
	return handleFreesoundOAuthPollRequest(context);
}
