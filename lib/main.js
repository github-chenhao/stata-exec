'use strict';

const { CompositeDisposable, Point, Range } = require('atom');
const path = require('path');
const fs = require('fs');
const sendCode = require('./sendCode');

const apps = {
  stataMP: 'StataMP',
  stata: 'Stata',
  stataIC: 'StataIC',
  stataSE: 'StataSE',
  xquartz: 'XQuartz'
};

module.exports = {
  config: {
    whichApp: {
      type: 'string',
      enum: [apps.stataMP, apps.stataSE, apps.stata, apps.stataIC, apps.xquartz],
      default: apps.stataSE,
      description: 'Which application to send code to. Only applicable for MacOS. The StataIC executable is currently named `Stata`, so try choosing that if you\'re having issues.',
      order: 2
    },
    advancePosition: {
      type: 'boolean',
      default: false,
      order: 4,
      description: 'Cursor advances to the next line after ' +
        'sending the current line when there is no selection'
    },
    skipComments: {
      type: 'boolean',
      default: true,
      order: 5,
      description: 'When "advancePosition" is true, skip lines that contain ' +
        'only comments'
    },
    focusWindow: {
      type: 'boolean',
      default: true,
      order: 3,
      description: 'After code is sent, bring focus to where it was sent'
    },
    pasteSpeed: {
      type: 'number',
      default: 1.0,
      minimum: 0.1,
      maximum: 10,
      order: 7,
      description: 'This is only applicable for XQuartz. This value changes the amount of time the program waits between switching to the XQuartz window, pasting code, and sending "enter". The only way to send code to XQuartz is to use the clipboard, and the responsiveness of sending code will depend on the speed of your internet connection. If the copy-pasting isn\'t working, try increasing the value. Decreasing the value will run your code faster. Value must be between 0.1 and 10.'
    },
    stataPath: {
      type: 'string',
      description: 'Absolute path to Stata executable. Only applicable for Windows.',
      default: 'C:\\Program Files (x86)\\Stata15\\StataSE-64.exe',
      order: 1,
    },
    allowSave: {
      type: 'boolean',
      default: true,
      description: 'Save file automatically before running "Run All"'
    }
  },

  subscriptions: null,

  activate(state) {
    this.subscriptions = new CompositeDisposable();

    this.subscriptions.add(atom.commands.add('atom-text-editor',
      'stata-exec:run', () => this.run()));
    this.subscriptions.add(atom.commands.add('atom-text-editor',
      'stata-exec:run-and-move-down', () => this.run(true)));
    this.subscriptions.add(atom.commands.add('atom-text-editor',
      'stata-exec:run-previous-command', () => this.runPreviousCommand()));
    this.subscriptions.add(atom.commands.add('atom-text-editor',
      'stata-exec:run-all', () => this.runAll()));
    this.subscriptions.add(atom.commands.add('atom-text-editor',
      'stata-exec:run-batch', () => this.run(false, true)));
    this.subscriptions.add(atom.commands.add('atom-text-editor', 'stata-exec:run-paragraph', () => this.runParagraph()));
    this.subscriptions.add(atom.commands.add('atom-text-editor', 'stata-exec:run-program', () => this.runFunction()));
    return this.subscriptions.add(atom.commands.add('atom-text-editor',
      'stata-exec:set-working-directory', () => this.setWorkingDirectory()));
  },

  deactivate() {
    return this.subscriptions.dispose();
  },

  _getEditorAndBuffer() {
    const editor = atom.workspace.getActiveTextEditor();
    const buffer = editor.getBuffer();
    return [editor, buffer];
  },

  runAll() {
    const whichApp = atom.config.get('stata-exec.whichApp');
    var msg = '';
    if (whichApp == "XQuartz") {
      this.error('Running entire do file not supported for XQuartz');
      return;
    }

    const [editor, buffer] = this._getEditorAndBuffer();
    if (atom.config.get('stata-exec.allowSave')) {
      editor.save();
    }
    const documentTitle = editor.getPath();
    if (!documentTitle) {
      this.error('Error: File not yet saved.');
      return;
    }
    const doFileCommand = `do \`"${documentTitle}"'`;
    return sendCode.send(doFileCommand);
  },

  run(advancePosition=false, batch=false) {
    const whichApp = atom.config.get('stata-exec.whichApp');
    const [editor, buffer] = this._getEditorAndBuffer();
    // we store the current position so that we can jump back to it later
    // (if the user wants to)
    const currentPosition = editor.getLastSelection().getScreenRange().end;
    const selections = this.getSelections();
    const texts = selections.texts;

    for (var i = 0; i < texts.length; i++) {
      if (batch) {
        this.runBatch(texts[i]);
      } else {
        // For interactive code (i.e. copy-pasted code) need to make sure there
        // are no block comments or ///.
        sendCode.send(this.removeComments(texts[i]));
      }
    }

    if (atom.config.get('stata-exec.advancePosition') === true) {
      advancePosition = true;
    }
    if (advancePosition && !selections.anySelection) {
      let nextPosition = this._findForward(this.nonEmptyLine, currentPosition.row + 1);
      if (nextPosition != null) {
        if (nextPosition == null) { nextPosition = [currentPosition + 1, 0]; }
        editor.setCursorScreenPosition(nextPosition);
        return editor.moveToFirstCharacterOfLine();
      }
    } else {
      if (!selections.anySelection) {
        return editor.setCursorScreenPosition(currentPosition);
      }
    }
  },

  runBatch(text) {
    var codepath = path.join(process.env.HOME, '.stata-exec_batch_code');
    if (process.platform == 'win32') {
      var eol = '\r\n'
    } else {
      var eol = '\n'
    }
    if (text.substr(text.length - 1) !== '\n') {
      text += eol;
    }
    fs.writeFile(codepath, text, function(err) {
      if(err) {
        return console.log(err);
      }
      console.log(`The batch code was saved to ${codepath}!`);
      sendCode.send(`do \`"${codepath}"'`);
    });
  },

  removeComments(text) {
    console.log('code with comments: ' + text);
    text = text.replace(/((["'])(?:\\[\s\S]|.)*?\2|(?:[^\w\s]|^)\s*\/(?![*\/])(?:\\.|\[(?:\\.|.)\]|.)*?\/(?=[gmiy]{0,4}\s*(?![*\/])(?:\W|$)))|\/\/\/.*?\r?\n\s*|\/\/.*?$|\/\*[\s\S]*?\*\//gm, '$1');
    // https://stackoverflow.com/questions/24518020/comprehensive-regexp-to-remove-javascript-comments
    // Using the "Final Boss Fight" at the bottom. Otherwise it fails on `di 5 / 5 // hello`
    // code = code.replace(';', '')
    if (process.platform == 'win32') {
      text = text + '\r';
    }
    console.log('code without comments: ' + text);
    return text;
  },

  runPreviousCommand() {
    const whichApp = atom.config.get('stata-exec.whichApp');
    return sendCode.send(sendCode.previousCommand);
  },

  getFunctionRange() {
    // gets the range of the closest function above the cursor.
    // if there is no (proper) function, return false
    const [editor, buffer] = this._getEditorAndBuffer();
    const currentPosition = editor.getCursorBufferPosition();
    // search for the simple function that looks something like:
    // label <- function(...) {
    // in case the current function definition is on the current line
    currentPosition.row += 1;
    const backwardRange = [0, currentPosition];
    const funRegex = new RegExp(/^\s*(pr(ogram|ogra|ogr|og|o)?)\s*(?!drop\s+)(de(fine|fin|fi|f)?)?\s*[A-Za-z_][A-Za-z0-9_]{0,31}/g);
    let foundStart = null;
    editor.backwardsScanInBufferRange(funRegex, backwardRange, function(result) {
      if (result.range.start.column === 0) {
        foundStart = result.range;
        return result.stop();
      }
    });

    if ((foundStart == null)) {
      console.error("Couldn't find the beginning of the program.");
      return null;
    }

    const dropRegex = new RegExp(/\s*pr(ogram|ogra|ogr|og|o)?\s+(drop)\s+[A-Za-z_][A-Za-z0-9_]{0,31}/g);
    const textPrevRow = editor.lineTextForBufferRow(foundStart.start.row - 1);
    if (dropRegex.test(textPrevRow) == true) {
      foundStart.start.row -= 1;
    }

    // now look for the end
    const numberOfLines = editor.getLineCount();
    const forwardRange = [foundStart.start, new Point(numberOfLines + 1, 0)];

    let foundEnd = null;
    editor.scanInBufferRange(/^\s*end\s*$/g, forwardRange, function(result) {
      if (result.range.start.column === 0) {
        foundEnd = result.range;
        return result.stop();
      }
    });

    if ((foundEnd == null)) {
      console.error("Couldn't find the end of the program.");
      return null;
    }

    // check if cursor is contained in range
    currentPosition.row -= 1;
    if ((foundStart.start.row <= currentPosition.row) &&
      (currentPosition.row <= foundEnd.start.row)) {
      return new Range(foundStart.start, foundEnd.end);
    } else {
      console.error("Couldn't find a program surrounding the current line.");
      console.error("start: ", foundStart);
      console.error("end: ", foundEnd);
      console.error("currentPosition: ", currentPosition);
      return null;
    }
  },

  runFunction() {
    const [editor, buffer] = this._getEditorAndBuffer();
    const whichApp = atom.config.get('stata-exec.whichApp');

    const range = this.getFunctionRange();
    if (range != null) {
      let code = editor.getTextInBufferRange(range);
      return sendCode.send(this.removeComments(code));
    } else {
      return this.Warning("Couldn't find program.");
    }
  },

  getSelections() {
    // returns an object with keys:
    // selection: the selection or line at which the cursor is present
    // anySelection: if true, the user made a selection.
    const [editor, buffer] = this._getEditorAndBuffer();

    let selections = editor.getSelectionsOrderedByBufferPosition();
    let texts = Array(selections.length);
    let anySelection = true;

    for (var i = 0; i < selections.length; i++) {
      var selection = selections[i];
      if (selection.getText() === '') {
        anySelection = false;
        const cursorPosition = selection.cursor.getBufferPosition().row;
        texts[i] = editor.lineTextForBufferRow(cursorPosition);
      } else {
        texts[i] = selection.getText();
      }
    }

    return { texts, anySelection };
  },

  error(message) {
    console.error(message);
    return atom.notifications.addError(message);
  },

  warning(message) {
    console.error(message);
    return atom.notifications.addWarning(message);
  },

  onlyWhitespace(str) {
    // returns true if string is only whitespace
    return str.replace(/\s/g, '').length === 0;
  },

  getCurrentParagraphRange() {
    let lineIndex;
    const [editor, buffer] = this._getEditorAndBuffer();
    const currentPosition = editor.getCursorBufferPosition().row;

    let currentLine = buffer.lineForRow(currentPosition);

    if (this.onlyWhitespace(currentLine)) {
      return null;
    }

    let startIndex = -1;
    // if we exhaust loop, then this paragraph begins at the first line
    if (currentPosition > 0) {
      let asc, start;
      for (start = currentPosition - 1, lineIndex = start, asc = start <= 0; asc ? lineIndex <= 0 : lineIndex >= 0; asc ? lineIndex++ : lineIndex--) {
        currentLine = buffer.lineForRow(lineIndex);
        if (this.onlyWhitespace(currentLine)) {
          startIndex = lineIndex;
          break;
        }
      }
    }
    startIndex += 1;

    let endIndex = editor.getLineCount();
    const numberOfLines = editor.getLineCount() - 1;
    if (currentPosition < (endIndex - 1)) {
      let asc1, end, start1;
      for (start1 = currentPosition + 1, lineIndex = start1, end = numberOfLines, asc1 = start1 <= end; asc1 ? lineIndex <= end : lineIndex >= end; asc1 ? lineIndex++ : lineIndex--) {
        currentLine = buffer.lineForRow(lineIndex);
        if (this.onlyWhitespace(currentLine)) {
          endIndex = lineIndex;
          break;
        }
      }
    }
    endIndex -= 1;

    const paragraphRange = new Range([startIndex, 0], [endIndex, buffer.lineLengthForRow(endIndex)]);

    return paragraphRange;
  },

  runParagraph() {
    const whichApp = atom.config.get('stata-exec.whichApp');
    const [editor, buffer] = this._getEditorAndBuffer();
    const paragraphRange = this.getCurrentParagraphRange();

    if (paragraphRange) {
      let code = editor.getTextInBufferRange(paragraphRange);
      sendCode.send(this.removeComments(code));
      const advancePosition = atom.config.get('stata-exec.advancePosition');
      if (advancePosition) {
        const currentPosition = editor.getLastSelection().getScreenRange().end;
        let nextPosition = this._findForward(this.nonEmptyLine, paragraphRange.end.row + 1);
        if (nextPosition != null) {
          if (nextPosition == null) { nextPosition = [currentPosition + 1, 0]; }
          editor.setCursorScreenPosition(nextPosition);
          return editor.moveToFirstCharacterOfLine();
        }
      }
    } else {
      return this.Warning('No paragraph at cursor.');
    }
  },

  nonEmptyLine(line) {
    const skipComments = atom.config.get('stata-exec.skipComments');
    let ret = true;
    if (skipComments) {
      ret = !/^\s*#/.test(line);
    }
    // a non empty line is a line that doesn't contain only a comment
    // and at least 1 character
    return ret && /\S/.test(line);
  },

  _findForward(searchFun, startPosition = null) {
    const editor = atom.workspace.getActiveTextEditor();
    const buffer = editor.getBuffer();

    if ((startPosition == null)) {
      startPosition = editor.getCursorBufferPosition().row;
    }

    let index = null;
    const numberOfLines = editor.getLineCount() - 1;
    if (startPosition >= numberOfLines) {
      return null;
    }
    for (let lineIndex = startPosition, end = numberOfLines, asc = startPosition <= end; asc ? lineIndex <= end : lineIndex >= end; asc ? lineIndex++ : lineIndex--) {
      const currentLine = buffer.lineForRow(lineIndex);
      if (searchFun(currentLine)) {
        index = lineIndex;
        break;
      }
    }

    if (index != null) {
      return [index, buffer.lineLengthForRow(index)];
    }

    return null;
  },

  setWorkingDirectory() {
    const whichApp = atom.config.get('stata-exec.whichApp');
    if (whichApp == "XQuartz") {
      this.Warning('Set Working Directory not supported for XQuartz');
      return;
    }

    // set the current working directory to the directory of
    // where the current file is
    const [editor, buffer] = this._getEditorAndBuffer();
    let cwd = editor.getPath();
    if (!cwd) {
      this.Warning('No current working directory (save the file first).');
      return;
    }
    cwd = cwd.substring(0, cwd.lastIndexOf('/'));
    cwd = `cd \`"${cwd}"'`;

    return sendCode.send(cwd);
  }
};
