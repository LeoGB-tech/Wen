'use strict';
/*
 * Ancre — aspirateur de sites pour la lecture hors ligne.
 * Serveur local : télécharge un site (pages, sous-pages, images, CSS, polices),
 * retire pubs / traqueurs / bandeaux cookies, et le sert hors ligne.
 */
const express = require('express');
const cheerio = require('cheerio');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT) || 4321;
const DATA = process.env.ANCRE_DATA || path.join(__dirname, 'sites');
fs.mkdirSync(DATA, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/* ───────────────────────── Filtres pubs / traqueurs ───────────────────────── */

const AD_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com',
  'googletagmanager.com', 'googletagservices.com', 'adservice.google.com', 'pagead2.googlesyndication.com',
  'imasdk.googleapis.com', '2mdn.net', 'amazon-adsystem.com', 'adnxs.com', 'adsrvr.org', 'criteo.com',
  'criteo.net', 'taboola.com', 'outbrain.com', 'scorecardresearch.com', 'quantserve.com', 'quantcount.com',
  'pubmatic.com', 'rubiconproject.com', 'openx.net', 'casalemedia.com', 'smartadserver.com', 'moatads.com',
  'adform.net', 'teads.tv', 'yieldmo.com', 'sharethrough.com', 'media.net', 'zemanta.com', 'hotjar.com',
  'facebook.net', 'analytics.twitter.com', 'ads-twitter.com', 'bat.bing.com', 'clarity.ms', 'mgid.com',
  'revcontent.com', 'onetrust.com', 'cookielaw.org', 'didomi.io', 'privacy-center.org', 'sddan.com',
  'xiti.com', 'chartbeat.com', 'chartbeat.net', 'nr-data.net', 'segment.com', 'segment.io', 'mixpanel.com',
  'optimizely.com', 'analytics.tiktok.com', 'snap.licdn.com', 'ads.linkedin.com', 'adsafeprotected.com',
  'doubleverify.com', 'gumgum.com', 'seedtag.com', 'ligatus.com', 'adition.com', 'yandex.ru/ads',
  'mc.yandex.ru', 'cookiebot.com', 'consensu.org', 'quantcast.com', 'trustarc.com', 'usercentrics.eu',
  'adsystem.com', 'adroll.com', 'bidswitch.net', 'indexww.com', 'lijit.com', 'sonobi.com', '33across.com',
  'contextweb.com', 'serving-sys.com', 'eyeota.net', 'bluekai.com', 'krxd.net', 'exelator.com',
  'cxense.com', 'piano.io', 'tinypass.com', 'permutive.com', 'permutive.app', 'adsco.re', 'ezoic.net',
  'ezojs.com', 'propellerads.com', 'popads.net', 'adsterra.com', 'exoclick.com', 'juicyads.com',
  'trafficjunky.net', 'plausible.io', 'matomo.cloud', 'stats.wp.com', 'pixel.wp.com', 'statcounter.com',
];

const AD_SELECTORS = [
  'ins.adsbygoogle', '[id^="google_ads"]', '[id^="div-gpt-ad"]', '[id^="gpt-ad"]', '[class*="adsbygoogle"]',
  '[data-ad]', '[data-ad-slot]', '[data-ad-unit]', '[data-ad-client]', '[data-google-query-id]', '[data-adunit]',
  '[aria-label="advertisement" i]', '[aria-label="publicité" i]', '[id^="taboola"]', '[id^="outbrain"]',
  '.OUTBRAIN', '.trc_related_container', '#onetrust-consent-sdk', '#onetrust-banner-sdk', '#didomi-host',
  '.didomi-popup', '.cc-window', '.cc-banner', '#CybotCookiebotDialog', '.qc-cmp2-container',
  '#qc-cmp2-container', '#usercentrics-root', '#cmpbox', '#cmpbox2', '.cmp-container', '#truste-consent-track',
  '#sp_message_container', '[id^="sp_message_container"]', '.fc-consent-root', '#gdpr-consent-tool-wrapper',
  '#cookie-law-info-bar', '#cookie-notice', '.cookie-notice', '#cookie-banner', '.cookie-banner',
  '#cookieConsent', '.cookie-consent', '#cookies-banner', '.cookies-banner', '#tarteaucitronRoot',
  '#axeptio_overlay', '.axeptio_widget', '#hs-eu-cookie-confirmation',
];

// Jetons de classe / id typiques des emplacements publicitaires.
const AD_TOKEN = /^(ad|ads|adv|advert|adverts|advertising|advertisement|advertisements|adsbox|adbox|adslot|adunit|adzone|adblock|adbanner|adsense|pub|publicite|publicité|sponsor|sponsored|sponsors|sponsoring|dfp|taboola|outbrain|ad[-_].+|.+[-_]ads?|.+[-_]advert.*|gpt[-_]ad.*|dfp[-_].+|google[-_]ad.*|banner[-_]ad.*|pub[-_](banner|container|slot|top|haut|bas|side|zone|wrapper)|.+[-_]sponsor(ed)?)$/i;
const PROTECTED_TAGS = new Set(['html', 'head', 'body', 'main', 'article', 'header', 'footer', 'nav']);

