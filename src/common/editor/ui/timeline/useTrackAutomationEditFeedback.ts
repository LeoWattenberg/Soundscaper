/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useState } from 'react';

export function useTrackAutomationEditFeedback() {
	const [feedback, setFeedback] = useState('');
	const attempt = useCallback(<Result,>(operation: () => Result): Result | undefined => {
		try {
			const result = operation();
			setFeedback('');
			return result;
		} catch (error) {
			setFeedback(error instanceof Error && error.message
				? error.message
				: 'The automation edit could not be applied.');
			return undefined;
		}
	}, []);
	return Object.freeze({ feedback, attempt });
}
