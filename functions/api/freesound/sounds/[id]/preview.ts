/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	handleFreesoundPreviewRequest,
	type FreesoundFunctionContext,
} from '../../_shared/handlers.ts';

export function onRequest(context: FreesoundFunctionContext): Promise<Response> {
	return handleFreesoundPreviewRequest(context);
}
