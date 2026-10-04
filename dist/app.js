const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const editor = $('#editor');
const app = $('.app');
const storageKey = 'docs-workspace-v1';
function blankDocument() {
  return { id: crypto.randomUUID(), title: 'Untitled document', html: '<p><br></p>', comments: [], starred: false, updated: Date.now(), notes: '', tasks: [] };
}
let state;
try { state = JSON.parse(localStorage.getItem(storageKey)); } catch { /* A fresh workspace works without storage. */ }
if (!state || !Array.isArray(state.documents) || !state.documents.length) {
  const doc = blankDocument();
  state = { activeId: doc.id, name: 'Khalid', documents: [doc], blankStartApplied: true };
} else if (!state.blankStartApplied) {
  // Open a blank page once on upgrade; keep all previous documents in the library.
  const doc = blankDocument();
  state.documents.unshift(doc);
  state.activeId = doc.id;
  state.blankStartApplied = true;
}
let active = state.documents.find(d => d.id === state.activeId) || state.documents[0];
let savedRange = null;
let saveTimer, toastTimer;
let commentFilter = 'open';
let viewing = false;
let isComposing = false;
const escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

// Keep imported and pasted documents inert while retaining supported rich text.
function sanitizeHTML(html) {
  const parsed = new DOMParser().parseFromString(String(html), 'text/html');
  const allowed = new Set(['P','DIV','SPAN','BR','H1','H2','H3','H4','H5','H6','STRONG','B','EM','I','U','S','STRIKE','UL','OL','LI','BLOCKQUOTE','HR','TABLE','THEAD','TBODY','TR','TD','TH','A','IMG','FONT','SUB','SUP']);
  const styleNames = new Set(['color','background-color','font-family','font-size','font-weight','font-style','text-decoration','text-align','line-height','margin-left','padding-left']);
  const allowedClasses = new Set(['eyebrow','doc-subtitle','brief-meta','status-pill','doc-end']);
  for (const element of [...parsed.body.querySelectorAll('*')]) {
    if (!allowed.has(element.tagName)) {
      if (['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','LINK','META','FORM','INPUT','BUTTON','TEXTAREA'].includes(element.tagName)) element.remove();
      else element.replaceWith(...element.childNodes);
      continue;
    }
    const cleanStyle = document.createElement('span').style;
    for (const property of styleNames) {
      const value = element.style.getPropertyValue(property);
      if (value && !/url\s*\(|expression|var\s*\(/i.test(value)) cleanStyle.setProperty(property, value);
    }
    const classes = [...element.classList].filter(c => allowedClasses.has(c));
    const href = element.getAttribute('href');
    const src = element.getAttribute('src');
    const alt = element.getAttribute('alt');
    const fontFace = element.getAttribute('face');
    const fontColor = element.getAttribute('color');
    const fontSize = element.getAttribute('size');
    for (const attr of [...element.attributes]) element.removeAttribute(attr.name);
    if (cleanStyle.cssText) element.setAttribute('style', cleanStyle.cssText);
    if (classes.length) element.className = classes.join(' ');
    if (element.tagName === 'A' && href && /^(https?:|mailto:)/i.test(href)) { element.href = href; element.target = '_blank'; element.rel = 'noopener noreferrer'; }
    if (element.tagName === 'IMG') {
      if (src && /^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(src)) { element.src = src; element.alt = alt || 'Document image'; }
      else element.remove();
    }
    if (element.tagName === 'FONT') {
      if (fontFace && /^[\w\s,-]+$/.test(fontFace)) element.setAttribute('face', fontFace);
      if (fontColor && /^(#[a-f\d]{3,8}|[a-z]+)$/i.test(fontColor)) element.setAttribute('color', fontColor);
      if (fontSize && /^[1-7]$/.test(fontSize)) element.setAttribute('size', fontSize);
    }
  }
  return parsed.body.innerHTML;
}

function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3400);
}
function persist() {
  clearTimeout(saveTimer);
  active.html = editor.innerHTML;
  active.title = $('#document-title').value.trim() || 'Untitled document';
  active.updated = Date.now();
  state.activeId = active.id;
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    $('#save-status').textContent = 'All changes saved';
    $('.outline-footer').innerHTML = '<span class="small-dot"></span> Saved on this device';
    return true;
  } catch {
    $('#save-status').textContent = 'Unable to save on this device';
    $('.outline-footer').textContent = 'Not saved · download a copy';
    notify('Device storage is unavailable or full. Download a copy to keep your changes.');
    return false;
  }
}
function changed() {
  $('#save-status').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 350);
  updateStats();
  updateOutline();
  document.title = `Docs — ${$('#document-title').value || 'Untitled document'}`;
}
function updateStats() {
  const text = editor.innerText.trim();
  const words = text ? text.split(/\s+/).length : 0;
  $('#word-count').textContent = `${words.toLocaleString()} words`;
  $('#page-info').textContent = `${Math.max(1, Math.ceil(editor.offsetHeight / 1120))} ${editor.offsetHeight > 1120 ? 'pages' : 'page'}`;
}
function updateOutline() {
  const headings = $$('h1,h2,h3', editor);
  const outline = $('#outline');
  outline.replaceChildren();
  if (!headings.length) {
    const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'Headings you add will appear here.'; outline.append(empty); return;
  }
  headings.forEach((heading, index) => {
    const button = document.createElement('button');
    button.className = `outline-link ${index === 0 ? 'active' : ''} ${heading.tagName === 'H3' ? 'sub' : ''}`;
    button.textContent = heading.innerText.trim().replace(/\n/g, ' ');
    button.onclick = () => { heading.scrollIntoView({ behavior: 'smooth', block: 'start' }); $$('.outline-link').forEach(b => b.classList.remove('active')); button.classList.add('active'); };
    outline.append(button);
  });
}
function loadDocument(doc) {
  clearTimeout(saveTimer);
  active = doc; state.activeId = doc.id; savedRange = null;
  editor.innerHTML = sanitizeHTML(doc.html || '<p><br></p>');
  $('#document-title').value = doc.title;
  $('#star-btn').classList.toggle('starred', !!doc.starred);
  $('#star-btn').setAttribute('aria-pressed', String(!!doc.starred));
  document.title = `Docs — ${doc.title}`;
  $('#document-workspace').scrollTop = 0;
  active.comments ||= []; active.tasks ||= []; active.notes ||= '';
  renderComments(); updateOutline(); updateStats(); persist();
}
function newDocument() {
  persist();
  const doc = blankDocument();
  state.documents.unshift(doc); loadDocument(doc); closeModal();
  editor.focus(); notify('New document created');
}
document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  if (selection.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) {
    savedRange = selection.getRangeAt(0).cloneRange();
    for (const name of ['bold','italic','underline','insertUnorderedList','insertOrderedList']) {
      try { $(`[data-command="${name}"]`)?.classList.toggle('active', document.queryCommandState(name)); } catch { /* Optional visual state. */ }
    }
    const node = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
    const block = node.closest('h1,h2,h3,blockquote,p');
    if (block) $('#style-select').value = block.tagName.toLowerCase();
  }
});
function restoreSelection() {
  editor.focus();
  if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(savedRange);
  }
}
function command(name, value = null) {
  if (viewing) { notify('Switch to Editing to make changes.'); return; }
  restoreSelection(); document.execCommand(name, false, value); changed();
}
$$('[data-command]').forEach(button => {
  button.addEventListener('mousedown', event => event.preventDefault());
  button.onclick = () => command(button.dataset.command);
});
editor.addEventListener('compositionstart', () => { isComposing = true; });
editor.addEventListener('compositionend', () => { isComposing = false; changed(); });
editor.addEventListener('input', () => { if (!isComposing) changed(); });
editor.addEventListener('paste', event => {
  if (viewing) return;
  event.preventDefault();
  const html = event.clipboardData.getData('text/html');
  const plain = event.clipboardData.getData('text/plain');
  command('insertHTML', html ? sanitizeHTML(html) : escapeHTML(plain).replace(/\n/g, '<br>'));
});
editor.addEventListener('click', event => { if (event.target.closest('a') && (viewing || event.metaKey || event.ctrlKey)) window.open(event.target.closest('a').href, '_blank', 'noopener,noreferrer'); });
$('#document-title').addEventListener('input', changed);
window.addEventListener('beforeunload', persist);
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
$('#style-select').onchange = event => command('formatBlock', event.target.value);
$('#font-select').onchange = event => command('fontName', event.target.value);
function fontSize(size) {
  size = Math.min(72, Math.max(8, Number(size) || 11));
  if (viewing) return notify('Switch to Editing to make changes.');
  restoreSelection();
  document.execCommand('fontSize', false, '7');
  $$('font[size="7"]', editor).forEach(font => { font.removeAttribute('size'); font.style.fontSize = `${size}pt`; });
  $('#font-size').value = size; changed();
}
$('#font-size').onchange = event => fontSize(event.target.value);
$('#font-minus').onclick = () => fontSize(Number($('#font-size').value) - 1);
$('#font-plus').onclick = () => fontSize(Number($('#font-size').value) + 1);
$('#text-color').oninput = event => { command('foreColor', event.target.value); $('.color-tool span').style.borderColor = event.target.value; };
$('#highlight-color').oninput = event => { command('hiliteColor', event.target.value); $('.highlight-tool svg').style.borderColor = event.target.value; };
$('#zoom-select').onchange = event => { $('#pages').style.zoom = event.target.value; updateStats(); };
$('#print-btn').onclick = () => window.print();
$('#spellcheck-btn').onclick = () => { editor.spellcheck = !editor.spellcheck; $('#spellcheck-btn').setAttribute('aria-pressed', String(editor.spellcheck)); notify(`Spell check ${editor.spellcheck ? 'enabled' : 'disabled'}`); };
let copiedFormat;
$('#paint-btn').onclick = () => {
  if (!copiedFormat) {
    const selection = window.getSelection(); const node = selection.anchorNode;
    if (!node || !editor.contains(node)) return notify('Select text to copy its formatting.');
    const style = getComputedStyle(node.nodeType === 1 ? node : node.parentElement);
    copiedFormat = { font: style.fontFamily, color: style.color, bold: parseInt(style.fontWeight) >= 600, italic: style.fontStyle === 'italic' };
    $('#paint-btn').classList.add('active'); notify('Select other text, then click Copy formatting again.');
  } else {
    command('fontName', copiedFormat.font); command('foreColor', copiedFormat.color);
    if (document.queryCommandState('bold') !== copiedFormat.bold) command('bold');
    if (document.queryCommandState('italic') !== copiedFormat.italic) command('italic');
    copiedFormat = null; $('#paint-btn').classList.remove('active');
  }
};
$('#star-btn').onclick = () => { active.starred = !active.starred; $('#star-btn').classList.toggle('starred', active.starred); $('#star-btn').setAttribute('aria-pressed', String(active.starred)); persist(); notify(active.starred ? 'Added to starred documents' : 'Removed from starred documents'); };

