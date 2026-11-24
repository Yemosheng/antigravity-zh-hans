'use strict';
// Installs the zh-Hans runtime translation layer into Antigravity's app.asar.
//
//   node src/install.js [--app <install dir>] [--resources <dir>] [--force] [--dry-run] [--launch]
//
// What it does:
//   1. locates <install>/resources/app.asar
//   2. copies inject.js / templates.json / native.json / merged dictionary to
//      %APPDATA%\Antigravity\zh-hans  (runtime files, editable without repacking)
//   3. backs up app.asar -> app.asar.zh-backup (once)
//   4. injects src/loader.js into dist/main.js
//   5. repacks the asar, verifies it, replaces the original
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { findInstall } = require('./detect');

const SRC = __dirname;
const ROOT = path.join(SRC, '..');
const DICT_DIR = path.join(ROOT, 'dict');
const ASAR_TOOL = path.join(ROOT, 'tools', 'asar-tool.js');

const MARKER = '/*=== zh-hans loader ===*/';
const END_MARKER = '/*=== /zh-hans loader ===*/';
const ANCHOR = 'const electron_1 = require("electron");';

function parseArgs(argv) {
    const a = { force: false, dryRun: false, launch: false, app: null };
    for (let i = 0; i < argv.length; i++) {
        const v = argv[i];
        if (v === '--force' || v === '-f') a.force = true;
        else if (v === '--dry-run') a.dryRun = true;
        else if (v === '--launch') a.launch = true;
        else if (v === '--app' || v === '--resources') a.app = argv[++i];
    }
    return a;
}

function log(...a) { console.log('[zh-hans]', ...a); }

function dataDir() {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'Antigravity', 'zh-hans');
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
        cp.execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},250)'], { stdio: 'ignore' });
    }
    return !isRunning();
}

function loadMergedDict() {
    const dict = {};
    const p1 = path.join(DICT_DIR, 'dict.json');
    const p2 = path.join(DICT_DIR, 'manual.json');
    if (fs.existsSync(p1)) Object.assign(dict, JSON.parse(fs.readFileSync(p1, 'utf8')));
    let manual = 0;
    if (fs.existsSync(p2)) {
        const m = JSON.parse(fs.readFileSync(p2, 'utf8'));
        for (const k of Object.keys(m)) { dict[k] = m[k]; manual++; }
    }
    return { dict, manual };
}

function copyRuntimeFiles() {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    const files = [
        ['src/inject.js', 'inject.js'],
        ['dict/templates.json', 'templates.json'],
        ['dict/native.json', 'native.json']
    ];
    for (const [from, to] of files) {
        fs.copyFileSync(path.join(ROOT, from), path.join(dir, to));
    }
    const { dict, manual } = loadMergedDict();
    fs.writeFileSync(path.join(dir, 'dict.json'), JSON.stringify(dict), 'utf8');
    log('runtime files ->', dir);
    log('dictionary entries:', Object.keys(dict).length, '(' + manual + ' hand-written overrides)');
    return dir;
}

function asarCat(asar, rel, out) {
    cp.execFileSync(process.execPath, [ASAR_TOOL, 'cat', asar, rel, out], { stdio: 'inherit' });
}

function stripLoader(src) {
    const start = src.indexOf(MARKER);
    if (start < 0) return src;
    const end = src.indexOf(END_MARKER, start);
    if (end >= 0) return src.slice(0, start) + src.slice(end + END_MARKER.length);
    // legacy install (loader without an end marker): cut from the marker up to the
    // first line that starts a closing IIFE — the loader is inserted as one such block.
    const tail = src.slice(start);
    const m = /\n\}\)\(\);\r?\n/.exec(tail);
    if (!m) throw new Error('main.js contains a loader but its end cannot be located. Restore app.asar from app.asar.zh-backup and retry.');
    const cut = start + m.index + m[0].length;
    return src.slice(0, start) + src.slice(cut);
}

