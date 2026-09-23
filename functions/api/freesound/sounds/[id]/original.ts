/* SPDX-License-Identifier: AGPL-3.0-only */

import { handleFreesoundOriginalRequest } from '../../_shared/protected-handlers.ts';
import type { FreesoundOAuthFunctionContext } from '../../_shared/oauth-http.ts';

export function onRequest(context: FreesoundOAuthFunctionContext): Promise<Response> {
	return handleFreesoundOriginalRequest(context);
}
