import React from 'react';
import ToolComingSoon from '../shared/ToolComingSoon';
import { COMING_SOON_TOOLS } from '../shared/comingSoonTools';

export default function Mockup3DTool() {
    return <ToolComingSoon {...COMING_SOON_TOOLS.mockup3d} />;
}