function buildPatchedMain(pristineAsar, tmpDir) {
    const extracted = path.join(tmpDir, 'main.js');
    asarCat(pristineAsar, 'dist/main.js', extracted);
    let src = fs.readFileSync(extracted, 'utf8');
    if (!src.startsWith('"use strict"') && !src.includes('require("electron")')) {
        throw new Error('unexpected dist/main.js layout — is this really Antigravity?');
    }
    src = stripLoader(src);
    const i = src.indexOf(ANCHOR);
    if (i < 0) throw new Error('anchor `' + ANCHOR + '` not found in dist/main.js; this Antigravity build is not supported.');
    const loader = fs.readFileSync(path.join(SRC, 'loader.js'), 'utf8');
    const at = i + ANCHOR.length;
    src = src.slice(0, at) + '\n' + MARKER + '\n' + loader + (loader.endsWith('\n') ? '' : '\n') + END_MARKER + '\n' + src.slice(at);
    const out = path.join(tmpDir, 'main.patched.js');
    fs.writeFileSync(out, src, 'utf8');
    log('patched dist/main.js (+' + (src.length - fs.statSync(extracted).size) + ' bytes)');
    return out;
}

function packAsar(baseAsar, patchedMain, tmpDir) {
    const out = path.join(tmpDir, 'app.zh.asar');
    cp.execFileSync(process.execPath, [ASAR_TOOL, 'pack', baseAsar, out, 'dist/main.js=' + patchedMain], { stdio: 'inherit' });
    return out;
}

function verifyAsar(asar, tmpDir) {
    const list = cp.execFileSync(process.execPath, [ASAR_TOOL, 'list', asar], { encoding: 'utf8' });
    const entries = list.split(/\r?\n/).filter(Boolean).length;
    if (entries < 1000) throw new Error('repacked asar looks wrong (' + entries + ' entries)');
    const check = path.join(tmpDir, 'check.js');
    asarCat(asar, 'dist/main.js', check);
    const m = fs.readFileSync(check, 'utf8');
    if (!m.includes(MARKER) || !m.includes(END_MARKER)) throw new Error('patched main.js is missing the loader');
    if (!m.includes(ANCHOR)) throw new Error('patched main.js lost its original content');
    if (!/^["']?use strict/.test(m)) throw new Error('patched main.js corrupted: ' + JSON.stringify(m.slice(0, 24)));
    log('verified repacked asar (' + entries + ' entries)');
}

function replaceAsar(target, fresh) {
    const tmp = target + '.zh-new';
    const old = target + '.zh-old';
    fs.copyFileSync(fresh, tmp);
    let lastErr = null;
    for (let i = 0; i < 10; i++) {
        try {
            if (fs.existsSync(old)) fs.unlinkSync(old);
            fs.renameSync(target, old);
            fs.renameSync(tmp, target);
            fs.unlinkSync(old);
            return;
        } catch (e) {
            lastErr = e;
            try { cp.execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},200)'], { stdio: 'ignore' }); } catch (e2) { }
        }
    }
    throw lastErr || new Error('failed to replace app.asar');
}

function main() {
    const args = parseArgs(process.argv.slice(2));

    let install;
    try {
        install = findInstall(args.app);
    } catch (e) {
        console.error('[zh-hans] ' + e.message);
        process.exit(1);
    }
    const { appDir, resources, asar } = install;
    const backup = path.join(resources, 'app.asar.zh-backup');
    log('found Antigravity at', appDir, '(' + install.source + ')');

    if (isRunning()) {
        if (!args.force) {
            log('Antigravity is running. Close it first, or pass --force to close it automatically.');
            process.exit(2);
        }
        log('closing Antigravity...');
        if (!killAll()) { console.error('[zh-hans] could not close Antigravity.exe'); process.exit(3); }
    }

    if (args.dryRun) {
        log('dry run: would patch', asar);
        return;
    }

    copyRuntimeFiles();

    if (!fs.existsSync(backup)) {
        fs.copyFileSync(asar, backup);
        log('backup created:', backup, '(' + fs.statSync(backup).size + ' bytes)');
    } else {
        log('backup already present:', backup);
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-zh-'));
    try {
        const patchedMain = buildPatchedMain(backup, tmpDir);
        const fresh = packAsar(backup, patchedMain, tmpDir);
        verifyAsar(fresh, tmpDir);
        replaceAsar(asar, fresh);
        log('installed ->', asar, '(' + fs.statSync(asar).size + ' bytes)');
        log('restart Antigravity to see Chinese UI.');
        if (args.launch) {
            const exe = path.join(appDir, 'Antigravity.exe');
            if (fs.existsSync(exe)) {
                const env = Object.assign({}, process.env);
                delete env.ELECTRON_RUN_AS_NODE;
                cp.spawn(exe, [], { detached: true, stdio: 'ignore', env, cwd: appDir }).unref();
                log('launched', exe);
            }
        }
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { }
    }
}

main();