const SCRIPT_AD_HINT = /(googletag|adsbygoogle|gtag\(|fbq\(|_gaq|dataLayer|googletagmanager|__tcfapi|didomi|taboola|outbrain|hotjar|_paq\.push|clarity\()/i;

// Liens qu'on ne suit jamais.
const SKIP_LINK = /(\/logout|\/log-out|\/signout|\/sign-out|\/deconnexion|wp-login\.php|\/wp-admin|\/wp-json|\/xmlrpc\.php|add-to-cart|\/cart\b|\/panier|\/checkout|replytocom=|\?share=|\/feed\/?$|\/rss\/?$|\/comments\/feed|\/trackback|\/print\/|[?&]print=|\/cdn-cgi\/)/i;

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp|ico|tiff?)$/i;
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|txt|rtf|epub|csv)$/i;
const BINARY_EXT = /\.(zip|rar|7z|tar|gz|tgz|bz2|exe|msi|dmg|pkg|deb|rpm|apk|iso|bin|mp4|m4v|mkv|webm|avi|mov|wmv|flv|mp3|m4a|flac|wav|ogg|aac|wma|woff2?|ttf|otf|eot|css|js|json|xml)$/i;
const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|igshid|yclid|ref_src|__twitter_impression)$/i;

/* ───────────────────────── Utilitaires ───────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
const bareHost = (h) => h.toLowerCase().replace(/^www\./, '');

function isAdHost(hostname) {
  const h = hostname.toLowerCase();
  return AD_HOSTS.some((d) => h === d || h.endsWith('.' + d));
}

function cleanUrl(u) {
  const x = new URL(u);
  x.hash = '';
  for (const k of [...x.searchParams.keys()]) if (TRACKING_PARAM.test(k)) x.searchParams.delete(k);
  if (![...x.searchParams.keys()].length) x.search = '';
  return x;
}

// Clé canonique d'une page (sert de dédoublonnage et de recherche hors ligne).
function pageKey(u) {
  const x = cleanUrl(u);
  x.hostname = bareHost(x.hostname);
  x.protocol = 'https:';
  if (x.pathname.length > 1 && x.pathname.endsWith('/')) x.pathname = x.pathname.slice(0, -1);
  x.pathname = x.pathname.replace(/\/index\.(html?|php)$/i, '/') || '/';
  return x.href;
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
function safeSeg(s) {
  let out = s.normalize('NFC').replace(/[^\p{L}\p{N}._\-~@+,=]/gu, '_').replace(/[. ]+$/, '');
  if (!out) out = '_';
  if (RESERVED.test(out)) out = '_' + out;
  if (out.length > 80) {
    const ext = path.extname(out).slice(0, 10);
    out = out.slice(0, 60) + '~' + hash(s).slice(0, 8) + ext;
  }
  return out;
}

// Chemin local déterministe d'une URL (relatif au dossier du site).
function localRel(u, kind) {
  const url = new URL(u);
  let host = bareHost(url.hostname);
  if (url.port) host += '_' + url.port;
  const parts = url.pathname.split('/').slice(1).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  const last = parts.pop() || '';
  const dirs = parts.filter(Boolean).map(safeSeg);
  const q = url.search ? '__' + hash(url.search).slice(0, 8) : '';
  let name = last ? safeSeg(last) : '';
  let ext = path.extname(name).toLowerCase();

  if (kind === 'page') {
    if (!name) name = 'index';
    else if (ext === '.html' || ext === '.htm') name = name.slice(0, -ext.length);
    return [safeSeg(host), ...dirs, name + q + '.html'].join('/');
  }
  if (!name) { name = 'index'; ext = ''; }
  let base = ext ? name.slice(0, -ext.length) : name;
  const want = kind === 'css' ? '.css' : kind === 'js' ? '.js' : null;
  if (want && ext !== want) { base = name; ext = want; }
  return [safeSeg(host), ...dirs, base + q + ext].join('/');
}

function decodeHtml(buf, contentType) {
  let cs = (/charset=["']?([\w-]+)/i.exec(contentType || '') || [])[1];
  if (!cs) {
    const head = buf.subarray(0, 4096).toString('latin1');
    cs = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1];
  }
  try { return new TextDecoder((cs || 'utf-8').toLowerCase()).decode(buf); }
  catch { return buf.toString('utf8'); }
}

class Semaphore {
  constructor(n) { this.n = n; this.q = []; }
  async run(fn) {
    if (this.n <= 0) await new Promise((r) => this.q.push(r));
    this.n--;
    try { return await fn(); } finally { this.n++; const next = this.q.shift(); if (next) next(); }
  }
}

async function dirSize(dir) {
  let total = 0;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else { try { total += (await fsp.stat(p)).size; } catch {} }
  }
  return total;
}

function siteIdFor(startUrl) {
  const u = new URL(startUrl);
  const slug = bareHost(u.hostname).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return slug + '-' + hash(pageKey(startUrl)).slice(0, 6);
}

const siteDir = (id) => path.join(DATA, id);
async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJson(file, data) {
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, file);
}

/* ───────────────────────── Le moteur d'aspiration ───────────────────────── */

