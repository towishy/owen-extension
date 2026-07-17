import AdmZip from 'adm-zip';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const browserDir = join(root, 'browser-extension');
const distDir = join(root, 'dist');
const version = packageJson.version;
const outputName = `owen-browser-capture-browser-extension-${version}.zip`;
const outputPath = join(distDir, outputName);
const checkOnly = process.argv.includes('--check');

const requiredFiles = [
  'manifest.json',
  'protocol-runtime.js',
  'background.js',
  'popup.html',
  'popup.js',
  'popup.css'
];

validateBrowserExtension();

if (!checkOnly) {
  mkdirSync(distDir, { recursive: true });
  const zip = new AdmZip();
  const rootFolder = `owen-browser-capture-browser-extension-${version}`;
  for (const filePath of listFiles(browserDir)) {
    const rel = relative(browserDir, filePath).split(sep).join('/');
    zip.addLocalFile(filePath, dirnameForZipEntry(rootFolder, rel));
  }
  zip.writeZip(outputPath);
  verifyZip(outputPath, rootFolder);
  console.log(`Created ${outputPath}`);
}

function validateBrowserExtension() {
  for (const file of requiredFiles) {
    const fullPath = join(browserDir, file);
    if (!statSync(fullPath, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Missing browser extension file: ${file}`);
    }
  }

  const manifest = JSON.parse(readFileSync(join(browserDir, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) {
    throw new Error('browser-extension/manifest.json must use manifest_version 3');
  }
  if (manifest.background?.service_worker !== 'background.js') {
    throw new Error('browser-extension manifest must point background.service_worker to background.js');
  }
  if (manifest.action?.default_popup !== 'popup.html') {
    throw new Error('browser-extension manifest must point action.default_popup to popup.html');
  }
  if (!Array.isArray(manifest.permissions) || !manifest.permissions.includes('storage')) {
    throw new Error('browser-extension manifest must include storage permission');
  }
  if (!Array.isArray(manifest.host_permissions) || !manifest.host_permissions.includes('<all_urls>')) {
    throw new Error('browser-extension manifest must include permanent <all_urls> access for passive agent operation');
  }
  if (Array.isArray(manifest.optional_host_permissions) && manifest.optional_host_permissions.length > 0) {
    throw new Error('browser-extension manifest must not require optional per-site host permissions');
  }
  for (const file of ['protocol-runtime.js', 'background.js', 'popup.js']) {
    const result = spawnSync(process.execPath, ['--check', join(browserDir, file)], { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`Browser extension syntax check failed: ${file}`);
    }
  }
}

function verifyZip(zipPath, rootFolder) {
  const zip = new AdmZip(zipPath);
  const entries = new Set(zip.getEntries().map(entry => entry.entryName));
  for (const file of requiredFiles) {
    const expected = `${rootFolder}/${file}`;
    if (!entries.has(expected)) {
      throw new Error(`Release ZIP is missing ${expected}`);
    }
  }
}

function dirnameForZipEntry(rootFolder, relPath) {
  const lastSlash = relPath.lastIndexOf('/');
  if (lastSlash === -1) {
    return rootFolder;
  }
  return `${rootFolder}/${relPath.slice(0, lastSlash)}`;
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(fullPath);
    }
    return [fullPath];
  });
}