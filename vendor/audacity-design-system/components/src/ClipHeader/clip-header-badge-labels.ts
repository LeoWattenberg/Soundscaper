/** LOCAL DEVIATION (see ../../../README.md): semitones with a signed label. */
export function clipPitchShiftLabel(cents: number): string {
  const semitones = (Number(cents) || 0) / 100;
  if (semitones === 0) return '';
  const magnitude = Math.abs(semitones).toFixed(2).replace(/\.?0+$/u, '');
  return `${semitones > 0 ? '+' : '-'}${magnitude}`;
}

/** A non-default speed must never be rounded back to the default's label. */
export function clipSpeedLabel(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  const displayed = rounded === 100 && percent !== 100
    ? (percent < 100 ? 99.9 : 100.1)
    : rounded;
  return `${displayed}%`;
}