const modal = $('#modal');
function showModal(title, content, setup) {
  hideMenu(); $('#modal-title').textContent = title; $('#modal-content').innerHTML = content;
  if (!modal.open) modal.showModal();
  setup?.();
}
function closeModal() { modal.close(); }
$('#modal-close').onclick = closeModal;
modal.addEventListener('click', event => { if (event.target === modal) { const r = modal.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeModal(); } });
function actionButtons(primary, id = 'modal-submit') { return `<div class="modal-actions"><button class="secondary-button" data-close>Cancel</button><button class="primary-button" id="${id}">${primary}</button></div>`; }
modal.addEventListener('click', event => { if (event.target.closest('[data-close]')) closeModal(); });

function showDocuments() {
  persist();
  showModal('Your documents', `<div class="document-list">${[...state.documents].sort((a,b) => b.updated-a.updated).map(doc => `<button class="document-entry" data-doc-id="${escapeHTML(doc.id)}">${icon('file')}<span><strong>${escapeHTML(doc.title)}</strong><small>${doc.id === active.id ? 'Currently open · ' : ''}${new Date(doc.updated).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</small></span>${doc.starred ? '<span class="doc-star">★</span>' : ''}</button>`).join('')}</div><div class="modal-actions"><button class="secondary-button" id="import-dialog-btn">Import a file</button><button class="primary-button" id="create-doc-btn">New document</button></div>`, () => {
    $$('[data-doc-id]',modal).forEach(button => button.onclick = () => { loadDocument(state.documents.find(doc => doc.id === button.dataset.docId)); closeModal(); });
    $('#create-doc-btn').onclick = newDocument;
    $('#import-dialog-btn').onclick = () => $('#import-input').click();
  });
}
$('#documents-btn').onclick = showDocuments;
$('#folder-btn').onclick = showDocuments;
$('#new-tab-btn').onclick = newDocument;
$('#document-tab').onclick = () => { $('#document-workspace').scrollTo({top:0,behavior:'smooth'}); };
function makeCopy() {
  persist();
  const copy = JSON.parse(JSON.stringify(active)); copy.id = crypto.randomUUID(); copy.title = `Copy of ${active.title}`; copy.updated = Date.now();
  state.documents.unshift(copy); loadDocument(copy); notify('A copy was added to your documents');
}
function saveFile() {
  showModal('Save file', `<label for="save-filename">File name</label><input id="save-filename" value="${escapeHTML($('#document-title').value.trim() || 'Untitled document')}"><label for="save-format">File format</label><select id="save-format"><option value="html">Formatted document (.html)</option><option value="txt">Plain text (.txt)</option></select>${actionButtons('Save file')}`, () => {
    $('#save-filename').focus();
    $('#save-filename').select();
    const save = () => {
      const filename = $('#save-filename').value.trim();
      if (!filename) { $('#save-filename').focus(); return; }
      const format = $('#save-format').value;
      download(format, filename.replace(/\.(html|txt)$/i, ''));
      closeModal();
    };
    $('#modal-submit').onclick = save;
    $('#save-filename').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); save(); } };
  });
}
function download(type, filename) {
  persist();
  let contents, mime, extension;
  if (type === 'txt') { contents = editor.innerText; mime = 'text/plain'; extension = 'txt'; }
  else {
    contents = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(active.title)}</title><style>body{max-width:700px;margin:60px auto;padding:30px;font:15px/1.7 Arial,sans-serif;color:#333b40}h1{font-size:42px;line-height:1.2;color:#263f34}h2{color:#344b3d}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dde3df;padding:12px;text-align:left}th,.brief-meta{background:#f0f4f0}.brief-meta{padding:16px}.eyebrow{font-size:11px;letter-spacing:2px;color:#648073}blockquote{border-left:3px solid #94ab99;padding:10px 20px}img{max-width:100%}.doc-subtitle,.doc-end{color:#838789}@media print{body{margin:0}}</style></head><body>${sanitizeHTML(editor.innerHTML)}</body></html>`;
    mime = 'text/html'; extension = 'html';
  }
  const blob = new Blob([contents], {type:mime+';charset=utf-8'});
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `${(filename || active.title).replace(/[\\/:*?"<>|]/g,'-')}.${extension}`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000); notify('Your document copy has been downloaded');
}
$('#import-input').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 4 * 1024 * 1024) { notify('Choose a document smaller than 4 MB.'); event.target.value = ''; return; }
  try {
    const text = await file.text(); persist();
    const doc = { id:crypto.randomUUID(),title:file.name.replace(/\.(txt|html?)$/i,''),html:/\.html?$/i.test(file.name) ? sanitizeHTML(text) : text.split(/\n/).map(line => `<p>${escapeHTML(line) || '<br>'}</p>`).join(''),comments:[],starred:false,updated:Date.now(),notes:'',tasks:[] };
    state.documents.unshift(doc); loadDocument(doc); closeModal(); notify('Document imported');
  } catch { notify('This document could not be imported.'); }
  event.target.value = '';
};
function linkDialog() {
  const text = savedRange?.toString() || '';
  showModal('Insert link', `<label for="link-text">Text</label><input id="link-text" value="${escapeHTML(text)}" placeholder="Link text"><label for="link-url">Link</label><input id="link-url" type="url" placeholder="https://example.com"><p id="link-error" hidden></p>${actionButtons('Apply')}`, () => {
    $('#link-url').focus();
    $('#modal-submit').onclick = () => {
      let href = $('#link-url').value.trim(); const label = $('#link-text').value.trim() || href;
      if (!/^[a-z]+:/i.test(href)) href = 'https://' + href;
      try { const url = new URL(href); if (!['https:','http:','mailto:'].includes(url.protocol) || (url.protocol !== 'mailto:' && !url.hostname.includes('.'))) throw Error(); } catch { $('#link-error').hidden = false; $('#link-error').textContent = 'Enter a valid web or email address.'; return; }
      closeModal(); command('insertHTML', `<a href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)}</a>`);
    };
  });
}
$('#link-btn').onclick = linkDialog;
$('#image-btn').onclick = () => { if (viewing) return notify('Switch to Editing to insert an image.'); $('#image-input').click(); };
$('#image-input').onchange = event => {
  const file = event.target.files[0]; if (!file) return;
  if (!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type)) { notify('Choose a PNG, JPEG, GIF, or WebP image.'); event.target.value = ''; return; }
  if (file.size > 2*1024*1024) { notify('Choose an image smaller than 2 MB so your document can be saved.'); event.target.value = ''; return; }
  const reader = new FileReader(); reader.onload = () => { command('insertHTML', `<img src="${reader.result}" alt="${escapeHTML(file.name)}"><p><br></p>`); }; reader.onerror = () => notify('Unable to read this image.'); reader.readAsDataURL(file); event.target.value = '';
};
function tableDialog() {
  showModal('Insert table', '<label for="table-rows">Rows</label><input id="table-rows" type="number" min="1" max="20" value="3"><label for="table-cols">Columns</label><input id="table-cols" type="number" min="1" max="8" value="3">'+actionButtons('Insert'), () => {
    $('#modal-submit').onclick = () => {
      const rows = Math.min(20,Math.max(1,parseInt($('#table-rows').value)||3)); const cols = Math.min(8,Math.max(1,parseInt($('#table-cols').value)||3));
      closeModal(); command('insertHTML', '<table><tbody>'+Array.from({length:rows},() => '<tr>'+Array.from({length:cols},() => '<td><br></td>').join('')+'</tr>').join('')+'</tbody></table><p><br></p>');
    };
  });
}

