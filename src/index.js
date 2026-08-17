import fs from 'node:fs';
import path from 'node:path';
import { fetchManifest, downloadModule, outDir } from './download.js';

const LIGHT_PINK = 0xffb6c1;

function parseVersions(manifest) {
  const modules = {};
  for (const [key, val] of Object.entries(manifest.modules || {})) {
    modules[key.replace(/^discord_/, '')] = val.full.module_version;
  }
  return {
    host: manifest.full.host_version.join('.'),
    modules
  };
}

function getDiff(oldVer, newVer) {
  if (!oldVer) return [];
  const diff = [];

  if (oldVer.host !== newVer.host) {
    diff.push({ name: 'host', from: oldVer.host, to: newVer.host });
  }

  const keys = new Set([...Object.keys(oldVer.modules), ...Object.keys(newVer.modules)]);
  for (const key of keys) {
    const from = oldVer.modules[key];
    const to = newVer.modules[key];
    if (from !== to) {
      diff.push({ name: key, from: from ?? 'none', to: to ?? 'removed' });
    }
  }

  return diff;
}

async function sendWebhook(url, channel, hostVer, diff) {
  if (!url || !diff.length) return;

  const repo = process.env.GITHUB_REPOSITORY;
  const diffLink = repo ? `\n\n[🔍 View Code Diff on GitHub](https://github.com/${repo}/commits/${channel})` : '';

  let lines = diff.map(d => `\`${d.name}\`: \`${d.from}\` → \`${d.to}\``).join('\n');
  if (lines.length > 3700) lines = lines.slice(0, 3650) + '\n...';

  const payload = {
    embeds: [{
      title: `Discord Changed Something :3 — ${channel.toUpperCase()}`,
      color: LIGHT_PINK,
      description: `${lines}${diffLink}`,
      fields: [
        { name: 'Host', value: `\`${hostVer}\``, inline: true },
        { name: 'Channel', value: `\`${channel}\``, inline: true },
        { name: 'Changed', value: `\`${diff.length}\``, inline: true }
      ],
      footer: {
        text: 'github.com/abbienull'
      },
      timestamp: new Date().toISOString()
    }]
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) console.warn(`webhook failed: ${res.status}`);
  } catch (err) {
    console.warn(`webhook error: ${err.message}`);
  }
}

async function main() {
  const [channel = 'canary', oldManifestPath] = process.argv.slice(2);

  let oldVersions = null;
  if (oldManifestPath && fs.existsSync(oldManifestPath)) {
    try {
      oldVersions = parseVersions(JSON.parse(fs.readFileSync(oldManifestPath, 'utf8')));
    } catch {}
  }

  console.log(`[${channel}] fetching manifest...`);
  const manifest = await fetchManifest(channel);
  const versions = parseVersions(manifest);

  const targets = ['host', ...Object.keys(manifest.modules || {})];
  for (const mod of targets) {
    try {
      await downloadModule(channel, mod, manifest);
    } catch (err) {
      console.error(`[${channel}] error downloading ${mod}:`, err.message);
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const diff = getDiff(oldVersions, versions);
  if (diff.length) {
    console.log(`[${channel}] changes detected:`);
    for (const d of diff) console.log(`  ${d.name}: ${d.from} -> ${d.to}`);

    fs.writeFileSync('changes.txt', diff.map(d => `${d.name}: ${d.from} -> ${d.to}`).join('\n'));

    if (process.env.DISCORD_WEBHOOK) {
      await sendWebhook(process.env.DISCORD_WEBHOOK, channel, versions.host, diff);
    }
  } else {
    console.log(`[${channel}] no version changes.`);
  }

  const table = Object.entries(versions.modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join('\n');

  fs.writeFileSync(path.join(outDir, 'README.md'), `# discord-desktop-datamining

## ${channel} (${versions.host})

| Module | Version |
| :--- | :---: |
${table}

### branches

- [stable](../../tree/stable)
- [ptb](../../tree/ptb)
- [canary](../../tree/canary)
- [development](../../tree/development)

### credits

- [abbienull](https://github.com/abbienull)
`);

  console.log(`[${channel}] done.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