const DEFAULTS = {
  maxPages: 300, maxDepth: 4, subdomains: false, samePath: false, robots: true,
  keepScripts: false, documents: true, maxFileMB: 30, concurrency: 4, delay: 150,
};

class CrawlJob {
  constructor(startUrl, opts) {
    this.opts = { ...DEFAULTS, ...opts };
    this.opts.maxPages = Math.max(1, Math.min(5000, Number(this.opts.maxPages) || DEFAULTS.maxPages));
    this.opts.maxDepth = Math.max(0, Math.min(20, Number(this.opts.maxDepth)));
    this.opts.maxFileMB = Math.max(1, Math.min(500, Number(this.opts.maxFileMB) || DEFAULTS.maxFileMB));
    const start = cleanUrl(startUrl);
    this.start = start.href;
    this.root = bareHost(start.hostname);
    this.prefix = this.opts.samePath ? start.pathname.replace(/[^/]*$/, '') : '';
    this.id = siteIdFor(this.start);
    this.jobId = this.id + '-' + Date.now().toString(36);
    this.dir = siteDir(this.id);
    this.status = 'running';
    this.queue = [];
    this.seen = new Set();
    this.taken = 0;
    this.active = 0;
    this.assets = new Map();
    this.pending = new Set();
    this.assetSem = new Semaphore(8);
    this.abort = new AbortController();
    this.robotRules = null;
    this.stats = { pages: 0, assets: 0, bytes: 0, errors: 0, blocked: 0 };
    this.current = '';
    this.log = [];
    this.startedAt = Date.now();
    this.finishedAt = null;
  }

  note(level, msg) {
    this.log.push({ t: Date.now(), level, msg });
    if (this.log.length > 60) this.log.shift();
  }

  inScope(u) {
    let x;
    try { x = new URL(u); } catch { return false; }
    if (!/^https?:$/.test(x.protocol)) return false;
    const h = bareHost(x.hostname);
    const okHost = this.opts.subdomains ? (h === this.root || h.endsWith('.' + this.root)) : h === this.root;
    if (!okHost) return false;
    if (this.prefix && !x.pathname.startsWith(this.prefix)) return false;
    return true;
  }

  goUrl(abs, frag) {
    return `/go/${this.id}?u=${encodeURIComponent(abs)}${frag || ''}`;
  }

