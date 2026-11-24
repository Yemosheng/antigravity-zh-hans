'use strict';
// Restores the original app.asar from app.asar.zh-backup.
//
//   node src/uninstall.js [--app <install dir>] [--force] [--purge]
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { findInstall } = require('./detect');

const log = (...a) => console.log('[zh-hans]', ...a);

function parseArgs(argv) {
    const a = { force: false, purge: false, app: null };
    for (let i = 0; i < argv.length; i++) {
        const v = argv[i];
        if (v === '--force' || v === '-f') a.force = true;
        else if (v === '--purge') a.purge = true;
        else if (v === '--app' || v === '--resources') a.app = argv[++i];
    }
    return a;
}

function isRunning() {
    try {
        const out = cp.execFileSync('tasklist', ['/FI', 'IMAGENAME eq Antigravity.exe', '/NH'], { encoding: 'latin1' });
        return /Antigravity\.exe/i.test(out);
    } catch (e) { return false; }
}

function killAll() {
    try { cp.execFileSync('taskkill', ['/IM', 'Antigravity.exe', '/F', '/T'], { stdio: 'ignore' }); } catch (e) { }
    for (let i = 0; i < 60; i++) {
        if (!isRunning()) return true;
        try { cp.execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},250)'], { stdio: 'ignore' }); } catch (e) { }
    }
    return !isRunning();
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    let install;
    try { install = findInstall(args.app); } catch (e) { console.error('[zh-hans] ' + e.message); process.exit(1); }

    const backup = path.join(install.resources, 'app.asar.zh-backup');
    if (!fs.existsSync(backup)) {
        console.error('[zh-hans] no backup found at ' + backup + ' — nothing to restore.');
        process.exit(1);
    }

    if (isRunning()) {
        if (!args.force) {
            log('Antigravity is running. Close it first, or pass --force.');
            process.exit(2);
        }
        log('closing Antigravity...');
        if (!killAll()) { console.error('[zh-hans] could not close Antigravity.exe'); process.exit(3); }
    }

    const tmp = install.asar + '.zh-restore';
    fs.copyFileSync(backup, tmp);
    fs.renameSync(install.asar, install.asar + '.zh-old');
    fs.renameSync(tmp, install.asar);
    fs.unlinkSync(install.asar + '.zh-old');
    fs.unlinkSync(backup);
    log('restored original app.asar (' + fs.statSync(install.asar).size + ' bytes)');

    if (args.purge) {
        const dir = path.join(process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'), 'Antigravity', 'zh-hans');
        try { fs.rmSync(dir, { recursive: true, force: true }); log('removed', dir); } catch (e) { }
    } else {
        log('runtime files kept at %APPDATA%\\Antigravity\\zh-hans (use --purge to delete).');
    }
    log('restart Antigravity to get the English UI back.');
}

main();