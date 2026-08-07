const https = require('https');
function fetch(u) {
  return new Promise((res, rej) => {
    https.get(u, {headers: {'User-Agent': 'node'}}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(d));
    }).on('error', rej);
  });
}
(async () => {
  // 搜索 Chromium 里的 blocked extensions
  const queries = [
    '"Name is not allowed" repo:chromium/chromium',
    'blocked_extensions ini exe repo:chromium/chromium',
    'GetBlockedExtensionList repo:chromium/chromium',
    'IsBlockedExtension repo:chromium/chromium',
  ];
  for (const q of queries) {
    const u = 'https://api.github.com/search/code?q=' + encodeURIComponent(q) + '&per_page=3';
    try {
      const j = JSON.parse(await fetch(u));
      if (j.total_count > 0) {
        console.log('QUERY:', q);
        console.log('total:', j.total_count);
        for (const i of (j.items || []).slice(0,3)) console.log(' ', i.path);
        console.log();
      }
    } catch(e) {}
  }

  // 直接拉 Chromium file_system_access.cc / permission_context.cc 搜 blocked
  const files = [
    'https://raw.githubusercontent.com/chromium/chromium/main/content/browser/file_system_access/file_system_access_permission_context.cc',
  ];
  for (const url of files) {
    try {
      const text = await fetch(url);
      const lines = text.split('\n').filter(l => /blocked|extension|\.ini|\.exe|\.bat|\.reg/i.test(l));
      if (lines.length) {
        console.log('=== ' + url.split('/').pop() + ' ===');
        lines.forEach(l => console.log(l.trim().substring(0, 250)));
      }
    } catch(e) { console.log('fetch err:', e.message); }
  }
})();
