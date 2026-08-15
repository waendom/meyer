#!/usr/bin/env node
// Turns the folders under albums/ into everything the gallery needs.
//
//   albums/digital/*.jpg       ->  assets/full/*.jpg   (large, for the enlarged view)
//   albums/mixed-media/*.jpg   ->  assets/thumb/*.jpg  (small, for the grid tiles)
//                              ->  gallery-data.js     (order, ratios, categories, mapping)
//
// Drop a file into an album folder, commit, done. The GitHub Action runs this and commits
// the result back, so nothing has to be prepared by hand.

import { readdir, mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { solveSubstitutes, verify, checkAllView } from './assign.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ALBUMS = {
  digital: 'albums/digital',
  mixed:   'albums/mixed-media',
};
const FULL_DIR  = 'assets/full';
const THUMB_DIR = 'assets/thumb';
const FULL_MAX  = 1400;   // enough for a phone or laptop at full screen
const THUMB_MAX = 560;    // grid tiles are never drawn larger than this
const MIN_PER_CATEGORY = 4;   // below this the lattice cannot avoid repeats side by side

const IMAGE_RE = /\.(jpe?g|png|webp|tiff?)$/i;
const NUMBERED_RE = /^(\d{3})-/;

async function listImages(dir){
  if(!existsSync(path.join(ROOT, dir))) return [];
  const names = (await readdir(path.join(ROOT, dir))).filter(n => IMAGE_RE.test(n) && !n.startsWith('.'));
  // already-numbered files keep their place; anything new sorts after them by name
  const numbered = names.filter(n => NUMBERED_RE.test(n)).sort();
  const fresh = names.filter(n => !NUMBERED_RE.test(n)).sort();
  return { numbered, fresh };
}

// New files are given the next free number and renamed in place, so ordering is stable
// and visible in the repo rather than hidden in a config file.
async function assignNumbers(dir, { numbered, fresh }){
  let next = 1;
  for(const n of numbered){
    const v = parseInt(NUMBERED_RE.exec(n)[1], 10);
    if(v >= next) next = v + 1;
  }
  const finalNames = [...numbered];
  for(const n of fresh){
    const num = String(next++).padStart(3, '0');
    const clean = n.replace(/\s+/g, '-').toLowerCase();
    const target = `${num}-${clean}`;
    await rename(path.join(ROOT, dir, n), path.join(ROOT, dir, target));
    console.log(`  numbered new upload: ${n} -> ${target}`);
    finalNames.push(target);
  }
  return finalNames.sort();
}

