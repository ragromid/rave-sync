const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const rootDir = path.resolve(__dirname, '..');
const srcPath = path.join(rootDir, 'public', 'app.js');
const outPath = path.join(rootDir, 'public', 'app.tv.js');
const regPath = require.resolve('regenerator-runtime/runtime.js');

const polyfills = `/* Smart TV / Older WebView Polyfills (Chrome 49+ / WebOS / Tizen) */
(function () {
  if (typeof Object.entries !== 'function') {
    Object.entries = function (obj) {
      var keys = Object.keys(obj);
      var res = new Array(keys.length);
      for (var i = 0; i < keys.length; i++) res[i] = [keys[i], obj[keys[i]]];
      return res;
    };
  }
  if (typeof Object.values !== 'function') {
    Object.values = function (obj) {
      var keys = Object.keys(obj);
      var res = new Array(keys.length);
      for (var i = 0; i < keys.length; i++) res[i] = obj[keys[i]];
      return res;
    };
  }
  if (typeof Promise !== 'undefined' && !Promise.prototype.finally) {
    Promise.prototype.finally = function (cb) {
      var P = this.constructor;
      return this.then(
        function (val) { return P.resolve(cb()).then(function () { return val; }); },
        function (err) { return P.resolve(cb()).then(function () { throw err; }); }
      );
    };
  }
  if (!Array.prototype.flat) {
    Array.prototype.flat = function (depth) {
      var d = depth === undefined ? 1 : Number(depth);
      var flatten = function (arr, lvl) {
        var out = [];
        for (var i = 0; i < arr.length; i++) {
          if (Array.isArray(arr[i]) && lvl > 0) out = out.concat(flatten(arr[i], lvl - 1));
          else out.push(arr[i]);
        }
        return out;
      };
      return flatten(this, d);
    };
  }
  if (!String.prototype.replaceAll) {
    String.prototype.replaceAll = function (search, replacement) {
      if (search instanceof RegExp) return this.replace(search, replacement);
      return this.split(String(search)).join(String(replacement));
    };
  }
  if (typeof NodeList !== 'undefined' && NodeList.prototype && !NodeList.prototype.forEach) {
    NodeList.prototype.forEach = Array.prototype.forEach;
  }
  if (typeof window.CSS === 'undefined') window.CSS = {};
  if (typeof window.CSS.escape !== 'function') {
    window.CSS.escape = function (val) {
      return String(val).replace(/([^a-zA-Z0-9_-])/g, '\\\\$1');
    };
  }
})();
`;

const source = fs.readFileSync(srcPath, 'utf8');
const regSource = fs.readFileSync(regPath, 'utf8');

const result = babel.transformSync(source, {
  filename: 'app.js',
  presets: [
    ['@babel/preset-env', {
      targets: { chrome: '49' },
      modules: false
    }]
  ],
  compact: false,
  comments: false
});

if (!result || !result.code) {
  throw new Error('Babel transform returned empty output');
}

const bundle = polyfills + '\n' + regSource + '\n' + result.code + '\n';
fs.writeFileSync(outPath, bundle, 'utf8');
console.log('Built', outPath, '(' + Math.round(bundle.length / 1024) + ' KB)');
