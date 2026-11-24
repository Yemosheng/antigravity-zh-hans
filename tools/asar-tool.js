// asar-tool.js — read, extract, and repack Electron asar archives (no deps)
// Usage:
//   node asar-tool.js list   <asar>
//   node asar-tool.js extract<asar> <outDir>
//   node asar-tool.js pack   <asar> <outAsar> [patchedFile ...]   (patch files given as relpath=localfile)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readHeader(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const headerSize = head.readUInt32LE(4);      // 4 + payload
  const strLen = head.readUInt32LE(12);         // json byte length
  const json = Buffer.alloc(strLen);
  fs.readSync(fd, json, 0, strLen, 16);
  const base = 8 + headerSize;
  fs.closeSync(fd);
  return { header: JSON.parse(json.toString('utf8')), base, asarPath };
}

function walk(node, prefix, out) {
  if (node.files) {
    for (const name of Object.keys(node.files)) walk(node.files[name], prefix + '/' + name, out);
  } else {
    out.push({ p: prefix.replace(/^\//, ''), node });
  }
}

function load(asarPath) {
  const { header, base } = readHeader(asarPath);
  const fd = fs.openSync(asarPath, 'r');
  const entries = [];
  walk(header, '', entries);
  const files = new Map();   // relpath -> Buffer (only packed)
  const unpacked = new Map(); // relpath -> size
  for (const e of entries) {
    if (e.node.files) continue;
    if (e.node.unpacked) { unpacked.set(e.p, e.node.size); continue; }
    if (e.node.link) { files.set(e.p, null); continue; }
    const buf = Buffer.alloc(e.node.size);
    if (e.node.size > 0) fs.readSync(fd, buf, 0, e.node.size, base + Number(e.node.offset));
    files.set(e.p, buf);
  }
  fs.closeSync(fd);
  return { header, files, unpacked, base };
}

function buildTree(files, unpacked) {
  const root = { files: {} };
  const put = (rel, nodeFactory) => {
    const parts = rel.split('/');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      cur.files[p] = cur.files[p] || { files: {} };
      cur = cur.files[p];
    }
    cur.files[parts[parts.length - 1]] = nodeFactory();
  };
  for (const [rel, buf] of files) put(rel, () => ({ buf }));
  for (const [rel, size] of unpacked) put(rel, () => ({ size, unpacked: true }));
  return root;
}

function serialize(root) {
  // assign offsets in deterministic (sorted) order
  const order = [];
  const walk2 = (node, prefix) => {
    if (node.files) {
      for (const name of Object.keys(node.files).sort()) walk2(node.files[name], prefix + '/' + name);
    } else if (node.buf !== undefined) {
      order.push({ node, prefix: prefix.replace(/^\//, '') });
    }
  };
  walk2(root, '');
  let offset = 0;
  const out = { files: {} };
  const data = [];
  // rebuild with offsets, same traversal order as data concat
  const walk3 = (node, prefix) => {
    if (node.files) {
      const o = { files: {} };
      for (const name of Object.keys(node.files).sort()) {
        const child = walk3(node.files[name], prefix + '/' + name);
        if (child !== undefined) o.files[name] = child;
      }
      return o;
    }
    if (node.buf === undefined) return { size: node.size, unpacked: true };
    const size = node.buf.length;
    const entry = { size, offset: String(offset) };
    data.push(node.buf);
    offset += size;
    return entry;
  };
  const header = walk3(root, '');
  const jsonStr = JSON.stringify(header);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const padded = Math.ceil(jsonBuf.length / 4) * 4;
  const payloadSize = 4 + padded;            // length field + padded string
  const headerSize = 4 + payloadSize;        // payload size field + payload
  const totalHeader = 8 + headerSize;
  const hb = Buffer.alloc(totalHeader, 0);
  hb.writeUInt32LE(4, 0);
  hb.writeUInt32LE(headerSize, 4);
  hb.writeUInt32LE(payloadSize, 8);
  hb.writeUInt32LE(jsonBuf.length, 12);
  jsonBuf.copy(hb, 16);
  return { headerBytes: hb, data };
}

function pack(asarPath, outPath, patched) {
  const src = load(asarPath);
  for (const [rel, file] of Object.entries(patched || {})) {
    if (!src.files.has(rel)) throw new Error('not in archive: ' + rel);
    src.files.set(rel, fs.readFileSync(file));
  }
  const root = buildTree(src.files, src.unpacked);
  const { headerBytes, data } = serialize(root);
  const fd = fs.openSync(outPath, 'w');
  fs.writeSync(fd, headerBytes);
  for (const buf of data) fs.writeSync(fd, buf);
  fs.closeSync(fd);
  return { files: src.files.size, unpacked: src.unpacked.size, headerBytes: headerBytes.length };
}

function verify(asarPath) {
  const { files, unpacked } = load(asarPath);
  let bad = 0;
  for (const [rel, buf] of files) { if (buf && buf.length === 0) bad++; }
  return { packed: files.size, unpacked: unpacked.size, emptyFiles: bad };
}

const [, , cmd, a1, a2, ...rest] = process.argv;
if (cmd === 'list') {
  const { files, unpacked } = load(a1);
  for (const p of [...files.keys()].sort()) console.log('f', p, files.get(p) ? files.get(p).length : 0);
  for (const [p, s] of [...unpacked.entries()].sort()) console.log('u', p, s);
} else if (cmd === 'extract') {
  const { files, unpacked } = load(a1);
  for (const [rel, buf] of files) {
    if (!buf) continue;
    const dst = path.join(a2, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, buf);
  }
  console.log('extracted', files.size, 'unpacked entries:', unpacked.size);
} else if (cmd === 'cat') {
  const { files } = load(a1);
  const buf = files.get(a2);
  if (!buf) { console.error('not found: ' + a2); process.exit(1); }
  fs.writeFileSync(a2 ? rest[0] : '', buf);
  console.log('wrote', a2, buf.length, 'bytes to', rest[0]);
} else if (cmd === 'pack') {
  const patched = {};
  for (const kv of rest) { const i = kv.indexOf('='); patched[kv.slice(0, i)] = kv.slice(i + 1); }
  const r = pack(a1, a2, patched);
  console.log('packed', JSON.stringify(r));
  console.log('verify', JSON.stringify(verify(a2)));
} else if (cmd === 'verify') {
  console.log(JSON.stringify(verify(a1)));
} else {
  console.log('usage: list|extract|pack|verify');
}