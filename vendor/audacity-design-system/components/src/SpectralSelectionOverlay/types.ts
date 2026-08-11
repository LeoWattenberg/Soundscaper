/**
 * Shared types for spectral selection components
 */

import { SpectralSelection } from '@audacity-ui/core';

export type { SpectralSelection };

export interface Track {
  clips: Array<{
    id: number | string;
    start: number;
    duration: number;
  }>;
}
