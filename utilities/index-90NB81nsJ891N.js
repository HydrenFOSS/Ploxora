/*
Copyright (c) 2025 ma4z

All rights reserved.

No part of this software, code, or any accompanying materials may be copied, reproduced, distributed, or used in any form without explicit written permission from the author.

This includes but is not limited to: source code, compiled code, documentation, and examples.

Violation of this license may result in legal action. You agree not to claim ownership or authorship of any portion of this software.

THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
*/
const _0x5a2f = 'c3VwZXJzZWNyZXQ=';

function _0x3c4f(data) {
  return Buffer.from(data, 'base64');
}

function _0x2b9a(buf) {
  return buf.toString('base64');
}

function _xorBuffer(buf, key) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ key[i % key.length];
  }
  return out;
}

function _0x7b8d(str) {
  const buf = Buffer.from(str, 'utf-8');
  const key = _0x3c4f(_0x5a2f);
  const xored = _xorBuffer(buf, key);
  const reversed = Buffer.from(xored).reverse(); // reverse bytes
  return _0x2b9a(reversed);
}

// Deobfuscate string
function _0x8c9e(str) {
  const buf = _0x3c4f(str);
  const reversed = Buffer.from(buf).reverse(); // reverse bytes
  const key = _0x3c4f(_0x5a2f);
  const xored = _xorBuffer(reversed, key);
  return xored.toString('utf-8');
}

module.exports = { obf: _0x7b8d, dobf: _0x8c9e };
