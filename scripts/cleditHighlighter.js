(function(cledit) {

	function Highlighter(editor) {
		var escape = cledit.Utils.escape;

		var contentElt = editor.$contentElt;
		var sectionCounter = 0;
		this.trailingLfElt;
		this.isComposing = 0;

		var sectionList = [];
		var sectionsToRemove = [];
		var modifiedSections = [];
		var insertBeforeSection;
		var wrapEmptyLines = cledit.Utils.isWebkit;
		var useBr = cledit.Utils.isGecko || cledit.Utils.isWebkit;
		var trailingNodeTag = 'div';

		var lfHtml = useBr ?
			'<span class="lf"><br><span class="hd-lf" style="display: none">\n</span></span>' :
			'<span class="lf">\n</span>';

		this.fixContent = function(mutations) {
			if(useBr) {
				Array.prototype.forEach.call(contentElt.querySelectorAll('.hd-lf'), function(lfElt) {
					if(!lfElt.previousSibling) {
						lfElt.parentNode.removeChild(lfElt);
					}
				});
				Array.prototype.forEach.call(contentElt.querySelectorAll('br'), function(brElt) {
					if(!brElt.nextSibling) {
						var lfElt = editor.$document.createElement('span');
						lfElt.className = 'hidden-lf';
						lfElt.textContent = '\n';
						lfElt.style.display = 'none';
						brElt.parentNode.appendChild(lfElt);
					}
				});
			}
			wrapEmptyLines && Array.prototype.forEach.call(contentElt.querySelectorAll('div'), function(elt) {
				if(elt.previousSibling && elt.previousSibling.textContent && elt.previousSibling.textContent.slice(-1) !== '\n') {
					elt.parentNode.insertBefore(editor.$document.createTextNode('\n'), elt);
				}
			});
			if(cledit.Utils.isMsie && editor.getContent() === contentElt.textContent) {
				// In IE, backspace can provoke div merging without any actual text modification
				var removedSections = [];
				var addedNode;
				mutations.forEach(function(mutation) {
					var node;
					if(mutation.removedNodes.length === 1) {
						node = mutation.removedNodes[0];
						node.section && removedSections.push(node.section);
					}
					if(mutation.addedNodes.length === 1) {
						addedNode = mutation.addedNodes[0];
					}
				});
				if(addedNode && removedSections.length === 2) {
					var index1 = sectionList.indexOf(removedSections[0]);
					var index2 = sectionList.indexOf(removedSections[1]);
					var firstSection = sectionList[Math.min(index1, index2)];
					var secondSection = sectionList[Math.max(index1, index2)];
					if(firstSection.text.slice(-1) === '\n') {
						editor.selectionMgr.saveSelectionState();
						addedNode.textContent = firstSection.text.slice(0, -1) + secondSection.text;
						editor.selectionMgr.selectionStart--;
						editor.selectionMgr.selectionEnd--;
						return true;
					}
				}
			}
		};

		this.addTrailingNode = function() {
			this.trailingNode = editor.$document.createElement(trailingNodeTag);
			contentElt.appendChild(this.trailingNode);
		};

		function Section(text) {
			this.id = ++sectionCounter;
			this.text = text;
		}

		Section.prototype.setElement = function(elt) {
			this.elt = elt;
			elt.section = this;
		};

		this.parseSections = function(content, isInit) {
			var tmpText = content + "\n\n";
			var newSectionList = [];
			var offset = 0;

			function addSection(startOffset, endOffset) {
				var sectionText = tmpText.substring(offset, endOffset);
				newSectionList.push(new Section(sectionText));
			}

			// Look for delimiters
			editor.options.sectionDelimiter && tmpText.replace(editor.options.sectionDelimiter, function(match, matchOffset) {
				// Create a new section with the text preceding the delimiter
				addSection(offset, matchOffset);
				offset = matchOffset;
			});

			// Last section
			addSection(offset, content.length);

			modifiedSections = [];
			sectionsToRemove = [];
			insertBeforeSection = undefined;

			if(isInit) {
				// Render everything if isInit
				sectionsToRemove = sectionList;
				sectionList = newSectionList;
				modifiedSections = newSectionList;
			}
			else {
				// Find modified section starting from top
				var leftIndex = sectionList.length;
				sectionList.some(function(section, index) {
					var newSection = newSectionList[index];
					if(index >= newSectionList.length ||
							// Check text modification
						section.text != newSection.text ||
							// Check that section has not been detached or moved
						section.elt.parentNode !== contentElt ||
							// Check also the content since nodes can be injected in sections via copy/paste
						section.elt.textContent != newSection.text) {
						leftIndex = index;
						return true;
					}
				});

				// Find modified section starting from bottom
				var rightIndex = -sectionList.length;
				sectionList.slice().reverse().some(function(section, index) {
					var newSection = newSectionList[newSectionList.length - index - 1];
					if(index >= newSectionList.length ||
							// Check modified
						section.text != newSection.text ||
							// Check that section has not been detached or moved
						section.elt.parentNode !== contentElt ||
							// Check also the content since nodes can be injected in sections via copy/paste
						section.elt.textContent != newSection.text) {
						rightIndex = -index;
						return true;
					}
				});

				if(leftIndex - rightIndex > sectionList.length) {
					// Prevent overlap
					rightIndex = leftIndex - sectionList.length;
				}

				// Create an array composed of left unmodified, modified, right
				// unmodified sections
				var leftSections = sectionList.slice(0, leftIndex);
				modifiedSections = newSectionList.slice(leftIndex, newSectionList.length + rightIndex);
				var rightSections = sectionList.slice(sectionList.length + rightIndex, sectionList.length);
				insertBeforeSection = rightSections[0];
				sectionsToRemove = sectionList.slice(leftIndex, sectionList.length + rightIndex);
				sectionList = leftSections.concat(modifiedSections).concat(rightSections);
			}

			if(this.isComposing) {
				return sectionList;
			}

			var newSectionEltList = editor.$document.createDocumentFragment();
			modifiedSections.forEach(function(section) {
				highlight(section);
				newSectionEltList.appendChild(section.elt);
			});
			editor.watcher.noWatch((function() {
				if(isInit) {
					contentElt.innerHTML = '';
					contentElt.appendChild(newSectionEltList);
					return this.addTrailingNode();
				}

				// Remove outdated sections
				sectionsToRemove.forEach(function(section) {
					// section may be already removed
					section.elt.parentNode === contentElt && contentElt.removeChild(section.elt);
					// To detect sections that come back with built-in undo
					section.elt.section = undefined;
				});

				if(insertBeforeSection !== undefined) {
					contentElt.insertBefore(newSectionEltList, insertBeforeSection.elt);
				}
				else {
					contentElt.appendChild(newSectionEltList);
				}

				// Remove unauthorized nodes (text nodes outside of sections or duplicated sections via copy/paste)
				var childNode = contentElt.firstChild;
				while(childNode) {
					var nextNode = childNode.nextSibling;
					if(!childNode.section) {
						contentElt.removeChild(childNode);
					}
					childNode = nextNode;
				}
				this.addTrailingNode();
				editor.selectionMgr.restoreSelection();
				editor.selectionMgr.updateCursorCoordinates();
			}).bind(this));

			return sectionList;
		};

		function highlight(section) {
			var text = escape(section.text);
			text = cledit.Prism.highlight(text, editor.options.language);
			if(wrapEmptyLines) {
				text = text.replace(/^\n/gm, '<div>\n</div>');
			}
			text = text.replace(/\n/g, lfHtml);
			/*
			 var frontMatter = section.textWithFrontMatter.substring(0, section.textWithFrontMatter.length - section.text.length);
			 if(frontMatter.length) {
			 // Front matter highlighting
			 frontMatter = escape(frontMatter);
			 frontMatter = frontMatter.replace(/\n/g, '<span class="token lf">\n</span>');
			 text = '<span class="token md">' + frontMatter + '</span>' + text;
			 }
			 */
			var sectionElt = editor.$document.createElement('div');
			sectionElt.id = 'classeur-editor-section-' + section.id;
			sectionElt.className = 'classeur-editor-section';
			sectionElt.innerHTML = text;
			section.setElement(sectionElt);
			//section.addTrailingLf();
		}
	}

	cledit.Highlighter = Highlighter;

})(window.cledit);