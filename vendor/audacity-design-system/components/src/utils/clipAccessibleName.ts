import { formatTimeForA11y } from './announce';

/** Authored timeline seconds may differ from the viewport's painted interval. */
export interface ClipAccessibleTiming {
	name: string;
	start: number;
	duration: number;
	timelineStartSeconds?: number;
	timelineDurationSeconds?: number;
}

export function clipAccessibleName(clip: ClipAccessibleTiming): string {
	const start = clip.timelineStartSeconds ?? clip.start;
	const duration = clip.timelineDurationSeconds ?? clip.duration;
	return `${clip.name} clip, starts at ${formatTimeForA11y(start)}, ${formatTimeForA11y(duration)} long`;
}
