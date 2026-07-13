const target = process.argv[2];

if (!target) {
  console.error('Usage: npm run verify:hosting -- https://your-project.web.app');
  process.exitCode = 1;
} else {
  const url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Hosting verification only supports HTTP(S) URLs.');
  }

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Hosting returned HTTP ${response.status}.`);
  }

  const checks = [
    ['content-security-policy', (value) => value.includes("frame-ancestors 'none'")],
    ['x-content-type-options', (value) => value.toLowerCase() === 'nosniff'],
    ['x-frame-options', (value) => value.toUpperCase() === 'DENY'],
    ['referrer-policy', (value) => value.length > 0],
    ['permissions-policy', (value) => value.length > 0],
  ];
  const failures = checks.filter(([name, verify]) => !verify(response.headers.get(name) || ''));

  if (failures.length) {
    failures.forEach(([name]) => console.error(`Missing or invalid header: ${name}`));
    process.exitCode = 1;
  } else {
    console.log(`Hosting headers verified: ${response.url}`);
  }
}

