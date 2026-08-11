import React from 'react';
import { figma } from '@figma/code-connect';
import { Dropdown, DropdownOption } from './Dropdown';

/**
 * Code Connect for Figma Dropdown / Outline component
 * https://www.figma.com/design/8rgC6MOTSEY1MHO4wWnucb/01---Audacity-Component-library?node-id=3085-124190
 */
figma.connect(
  Dropdown,
  'https://www.figma.com/design/8rgC6MOTSEY1MHO4wWnucb/01---Audacity-Component-library?node-id=3085-124190',
  {
    variant: { State: 'idle' },
    example: () => (
      <Dropdown
        options={[
          { value: 'option1', label: 'Option 1' },
          { value: 'option2', label: 'Option 2' },
          { value: 'option3', label: 'Option 3' },
        ]}
        placeholder="Select option"
        width="162px"
      />
    ),
  }
);

figma.connect(
  Dropdown,
  'https://www.figma.com/design/8rgC6MOTSEY1MHO4wWnucb/01---Audacity-Component-library?node-id=3085-124190',
  {
    variant: { State: 'disabled' },
    example: () => (
      <Dropdown
        options={[
          { value: 'option1', label: 'Option 1' },
          { value: 'option2', label: 'Option 2' },
        ]}
        placeholder="Select option"
        disabled={true}
        width="162px"
      />
    ),
  }
);