  fetch(url) {
    return fetch(url, {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(30000)]),
    });
  }

  async readBody(res) {
    const max = this.opts.maxFileMB * 1024 * 1024;
    const len = Number(res.headers.get('content-length')) || 0;
    if (len > max) { try { await res.body?.cancel(); } catch {} return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > max ? null : buf;
  }

  /* robots.txt (groupe User-agent: *) */
  async loadRobots() {
    if (!this.opts.robots) return;
    try {
      const origin = new URL(this.start).origin;
      const res = await this.fetch(origin + '/robots.txt');
      if (!res.ok) return;
      const txt = await res.text();
      const rules = [];
      let applies = false, inUaBlock = false;
      for (const raw of txt.split(/\r?\n/)) {
        const line = raw.replace(/#.*/, '').trim();
        const m = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
        if (!m) continue;
        const key = m[1].toLowerCase(), val = m[2].trim();
        if (key === 'user-agent') {
          if (!inUaBlock) applies = false;
          inUaBlock = true;
          if (val === '*') applies = true;
          continue;
        }
        inUaBlock = false;
        if (!applies || (key !== 'allow' && key !== 'disallow') || !val) continue;
        const re = new RegExp('^' + val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
        rules.push({ allow: key === 'allow', re, len: val.length });
      }
      this.robotRules = rules;
    } catch { /* pas de robots.txt : tout est permis */ }
  }

  robotsOk(u) {
    if (!this.robotRules || !this.robotRules.length) return true;
    const x = new URL(u);
    const p = x.pathname + x.search;
    let best = null;
    for (const r of this.robotRules) if (r.re.test(p) && (!best || r.len > best.len || (r.len === best.len && r.allow))) best = r;
    return !best || best.allow;
  }

  enqueue(u, depth) {
    let key;
    try { key = pageKey(u); } catch { return; }
    if (this.seen.has(key)) return;
    if (!this.inScope(u) || SKIP_LINK.test(u)) return;
    const pathname = new URL(u).pathname;
    if (IMAGE_EXT.test(pathname) || BINARY_EXT.test(pathname)) return;
    if (DOC_EXT.test(pathname) && !this.opts.documents) return;
    this.seen.add(key);
    if (!this.robotsOk(u)) { this.stats.blocked++; return; }
    this.queue.push({ url: cleanUrl(u).href, depth });
  }

  track(p) {
    const t = p.catch((e) => {
      if (e?.name !== 'AbortError') { this.stats.errors++; }
    }).finally(() => this.pending.delete(t));
    this.pending.add(t);
  }

  /* Ressource (image, css, police…) → chemin local. null = laisser tel quel, '' = pub à supprimer. */
  asset(raw, base, kind = 'asset') {
    if (!raw) return null;
    raw = raw.trim();
    if (!raw || /^(data:|blob:|about:|javascript:|#)/i.test(raw)) return null;
    let abs;
    try { abs = new URL(raw, base); } catch { return null; }
    if (!/^https?:$/.test(abs.protocol)) return null;
    if (isAdHost(abs.hostname)) return '';
    abs.hash = '';
    const key = abs.href;
    let rel = this.assets.get(key);
    if (!rel) {
      rel = localRel(key, kind);
      this.assets.set(key, rel);
      this.track(this.downloadAsset(key, rel, kind));
    }
    return `/view/${this.id}/${encodeURI(rel)}`;
  }

  async downloadAsset(url, rel, kind) {
    const dest = path.join(this.dir, rel);
    if (kind !== 'css' && fs.existsSync(dest)) { this.stats.assets++; return; }
    await this.assetSem.run(async () => {
      if (this.abort.signal.aborted) return;
      const res = await this.fetch(url);
      if (!res.ok) { try { await res.body?.cancel(); } catch {} throw new Error('HTTP ' + res.status); }
      let buf = await this.readBody(res);
      if (!buf) { this.note('warn', 'Fichier trop lourd ignoré : ' + url); return; }
      const ct = res.headers.get('content-type') || '';
      if (kind === 'css' || (ct.includes('text/css') && rel.endsWith('.css'))) {
        buf = Buffer.from(this.rewriteCss(buf.toString('utf8'), res.url || url));
      }
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, buf);
      this.stats.assets++;
      this.stats.bytes += buf.length;
    });
  }

  rewriteCss(css, base) {
    css = css.replace(/(@import\s*)?url\(\s*(['"]?)([^'")]*?)\2\s*\)/gi, (m, imp, q, u) => {
      const p = this.asset(u, base, imp ? 'css' : 'asset');
      if (p === null) return m;
      if (p === '') return imp ? '' : 'url("")';
      return (imp || '') + `url("${p}")`;
    });
    css = css.replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => {
      const p = this.asset(u, base, 'css');
      if (p === null) return m;
      return p === '' ? '' : `@import url("${p}")`;
    });
    return css;
  }

  rewriteSrcset(value, base) {
    return value.split(/,\s+/).map((part) => {
      const bits = part.trim().split(/\s+/);
      const url = (bits.shift() || '').replace(/,$/, '');
      const p = this.asset(url, base);
      return p ? [p, ...bits].join(' ') : (p === '' ? '' : part.trim());
    }).filter(Boolean).join(', ');
  }

  cleanAds($) {
    let removed = 0;
    const kill = (el) => {
      const tag = (el.tagName || el.name || '').toLowerCase();
      if (PROTECTED_TAGS.has(tag)) return;
      $(el).remove();
      removed++;
    };
    $(AD_SELECTORS.join(',')).each((_, el) => kill(el));
    $('[class],[id]').each((_, el) => {
      const tokens = [...(el.attribs.class || '').split(/\s+/), el.attribs.id || ''].filter(Boolean);
      if (tokens.some((t) => AD_TOKEN.test(t))) kill(el);
    });
    $('iframe[src],img[src],script[src],link[href]').each((_, el) => {
      const u = el.attribs.src || el.attribs.href;
      try { if (isAdHost(new URL(u, 'https://x.invalid').hostname)) kill(el); } catch {}
    });
    // pixels de suivi 1×1
    $('img[width="1"][height="1"], img[width="0"], img[height="0"]').each((_, el) => kill(el));
    return removed;
  }

  embedPlaceholder(orig) {
    const host = (() => { try { return new URL(orig).hostname.replace(/^www\./, ''); } catch { return 'contenu externe'; } })();
    return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:160px;max-width:100%;padding:20px;margin:12px 0;border:1px dashed #b8b1a4;border-radius:12px;background:#f5f2ec;color:#57524a;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;text-align:center"><strong style="font-weight:600;color:#2b2925">Contenu intégré (${host})</strong><span>Indisponible hors ligne.</span>${orig ? `<a href="${orig.replace(/"/g, '&quot;')}" target="_blank" rel="noopener" style="color:#c2410c">Ouvrir en ligne</a>` : ''}</div>`;
  }

  processHtml(html, pageUrl, depth) {
    const $ = cheerio.load(html);
    let base = pageUrl;
    const b = $('base[href]').attr('href');
    if (b) { try { base = new URL(b, pageUrl).href; } catch {} }
    $('base').remove();

    $('meta[http-equiv]').each((_, el) => {
      if (/content-security-policy|refresh|content-type/i.test(el.attribs['http-equiv'])) $(el).remove();
    });
    $('meta[charset]').remove();
    if (!$('head').length) $('html').prepend('<head></head>');
    $('head').prepend('<meta charset="utf-8">');

    this.cleanAds($);

    // Scripts
    if (!this.opts.keepScripts) {
      $('script, noscript').remove();
      $('link[rel~="modulepreload"]').remove();
    } else {
      $('script').each((_, el) => {
        const src = el.attribs.src;
        if (src) {
          const p = this.asset(src, base, 'js');
          if (p === '') $(el).remove();
          else if (p) $(el).attr('src', p);
        } else if (SCRIPT_AD_HINT.test($(el).html() || '')) $(el).remove();
      });
    }

    // Texte pour la recherche hors ligne (avant d'ajouter les encarts)
    const $text = cheerio.load($('body').html() || '');
    $text('nav, footer, header, aside, style, script, noscript, svg, iframe, form').remove();
    $text('p, div, li, br, td, th, h1, h2, h3, h4, h5, h6, section, article, blockquote, dt, dd').after(' ');
    const text = ($text.root().text() || '').replace(/\s+/g, ' ').trim().slice(0, 40000);

    // Indices de ressources inutiles hors ligne
    $('link').each((_, el) => {
      const rel = (el.attribs.rel || '').toLowerCase();
      if (/(^|\s)(preload|prefetch|preconnect|dns-prefetch|manifest|amphtml|alternate|pingback|EditURI|wlwmanifest)(\s|$)/i.test(rel)) {
        if (!/stylesheet/.test(rel)) $(el).remove();
      }
    });

    // Images chargées « paresseusement »
    const LAZY = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url', 'data-hi-res-src', 'data-full-src'];
    $('img, source').each((_, el) => {
      const a = el.attribs;
      for (const k of LAZY) {
        if (a[k] && !/^data:/.test(a[k])) {
          if (!a.src || /^data:|placeholder|blank|spacer|lazy|pixel|transparent/i.test(a.src)) $(el).attr('src', a[k]);
          break;
        }
      }
      const ss = a['data-srcset'] || a['data-lazy-srcset'];
      if (ss) $(el).attr('srcset', ss);
      for (const k of [...LAZY, 'data-srcset', 'data-lazy-srcset']) $(el).removeAttr(k);
      if (el.name === 'img') $(el).removeAttr('loading').removeClass('lazyload lazy');
    });

    // Ressources
    const rewriteAttr = (sel, attr, kind) => $(sel).each((_, el) => {
      const v = el.attribs[attr];
      const p = this.asset(v, base, kind);
      if (p === '') $(el).remove();
      else if (p) $(el).attr(attr, p);
    });
    rewriteAttr('img[src]', 'src');
    rewriteAttr('source[src]', 'src');
    rewriteAttr('video[poster]', 'poster');
    rewriteAttr('video[src]', 'src');
    rewriteAttr('audio[src]', 'src');
    rewriteAttr('track[src]', 'src');
    rewriteAttr('input[type="image"][src]', 'src');
    rewriteAttr('image[href]', 'href');
    rewriteAttr('image[xlink\\:href]', 'xlink:href');
    rewriteAttr('use[href^="http"]', 'href');
    $('link[href]').each((_, el) => {
      const rel = (el.attribs.rel || '').toLowerCase();
      if (/stylesheet/.test(rel)) {
        const p = this.asset(el.attribs.href, base, 'css');
        if (p === '') $(el).remove(); else if (p) $(el).attr('href', p);
      } else if (/icon|apple-touch/.test(rel)) {
        const p = this.asset(el.attribs.href, base);
        if (p) $(el).attr('href', p);
      } else if (rel === 'canonical' || rel === 'shortlink') {
        $(el).remove();
      }
    });
    $('img[srcset], source[srcset]').each((_, el) => {
      $(el).attr('srcset', this.rewriteSrcset(el.attribs.srcset, base));
    });
    $('style').each((_, el) => { $(el).text(this.rewriteCss($(el).html() || '', base)); });
    $('[style]').each((_, el) => {
      if (/url\(/i.test(el.attribs.style)) $(el).attr('style', this.rewriteCss(el.attribs.style, base));
    });

    // Contenus intégrés (vidéos, cartes…) → encart
    $('iframe, embed, object').each((_, el) => {
      const src = el.attribs.src || el.attribs.data || '';
      let abs = '';
      try { abs = src ? new URL(src, base).href : ''; } catch {}
      $(el).replaceWith(this.embedPlaceholder(abs));
    });

    // Liens
    $('a[href], area[href]').each((_, el) => {
      const href = (el.attribs.href || '').trim();
      if (!href || href.startsWith('#') || /^(mailto:|tel:|sms:|data:)/i.test(href)) return;
      if (/^javascript:/i.test(href)) { $(el).removeAttr('href'); return; }
      let abs;
      try { abs = new URL(href, base); } catch { return; }
      if (!/^https?:$/.test(abs.protocol)) return;
      if (isAdHost(abs.hostname)) { $(el).replaceWith($(el).text()); return; }
      const frag = abs.hash;
      abs.hash = '';
      // Lien direct vers une image : on la télécharge
      if (IMAGE_EXT.test(abs.pathname)) {
        const p = this.asset(abs.href, base);
        if (p) { $(el).attr('href', p); return; }
      }
      if (this.inScope(abs.href)) {
        if (depth < this.opts.maxDepth) this.enqueue(abs.href, depth + 1);
        $(el).attr('href', this.goUrl(cleanUrl(abs.href).href, frag));
        $(el).removeAttr('target');
      } else {
        $(el).attr('href', abs.href + frag);
        $(el).attr('target', '_blank');
        $(el).attr('rel', 'noopener noreferrer');
      }
    });
    $('form[action]').each((_, el) => {
      try { $(el).attr('action', new URL(el.attribs.action, base).href); } catch {}
    });

    $('[integrity]').removeAttr('integrity');
    $('[crossorigin]').removeAttr('crossorigin');
    $('[nonce]').removeAttr('nonce');

    const title = ($('title').first().text() || $('h1').first().text() || '').replace(/\s+/g, ' ').trim();
    const icon = $('link[rel~="icon"]').attr('href') || $('link[rel="shortcut icon"]').attr('href') || '';

    return { html: '<!DOCTYPE html>\n' + $.html().replace(/^<!DOCTYPE[^>]*>\s*/i, ''), title, text, icon };
  }

  async processUrl({ url, depth }) {
    this.current = url;
    let res;
    try { res = await this.fetch(url); }
    catch (e) {
      if (e?.name === 'AbortError' && this.abort.signal.aborted) return;
      this.stats.errors++; this.note('error', `Échec : ${url} (${e.cause?.code || e.message})`); return;
    }
    if (!res.ok) {
      try { await res.body?.cancel(); } catch {}
      this.stats.errors++; this.note('error', `HTTP ${res.status} : ${url}`); return;
    }
    const finalUrl = res.url || url;
    if (finalUrl !== url && !this.inScope(finalUrl)) {
      try { await res.body?.cancel(); } catch {}
      this.note('warn', `Redirigé hors du site, ignoré : ${url}`); return;
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const buf = await this.readBody(res);
    if (!buf) { this.note('warn', `Trop lourd, ignoré : ${url}`); return; }

    let record;
    if (ct.includes('html') || (!ct && /<html/i.test(buf.subarray(0, 2000).toString('latin1')))) {
      const out = this.processHtml(decodeHtml(buf, ct), finalUrl, depth);
      const rel = localRel(finalUrl, 'page');
      await fsp.mkdir(path.dirname(path.join(this.dir, rel)), { recursive: true });
      await fsp.writeFile(path.join(this.dir, rel), out.html);
      this.stats.bytes += Buffer.byteLength(out.html);
      record = { file: rel, title: out.title || new URL(finalUrl).pathname, type: 'page' };
      this.search[pageKey(finalUrl)] = { t: record.title, x: out.text };
      if (!this.meta.title && pageKey(finalUrl) === pageKey(this.start)) {
        this.meta.title = out.title;
        if (out.icon) this.meta.favicon = out.icon;
      }
    } else {
      const rel = localRel(finalUrl, 'asset');
      await fsp.mkdir(path.dirname(path.join(this.dir, rel)), { recursive: true });
      await fsp.writeFile(path.join(this.dir, rel), buf);
      this.stats.bytes += buf.length;
      const name = decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() || 'fichier');
      record = { file: rel, title: name, type: 'file' };
    }
    record.url = finalUrl;
    record.at = Date.now();
    this.pages[pageKey(url)] = record;
    this.pages[pageKey(finalUrl)] = record;
    this.stats.pages++;
    if (this.stats.pages % 15 === 0) await this.save();
  }

  async worker() {
    while (!this.abort.signal.aborted) {
      if (this.taken >= this.opts.maxPages) break;
      const item = this.queue.shift();
      if (!item) {
        if (this.active === 0) break;
        await sleep(120);
        continue;
      }
      this.taken++;
      this.active++;
      try { await this.processUrl(item); }
      catch (e) { this.stats.errors++; this.note('error', `${item.url} : ${e.message}`); }
      finally { this.active--; }
      if (this.opts.delay) await sleep(this.opts.delay);
    }
  }

  async save() {
    this.meta.updatedAt = Date.now();
    this.meta.pages = this.pages;
    this.meta.stats = { pages: new Set(Object.values(this.pages).map((p) => p.file)).size, assets: this.assets.size };
    await writeJson(path.join(this.dir, 'manifest.json'), this.meta);
    await writeJson(path.join(this.dir, 'search.json'), this.search);
  }

  async run() {
    await fsp.mkdir(this.dir, { recursive: true });
    const old = await readJson(path.join(this.dir, 'manifest.json'), null);
    this.meta = old || { id: this.id, startUrl: this.start, root: this.root, createdAt: Date.now() };
    this.meta.options = this.opts;
    this.meta.title = old?.title || '';
    this.pages = old?.pages || {};
    this.search = await readJson(path.join(this.dir, 'search.json'), {});
    this.note('info', `Départ : ${this.start}`);
    try {
      await this.loadRobots();
      if (this.robotRules?.length) this.note('info', `robots.txt : ${this.robotRules.length} règle(s) respectée(s)`);
      this.seen.add(pageKey(this.start));
      this.queue.push({ url: this.start, depth: 0 });
      await Promise.all(Array.from({ length: this.opts.concurrency }, () => this.worker()));
      this.current = 'Finalisation des images et feuilles de style…';
      while (this.pending.size) await Promise.allSettled([...this.pending]);

      // Favicon de la page d'accueil, ou /favicon.ico par défaut
      const startRec = this.pages[pageKey(this.start)];
      let fav = this.meta.favicon;
      if (fav && !fav.startsWith('/view/')) fav = this.asset(fav, startRec?.url || this.start);
      if (!fav) {
        const p = this.asset(new URL('/favicon.ico', this.start).href, this.start);
        while (this.pending.size) await Promise.allSettled([...this.pending]);
        if (p && fs.existsSync(path.join(this.dir, decodeURI(p.replace(`/view/${this.id}/`, ''))))) fav = p;
      }
      this.meta.favicon = fav || '';
      if (!this.meta.title) this.meta.title = this.root;
      this.meta.bytes = await dirSize(this.dir);
      await this.save();
      this.status = this.abort.signal.aborted ? 'cancelled' : (this.stats.pages ? 'done' : 'failed');
      if (this.status === 'failed') this.note('error', 'Aucune page n’a pu être téléchargée.');
      else this.note('info', `Terminé : ${this.stats.pages} page(s), ${this.stats.assets} ressource(s).`);
    } catch (e) {
      this.status = 'failed';
      this.note('error', e.message);
      try { await this.save(); } catch {}
    }
    this.current = '';
    this.finishedAt = Date.now();
    // Un site sans aucune page n'a rien à faire dans la bibliothèque
    if (!Object.keys(this.pages).length) await fsp.rm(this.dir, { recursive: true, force: true }).catch(() => {});
  }

  cancel() {
    if (this.status !== 'running') return;
    this.abort.abort();
    this.note('warn', 'Arrêt demandé — ce qui a été téléchargé est conservé.');
  }

  snapshot() {
    return {
      jobId: this.jobId, siteId: this.id, startUrl: this.start, status: this.status,
      title: this.meta?.title || this.root, current: this.current, stats: this.stats,
      queued: this.queue.length, taken: this.taken, maxPages: this.opts.maxPages,
      log: this.log.slice(-12), startedAt: this.startedAt, finishedAt: this.finishedAt,
    };
  }
}

/* ───────────────────────── Serveur ───────────────────────── */

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const jobs = new Map();

app.post('/api/crawl', (req, res) => {
  let { url, ...opts } = req.body || {};
  url = String(url || '').trim();
  if (!url) return res.status(400).json({ error: 'Indique une adresse.' });
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'Adresse invalide.' }); }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes('.')) {
    return res.status(400).json({ error: 'Adresse invalide.' });
  }
  const id = siteIdFor(parsed.href);
  for (const j of jobs.values()) {
    if (j.id === id && j.status === 'running') return res.status(409).json({ error: 'Ce site est déjà en cours de téléchargement.' });
  }
  const job = new CrawlJob(parsed.href, opts);
  jobs.set(job.jobId, job);
  job.run();
  res.json({ jobId: job.jobId, siteId: job.id });
});

app.get('/api/jobs', (req, res) => {
  const cutoff = Date.now() - 1000 * 60 * 30;
  for (const [k, j] of jobs) if (j.finishedAt && j.finishedAt < cutoff) jobs.delete(k);
  res.json([...jobs.values()].map((j) => j.snapshot()));
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Tâche introuvable.' });
  j.cancel();
  res.json({ ok: true });
});

app.delete('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (j && j.status !== 'running') jobs.delete(req.params.id);
  res.json({ ok: true });
});

