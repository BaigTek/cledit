/* jshint -W084, -W099 */
// Credit: http://dabblet.com/

(function(diff_match_patch) {

	var DIFF_DELETE = -1;
	var DIFF_INSERT = 1;
	var DIFF_EQUAL = 0;

	function cledit(contentElt, scrollElt, windowParam) {
		var editor = {
			$contentElt: contentElt,
			$scrollElt: scrollElt || contentElt,
			$window: windowParam || window,
			$keystrokes: {},
			$markers: []
		};
		editor.$document = editor.$window.document;
		cledit.Utils.createEventHooks(editor);

		editor.toggleEditable = function(isEditable) {
			if(isEditable === undefined) {
				isEditable = !contentElt.contentEditable;
			}
			contentElt.contentEditable = isEditable;
		};
		editor.toggleEditable(true);

		var scrollTop;
		var textContent = contentElt.textContent;
		var debounce = cledit.Utils.debounce;

		var highlighter = new cledit.Highlighter(editor);

		var sectionList;

		function parseSections(content, isInit) {
			sectionList = highlighter.parseSections(content, isInit);
			editor.$allElements = Array.prototype.slice.call(contentElt.querySelectorAll('.cledit-section *'));
			editor.$trigger('contentChanged', content, sectionList);
		}

		// Used to detect editor changes
		var watcher = new cledit.Watcher(editor, checkContentChange);
		watcher.startWatching();

		var diffMatchPatch = new diff_match_patch();
		/*
		 var jsonDiffPatch = jsondiffpatch.create({
		 objectHash: function(obj) {
		 return JSON.stringify(obj);
		 },
		 arrays: {
		 detectMove: false
		 },
		 textDiff: {
		 minLength: 9999999
		 }
		 });
		 */

		var selectionMgr = new cledit.SelectionMgr(editor);
		// TODO
		// $(document).on('selectionchange', '.editor-content', selectionMgr.saveSelectionState.bind(selectionMgr, true, false));

		function adjustCursorPosition(force) {
			selectionMgr.saveSelectionState(true, true, force);
		}

		function replaceContent(selectionStart, selectionEnd, replacement) {
			var range = selectionMgr.createRange(
				Math.min(selectionStart, selectionEnd),
				Math.max(selectionStart, selectionEnd)
			);
			if('' + range == replacement) {
				return;
			}
			range.deleteContents();
			range.insertNode(editor.$document.createTextNode(replacement));
		}

		function setContent(value, noWatch, maxStartOffset) {
			maxStartOffset = maxStartOffset !== undefined && maxStartOffset < textContent.length ? maxStartOffset : textContent.length - 1;
			var startOffset = Math.min(
				diffMatchPatch.diff_commonPrefix(textContent, value),
				maxStartOffset
			);
			var endOffset = Math.min(
				diffMatchPatch.diff_commonSuffix(textContent, value),
				textContent.length - startOffset,
				value.length - startOffset
			);
			var replacement = value.substring(startOffset, value.length - endOffset);
			if(noWatch) {
				watcher.noWatch(function() {
					replaceContent(startOffset, textContent.length - endOffset, replacement);
					textContent = value;
					parseSections(value);
				});
			}
			else {
				replaceContent(startOffset, textContent.length - endOffset, replacement);
			}
			return {
				start: startOffset,
				end: value.length - endOffset
			};
		}

		function replace(selectionStart, selectionEnd, replacement) {
			undoMgr.setDefaultMode('single');
			replaceContent(selectionStart, selectionEnd, replacement);
			var endOffset = selectionStart + replacement.length;
			selectionMgr.setSelectionStartEnd(endOffset, endOffset);
			selectionMgr.updateCursorCoordinates(true);
		}

		function replaceAll(search, replacement) {
			undoMgr.setDefaultMode('single');
			var value = textContent.replace(search, replacement);
			if(value != textContent) {
				var offset = editor.setContent(value);
				selectionMgr.setSelectionStartEnd(offset.end, offset.end);
				selectionMgr.updateCursorCoordinates(true);
			}
		}

		function replacePreviousText(text, replacement) {
			var offset = selectionMgr.selectionStart;
			if(offset !== selectionMgr.selectionEnd) {
				return false;
			}
			var range = selectionMgr.createRange(offset - text.length, offset);
			if('' + range != text) {
				return false;
			}
			range.deleteContents();
			range.insertNode(editor.$document.createTextNode(replacement));
			offset = offset - text.length + replacement.length;
			selectionMgr.setSelectionStartEnd(offset, offset);
			selectionMgr.updateCursorCoordinates(true);
			return true;
		}

		function getContent() {
			return textContent;
		}

		function focus() {
			selectionMgr.restoreSelection();
			scrollElt.scrollTop = scrollTop;
		}

		var undoMgr = new cledit.UndoMgr(editor);

		// TODO
		/*
		 function onComment() {
		 if(watcher.isWatching === true) {
		 undoMgr.currentMode = undoMgr.currentMode || 'comment';
		 undoMgr.saveState();
		 }
		 }

		 eventMgr.addListener('onDiscussionCreated', onComment);
		 eventMgr.addListener('onDiscussionRemoved', onComment);
		 eventMgr.addListener('onCommentsChanged', onComment);
		 */

		function addMarker(marker) {
			editor.$markers.indexOf(marker) === -1 && editor.$markers.push(marker);
		}

		function removeMarker(marker) {
			var index = editor.$markers.indexOf(marker);
			index !== -1 && editor.$markers.splice(index, 1);
		}

		var triggerSpellCheck = debounce(function() {
			var selection = editor.$window.getSelection();
			if(!selectionMgr.hasFocus || highlighter.isComposing || selectionMgr.selectionStart !== selectionMgr.selectionEnd || !selection.modify) {
				return;
			}
			// Hack for Chrome to trigger the spell checker
			if(selectionMgr.selectionStart) {
				selection.modify("move", "backward", "character");
				selection.modify("move", "forward", "character");
			}
			else {
				selection.modify("move", "forward", "character");
				selection.modify("move", "backward", "character");
			}
		}, 10);

		function checkContentChange(mutations) {
			var removedSections = {};
			var modifiedSections = {};

			function markModifiedSection(node) {
				while(node && node !== contentElt) {
					if(node.section) {
						(node.parentNode ? modifiedSections : removedSections)[node.section.id] = node.section;
						return;
					}
					node = node.parentNode;
				}
			}

			mutations.forEach(function(mutation) {
				markModifiedSection(mutation.target);
				Array.prototype.forEach.call(mutation.addedNodes, markModifiedSection);
				Array.prototype.forEach.call(mutation.removedNodes, markModifiedSection);
			});
			removedSections = Object.keys(removedSections).map(function(key) {
				return removedSections[key];
			});
			modifiedSections = Object.keys(modifiedSections).map(function(key) {
				return modifiedSections[key];
			});
			var isSelectionSaved;
			watcher.noWatch(function() {
				isSelectionSaved = highlighter.fixContent(modifiedSections, removedSections, mutations);
			});
			var newTextContent = contentElt.textContent.replace(/\r\n?/g, '\n'); // Mac/DOS to Unix
			if(newTextContent && newTextContent == textContent) {
				return;
			}

			if(newTextContent.slice(-1) !== '\n') {
				newTextContent += '\n';
			}
			var patches = getPatches(newTextContent);
			undoMgr.addPatches(patches);
			undoMgr.setDefaultMode('typing');

			editor.$markers.forEach(function(marker) {
				patches.forEach(marker.adjustOffset, marker);
			});

			// TODO
			/*
			 var discussionList = _.values(fileDesc.discussionList);
			 fileDesc.newDiscussion && discussionList.push(fileDesc.newDiscussion);
			 var updateDiscussionList = adjustCommentOffsets(textContent, newTextContent, discussionList);
			 if(updateDiscussionList === true) {
			 fileDesc.discussionList = fileDesc.discussionList; // Write discussionList in localStorage
			 }
			 */
			textContent = newTextContent;
			isSelectionSaved || selectionMgr.saveSelectionState();
			parseSections(textContent);
			// TODO
			//updateDiscussionList && eventMgr.onCommentsChanged(fileDesc);
			undoMgr.saveState();
			triggerSpellCheck();
		}

		function getPatches(newTextContent) {
			var changes = diffMatchPatch.diff_main(textContent, newTextContent);
			var patches = [];
			var startOffset = 0;
			changes.forEach(function(change) {
				var changeType = change[0];
				var changeText = change[1];
				switch(changeType) {
					case DIFF_EQUAL:
						startOffset += changeText.length;
						break;
					case DIFF_DELETE:
						patches.push({
							insert: false,
							offset: startOffset,
							text: changeText
						});
						break;
					case DIFF_INSERT:
						patches.push({
							insert: true,
							offset: startOffset,
							text: changeText
						});
						startOffset += changeText.length;
						break;
				}
			});
			return patches;
		}

		// See https://gist.github.com/shimondoodkin/1081133
		// TODO
		/*
		 if(/AppleWebKit\/([\d.]+)/.exec(navigator.userAgent)) {
		 var $editableFix = $('<input style="width:1px;height:1px;border:none;margin:0;padding:0;" tabIndex="-1">').appendTo('html');
		 $contentElt.blur(function() {
		 $editableFix[0].setSelectionRange(0, 0);
		 $editableFix.blur();
		 });
		 }
		 */

		function setSelection(start, end) {
			selectionMgr.setSelectionStartEnd(start, end);
			selectionMgr.updateCursorCoordinates();
		}

		function keydownHandler(handler) {
			return function(evt) {
				if(
					evt.which !== 17 && // Ctrl
					evt.which !== 91 && // Cmd
					evt.which !== 18 && // Alt
					evt.which !== 16 // Shift
				) {
					handler(evt);
				}
			};
		}

		contentElt.addEventListener('keydown', keydownHandler(function(evt) {
			selectionMgr.saveSelectionState();
			adjustCursorPosition();
			Object.keys(editor.$keystrokes).some(function(key) {
				return editor.$keystrokes[key].perform(evt, editor);
			});
		}), false);

		// In case of Ctrl/Cmd+A outside the editor element
		editor.$window.addEventListener('keydown', keydownHandler(function() {
			adjustCursorPosition();
		}), false);

		// Mouseup can happen outside the editor element
		editor.$window.addEventListener('mouseup', selectionMgr.saveSelectionState.bind(selectionMgr, true, false));
		// This can also provoke selection changes and does not fire mouseup event on Chrome/OSX
		contentElt.addEventListener('contextmenu', selectionMgr.saveSelectionState.bind(selectionMgr, true, false));

		contentElt.addEventListener('compositionstart', function() {
			highlighter.isComposing++;
		}, false);

		contentElt.addEventListener('compositionend', function() {
			setTimeout(function() {
				highlighter.isComposing--;
			}, 0);
		}, false);

		contentElt.addEventListener('paste', function(evt) {
			undoMgr.setCurrentMode('single');
			evt.preventDefault();
			var data, clipboardData = evt.clipboardData;
			if(clipboardData) {
				data = clipboardData.getData('text/plain');
			}
			else {
				clipboardData = editor.$window.clipboardData;
				data = clipboardData && clipboardData.getData('Text');
			}
			if(!data) {
				return;
			}
			replace(selectionMgr.selectionStart, selectionMgr.selectionEnd, data);
			adjustCursorPosition();
		}, false);

		contentElt.addEventListener('cut', function() {
			undoMgr.setCurrentMode('single');
			adjustCursorPosition();
		}, false);

		contentElt.addEventListener('focus', function() {
			selectionMgr.hasFocus = true;
		}, false);

		contentElt.addEventListener('blur', function() {
			selectionMgr.hasFocus = false;
		}, false);

		function addKeystroke(key, keystroke) {
			editor.$keystrokes[key] = keystroke;
		}
		Object.keys(cledit.defaultKeystrokes).forEach(function(key) {
			addKeystroke(key, cledit.defaultKeystrokes[key]);
		});

		editor.selectionMgr = selectionMgr;
		editor.undoMgr = undoMgr;
		editor.highlighter = highlighter;
		editor.watcher = watcher;
		editor.adjustCursorPosition = adjustCursorPosition;
		editor.setContent = setContent;
		editor.replace = replace;
		editor.replaceAll = replaceAll;
		editor.replacePreviousText = replacePreviousText;
		editor.getContent = getContent;
		editor.focus = focus;
		editor.setSelection = setSelection;
		editor.addKeystroke = addKeystroke;
		editor.addMarker = addMarker;
		editor.removeMarker = removeMarker;

		editor.init = function(options) {
			options = cledit.Utils.extend({
				cursorFocusRatio: 0.5,
				language: {},
				sectionDelimiter: ''
			}, options || {});
			editor.options = options;

			if(options.content !== undefined) {
				textContent = options.content;
			}

			if(options.sectionDelimiter && !(options.sectionDelimiter instanceof RegExp)) {
				options.sectionDelimiter = new RegExp(options.sectionDelimiter, 'gm');
			}

			undoMgr.init();
			selectionMgr.saveSelectionState();
			parseSections(textContent, true);

			if(options.selectionStart !== undefined && options.selectionEnd !== undefined) {
				editor.setSelection(options.selectionStart, options.selectionEnd);
			}

			if(options.scrollTop !== undefined) {
				scrollElt.scrollTop = options.scrollTop;
			}

			scrollTop = scrollElt.scrollTop;
		};

		return editor;
	}

	window.cledit = cledit;
})(window.diff_match_patch);

