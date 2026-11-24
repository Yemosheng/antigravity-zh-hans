/* zh-hans renderer translator. Executed inside the page by main-process loader.
   Expects __ZH_DICT__ (English -> Chinese) and __ZH_LOG__ in scope. */
var DICT = __ZH_DICT__ || {};
var TPL = (typeof __ZH_TPL__ !== 'undefined' && __ZH_TPL__) ? __ZH_TPL__ : [];
var LOG = (typeof __ZH_LOG__ === 'function') ? __ZH_LOG__ : function () { };
var COMPILED = [];
for (var ti = 0; ti < TPL.length; ti++) {
    try { COMPILED.push([new RegExp(TPL[ti][0]), TPL[ti][1]]); } catch (e) { }
}
var CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, KBD: 1, SAMP: 1, VAR: 1 };
var ATTRS = ['placeholder', 'title', 'aria-label', 'aria-description', 'alt', 'aria-valuetext'];

function lookupExact(t) {
    if (!t) return null;
    if (Object.prototype.hasOwnProperty.call(DICT, t)) {
        var v = DICT[t];
        if (typeof v === 'string' && v && v !== t) return v;
    }
    return null;
}

function translateGroup(g) {
    var v = lookupExact(g);
    return v === null ? g : v;
}

function lookup(text) {
    if (!text) return null;
    var v = lookupExact(text);
    if (v !== null) return v;
    for (var i = 0; i < COMPILED.length; i++) {
        var m = COMPILED[i][0].exec(text);
        if (!m) continue;
        var rep = COMPILED[i][1];
        var out = rep.replace(/\$(\d)/g, function (all, d) {
            var g = m[parseInt(d, 10)];
            return g === undefined ? '' : translateGroup(g);
        });
        if (out && out !== text) return out;
    }
    return null;
}

var reported = Object.create(null);
var reportQueue = [];
var reportTimer = null;

function looksLikeCode(t) {
    if (t.length > 220) return true;
    if (!/[A-Za-z]/.test(t)) return true;
    if (/^(https?:\/\/|\/|\.\.?[\\/]|[A-Za-z]:\\)/.test(t)) return true;
    if (/^[0-9a-f]{16,}$/i.test(t)) return true;
    if (/@[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) return true;
    if (/^[\w.-]+\.(js|ts|json|css|png|svg|html|md|py|go)$/i.test(t)) return true;
    if (/^\s*[\{\[<]/.test(t)) return true;
    return false;
}

function report(t) {
    if (!t || reported[t]) return;
    if (looksLikeCode(t)) return;
    if (reportQueue.length > 400) return;
    reported[t] = 1;
    reportQueue.push(t);
    if (!reportTimer) {
        reportTimer = setTimeout(function () {
            reportTimer = null;
            var arr = reportQueue;
            reportQueue = [];
            for (var i = 0; i < arr.length; i++) {
                try { LOG(arr[i]); } catch (e) { }
            }
        }, 900);
    }
}

function translateTextNode(node) {
    var raw = node.nodeValue;
    if (!raw) return;
    var t = raw.trim();
    if (!t || t.length > 240) return;
    if (CJK.test(t)) return;
    var zh = lookup(t);
    if (zh === null) { report(t); return; }
    var lead = /^\s*/.exec(raw)[0];
    var trail = /\s*$/.exec(raw)[0];
    var next = lead + zh + trail;
    if (next !== raw) node.nodeValue = next;
}

function frameOf(node) {
    var el = node.parentNode;
    return el && el.nodeType === 1 ? el : null;
}

function inSkippedSubtree(el) {
    var n = el;
    var guard = 0;
    while (n && n.nodeType === 1 && guard++ < 80) {
        if (SKIP_TAGS[n.nodeName]) return true;
        if (n.getAttribute && (n.getAttribute('translate') === 'no' || n.hasAttribute('data-zh-skip'))) return true;
        if (n.isContentEditable) return true;
        n = n.parentNode;
    }
    return false;
}

function translateAttrs(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.nodeName === 'SCRIPT' || el.nodeName === 'STYLE' || el.nodeName === 'NOSCRIPT') return;
    if (el.getAttribute && (el.getAttribute('translate') === 'no' || el.hasAttribute('data-zh-skip'))) return;
    for (var i = 0; i < ATTRS.length; i++) {
        var a = ATTRS[i];
        var v = el.getAttribute && el.getAttribute(a);
        if (!v) continue;
        var t = v.trim();
        if (!t || t.length > 240 || CJK.test(t)) continue;
        var zh = lookup(t);
        if (zh !== null) {
            try { el.setAttribute(a, zh); } catch (e) { }
        }
    }
}

function composeText(el) {
    var kids = el.childNodes;
    if (!kids || kids.length < 2) return;
    var s = '';
    for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k.nodeType === 3) s += k.nodeValue;
        else if (k.nodeType === 4) s += k.nodeValue;
        else return; // has element children: skip
    }
    var t = s.trim();
    if (!t || t.length > 240 || CJK.test(t)) return;
    var zh = lookup(t);
    if (zh === null) {
        var norm = t.replace(/\s+/g, ' ');
        if (norm !== t) zh = lookup(norm);
    }
    if (zh === null) return;
    kids[0].nodeValue = zh;
    for (var j = 1; j < kids.length; j++) kids[j].nodeValue = '';
}

function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) {
        var p = node.parentNode;
        if (p && p.nodeType === 1 && !inSkippedSubtree(p)) translateTextNode(node);
        return;
    }
    if (node.nodeType !== 1) return;
    translateAttrs(node);
    if (SKIP_TAGS[node.nodeName]) return;
    if (inSkippedSubtree(node)) return;
    composeText(node);
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) walk(kids[i]);
}

var observer = null;

function startObserver() {
    if (observer) return;
    observer = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            try {
                if (r.type === 'characterData') {
                    var p = r.target.parentNode;
                    if (p && p.nodeType === 1 && !inSkippedSubtree(p)) translateTextNode(r.target);
                } else if (r.type === 'childList') {
                    for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
                } else if (r.type === 'attributes') {
                    if (r.target && r.target.nodeType === 1) translateAttrs(r.target);
                }
            } catch (e) { }
        }
    });
    observer.observe(document.documentElement || document, {
        subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ATTRS
    });
}

function boot() {
    try { document.documentElement.setAttribute('lang', 'zh-CN'); } catch (e) { }
    walk(document.body || document.documentElement);
    try {
        if (document.title) {
            var zh = lookup(document.title.trim());
            if (zh) document.title = zh;
        }
    } catch (e) { }
    startObserver();
    // React may hydrate and replace text shortly after first paint.
    var passes = 0;
    var timer = setInterval(function () {
        passes++;
        try { walk(document.body || document.documentElement); } catch (e) { }
        if (passes >= 12) clearInterval(timer);
    }, 400);
    try { window.__ZH_APPLIED__ = true; } catch (e) { }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}