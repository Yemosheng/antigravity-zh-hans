/*=== zh-hans loader: injected into dist/main.js by src/install.js ===*/
(function () {
    try {
        var fs = require('fs');
        var path = require('path');
        var os = require('os');
        var dir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Antigravity', 'zh-hans');
        var dictPath = path.join(dir, 'dict.json');
        var nativePath = path.join(dir, 'native.json');
        var injectPath = path.join(dir, 'inject.js');
        var logPath = path.join(dir, 'missing.log');
        var pendingLog = [];
        var logTimer = null;
        function flushLog() {
            logTimer = null;
            if (!pendingLog.length) return;
            try { fs.appendFileSync(logPath, pendingLog.join('\n') + '\n', 'utf8'); } catch (e) { }
            pendingLog = [];
        }
        function queueLog(msg) {
            if (pendingLog.length > 500) return;
            pendingLog.push(msg);
            if (!logTimer) logTimer = setTimeout(flushLog, 1500);
            if (typeof logTimer.unref === 'function') logTimer.unref();
        }
        function readJson(p) {
            try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
        }
        function build() {
            var body = readJson(injectPath);
            if (!body) return null;
            var dict = readJson(dictPath) || '{}';
            var nat = readJson(nativePath) || '{}';
            var tpl = readJson(path.join(dir, 'templates.json')) || '[]';
            return '(function(){var __ZH_DICT__=(' + dict + ');' +
                'var __ZH_NATIVE__=(' + nat + ');' +
                'var __ZH_TPL__=(' + tpl + ');' +
                'var __ZH_LOG__=function(m){try{console.log("__ZHMISS__"+m)}catch(e){}};' +
                body + '\n})();';
        }
        function inject(wc, frame) {
            var src = build();
            if (!src) return;
            try {
                var p = frame ? frame.executeJavaScript(src) : wc.executeJavaScript(src);
                if (p && typeof p.catch === 'function') p.catch(function () { });
            } catch (e) { }
        }
        electron_1.app.on('web-contents-created', function (_event, wc) {
            wc.on('dom-ready', function () { inject(wc); });
            wc.on('did-frame-finish-load', function (ev, isMainFrame) {
                if (isMainFrame) { inject(wc); return; }
                try {
                    var frames = wc.mainFrame.framesInSubtree || [];
                    for (var i = 0; i < frames.length; i++) inject(wc, frames[i]);
                } catch (e) { }
            });
            wc.on('console-message', function (ev, level, message) {
                var msg = (ev && typeof ev === 'object' && typeof ev.message === 'string') ? ev.message : message;
                if (typeof msg !== 'string') return;
                if (msg.indexOf('__ZHMISS__') === 0) queueLog(msg.slice(10));
                else if (msg.indexOf('__ZHERR__') === 0) queueLog('[error] ' + msg.slice(10));
            });
        });
        // Native menus / tray: translate labels whenever the app installs a menu.
        function trLabel(s) {
            if (typeof s !== 'string' || !s) return s;
            var map = {};
            try { map = JSON.parse(readJson(dictPath) || '{}'); } catch (e) { }
            try {
                var nat = JSON.parse(readJson(nativePath) || '{}');
                for (var k in nat) map[k] = nat[k];
            } catch (e) { }
            return (typeof map[s] === 'string' && map[s]) ? map[s] : s;
        }
        function walkMenu(menu) {
            try {
                if (!menu) return;
                var items = menu.items || [];
                for (var i = 0; i < items.length; i++) {
                    var it = items[i];
                    if (it && typeof it.label === 'string' && it.label) {
                        var t = trLabel(it.label);
                        if (t !== it.label) { try { it.label = t; } catch (e) { } }
                    }
                    if (it && it.submenu) walkMenu(it.submenu);
                }
            } catch (e) { }
        }
        function wrapMenuStatics() {
            try {
                var Menu = electron_1.Menu;
                var origSet = Menu.setApplicationMenu;
                if (typeof origSet === 'function' && !origSet.__zhWrapped) {
                    var wrappedSet = function (m) { try { walkMenu(m); } catch (e) { } return origSet.apply(this, arguments); };
                    wrappedSet.__zhWrapped = true;
                    Menu.setApplicationMenu = wrappedSet;
                }
                var origBuild = Menu.buildFromTemplate;
                if (typeof origBuild === 'function' && !origBuild.__zhWrapped) {
                    var wrappedBuild = function (tpl) {
                        try {
                            if (Array.isArray(tpl)) {
                                for (var i = 0; i < tpl.length; i++) {
                                    var x = tpl[i];
                                    if (x && typeof x.label === 'string') {
                                        var t = trLabel(x.label);
                                        if (t !== x.label) x = Object.assign({}, x, { label: t });
                                        tpl[i] = x;
                                    }
                                }
                            }
                        } catch (e) { }
                        return origBuild.apply(this, arguments);
                    };
                    wrappedBuild.__zhWrapped = true;
                    Menu.buildFromTemplate = wrappedBuild;
                }
                var TrayProto = electron_1.Tray && electron_1.Tray.prototype;
                if (TrayProto && typeof TrayProto.setContextMenu === 'function' && !TrayProto.setContextMenu.__zhWrapped) {
                    var origTraySet = TrayProto.setContextMenu;
                    var wrappedTraySet = function (m) { try { walkMenu(m); } catch (e) { } return origTraySet.apply(this, arguments); };
                    wrappedTraySet.__zhWrapped = true;
                    TrayProto.setContextMenu = wrappedTraySet;
                }
            } catch (e) { }
        }
        wrapMenuStatics();
        electron_1.app.whenReady().then(function () {
            setTimeout(function () {
                try { walkMenu(electron_1.Menu.getApplicationMenu()); } catch (e) { }
                try {
                    var wins = electron_1.BrowserWindow ? electron_1.BrowserWindow.getAllWindows() : [];
                    for (var i = 0; i < wins.length; i++) { try { wins[i].setTitle(wins[i].getTitle()); } catch (e) { } }
                } catch (e) { }
            }, 2500);
        }).catch(function () { });
        process.on('exit', flushLog);
    } catch (e) {
        try { console.error('[zh-hans] loader failed', e); } catch (e2) { }
    }
})();