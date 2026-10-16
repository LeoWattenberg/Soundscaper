/* SPDX-License-Identifier: GPL-3.0-only */

type Parameters = Readonly<Record<string, unknown>>;

/** These inserts have fixed state geometry for ordinary parameter edits. */
export function isAdditionalContinuousAudacityEffect(type: string): boolean {
	return ['audacity-auto-duck', 'audacity-bass-treble', 'audacity-classic-filters',
		'audacity-distortion', 'audacity-noise-reduction', 'audacity-phaser', 'audacity-wahwah'].includes(type);
}

/** Topology controls retain their existing explicit rebuild boundary. */
export function canRetainAdditionalAudacityState(type: string, previous: Parameters, next: Parameters): boolean {
	if (!isAdditionalContinuousAudacityEffect(type)) return false;
	const topology = type === 'audacity-phaser' ? ['stages']
		: type === 'audacity-classic-filters' ? ['family', 'direction', 'order']
		: type === 'audacity-distortion' ? ['dcBlock'] : [];
	return topology.every(key => Object.is(previous[key], next[key]));
}
