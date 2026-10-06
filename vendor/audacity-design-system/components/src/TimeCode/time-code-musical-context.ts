import { createContext } from 'react';

export interface TimeCodeMusicalPosition {
	readonly bar: number;
	readonly beat: number;
	readonly beatsPerBar: number;
}

export interface TimeCodeMusicalMap {
	fromSeconds(seconds: number): TimeCodeMusicalPosition;
	toSeconds(bar: number, beat: number): number;
}

/** Hosts supply their tempo and signature authority to every time display. */
export const TimeCodeMusicalContext = /* @__PURE__ */ createContext<TimeCodeMusicalMap | undefined>(undefined);