function toggleComments(force) {
  const hidden = force === undefined ? !app.classList.contains('comments-hidden') : !force;
  app.classList.toggle('comments-hidden',hidden); app.classList.toggle('comments-open-mobile',!hidden);
  $('#comments-btn').setAttribute('aria-pressed',String(!hidden));
}
$('#comments-btn').onclick = () => {
  if (window.innerWidth <= 850) toggleComments(!app.classList.contains('comments-open-mobile'));
  else toggleComments();
};
$('#close-comments').onclick = () => toggleComments(false);
function findQuote(quote) {
  if (!quote) return;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT); const nodes = []; let text = ''; let node;
  while ((node = walker.nextNode())) { nodes.push({ node, start:text.length }); text += node.textContent; }
  const start = text.indexOf(quote); if (start === -1) return notify('The quoted text has changed.');
  const end = start + quote.length; const first = nodes.find(n => n.start+n.node.textContent.length > start); const last = nodes.find(n => n.start+n.node.textContent.length >= end);
  if (!first || !last) return;
  const range = document.createRange(); range.setStart(first.node,start-first.start); range.setEnd(last.node,end-last.start);
  editor.focus(); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); savedRange = range.cloneRange(); first.node.parentElement.scrollIntoView({behavior:'smooth',block:'center'});
}
function renderComments() {
  const visible = active.comments.filter(c => commentFilter === 'all' || (commentFilter === 'resolved' ? c.resolved : !c.resolved));
  $('#comment-count').textContent = active.comments.filter(c => !c.resolved).length;
  $('.comment-filter>span').textContent = commentFilter === 'resolved' ? 'Resolved comments' : commentFilter === 'all' ? 'All comments' : 'Open comments';
  $('#comments-list').innerHTML = visible.length ? visible.map((comment,index) => `<section class="comment-card ${index===0?'selected':''}" data-comment-id="${escapeHTML(comment.id)}"><div class="comment-author"><span class="avatar" style="background:${comment.color};color:${comment.ink}">${escapeHTML(comment.initials)}</span><div><strong>${escapeHTML(comment.author)}</strong><time>${escapeHTML(comment.time)}</time></div><button class="icon-button resolve-comment" data-id="${escapeHTML(comment.id)}" title="${comment.resolved?'Reopen comment':'Resolve comment'}" aria-label="${comment.resolved?'Reopen comment':'Resolve comment'}">${icon(comment.resolved?'undo':'check')}</button></div>${comment.quote?`<button class="comment-quote" data-quote-id="${escapeHTML(comment.id)}">${escapeHTML(comment.quote)}</button>`:''}<p class="comment-text">${escapeHTML(comment.text)}</p>${(comment.replies||[]).map(reply=>`<div class="reply-item"><strong>${escapeHTML(reply.author)}</strong><p>${escapeHTML(reply.text)}</p></div>`).join('')}${comment.resolved?`<div class="resolved-label">${icon('check')}Resolved</div>`:`<input class="comment-reply" aria-label="Reply to ${escapeHTML(comment.author)}" placeholder="Reply or add others" data-reply-id="${escapeHTML(comment.id)}">`}</section>`).join('') : '<div class="empty-state">'+(commentFilter==='resolved'?'No resolved comments yet.':'You’re all caught up.<br>Add a comment to start a conversation.')+'</div>';
  $$('.resolve-comment').forEach(button => button.onclick = () => { const c = active.comments.find(c=>c.id===button.dataset.id); c.resolved=!c.resolved; renderComments(); persist(); notify(c.resolved?'Comment resolved':'Comment reopened'); });
  $$('[data-quote-id]').forEach(button => button.onclick = () => findQuote(active.comments.find(c=>c.id===button.dataset.quoteId).quote));
  $$('.comment-reply').forEach(input => input.onkeydown = event => {
    if (event.key==='Enter' && input.value.trim()) { const c=active.comments.find(c=>c.id===input.dataset.replyId); c.replies.push({author:state.name||'You',text:input.value.trim()}); renderComments(); persist(); notify('Reply added'); }
  });
}
function addComment() {
  const quote = savedRange?.toString().trim().slice(0,350) || '';
  showModal('Add a comment', `${quote?`<div class="quote-preview">${escapeHTML(quote)}</div>`:''}<label for="comment-input">Comment</label><textarea id="comment-input" placeholder="Share a thought or leave a note…"></textarea>${actionButtons('Comment')}`, () => {
    $('#comment-input').focus();
    $('#modal-submit').onclick = () => {
      const text = $('#comment-input').value.trim(); if (!text) { $('#comment-input').focus(); return; }
      const name = state.name || 'You';
      active.comments.push({id:crypto.randomUUID(),author:name,initials:name[0].toUpperCase(),color:'#e0ede5',ink:'#386653',time:new Date().toLocaleDateString(undefined,{month:'short',day:'numeric'})+', '+new Date().toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}),quote,text,replies:[],resolved:false});
      commentFilter='open'; renderComments(); persist(); closeModal(); toggleComments(true); notify('Comment added');
    };
  });
}
$('#add-comment-btn').onclick = addComment; $('#new-comment-btn').onclick=addComment;

