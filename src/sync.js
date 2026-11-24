'use strict';
// Copies the translation files to %APPDATA%\Antigravity\zh-hans so an already
// installed Antigravity picks them up after a page reload (Ctrl+R).
// Use this while editing the dictionary — no asar repacking needed.
//
//   node src/sync.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DICT_DIR = path.join(ROOT, 'dict');

function dataDir() {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'Antigravity', 'zh-hans');
}

function main() {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });

    fs.copyFileSync(path.join(ROOT, 'src', 'inject.js'), path.join(dir, 'inject.js'));
    fs.copyFileSync(path.join(DICT_DIR, 'templates.json'), path.join(dir, 'templates.json'));
    fs.copyFileSync(path.join(DICT_DIR, 'native.json'), path.join(dir, 'native.json'));

    const dict = {};
    const base = path.join(DICT_DIR, 'dict.json');
    if (fs.existsSync(base)) Object.assign(dict, JSON.parse(fs.readFileSync(base, 'utf8')));
    const manualPath = path.join(DICT_DIR, 'manual.json');
    let manual = 0;
    if (fs.existsSync(manualPath)) {
        const m = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
        for (const k of Object.keys(m)) { dict[k] = m[k]; manual++; }
    }
    fs.writeFileSync(path.join(dir, 'dict.json'), JSON.stringify(dict), 'utf8');

    console.log('[zh-hans] synced to', dir);
    console.log('[zh-hans] entries:', Object.keys(dict).length, '(' + manual + ' hand-written overrides)');
    console.log('[zh-hans] press Ctrl+R in the Antigravity window to apply.');
}

main();