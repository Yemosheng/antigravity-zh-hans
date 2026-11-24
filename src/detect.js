'use strict';
// Locates an Antigravity installation (the folder that contains resources/app.asar).
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function asResources(p) {
    if (!p) return null;
    try {
        if (!fs.existsSync(p)) return null;
        const asar = path.join(p, 'resources', 'app.asar');
        if (fs.existsSync(asar)) return { appDir: p, resources: path.join(p, 'resources'), asar };
        if (path.basename(p).toLowerCase() === 'resources' && fs.existsSync(path.join(p, 'app.asar'))) {
            return { appDir: path.dirname(p), resources: p, asar: path.join(p, 'app.asar') };
        }
    } catch (e) { }
    return null;
}

function regQuery(key) {
    try {
        const out = cp.execFileSync('reg', ['query', key, '/s', '/f', 'Antigravity'], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000
        });
        return out;
    } catch (e) {
        return '';
    }
}

function fromRegistry() {
    const keys = [
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    ];
    const found = [];
    for (const key of keys) {
        const out = regQuery(key);
        for (const line of out.split(/\r?\n/)) {
            let m;
            // DisplayIcon    REG_SZ    C:\...\Antigravity.exe,0
            m = /DisplayIcon\s+REG_(?:SZ|EXPAND_SZ)\s+"?([^"\r\n]+?\.exe)(?:,\d+)?"?\s*$/i.exec(line);
            if (m) { found.push(path.dirname(m[1].trim())); continue; }
            // UninstallString   REG_SZ   "C:\...\Uninstall Antigravity.exe" /currentuser
            m = /UninstallString\s+REG_SZ\s+"([^"]+?\.exe)"/i.exec(line);
            if (m) { found.push(path.dirname(m[1])); continue; }
            m = /InstallLocation\s+REG_SZ\s+"?([^"\r\n]+)"?\s*$/i.exec(line);
            if (m) { found.push(m[1].trim()); }
        }
    }
    return found;
}

function fromWellKnownDirs() {
    const roots = [];
    if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'Programs'));
    if (process.env.ProgramFiles) roots.push(process.env.ProgramFiles);
    if (process.env['ProgramFiles(x86)']) roots.push(process.env['ProgramFiles(x86)']);
    const names = ['antigravity', 'Antigravity', 'antigravity-ide', 'Antigravity IDE'];
    const out = [];
    for (const root of roots) {
        for (const n of names) out.push(path.join(root, n));
        try {
            for (const d of fs.readdirSync(root)) {
                if (/antigravity/i.test(d)) out.push(path.join(root, d));
            }
        } catch (e) { }
    }
    return out;
}

/**
 * @param {string|null} explicit  --app/--resources value
 * @returns {{appDir:string, resources:string, asar:string, source:string}}
 */
function findInstall(explicit) {
    const tried = [];
    const check = (p, source) => {
        if (!p) return null;
        const r = asResources(p);
        tried.push(p);
        if (r) return Object.assign(r, { source });
        return null;
    };

    let hit = check(explicit, 'command line');
    if (hit) return hit;
    hit = check(process.env.ANTIGRAVITY_DIR, 'ANTIGRAVITY_DIR');
    if (hit) return hit;
    hit = check(process.env.ANTIGRAVITY_RESOURCES, 'ANTIGRAVITY_RESOURCES');
    if (hit) return hit;
    for (const p of fromWellKnownDirs()) {
        hit = check(p, 'common install folder');
        if (hit) return hit;
    }
    for (const p of fromRegistry()) {
        hit = check(p, 'registry');
        if (hit) return hit;
    }

    const fallback = 'C:\\Users\\<user>\\AppData\\Local\\Programs\\antigravity';
    const err = new Error(
        'Antigravity installation not found.\n' +
        'Looked in: ' + (tried.length ? tried.join(', ') : '(none)') + '\n' +
        'Pass the install folder explicitly:  node src/install.js --app "' + fallback + '"'
    );
    err.code = 'NOT_FOUND';
    throw err;
}

module.exports = { findInstall };