const dropdown = $('#dropdown');
let menuAnchor = null;
function hideMenu() {
  dropdown.hidden = true;
  menuAnchor = null;
  $$('[data-menu]').forEach(button => { button.classList.remove('active'); button.setAttribute('aria-expanded', 'false'); });
}
function showMenu(anchor, items) {
  hideMenu();
  menuAnchor = anchor;
  if (anchor.dataset.menu) { anchor.classList.add('active'); anchor.setAttribute('aria-expanded', 'true'); }
  dropdown.setAttribute('aria-label', anchor.textContent.trim() || anchor.getAttribute('aria-label') || 'Options');
  dropdown.innerHTML = items.map((item,index) => item==='-' ? '<hr>' : typeof item === 'string' ? `<div class="menu-caption">${escapeHTML(item)}</div>` : `<button role="menuitem" data-item="${index}">${escapeHTML(item.label)}<span>${escapeHTML(item.shortcut || '')}</span></button>`).join('');
  dropdown.hidden=false; const rect=anchor.getBoundingClientRect();
  dropdown.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-dropdown.offsetWidth-8))+'px'; dropdown.style.top=Math.min(rect.bottom+5,window.innerHeight-dropdown.offsetHeight-15)+'px';
  $$('[data-item]',dropdown).forEach(button=>button.onclick=()=>{ const item=items[Number(button.dataset.item)];hideMenu();item.action(); });
}
document.addEventListener('click',event=>{ if(!dropdown.contains(event.target) && !event.target.closest('[data-menu]') && !event.target.closest('[data-dropdown-anchor]'))hideMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !dropdown.hidden) { const anchor = menuAnchor; hideMenu(); anchor?.focus(); } });
dropdown.addEventListener('keydown',event=>{
  const buttons=$$('button',dropdown);const i=buttons.indexOf(document.activeElement);
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[(i < 0 ? (event.key==='ArrowDown'?0:buttons.length-1) : (i+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length)]?.focus();}
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    if (!menuAnchor?.dataset.menu) return;
    event.preventDefault();
    switchMenu(menuAnchor, event.key === 'ArrowRight' ? 1 : -1, true);
  }
  if (event.key === 'Tab') hideMenu();
});
function menuButton(id, items) { const button=$(id); button.dataset.dropdownAnchor='true';button.onclick=()=>showMenu(button,items); }
menuButton('#align-btn',[
  {label:'Align left',action:()=>command('justifyLeft')},{label:'Center',action:()=>command('justifyCenter')},{label:'Align right',action:()=>command('justifyRight')},{label:'Justify',action:()=>command('justifyFull')}
]);
menuButton('#spacing-btn',[1,1.15,1.5,2].map(value=>({label:value===1?'Single':value===2?'Double':String(value),action:()=>{
  if(viewing)return notify('Switch to Editing to make changes.');restoreSelection();const selection=window.getSelection();const blocks=$$('p,h1,h2,h3,li,blockquote',editor).filter(block=>selection.rangeCount&&selection.getRangeAt(0).intersectsNode(block));blocks.forEach(block=>block.style.lineHeight=String(value));changed();
}})));
menuButton('#mode-btn', [{label:'Editing',action:()=>setMode(false)},{label:'Viewing',action:()=>setMode(true)}]);
function setMode(value) { viewing=value;editor.contentEditable=String(!value);app.classList.toggle('viewing',value);$('#mode-btn span').textContent=value?'Viewing':'Editing';notify(value?'Viewing mode enabled':'Editing mode enabled'); }
menuButton('#comment-filter-btn',[{label:'Open comments',action:()=>{commentFilter='open';renderComments();}},{label:'Resolved comments',action:()=>{commentFilter='resolved';renderComments();}},{label:'All comments',action:()=>{commentFilter='all';renderComments();}}]);
$('#collapse-btn').onclick=()=>{app.classList.toggle('menus-hidden');$('#collapse-btn svg').classList.toggle('flip');$('#collapse-btn').title=app.classList.contains('menus-hidden')?'Show menus':'Hide menus';};
$('#outline-toggle').onclick=()=>app.classList.toggle('outline-hidden');
$('#rail-collapse').onclick=()=>app.classList.add('rail-hidden');

