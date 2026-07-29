/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
	ScapeOpenDecisionChoice,
	ScapeOpenDecisionRequest,
	ScapeOpenInspection,
} from '../../controller/scape-open-request-service.ts';
import {
	createScapeOpenDecisionContinuation,
	type ScapeOpenDecisionPrompt,
} from './scape-open-decision-continuation.ts';

type DecisionOwner = ReturnType<
	typeof createScapeOpenDecisionContinuation<ScapeOpenInspection>
>;

export function useScapeOpenDecisionContinuation() {
	const [scapeOpenDecision, setScapeOpenDecision] = useState<ScapeOpenDecisionPrompt<ScapeOpenInspection> | null>(null);
	const ownerRef = useRef<DecisionOwner | null>(null);
	const getOwner = useCallback((): DecisionOwner => {
		if (!ownerRef.current) {
			ownerRef.current = createScapeOpenDecisionContinuation({
				publish: setScapeOpenDecision,
			});
		}
		return ownerRef.current;
	}, []);

	useEffect(() => {
		const owner = getOwner();
		return () => {
			owner.dispose();
			if (ownerRef.current === owner) ownerRef.current = null;
		};
	}, [getOwner]);

	const requestScapeOpenDecision = useCallback((request: ScapeOpenDecisionRequest<ScapeOpenInspection>) => (
		getOwner().request(request)
	), [getOwner]);
	const settleScapeOpenDecision = useCallback((
		prompt: ScapeOpenDecisionPrompt<ScapeOpenInspection>,
		choice: ScapeOpenDecisionChoice,
	) => ownerRef.current?.settle(prompt, choice) ?? false, []);

	return Object.freeze({
		requestScapeOpenDecision,
		scapeOpenDecision,
		settleScapeOpenDecision,
	});
}
