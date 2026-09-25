#!/usr/bin/env node
/* Bundle the meSpeak engine for the browser from the npm package.
   Usage: node scripts/vendor-mespeak.js <unpacked mespeak package dir>
   (npm pack mespeak@2.0.2 && tar xzf mespeak-2.0.2.tgz gives ./package)
   Writes public/js/vendor/mespeak/{mespeak.js,mespeak_config.json,en-us.json}. */
'use strict';
const fs = require('fs'), path = require('path');
const src = process.argv[2];
if (!src) { console.error('give the unpacked package directory'); process.exit(1); }
const out = path.join(__dirname, '..', 'public', 'js', 'vendor', 'mespeak');
fs.mkdirSync(out, { recursive: true });
const espeak = fs.readFileSync(path.join(src, 'src', 'ESpeak.js'), 'utf8');
const index = fs.readFileSync(path.join(src, 'src', 'index.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
const bundle = `/* meSpeak ${index.match(/meSpeak\s+v\.([\d.]+)/)[1]} (npm mespeak@${pkg.version}), bundled for the browser by scripts/vendor-mespeak.js.
   eSpeak and meSpeak are under the GNU GPL — see NOTICE beside this file. Not part of the app's own code. */
(function (root) {
  var espeakModule = { exports: {} };
  (function (module, exports) {
${espeak}
  })(espeakModule, espeakModule.exports);
  /* a factory rather than one instance: the engine leaks across calls (each run
     of eSpeak's main keeps what it allocated), so the page makes a fresh one
     every so often and lets the old one go */
  root.meSpeakFactory = function () {
    var mod = { exports: {} };
    (function (module, exports, require) {
${index}
    })(mod, mod.exports, function () { return espeakModule.exports; });
    return mod.exports;
  };
  root.meSpeak = root.meSpeakFactory();
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
`;
fs.writeFileSync(path.join(out, 'mespeak.js'), bundle);
fs.copyFileSync(path.join(src, 'src', 'mespeak_config.json'), path.join(out, 'mespeak_config.json'));
fs.copyFileSync(path.join(src, 'voices', 'en', 'en-us.json'), path.join(out, 'en-us.json'));
console.log('wrote', out, (bundle.length / 1e6).toFixed(2), 'MB');