async function listSites() {
  const out = [];
  for (const id of await fsp.readdir(DATA).catch(() => [])) {
    const m = await readJson(path.join(siteDir(id), 'manifest.json'), null);
    if (!m) continue;
    out.push({
      id: m.id, title: m.title, startUrl: m.startUrl, root: m.root, favicon: m.favicon || '',
      pages: m.stats?.pages || 0, assets: m.stats?.assets || 0, bytes: m.bytes || 0,
      createdAt: m.createdAt, updatedAt: m.updatedAt, options: m.options || {},
    });
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

const validId = (id) => /^[a-z0-9-]+$/.test(id);

app.get('/api/sites', async (req, res) => res.json(await listSites()));

app.get('/api/sites/:id/pages', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).end();
  const m = await readJson(path.join(siteDir(req.params.id), 'manifest.json'), null);
  if (!m) return res.status(404).json({ error: 'Site introuvable.' });
  const byFile = new Map();
  for (const p of Object.values(m.pages || {})) if (!byFile.has(p.file)) byFile.set(p.file, p);
  const list = [...byFile.values()].map((p) => ({ url: p.url, title: p.title, file: p.file, type: p.type }));
  list.sort((a, b) => a.url.length - b.url.length || a.url.localeCompare(b.url));
  res.json(list);
});

