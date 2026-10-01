#!/usr/bin/env node
/* public/care.html is index.html with the care layer on it: the same page, the same
   scripts, plus care-core, care-api and care. It is written from index.html so the two
   never drift; `node scripts/library.js index` (which `npm test` runs) rewrites it. */
'use strict';
const fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
function write() {
  const src = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const v = (src.match(/data-v="([^"]+)"/) || [])[1] || '';
  let out = src
    .replace(/<html lang="en" data-v="([^"]+)">/, '<html lang="en" data-v="$1" data-care="1">')
    .replace(/<title>OnTrack<\/title>/, '<title>OnTrack Care</title>')
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="OnTrack Care: your physio\'s exercises on your phone, coached by the camera; a rep sent for review, answered in the app.">')
    .replace(/<a class="brand" href="#\/" aria-label="OnTrack home"><span class="wordmark">OnTrack<\/span><\/a>/, '<a class="brand" href="#/" aria-label="OnTrack home"><span class="wordmark">OnTrack</span> <span class="care-mark">care</span></a>')
    .replace(/<script src="js\/app\.js\?v=([^"]+)"><\/script>/, '<script src="js/app.js?v=$1"></script>\n<script src="care-config.js?v=$1"></script>\n<script src="js/care-core.js?v=$1"></script>\n<script src="js/care-api.js?v=$1"></script>\n<script src="js/care.js?v=$1"></script>');
  if (!/care\.js\?v=/.test(out) || !/data-care="1"/.test(out)) throw new Error('index.html has changed shape; care-page.js could not place the care layer');
  out = '<!-- GENERATED from index.html by scripts/care-page.js — edit index.html or care.js, not this file -->\n' + out;
  const file = path.join(PUB, 'care.html');
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== out) fs.writeFileSync(file, out);
  return v;
}
if (require.main === module) console.log('care.html written for version ' + write());
module.exports = { write };
