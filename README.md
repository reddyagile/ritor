# Ritor

Ritor is a rich text (WYSIWYG) editor which focus on formatting text. Currently it is under development (not ready for production.)

The goal of Ritor is to be **modular**, **lightweight** and **minimal** with zero dependencies.

It is build using [Selection](https://developer.mozilla.org/en-US/docs/Web/API/Selection) and [Range](https://developer.mozilla.org/en-US/docs/Web/API/Range) API, avoids use of deprecated ```document.execCommand()``` method.

## Running project

```bash
$ git clone https://github.com/p9m/ritor.git
$ npm install
$ npm run dev
```

## Usage
```html
<div id="content">Write something...</div>
```
```js
const ritor = new Ritor('#content');
```

## Creating a module

```js
class Mention {
    constructor(ritor, options) {
        ritor.on('key:@', (e, value) => {
            if(value.length >= options.triggerAfterChar) {
               this.openMentionPanel();
            }
        });
    }
    openMentionPanel() {
        // Write code to display list of mentions
        // ...
    }
    handleListItemClick(item) {
        const content = this.ritor.getContent();
        content && content.insertText(item.value);
    }
}
export default Mention;
```
```js
import Mention from './Mention.js';

// Registering a module
Ritor.register('mention', Mention);

// Initializing a module
const ritor = new Ritor('#content', {
    modules: {
      mention: {
       triggerAfterChar: 3
      }
    }
});
```

## Features

- [X] Text Bold
- [X] Text Italic
- [X] Text Underline
- [X] Clear format
- [] Text color
- [] Link
- [] List (ordered and unordered)
- [] Undo and Redo
- [] Copy paste (allow inline tags)
- [] Implement custom document model
- [] Generate optimized html