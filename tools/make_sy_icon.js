'use strict';
// One-off: regenerates apps/sy_airplay/icon.png in the SY Car Data (M Track) style:
// the airplay glyph with the amber accent instead of the kit's blue.
const path = require('path');
const fs = require('fs');
const { Canvas } = require(path.join(__dirname, '..', 'kit', 'runtime', 'canvas'));
const c = new Canvas(140, 140);
const WHITE = '#f2f2f2', AMBER = '#ffb020';
// a screen with the AirPlay triangle rising into its bottom edge (make_icon.js's airplay glyph, SY colours)
c.strokeRoundRect(16, 22, 108, 76, 12, 7, WHITE);
c.convex([[70, 78], [100, 120], [40, 120]], '#000000');
c.convex([[70, 86], [94, 118], [46, 118]], AMBER);
fs.writeFileSync(path.join(__dirname, '..', 'apps', 'sy_airplay', 'icon.png'), c.png(9));
console.log('icon written (140x140, SY amber)');
