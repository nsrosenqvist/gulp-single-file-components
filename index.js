"use strict";

const PLUGIN_NAME = 'gulp-single-file-components';
const PLUGIN_DEBUG = false;

// Globals
var through = require('through2');
var PluginError = require('gulp-util').PluginError;
var path = require('path');
var vinylSource = require('vinyl-source-stream');
var strStream = require('string-to-stream');
var defaults = require('defaults');

// Vueify Dependencies
var parse5 = require('parse5');
var hash = require('hash-sum');
var deindent = require('de-indent');

// Monkey-patch Vueify
let rewire = require('rewire');
let vueifyDir = path.dirname(require.resolve('vueify'));
let compilerPath = path.join(vueifyDir, 'lib/compiler.js');
var compiler = rewire(compilerPath);

// Main
module.exports = function(args) {
  debug(PLUGIN_NAME);

  // These are used to track what extension the output file should have as well as
  // what language has been identified for it
  var extensions, languages = {
    template: null,
    script: null,
    style: null,
  };

  // Process options and set defaults
  const options = defaults(args || {}, {
    outputModifiers: {},
    tags: {},
  });

  const defaultTags = {
    template: function (lang, filePath, node) {
      return lang || 'html';
    },
    script: function (lang, filePath, node) {
      return 'js';
    },
    style: function (lang, filePath, node) {
      return 'css';
    }
  }

  // Add defaultTags that haven't been overriden
  for (let tag in defaultTags) {
    if (! options.tags.hasOwnProperty(tag)) {
      options.tags[tag] = defaultTags[tag];
    }
  }

  // Handle file in stream
  return through.obj(function (file, encode, callback) {
    // Check that we can handle the stream
    if (file.isNull()) {
      return callback(null, file);
    }
    if (file.isStream()) {
      this.emit('error', new PluginError(PLUGIN_NAME, 'Streams are not supported'));
      return callback();
    }

    // Get a reference to the main file stream
    let mainStream = this;

    // Reset languages and extensions
    languages, extensions = {};

    // Pass on user configuration to Vue
    if (options) {
      compiler.applyConfig(options);
    }

    // Compile the file
    compile(file.contents.toString(), file.path, function (err, result) {
      if (err) {
        let message = 'In file ' + path.relative(process.cwd(), file.path) + ':\n' + err.message;
        mainStream.emit('error', new PluginError(PLUGIN_NAME, message));
        return callback();
      }

      let fileName = path.basename(file.path, path.extname(file.path));
      let partialPath = path.join(path.dirname(file.path), fileName);
      let streams = [];

      // Process tags
      for (let tag in options.tags) {
        if (result[tag]) {
          let content = modify(tag, result[tag], languages[tag]);
          let extension = extensions[tag] || 'txt';
          streams.push(createStream(partialPath+'.'+extension, file.base, new Buffer(content)));
        }
      }

      // Add component parts to main stream
      if (streams.length) {
        // Use the counter to verify when we're done with the last file
        let counter = streams.length;

        streams.forEach(function(stream) {
          stream.pipe(through.obj(function(part, enc, cb) {
            // Add component part to stream
            mainStream.push(part);

            // Mark as finished
            --counter || callback();
          }));
        });
      }
      else {
        callback();
      }
    });
  });

  function compile(content, filePath, cb) {
    // path is optional
    if (typeof filePath === 'function') {
      cb = filePath;
      filePath = process.cwd();
    }

    // generate css scope id
    var id = hash(filePath || content);

    // parse the file into an HTML tree
    var fragment = parse5.parseFragment(content, {locationInfo: true });

    // check node numbers
    if (! compiler.__get__('validateNodeCount')(fragment)) {
      return cb(new Error('Only one script tag and one template tag allowed per component file.'));
    }

    // check for scoped style nodes
    var hasScopedStyle = fragment.childNodes.some(function (node) {
      return node.nodeName === 'style' && compiler.__get__('isScoped')(node);
    })

    // Walk through the top level nodes and check for their
    // types & languages. If there are pre-processing needed,
    // push it into a jobs list.
    Promise.all(fragment.childNodes.map(function (node) {
      let lang = compiler.__get__('checkLang')(node) || null;

      // Save language and file extension
      for (let tag in options.tags) {
        if (node.nodeName === tag) {
          extensions[tag] = options.tags[tag](lang, filePath, node);
          languages[tag] = lang;
        }
      }

      switch (node.nodeName) {
        case 'template':
          return compiler.__get__('processTemplate')(node, filePath, id, hasScopedStyle, content);
        case 'style':
          return compiler.__get__('processStyle')(node, filePath, id);
        case 'script':
          return compiler.__get__('processScript')(node, filePath, content);
        default:
          // Process custom tag
          for (let tag in options.tags) {
            if (node.nodeName === tag) {
              return processCustom(tag, node, filePath, content);
            }
          }
      }
    })
    .filter(function (p) { return p }))
    .then(mergeParts, cb)
    .catch(cb);

    // Combine the compiler output into a standard object
    function mergeParts(parts) {
      var result = {};

      for (let tag in options.tags) {
        result[tag] = compiler.__get__('extract')(parts, tag);
      }

      cb(null, result);
    }

    // Process custom handlers
    function processCustom(tag, node, filePath, content) {
      let lang = compiler.__get__('checkLang')(node) || null;
      let custom = compiler.__get__('checkSrc')(node, filePath) || getRawCustomTemplate(node, content);

      return compiler.__get__('compileAsPromise')(tag, deindent(custom), lang, filePath);
    }

    // For some reason the custom node doesn't have a content attribute and
    // getRawTemplate from vueify errors out
    function getRawCustomTemplate(node, source) {
      var content = node;
      var l = content.childNodes.length
      if (!l) return ''
      var start = content.childNodes[0].__location.startOffset
      var end = content.childNodes[l - 1].__location.endOffset
      return source.slice(start, end)
    }
  }

  // Print to console if we're debugging
  function debug(msg) {
    if (PLUGIN_DEBUG) {
      console.log(msg);
    }
  }

  // Allow output from default compilers to be modified
  function modify(type, content, lang) {
    if (options.outputModifiers.hasOwnProperty(type)) {
      return options.outputModifiers[type](content, lang);
    }
    else {
      return content;
    }
  }

  // Add path and base to stream
  function parseStream(path, base) {
    return through.obj(function(file, encode, callback){
      file.base = base;
      file.path = path;
      return callback(null, file);
    });
  }

  // Create a stream from string
  function createStream(path, base, contents) {
    return strStream(contents).pipe(vinylSource()).pipe(parseStream(path, base));
  }
}
