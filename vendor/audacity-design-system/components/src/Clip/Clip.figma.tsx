import React from 'react';
import figma from '@figma/code-connect';
import { Clip } from './Clip';

/**
 * Figma Code Connect for Clip component
 * Links the Clip component to its Figma design
 */
figma.connect(
  Clip,
  'https://www.figma.com/design/8rgC6MOTSEY1MHO4wWnucb/01---Audacity-Component-library?node-id=1774-128030',
  {
    example: () => (
      <Clip
        color="blue"
        selected={false}
        name="Audio Clip"
        width={224}
        height={104}
        waveformData={[/* waveform data */]}
      />
    ),
  }
);
