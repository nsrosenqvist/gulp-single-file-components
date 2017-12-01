# gulp-single-file-components

A Gulp plugin that let's you build single file components (as made famous by Vue) and use them in other environments by splitting the vue-files into separate files.

## Prerequisites

* Works in Node 4.7.2+ with Gulp.js.

## Introduction

I created this to be able to improve how I worked with modules with Wordpress and the system I was using at the time made for a very long and complicated build process. This plugin however let me simplify the build process significantly and components were then assembled and included by a custom library.

Since I made it to meet a personal need it's not very elegant, it currently monkey-patches the package [vueify](https://www.npmjs.com/package/vueify) and hooks into its compiler. If it turns out that other people than me starts using the package I'll probably make a proper fork in the future.

## Usage

As simple as it gets:

```js
const gulp = require('gulp');
const components = require('gulp-single-file-components');

gulp.task('components', function() {
    return gulp.src('components/**/*.vue')
      .pipe(components())
      .pipe(gulp.dest('dist/'));
});    
```

The code above would output the follow vue-file into 3 different files with same name but corresponding extension:
```php
<template>
	<h1>Template</h1>
</template>

<script>
    console.log('script');
</script>

<style lang="scss">
	h1 {
		font-weight: bold;
	}
</style>
```

Since we're hooking into vueify's compiler we get [all the features from it](https://www.npmjs.com/package/vueify) as well, including support for different languages, like *SCSS* in the above example's style tag.

## Features

You can also extend the features of the plugin by passing in some options. Every option that's not handled by the plugin itself gets passed on to the vueify compiler so you can configure it too. Here's an example of adding a PHP compiler, a custom tag, and filtering the output from the default JavaScript compiler:

```js
const gulp = require('gulp');
const deindent = require('de-indent');
const indent = require('indent-string');
const components = require('gulp-single-file-components');

gulp.task('components', function() {
    return gulp.src('components/**/*.vue')
      .pipe(components({
        // We add a php compiler
        // (this get's passed on to vueify)
        customCompilers: {
          php: function (content, cb, compiler, filePath) {
            content = content.trim();

            if (content.startsWith('<?php')) {
              content = content.slice(5);
            }
            if (content.startsWith('<?')) {
              content = content.slice(2);
            }
            if (content.endsWith('?>')) {
              content = content.slice(0, -2);
            }

            let result = '<?php \n\n'+deindent(content).trim()+'\n';
            cb(null, result);
          },
        },
        // We add a custom tag named "config"
        // (this callback sets the file extension for the custom tag)
        tags: {
          config: function (lang, filePath, node) {
            if (! lang) {
              return 'ini';
            }
            else {
              return (lang === 'php') ? 'config.'+lang : lang;
            }
          },
        },
        // We wrap the default output of the vueify js compiler
        // with a self executing function
        outputModifiers: {
          script: function (content, lang) {
            return (! lang) ? '(function() { \n'+indent(content, 2)+'\n})();' : content;
          },
        }
      }))
      .pipe(gulp.dest('dist/');
});    
```

Here's an example of what the above modifications would enable. The following vue-file (example.vue):

```php
<template lang="blade.php">
	<h1>{{ $title }}</h1>
</template>

<script>
    console.log('script');
</script>

<style lang="scss">
    h1 {
        font-weight: bold;
    }
</style>

<config lang="php">
	return [
		'title' => __('Template', 'theme'),
    ];
</config>
```

Would output the following 4 files:

**example.blade.php**
```php
<h1>{{ $title }}</h1>
```
**example.js**
```js
(function() {
    "use strict";

    console.log('script');
})();
```
**example.css**
```css
h1 {
    font-weight: bold;
}
```
**example.config.php**
```php
<?php

return [
    'title' => __('Template', 'theme'),
];
```

By default the `template` tag's resulting extension is simply taken from the lang-attribute. Which is why we can output the template as blade.php without creating a custom tag handler (however it's not compiled blade, that would require a custom compiler). This can be changed by overriding the extension callback in the `tags` option. By default `style` only returns css and `script` js.

## License

MIT
