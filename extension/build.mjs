import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const releases = path.join(root, 'releases');
const baseManifest = {
  manifest_version: 3,
  name: 'Definitive Fantasy Sync',
  version: '1.0.0',
  description: 'Sync private ESPN fantasy leagues to your Definitive Fantasy account.',
  permissions: ['cookies', 'storage'],
  host_permissions: [
    'https://*.espn.com/*',
    'https://zkuwkyfofloayoeoyyej.supabase.co/*',
  ],
  action: { default_popup: 'popup.html' },
};

const chromeManifest = {
  ...baseManifest,
  minimum_chrome_version: '95', // Promises for chrome.storage.local in Manifest V3.
};

const firefoxManifest = {
  ...baseManifest,
  browser_specific_settings: {
    gecko: {
      // Stable, generated UUID. Keep this value unchanged for all future releases.
      id: '{3282a1a4-a39f-41e3-a272-7e0de3645173}',
      // Firefox 140+ provides built-in consent for transmitting these data types.
      strict_min_version: '140.0',
      data_collection_permissions: {
        // Email/account login and ESPN authentication cookies are transmitted.
        required: ['authenticationInfo', 'personallyIdentifyingInfo', 'websiteContent'],
      },
    },
    gecko_android: {
      // Built-in data consent arrived on Firefox for Android in version 142.
      strict_min_version: '142.0',
    },
  },
};

for (const [target, manifest] of [
  ['chrome', chromeManifest],
  ['firefox', firefoxManifest],
]) {
  const output = path.join(releases, target);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(path.join(root, 'src', 'popup.html'), path.join(output, 'popup.html'));
  await cp(path.join(root, 'src', 'popup.js'), path.join(output, 'popup.js'));
}

// Bundle once, then reuse byte-for-byte in both browsers. No remote scripts.
await build({
  entryPoints: [path.join(root, 'src', 'supabase-entry.js')],
  bundle: true,
  outfile: path.join(releases, 'chrome', 'supabase.js'),
  platform: 'browser',
  format: 'iife',
  target: ['chrome95', 'firefox140'],
  legalComments: 'inline',
});
await cp(
  path.join(releases, 'chrome', 'supabase.js'),
  path.join(releases, 'firefox', 'supabase.js'),
);

// The bundled third-party code is redistributed with its license notices.
const licenseFiles = [
  ['@supabase/supabase-js', 'LICENSE'],
  ['@supabase/auth-js', 'LICENSE'],
  ['@supabase/functions-js', 'LICENSE'],
  ['@supabase/postgrest-js', 'LICENSE'],
  ['@supabase/realtime-js', 'LICENSE'],
  ['@supabase/storage-js', 'LICENSE'],
  ['@supabase/phoenix', 'LICENSE.md'],
  ['iceberg-js', 'LICENSE'],
  ['tslib', 'LICENSE.txt'],
];
const licenses = await Promise.all(licenseFiles.map(async ([name, licenseFile]) =>
  `${name} — ${licenseFile}\n\n${await readFile(path.join(root, 'node_modules', name, licenseFile), 'utf8')}`,
));
for (const target of ['chrome', 'firefox']) {
  await writeFile(path.join(releases, target, 'THIRD_PARTY_LICENSES.txt'),
    `${licenses.join('\n\n' + '='.repeat(72) + '\n\n')}\n`);
}
console.log('Built releases/chrome/ and releases/firefox/.');
