/* SPDX-License-Identifier: AGPL-3.0-only */

import { handleFreesoundOAuthStartRequest } from '../_shared/oauth-handlers.ts';
import type { FreesoundOAuthFunctionContext } from '../_shared/oauth-http.ts';

export function onRequest(context: FreesoundOAuthFunctionContext): Promise<Response> {
	return handleFreesoundOAuthStartRequest(context);
}
