/* -*- Mode: js; js-indent-level: 2; -*- */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Mozilla Source Map.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Nick Fitzgerald <nfitzgerald@mozilla.com> (original author)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */
var path = require('path');
var fs = require('fs');
var copy = require('dryice').copy;
var ujs = require('uglify-js');

function myFilter (input, sourceInfo) {
  if (!sourceInfo) {
    throw new Error('Need source info');
  }

  input = input.toString();

  var module = sourceInfo.module;
  if (!module){
    if (sourceInfo.base) {
      module = sourceInfo.path.replace(/\.js$/, '');
    } else {
      // This is not a commonjs module.
      return input;
    }
  }

  var w = ujs.uglify.ast_walker();
  var walk = w.walk;
  var ast = ujs.parser.parse(input);
  var dep;

  var walkers = {
    call: function (expr, args) {
      if (expr[0] === 'name' && expr[1] === 'define') {
        if (!(args.length === 1
              && args[0][0] === 'function'
              && args[0][2].length === 3
              && args[0][2][0] === 'require'
              && args[0][2][1] === 'exports'
              && args[0][2][2] === 'module')) {
          throw new TypeError('Only support define(function (require, exports, module) {...});');
        }
        return ['assign', true,
                ['dot', ['sub', ['name', '__MODULES'], ['string', module]], 'exports'],
                 ['binary', '||',
                  ['call', walk(args[0]),
                   [['name', 'null'],
                    ['dot',
                     ['sub', ['name', '__MODULES'], ['string', module]],
                     'exports'],
                    ['sub', ['name', '__MODULES'], ['string', module]]]],
                  ['dot', ['sub', ['name', '__MODULES'], ['string', module]], 'exports']]];
      } else if (expr[0] === 'name' && expr[1] === 'require') {
        if (args[0] && args[0][0] === "string") {
          dep = args[0][1];
          return ['dot', ['sub', ['name', '__MODULES'], ['string', dep]], 'exports'];
        } else {
          throw new TypeError('Can only require string literals');
        }
      } else {
        return ['call', expr, args];
      }
    }
  };

  var moduleDefinition = ujs.uglify.gen_code(w.with_walkers(walkers, walk.bind(w, ast)), {
    beautify: true,
    indent_level: 2
  });

  return '__MODULES["' + module + '"] = { exports: {} };\n' + moduleDefinition + '\n\n';
}

myFilter.onRead = true;

var topologicalSort = (function () {

  function sourcesDependingOn(target, sources) {
    var results = [];
    for (var i = 0; i < sources.length; i++) {
      if (sources[i].deps) {
        if (Object.keys(sources[i].deps).indexOf(target.module) >= 0) {
          results.push(sources[i]);
        }
      }
    }
    return results;
  }

  function hasNoDeps(s) {
    return !s.deps || Object.keys(s.deps).length === 0;
  }

  return function (sources) {
    var sorted = [];
    var sourcesWithNoDeps = sources.filter(hasNoDeps);

    var n;
    while ( sourcesWithNoDeps.length > 0 ) {
      n = sourcesWithNoDeps.pop();
      sorted.push(n);
      sourcesDependingOn(n, sources).forEach(function (m) {
        if (!delete m.deps[n.module]) {
          throw new TypeError('Cannot remove dependency');
        }
        if (hasNoDeps(m)) {
          sourcesWithNoDeps.push(m);
        }
      });
    }

    if (sources.filter(hasNoDeps).length !== sources.length) {
      throw new Error("There is at least one type of circular dependency. Can't build.");
    }

    return sorted;
  };

}());



function buildBrowser() {
  console.log('Creating dist/source-map.js');

  var project = copy.createCommonJsProject({
    roots: [ path.join(__dirname, 'lib') ]
  });

  copy({
    source: [
      'build/prefix-source-map.js',
      topologicalSort(copy.source.commonjs({
        project: project,
        require: [ 'source-map' ]
      })()),
      'build/suffix-source-map.js'
    ],
    filter: myFilter,
    dest: 'dist/source-map.js'
  });
}

function buildBrowserMin() {
  console.log('Creating dist/source-map.min.js');

  copy({
    source: 'dist/source-map.js',
    filter: copy.filter.uglifyjs,
    dest: 'dist/source-map.min.js'
  });
}

function buildFirefox() {
  console.log('Creating dist/SourceMapConsumer.jsm');

  var project = copy.createCommonJsProject({
    roots: [ path.join(__dirname, 'lib') ]
  });

  copy({
    source: [
      'build/prefix-source-map-consumer.jsm',
      topologicalSort(copy.source.commonjs({
        project: project,
        require: [ 'source-map/source-map-consumer' ]
      })()),
      'build/suffix-source-map-consumer.jsm'
    ],
    filter: myFilter,
    dest: 'dist/SourceMapConsumer.jsm'
  });
}

var dirExists = false;
try {
  dirExists = fs.statSync('dist').isDirectory();
} catch (err) {}

if (!dirExists) {
  fs.mkdirSync('dist', 0777);
}

buildFirefox();
buildBrowser();
buildBrowserMin();
