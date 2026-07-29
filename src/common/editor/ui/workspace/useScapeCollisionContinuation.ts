/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
	ScapeCollisionChoice,
	ScapeCollisionRequest,
	ScapeOpenInspection,
} from '../../controller/scape-open-request-service.ts';
import {
	createScapeCollisionContinuation,
	type ScapeCollisionPrompt,
} from './scape-collision-continuation.ts';

type CollisionOwner = ReturnType<
	typeof createScapeCollisionContinuation<ScapeOpenInspection>
>;

export function useScapeCollisionContinuation() {
	const [scapeCollision, setScapeCollision] = useState<ScapeCollisionPrompt<ScapeOpenInspection> | null>(null);
	const ownerRef = useRef<CollisionOwner | null>(null);
	const getOwner = useCallback((): CollisionOwner => {
		if (!ownerRef.current) {
			ownerRef.current = createScapeCollisionContinuation({
				publish: setScapeCollision,
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

	const requestScapeCollision = useCallback((request: ScapeCollisionRequest<ScapeOpenInspection>) => (
		getOwner().request(request)
	), [getOwner]);
	const settleScapeCollision = useCallback((
		prompt: ScapeCollisionPrompt<ScapeOpenInspection>,
		choice: ScapeCollisionChoice,
	) => ownerRef.current?.settle(prompt, choice) ?? false, []);

	return Object.freeze({
		requestScapeCollision,
		scapeCollision,
		settleScapeCollision,
	});
}