app.delete('/api/sites/:id', async (req, res) => {
  const id = req.params.id;
  if (!validId(id)) return res.status(400).end();
  for (const j of jobs.values()) if (j.id === id && j.status === 'running') return res.status(409).json({ error: 'Téléchargement en cours : arrête-le d’abord.' });
  await fsp.rm(siteDir(id), { recursive: true, force: true });
  res.json({ ok: true });
});

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const nq = norm(q);
  const results = [];
  for (const site of await listSites()) {
    const idx = await readJson(path.join(siteDir(site.id), 'search.json'), {});
    for (const [url, { t, x }] of Object.entries(idx)) {
      const nt = norm(t || ''), nx = norm(x || '');
      const inTitle = nt.includes(nq);
      const pos = nx.indexOf(nq);
      if (!inTitle && pos < 0) continue;
      const from = Math.max(0, pos - 70);
      const snippet = pos >= 0 ? (from ? '…' : '') + x.slice(from, pos + nq.length + 110) + '…' : x.slice(0, 160) + '…';
      results.push({ siteId: site.id, siteTitle: site.title, url, title: t, snippet, score: (inTitle ? 10 : 0) + (pos >= 0 ? 1 : 0) });
    }
  }
  results.sort((a, b) => b.score - a.score);
  res.json(results.slice(0, 60));
});

