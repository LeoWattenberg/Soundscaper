/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState } from 'react';

import EditorToast from '../EditorToast.tsx';
import {
	timedRecordingToastPresentation,
	type TimedRecordingToastRange,
} from './timed-recording-toast-model.ts';

interface TimedRecordingToastCopy {
	readonly recording: string;
	readonly timedRecordingCancel: string;
	readonly timedRecordingCurrent: string;
	readonly timedRecordingStartTime: string;
	readonly timedRecordingEnd: string;
}

interface TimedRecordingToastProps {
	readonly scheduled: TimedRecordingToastRange | null | undefined;
	readonly active: TimedRecordingToastRange | null | undefined;
	readonly copy: TimedRecordingToastCopy;
	readonly locale: string;
	readonly onCancel: () => void;
}

export default function TimedRecordingToast({ scheduled, active, copy, locale, onCancel }: TimedRecordingToastProps) {
	const [nowMs, setNowMs] = useState(Date.now);
	const visible = Boolean(scheduled || active);
	useEffect(() => {
		if (!visible) return;
		const interval = setInterval(() => setNowMs(Date.now()), 1_000);
		return () => clearInterval(interval);
	}, [visible]);
	const presentation = timedRecordingToastPresentation(scheduled, active, nowMs);
	if (!presentation) return null;
	const pending = presentation.phase === 'scheduled';
	const title = pending && scheduled
		? copy.timedRecordingCurrent.replace('{time}', new Date(scheduled.startTimeMs).toLocaleString(locale))
		: copy.recording;
	const detail = pending
		? `${copy.timedRecordingStartTime}: ${presentation.timeRemaining}`
		: presentation.timeRemaining === null
			? undefined
			: `${copy.timedRecordingEnd}: ${presentation.timeRemaining}`;
	return <EditorToast id="timed-recording" persistent type="info"
		title={title}
		timer={detail}
		actions={pending ? [{ label: copy.timedRecordingCancel, onClick: onCancel }] : []}
	/>;
}
