import fs from 'fs';

const logFile = 'C:\\Users\\xxmoh\\.gemini\\antigravity-ide\\brain\\bdab48b8-d66b-4470-ad87-8e96dae44393\\.system_generated\\logs\\transcript.jsonl';
if (fs.existsSync(logFile)) {
  const content = fs.readFileSync(logFile, 'utf8');
  const idx = content.indexOf('Work Stream 2');
  if (idx >= 0) {
    console.log('Found in bdab48b8:', idx);
    console.log(content.substring(idx - 100, idx + 4000));
  } else {
    console.log('Not found in bdab48b8. Scanning for "index" or "composite":');
    const idx2 = content.indexOf('indexes');
    if (idx2 >= 0) {
      console.log(content.substring(idx2 - 100, idx2 + 1000));
    } else {
      console.log('Nothing found in bdab48b8');
    }
  }
} else {
  console.log('File does not exist:', logFile);
}