// Redirection d'un lien d'origine vers sa copie locale
app.get('/go/:id', async (req, res) => {
  const id = req.params.id;
  const u = String(req.query.u || '');
  if (!validId(id)) return res.status(400).end();
  const m = await readJson(path.join(siteDir(id), 'manifest.json'), null);
  let rec = null;
  if (m && u) {
    try {
      const key = pageKey(u);
      rec = m.pages[key];
      if (!rec) {
        const alt = new URL(key);
        alt.pathname = alt.pathname.endsWith('/') ? alt.pathname : alt.pathname + '/';
        rec = m.pages[pageKey(alt.href)];
      }
    } catch {}
  }
  if (rec) return res.redirect(302, `/view/${id}/${encodeURI(rec.file)}`);
  res.status(404).type('html').send(missingPage(u, m));
});

function missingPage(u, m) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Page non téléchargée</title><meta name="ancre-missing" content="${esc(u)}">
<style>
:root{--bg:#f4f0e8;--ink:#1d1b18;--mute:#6d665b;--line:#d9d1c3;--acc:#c2410c}
@media (prefers-color-scheme:dark){:root{--bg:#141311;--ink:#ece6da;--mute:#a39b8d;--line:#35312b;--acc:#fb8c4c}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.55 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;padding:24px}
.c{max-width:520px;text-align:center}.k{font:600 12px/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--acc)}
h1{font-size:34px;line-height:1.1;margin:14px 0 12px;font-weight:600;letter-spacing:-.01em}p{color:var(--mute);margin:0 0 18px}
code{display:block;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all;padding:12px 14px;border:1px solid var(--line);border-radius:10px;margin:0 0 22px;color:var(--ink)}
a{display:inline-block;margin:0 6px;padding:10px 16px;border-radius:999px;border:1px solid var(--ink);color:var(--ink);text-decoration:none;font:500 14px system-ui,-apple-system,"Segoe UI",sans-serif}
a.p{background:var(--ink);color:var(--bg)}
</style></head><body><div class="c"><div class="k">Hors ligne</div><h1>Cette page n’a pas été téléchargée</h1>
<p>Elle était trop profonde, au-delà de la limite de pages, exclue par le site (robots.txt) ou inexistante lors du téléchargement${m ? ` de « ${esc(m.title || m.root)} »` : ''}.</p>
${u ? `<code>${esc(u)}</code>` : ''}
<a href="javascript:history.back()">← Retour</a>${u ? `<a class="p" href="${esc(u)}" target="_blank" rel="noopener">Ouvrir en ligne</a>` : ''}
</div></body></html>`;
}

app.use('/view', express.static(DATA, {
  index: ['index.html'],
  extensions: ['html'],
  fallthrough: true,
  setHeaders(res, file) {
    if (/manifest\.json$|search\.json$/.test(file)) res.setHeader('cache-control', 'no-store');
  },
}));
app.use('/view', (req, res) => res.status(404).type('html').send(missingPage('', null)));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  ⚓ Ancre est prêt : ${url}\n  Sites enregistrés dans : ${DATA}\n`);
  if (process.argv.includes('--open')) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd);
  }
});
