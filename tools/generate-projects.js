// DEPTH: DEEP
// tools/generate-projects.js
// Usage: node tools/generate-projects.js --owner=JackFShields --out=projects.json
// This script is intentionally conservative: it catches network issues, rate limits,
// and writes partial output where possible.

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { execSync } from 'child_process';

function argv(name, fallback){
  const p = process.argv.find(a => a.startsWith(`--${name}=`));
  if(!p) return fallback;
  return p.split('=')[1];
}

const owner = argv('owner', 'JackFShields');
const outFile = argv('out', 'projects.json');
const token = process.env.GITHUB_TOKEN || '';
const apiBase = 'https://api.github.com';

const headers = {
  'Accept': 'application/vnd.github.v3+json',
  ...(token ? {'Authorization': `token ${token}`} : {})
};

async function fetchJson(url){
  const res = await fetch(url, {headers});
  if(res.status >= 400) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function stripMarkdown(md){
  if(!md) return '';
  // remove code blocks
  md = md.replace(/```[\s\S]*?```/g,' ');
  md = md.replace(/`[^`]*`/g,' ');
  // remove images and keep alt text
  md = md.replace(/!

\[([^\]

]*)\]

\(([^)]+)\)/g,'$1');
  // convert links to text
  md = md.replace(/

\[([^\]

]+)\]

\(([^)]+)\)/g,'$1');
  return md.replace(/\s+/g,' ').trim();
}

function firstImageFromMarkdown(md){
  if(!md) return null;
  const m = md.match(/!

\[[^\]

]*\]

\(([^)]+)\)/i);
  if(m && m[1]) return m[1];
  // check raw urls to images
  const urlm = md.match(/https?:\/\/\S+\.(png|jpe?g|gif|svg)/i);
  if(urlm) return urlm[0];
  return null;
}

async function fetchReadme(owner,name){
  try {
    const url = `${apiBase}/repos/${owner}/${name}/readme`;
    const res = await fetch(url, {headers});
    if(res.status === 404) return null;
    const json = await res.json();
    // json.content is base64
    const b64 = json.content || '';
    const md = Buffer.from(b64,'base64').toString('utf8');
    return md;
  } catch(e){
    console.warn('readme fetch failed',owner,name,e.message);
    return null;
  }
}

async function main(){
  console.log('Generate projects.json for', owner);
  try {
    const repos = await fetchJson(`${apiBase}/users/${owner}/repos?per_page=200&type=owner`);
    const out = [];
    for(const r of repos){
      try {
        // ignore forks optionally
        if(r.fork) continue;
        const name = r.name;
        const description = r.description || '';
        const homepage = r.homepage || `https://${owner}.github.io/${name}/`;
        const topics = await (async ()=>{
          try {
            const t = await fetchJson(`${apiBase}/repos/${owner}/${name}/topics`);
            return t.names || [];
          } catch { return []; }
        })();
        const md = await fetchReadme(owner,name);
        const readme_text = stripMarkdown(md || '');
        let readme_image = firstImageFromMarkdown(md || '');
        // if image is relative path, convert to raw url
        if(readme_image && !readme_image.startsWith('http')){
          readme_image = `https://raw.githubusercontent.com/${owner}/${name}/main/${readme_image.replace(/^\.\//,'')}`;
        }
        // best-effort screenshot attempt: if homepage exists, try to use social preview api or site metadata
        // we won't screenshot server-side here (too heavy). prefer social preview image via GitHub Open Graph if present
        let social = null;
        try {
          // fetch repo page HTML and search for og:image
          const html = await (await fetch(`https://github.com/${owner}/${name}`)).text();
          const og = html.match(/<meta property="og:image" content="([^"]+)"/i);
          if(og) social = og[1];
        } catch(e){}
        const image = readme_image || social || null;
        out.push({
          name,
          title: name,
          description,
          homepage,
          topics,
          readme_text,
          readme_image: readme_image || null,
          image,
          color: null,
          url: homepage
        });
      } catch(e){
        console.warn('repo processing failed', r.name, e.message);
      }
    }
    // write out file
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
    console.log('Wrote', outFile);
  } catch(e){
    console.error('Failed to list repos:', e.message);
    process.exit(1);
  }
}

main();