function showWordCount() {
  const text=editor.innerText.trim();const selection=savedRange?.toString().trim();
  showModal('Word count',`<div class="stats-grid"><div class="stat"><strong>${text?text.split(/\s+/).length:0}</strong><span>Words</span></div><div class="stat"><strong>${text.length}</strong><span>Characters</span></div><div class="stat"><strong>${text.replace(/\s/g,'').length}</strong><span>Characters without spaces</span></div><div class="stat"><strong>${Math.max(1,Math.ceil(editor.offsetHeight/1120))}</strong><span>Estimated pages</span></div></div>${selection?`<p>Selection: ${selection.split(/\s+/).length} words</p>`:''}<div class="modal-actions"><button class="primary-button" data-close>Done</button></div>`);
}
function showDetails() { showModal('Document details',`<p><strong>${escapeHTML(active.title)}</strong></p><p>Last saved ${new Date(active.updated).toLocaleString()}</p><p>${state.documents.length} ${state.documents.length===1?'document':'documents'} in this workspace.</p><p class="local-notice">Documents and comments are saved in this browser on this device. Download a copy to keep a backup.</p><div class="modal-actions"><button class="primary-button" id="details-export">Download a copy</button></div>`,()=>{$('#details-export').onclick=()=>download('html');}); }
$('#history-btn').onclick=showDetails;
function showShare() {
  persist();
  showModal(`Share “${active.title}”`, `<div class="permission-row"><span class="avatar" style="background:#386653;color:white">${escapeHTML((state.name||'K')[0])}</span><div><strong>${escapeHTML(state.name||'You')} (you)</strong><small>This device’s workspace</small></div><span>Owner</span></div><p class="local-notice">This document is saved locally. To share it, download a formatted copy and send the file. Live collaboration isn’t connected.</p><label>Download a copy</label><p>HTML keeps your formatting. A text file works with any text editor.</p><div class="modal-actions"><button class="secondary-button" id="share-text">Plain text</button><button class="primary-button" id="share-html">Formatted document</button></div>`,()=>{$('#share-text').onclick=()=>download('txt');$('#share-html').onclick=()=>download('html');});
}
$('#share-btn').onclick=showShare;
function showFind() {
  hideMenu(); if($('#find-bar'))return $('#find-input').focus();
  const bar=document.createElement('div');bar.className='search-bar';bar.id='find-bar';bar.innerHTML='<input id="find-input" placeholder="Find in document" aria-label="Find in document"><button id="find-next">Next</button><button class="icon-button" id="find-close" aria-label="Close find">'+icon('close')+'</button>';
  $('#document-workspace').append(bar);
  let lastTerm='';let offset=0;
  const find=()=>{
    const term=$('#find-input').value;if(!term)return;
    const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);let text='';const nodes=[];let node;
    while((node=walker.nextNode())){nodes.push({node,start:text.length});text+=node.textContent;}
    if(term!==lastTerm){offset=0;lastTerm=term;}
    let index=text.toLowerCase().indexOf(term.toLowerCase(),offset);if(index<0)index=text.toLowerCase().indexOf(term.toLowerCase());
    if(index<0){notify('No matches found');return;}
    const first=nodes.find(n=>n.start+n.node.textContent.length>index);const last=nodes.find(n=>n.start+n.node.textContent.length>=index+term.length);
    const range=document.createRange();range.setStart(first.node,index-first.start);range.setEnd(last.node,index+term.length-last.start);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);savedRange=range.cloneRange();first.node.parentElement.scrollIntoView({behavior:'smooth',block:'center'});offset=index+term.length;
  };
  $('#find-next').onclick=find;$('#find-input').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();find();}if(event.key==='Escape')bar.remove();};$('#find-close').onclick=()=>bar.remove();$('#find-input').focus();
}
function showShortcuts() { showModal('Keyboard shortcuts',`<div class="shortcuts">${[['Bold','⌘ / Ctrl + B'],['Italic','⌘ / Ctrl + I'],['Underline','⌘ / Ctrl + U'],['Undo','⌘ / Ctrl + Z'],['Redo','⌘ / Ctrl + Shift + Z'],['Insert link','⌘ / Ctrl + K'],['Find in document','⌘ / Ctrl + F'],['Save document','⌘ / Ctrl + S'],['Print','⌘ / Ctrl + P']].map(([label,key])=>`<div class="shortcut"><span>${label}</span><kbd>${key}</kbd></div>`).join('')}</div>`); }
const menus={
 file:()=>[{label:'New document',action:newDocument},{label:'Open…',shortcut:'Saved documents',action:showDocuments},{label:'Make a copy',action:makeCopy},'-',{label:'Save file…',shortcut:'⌘ / Ctrl + S',action:saveFile},{label:'Download as HTML',action:()=>download('html')},{label:'Download as plain text',action:()=>download('txt')},{label:'Save as PDF',shortcut:'Print dialog',action:()=>window.print()},'-',{label:'Rename',action:()=>{$('#document-title').focus();$('#document-title').select();}},{label:'Document details',action:showDetails},{label:'Print',shortcut:'⌘P',action:()=>window.print()}],
 edit:()=>[{label:'Undo',shortcut:'⌘Z',action:()=>command('undo')},{label:'Redo',shortcut:'⌘⇧Z',action:()=>command('redo')},'-',{label:'Select all',shortcut:'⌘A',action:()=>{restoreSelection();document.execCommand('selectAll');}},{label:'Find',shortcut:'⌘F',action:showFind}],
 view:()=>[{label:app.classList.contains('outline-hidden')?'Show document outline':'Hide document outline',action:()=>app.classList.toggle('outline-hidden')},{label:'Toggle comments',action:()=>toggleComments()},{label:app.classList.contains('rail-hidden')?'Show side panel':'Hide side panel',action:()=>app.classList.toggle('rail-hidden')},'-',{label:viewing?'Switch to Editing':'Switch to Viewing',action:()=>setMode(!viewing)},{label:'Full screen',action:()=>{if(document.fullscreenElement)document.exitFullscreen?.();else document.documentElement.requestFullscreen?.().catch(()=>notify('Full screen is unavailable in this preview.'));}}],
 insert:()=>[{label:'Image from device',action:()=>$('#image-input').click()},{label:'Table',action:tableDialog},{label:'Link',shortcut:'⌘K',action:linkDialog},{label:'Comment',action:addComment},'-',{label:'Horizontal line',action:()=>command('insertHorizontalRule')},{label:'Page break',action:()=>command('insertHTML','<hr style="break-after:page"><p><br></p>')}],
 format:()=>[{label:'Normal text',action:()=>command('formatBlock','p')},{label:'Title',action:()=>command('formatBlock','h1')},{label:'Heading 1',action:()=>command('formatBlock','h2')},{label:'Heading 2',action:()=>command('formatBlock','h3')},'-',{label:'Strikethrough',action:()=>command('strikeThrough')},{label:'Superscript',action:()=>command('superscript')},{label:'Subscript',action:()=>command('subscript')},'-',{label:'Clear formatting',action:()=>command('removeFormat')}],
 tools:()=>[{label:'Word count',action:showWordCount},{label:editor.spellcheck?'Disable spell check':'Enable spell check',action:()=>$('#spellcheck-btn').click()},{label:'Document notes',action:showNotes}],
 help:()=>[{label:'Keyboard shortcuts',action:showShortcuts},{label:'About this workspace',action:()=>showModal('A little room to write','<p>A familiar document editor for your ideas, plans, and next big thing.</p><p>Use the toolbar to format selected text, add headings to organize your outline, and leave comments on passages.</p><p class="local-notice">Your work is saved on this device. You can open your documents with the blue document icon, or download a copy from File. This independent demo is not affiliated with Google.</p>')}]
};
function switchMenu(anchor, direction, focusItem = false) {
  const buttons = $$('[data-menu]').filter(button => button.getClientRects().length);
  const next = buttons[(buttons.indexOf(anchor) + direction + buttons.length) % buttons.length];
  showMenu(next, menus[next.dataset.menu]());
  if (focusItem) $('button', dropdown)?.focus(); else next.focus();
}
$$('[data-menu]').forEach(button => {
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'dropdown');
  button.onclick = () => {
    if (!dropdown.hidden && menuAnchor === button) hideMenu();
    else showMenu(button, menus[button.dataset.menu]());
  };
  button.addEventListener('pointerenter', event => {
    if (event.pointerType === 'touch' || dropdown.hidden || !menuAnchor?.dataset.menu || menuAnchor === button) return;
    showMenu(button, menus[button.dataset.menu]());
  });
  button.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      showMenu(button, menus[button.dataset.menu]());
      const items = $$('button', dropdown);
      items[event.key === 'ArrowDown' ? 0 : items.length - 1]?.focus();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      switchMenu(button, event.key === 'ArrowRight' ? 1 : -1);
    } else if (event.key === 'Tab') hideMenu();
  });
});
$('#rail-add-btn').dataset.dropdownAnchor='true';$('#rail-add-btn').onclick=()=>showMenu($('#rail-add-btn'),menus.insert());
function showNotes() {
  showModal('Document notes',`<p>A place for thoughts that don’t belong on the page yet.</p><textarea class="notes-area" id="notes-input" aria-label="Document notes" placeholder="Jot something down…">${escapeHTML(active.notes||'')}</textarea><div class="modal-actions"><button class="primary-button" id="save-notes">Done</button></div>`,()=>{
    $('#notes-input').oninput=()=>{active.notes=$('#notes-input').value;persist();};$('#save-notes').onclick=()=>{closeModal();notify('Notes saved');};
  });
}
$('#notes-btn').onclick=showNotes;
$('#tasks-btn').onclick=()=>{
  showModal('Document checklist', `<div class="checklist" id="checklist"></div><label for="task-input">New task</label><input id="task-input" placeholder="What needs to get done?"><div class="modal-actions"><button class="primary-button" id="add-task">Add task</button></div>`,()=>{
    const render=()=>{$('#checklist').innerHTML=active.tasks.map((task,i)=>`<label><input type="checkbox" data-task="${i}" ${task.done?'checked':''}><span style="${task.done?'text-decoration:line-through;color:#9399a2':''}">${escapeHTML(task.text)}</span></label>`).join('')||'<p>No tasks yet.</p>';$$('[data-task]').forEach(box=>box.onchange=()=>{active.tasks[Number(box.dataset.task)].done=box.checked;persist();render();});};
    const add=()=>{const text=$('#task-input').value.trim();if(!text)return;active.tasks.push({text,done:false});$('#task-input').value='';persist();render();};$('#add-task').onclick=add;$('#task-input').onkeydown=event=>{if(event.key==='Enter')add();};render();
  });
};
$('#calendar-btn').onclick=()=>{
  const now=new Date();const year=now.getFullYear();const month=now.getMonth();const first=new Date(year,month,1).getDay();const count=new Date(year,month+1,0).getDate();
  showModal(now.toLocaleDateString(undefined,{month:'long',year:'numeric'}),'<div class="date-grid">'+['S','M','T','W','T','F','S'].map(day=>`<span class="day-name">${day}</span>`).join('')+'<span></span>'.repeat(first)+Array.from({length:count},(_,i)=>`<span class="${i+1===now.getDate()?'today':''}">${i+1}</span>`).join('')+'</div><p>Today is '+now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})+'.</p>');
};
$('#profile-btn').onclick=()=>{
  showModal('Your workspace',`<label for="profile-name">Your name</label><input id="profile-name" value="${escapeHTML(state.name||'')}" placeholder="Your name"><p>This name appears on your comments and replies.</p>${actionButtons('Save')}`,()=>{$('#modal-submit').onclick=()=>{state.name=$('#profile-name').value.trim()||'You';$('#profile-btn').textContent=state.name[0].toUpperCase();persist();closeModal();notify('Workspace updated');};});
};
document.addEventListener('keydown',event=>{
  if(!(event.metaKey||event.ctrlKey)||modal.open)return;
  if(event.key.toLowerCase()==='s'){event.preventDefault();saveFile();}
  if(event.key.toLowerCase()==='k'&&editor.contains(document.activeElement)){event.preventDefault();linkDialog();}
  if(event.key.toLowerCase()==='f'){event.preventDefault();showFind();}
});