async function main(){
  await mkdir(path.join(ROOT, FULL_DIR), { recursive: true });
  await mkdir(path.join(ROOT, THUMB_DIR), { recursive: true });

  const entries = [];      // { id, slug, category, ratio }
  for(const [category, dir] of Object.entries(ALBUMS)){
    const found = await listImages(dir);
    if(!found.numbered && !found.fresh) continue;
    const names = await assignNumbers(dir, found);
    console.log(`${dir}: ${names.length} artwork(s)`);
    for(const name of names){
      const src = path.join(ROOT, dir, name);
      const slug = `${category}-${name.replace(IMAGE_RE, '')}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
      const img = sharp(src, { failOn: 'none' }).rotate();      // respect EXIF orientation
      const meta = await img.metadata();
      const w = meta.width, h = meta.height;
      if(!w || !h){ console.warn(`  skipping unreadable file: ${name}`); continue; }

      const fullScale  = Math.min(1, FULL_MAX  / Math.max(w, h));
      const thumbScale = Math.min(1, THUMB_MAX / Math.max(w, h));
      await img.clone().resize(Math.round(w*fullScale),  Math.round(h*fullScale))
        .jpeg({ quality: 82, progressive: true, mozjpeg: true })
        .toFile(path.join(ROOT, FULL_DIR, `${slug}.jpg`));
      await img.clone().resize(Math.round(w*thumbScale), Math.round(h*thumbScale))
        .jpeg({ quality: 76, progressive: true, mozjpeg: true })
        .toFile(path.join(ROOT, THUMB_DIR, `${slug}.jpg`));

      // "012-red-tree-study.jpg" -> "Red Tree Study". albums/meta.json overrides this.
      const bare = name.replace(IMAGE_RE, '').replace(NUMBERED_RE, '');
      const pretty = bare.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/\b\w/g, ch => ch.toUpperCase());
      entries.push({ slug, category, file: name, ratio: +(w/h).toFixed(6), title: pretty });
    }
  }

  if(entries.length < 5){
    console.error(`\nNeed at least 5 artworks in total, found ${entries.length}.`);
    console.error('The gallery repeats endlessly in every direction; with fewer than five');
    console.error('pieces the same one would always end up next to itself.');
    process.exit(1);
  }

  // Interleave the categories so the unfiltered view mixes them instead of showing all of
  // one kind in a clump.
  const byCat = { digital: [], mixed: [] };
  entries.forEach(e => byCat[e.category].push(e));
  const order = [];
  for(let i = 0; i < Math.max(byCat.digital.length, byCat.mixed.length); i++){
    if(byCat.digital[i]) order.push(byCat.digital[i]);
    if(byCat.mixed[i])   order.push(byCat.mixed[i]);
  }

  const ids = order.map((_, i) => i + 1);
  const N = ids.length;

  // Per-artwork title, date and image description. The build fills in sensible defaults;
  // albums/meta.json overrides any of them without touching code.
  let meta = {};
  const metaPath = path.join(ROOT, 'albums', 'meta.json');
  if(existsSync(metaPath)){
    try { meta = JSON.parse(await readFile(metaPath, 'utf8')); }
    catch(err){ console.warn('albums/meta.json could not be read:', err.message); }
  }

  const RATIO = {}, CAT = {}, SRC = {}, THUMB = {}, TITLE = {}, DATE = {}, ALT = {};
  order.forEach((e, i) => {
    const id = i + 1;
    const m = meta[e.file] || meta[e.slug] || {};
    RATIO[id] = e.ratio; CAT[id] = e.category;
    SRC[id]   = `${FULL_DIR}/${e.slug}.jpg`;
    THUMB[id] = `${THUMB_DIR}/${e.slug}.jpg`;
    TITLE[id] = m.title || e.title || 'Untitled';
    DATE[id]  = m.date  || '';                      // empty leaves the placeholder visible
    // A real description serves screen readers and search engines; the filename is a far
    // better starting point than "Artwork 3".
    ALT[id]   = m.alt || `${TITLE[id]} — ${e.category === 'mixed' ? 'mixed media' : 'digital'} work by Lukas Meyer`;
  });

  // How far the pattern shifts from one row to the next. Which value works depends on how
  // many artworks there are, so rather than fixing it we try the sensible ones and keep the
  // first that lays out every category cleanly — that way adding one image cannot quietly
  // cost a filter button.
  const categories = ['digital', 'mixed'];
  const eligible = categories.filter(c => ids.filter(id => CAT[id] === c).length >= MIN_PER_CATEGORY);
  categories.filter(c => !eligible.includes(c)).forEach(c => {
    const n = ids.filter(id => CAT[id] === c).length;
    console.warn(`\n"${c}" has only ${n} artwork(s) — its filter stays hidden.`);
    console.warn(`Add at least ${MIN_PER_CATEGORY} (6 is comfortably safe) to switch it on.`);
  });

  let best = null;
  for(let B = 2; B <= Math.max(6, Math.floor(N/2)); B++){
    if(!checkAllView(N, B)) continue;
    const subs = {}; const ok = [];
    for(const category of eligible){
      const pool = ids.filter(id => CAT[id] === category);
      const s = solveSubstitutes(ids, pool, B);
      if(!s) continue;
      const check = verify(ids, pool, s, B, 12);
      if(check.touches || check.missing) continue;
      subs[category] = s; ok.push(category);
    }
    if(!best || ok.length > best.ok.length){ best = { B, subs, ok }; }
    if(ok.length === eligible.length) break;         // nothing left to improve
  }
  if(!best){
    console.error(`Cannot lay out ${N} artworks without a piece repeating beside itself.`);
    process.exit(1);
  }
  const { B: B_ROW, subs: SUBS, ok: enabled } = best;
  console.log(`  row shift ${B_ROW} chosen`);
  enabled.forEach(c => console.log(`  "${c}": ${ids.filter(id => CAT[id] === c).length} artworks, mapping verified`));
  eligible.filter(c => !enabled.includes(c)).forEach(c =>
    console.warn(`\nCould not lay out "${c}" without repeats at any row shift — filter hidden.`));

  // The banner and the single piece on the front page. By default the build picks the
  // first artworks; featured.json lets those be chosen deliberately without touching code.
  let featured = { banner: [], firstLook: null };
  const featuredPath = path.join(ROOT, 'featured.json');
  if(existsSync(featuredPath)){
    try { featured = { ...featured, ...JSON.parse(await readFile(featuredPath, 'utf8')) }; }
    catch(err){ console.warn('featured.json could not be read — using defaults:', err.message); }
  }
  const findId = want => {
    if(!want) return null;
    const needle = String(want).toLowerCase().replace(IMAGE_RE, '');
    const hit = order.findIndex(e => e.slug.includes(needle));
    return hit === -1 ? null : hit + 1;
  };
  const bannerIds = (featured.banner || []).map(findId).filter(Boolean);
  while(bannerIds.length < 2){
    const next = ids.find(id => !bannerIds.includes(id));
    if(!next) break;
    bannerIds.push(next);
  }
  const firstLookId = findId(featured.firstLook) || ids.find(id => !bannerIds.includes(id)) || ids[0];
  console.log(`  banner: ${bannerIds.map(id => order[id-1].slug).join(', ')}`);
  console.log(`  front page piece: ${order[firstLookId-1].slug}`);

  // Favicon and the picture shown when the link is shared, cut from an artwork so the site
  // never turns up as a blank grey box in a chat.
  const iconId = findId(featured.icon) || bannerIds[0] || ids[0];
  const iconEntry = order[iconId - 1];
  const iconSrc = path.join(ROOT, ALBUMS[iconEntry.category], iconEntry.file);
  try {
    await sharp(iconSrc).rotate().resize(180, 180, { fit: 'cover' })
      .png().toFile(path.join(ROOT, 'favicon.png'));
    await sharp(iconSrc).rotate().resize(1200, 630, { fit: 'cover' })
      .jpeg({ quality: 84 }).toFile(path.join(ROOT, 'share-preview.jpg'));
    console.log(`  favicon and sharing image from ${iconEntry.slug}`);
  } catch(err){
    console.warn('  could not generate favicon/sharing image:', err.message);
  }

  const data =
`// GENERATED by scripts/build-gallery.mjs — do not edit by hand.
// Add or remove images in albums/ and let the GitHub Action rebuild this file.
window.GALLERY = ${JSON.stringify({
  ids, RATIO, CAT, SRC, THUMB, TITLE, DATE, ALT, SUBS, B_ROW,
  banner: bannerIds.map(id => SRC[id]),
  firstLook: SRC[firstLookId],
  filters: ['all', ...enabled],
  generated: new Date().toISOString().slice(0,10)
}, null, 2)};
`;
  await writeFile(path.join(ROOT, 'gallery-data.js'), data, 'utf8');
  console.log(`\nWrote gallery-data.js — ${N} artworks, filters: all${enabled.length ? ', ' + enabled.join(', ') : ''}`);
}

main().catch(err => { console.error(err); process.exit(1); });
