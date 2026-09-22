/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	handleFreesoundWaveformRequest,
	type FreesoundFunctionContext,
} from '../../_shared/handlers.ts';

export function onRequest(context: FreesoundFunctionContext): Promise<Response> {
	return handleFreesoundWaveformRequest(context);
}
