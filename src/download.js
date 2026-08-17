import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import cp from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import asar from '@electron/asar';

const root = path.resolve(import.meta.dirname, '..');
export const outDir = path.join(root, 'out');
const tmpDir = path.join(root, 'tmp');

export async function fetchManifest(channel = 'canary') {
  const url = `https://discord.com/api/updates/distributions/app/manifests/latest?platform=win&channel=${channel}&arch=x64`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch manifest (${res.status} ${res.statusText})`);
  return res.json();
}

function extractAsars(dir) {
  if (!fs.existsSync(dir)) return;

  for (const file of fs.readdirSync(dir, { recursive: true })) {
    if (!file.endsWith('.asar')) continue;
    const fullPath = path.join(dir, file);
    const dest = fullPath.slice(0, -5);

    try {
      asar.extractAll(fullPath, dest);
    } catch (err) {
      console.warn(`Failed to extract asar ${file}:`, err.message);
    }
  }
}

export async function downloadModule(channel, modName, manifest) {
  const isHost = modName === 'host';
  const hostVer = manifest.full.host_version.join('.');
  const modKey = isHost ? 'host' : (modName.startsWith('discord_') ? modName : `discord_${modName}`);
  const cleanName = isHost ? 'host' : modKey.replace(/^discord_/, '');

  const data = isHost ? manifest.full : manifest.modules?.[modKey]?.full;
  const version = isHost ? hostVer : data?.module_version;
  if (version === undefined || version === null) return;

  const url = data?.url;
  if (!url) throw new Error(`No download URL for ${modName}`);

  console.log(`downloading ${cleanName}@${version}...`);

  const destDir = isHost
    ? path.join(outDir, 'host')
    : path.join(outDir, 'modules', cleanName);

  const tarFile = path.join(tmpDir, `${cleanName}-${version}.tar`);

  fs.rmSync(tarFile, { force: true });
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(destDir, { recursive: true });

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed for ${url} (${res.status})`);

  await pipeline(
    Readable.fromWeb(res.body),
    zlib.createBrotliDecompress(),
    fs.createWriteStream(tarFile)
  );

  await new Promise((resolve, reject) => {
    cp.execFile('tar', ['--strip-components', '1', '-xf', tarFile, '-C', destDir], err => {
      if (err) return reject(err);
      resolve();
    });
  });

  fs.rmSync(tarFile, { force: true });
  extractAsars(destDir);
}