// The same document journeys are available to browsers supporting WebMCP.
if (document.modelContext?.registerTool) {
  const lifecycle=new AbortController();
  const tools=[
    {name:'read_current_document',title:'Read current document',description:'Read the current document title, plain text, and word count.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){if(!input||typeof input!=='object'||Object.keys(input).length)throw new Error('Expected an empty object.');return{title:active.title,text:editor.innerText,words:editor.innerText.trim().split(/\s+/).filter(Boolean).length};}},
    {name:'create_document',title:'Create document',description:'Create and open a new locally saved document with a title and optional plain text.',inputSchema:{type:'object',properties:{title:{type:'string',minLength:1,maxLength:200},text:{type:'string',maxLength:100000}},required:['title'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute(input){if(!input||typeof input.title!=='string'||!input.title.trim()||input.title.length>200||(input.text!==undefined&&(typeof input.text!=='string'||input.text.length>100000))||Object.keys(input).some(k=>!['title','text'].includes(k)))throw new Error('Provide a title of 1–200 characters and optional text.');persist();const doc={id:crypto.randomUUID(),title:input.title.trim(),html:(input.text||'').split('\n').map(line=>`<p>${escapeHTML(line)||'<br>'}</p>`).join(''),comments:[],starred:false,updated:Date.now(),notes:'',tasks:[]};state.documents.unshift(doc);loadDocument(doc);return{id:doc.id,title:doc.title,saved:$('#save-status').textContent==='All changes saved'};}}
  ];
  for(const tool of tools){try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{/* Unsupported experimental implementations do not block the editor. */}}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
loadDocument(active);
$('#profile-btn').textContent=(state.name||'K')[0].toUpperCase();
if(window.innerWidth<=850)$('#comments-btn').setAttribute('aria-pressed','false');
window.addEventListener('resize',updateStats);
