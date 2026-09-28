export const extractMarkers = (content) => {
  const markers = [];
  content.split('\n').forEach((line, i) => {
    const after = line.match(/@addon-insert:after\s*\(\s*(["'])(.*?)\1\s*\)/);
    const before = line.match(/@addon-insert:before\s*\(\s*(["'])(.*?)\1\s*\)/);
    const replace = line.match(/@addon-insert:replace\s*\(\s*(["'])(.*?)\1\s*\)/);
    if (after) markers.push({type: 'after', lineIndex: i, searchText: after[2]});
    else if (before) markers.push({type: 'before', lineIndex: i, searchText: before[2]});
    else if (replace) markers.push({type: 'replace', lineIndex: i, markerName: replace[2]});
    else if (line.includes('@addon-insert:prepend')) markers.push({type: 'prepend', lineIndex: i});
    else if (line.includes('@addon-insert:append')) markers.push({type: 'append', lineIndex: i});
  });
  return markers;
};

const collectContentBetweenMarkers = (lines, startIndex) => {
  const content = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (lines[i].trim().includes('@addon-end')) break;
    content.push(lines[i]);
  }
  return content;
};

const trimmedLines = (lines) => lines.map(l => l.trim()).filter(Boolean);

const normalizeContent = (lines) => trimmedLines(lines)
  .filter(l => !l.startsWith('//') && !l.startsWith('#') && !l.startsWith('/*') && !l.startsWith('*'))
  .join('|');

// A comment-only block has no code signature, so it is matched on its comment lines instead.
const isAlreadyPresent = (block, target) => {
  const signature = normalizeContent(block);
  if (signature) return `|${normalizeContent(target)}|`.includes(`|${signature}|`);
  const comments = trimmedLines(block).join('|');
  return !comments || `|${trimmedLines(target).join('|')}|`.includes(`|${comments}|`);
};

const ENV_KEY = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

// A group's leading comments and blank lines are only added together with its first new variable.
const processEnvContent = (content, targetContent) => {
  const lines = [];
  const existing = new Set(targetContent.split('\n').map(line => line.match(ENV_KEY)?.[1]).filter(Boolean));
  let header = [], inGroup = false, count = 0;
  for (const line of content) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed) {
      if (inGroup) [header, inGroup] = [[], false];
      header.push(line);
      continue;
    }
    inGroup = true;
    const key = line.match(ENV_KEY)?.[1];
    if (!key || existing.has(key)) continue;
    existing.add(key);
    lines.push(...header, line);
    header = [];
    count++;
  }
  return {content: lines, count};
};

const findInsertIndex = (lines, searchText, type) => {
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(searchText)) return type === 'before' ? i : i + 1;
  return -1;
};

export const mergeContent = (targetContent, addonContent, markers, isEnv = false) => {
  const addonLines = addonContent.split('\n');
  const operations = [];
  let newContent = targetContent;
  if (isEnv && !markers.length) markers = [{type: 'append', lineIndex: -1}];

  for (const marker of markers) {
    let content = collectContentBetweenMarkers(addonLines, marker.lineIndex);
    if (!content.length) continue;
    let lineCount = content.length;

    if (isEnv) {
      const processed = processEnvContent(content, newContent);
      content = processed.content;
      lineCount = processed.count;
      if (!lineCount) {
        operations.push({success: false, type: marker.type, lines: 0, searchText: marker.searchText});
        continue;
      }
    } else {
      if (isAlreadyPresent(content, newContent.split('\n'))) {
        operations.push({success: false, type: marker.type, lines: content.length, searchText: marker.searchText || marker.markerName});
        continue;
      }
    }

    if (marker.type === 'prepend') {
      newContent = content.join('\n') + '\n' + newContent;
      operations.push({success: true, type: 'prepend', lines: lineCount});
    } else if (marker.type === 'append') {
      if (!newContent.endsWith('\n')) newContent += '\n';
      newContent += '\n' + content.join('\n') + '\n';
      operations.push({success: true, type: 'append', lines: lineCount});
    } else if (marker.type === 'replace' && marker.markerName) {
      const targetLines = newContent.split('\n');
      const replaceIndex = findInsertIndex(targetLines, marker.markerName, 'before');
      if (replaceIndex === -1) {
        operations.push({success: false, type: 'notfound', markerName: marker.markerName});
        continue;
      }
      targetLines.splice(replaceIndex, 1, ...content);
      newContent = targetLines.join('\n');
      operations.push({success: true, type: 'replace', lines: lineCount, markerName: marker.markerName});
    } else if ((marker.type === 'after' || marker.type === 'before') && marker.searchText) {
      const targetLines = newContent.split('\n');
      const insertIndex = findInsertIndex(targetLines, marker.searchText, marker.type);
      if (insertIndex === -1) {
        operations.push({success: false, type: 'notfound', searchText: marker.searchText});
        continue;
      }
      targetLines.splice(insertIndex, 0, ...content);
      newContent = targetLines.join('\n');
      operations.push({success: true, type: marker.type, lines: lineCount, searchText: marker.searchText});
    }
  }

  return {content: newContent, operations};
};
