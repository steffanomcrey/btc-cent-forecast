// btc-cent-forecast-01 entry (Node 22, standard library only): a median-anchored 4-hour Bitcoin forecast.
//
// The score is the mean absolute error in cents, so the right target is the conditional median of the close
// 240 minutes after the checkpoint, not the mean. The house baseline is persistence: the checkpoint's own
// last close. That last close is a thin-pool print (the median of one bar's final 10 seconds of samples,
// carried forward unchanged across quiet minutes), so it carries print noise the median does not want. This
// entry instead builds its guess from three robust pieces of the case's own 72 hours, each a median, each
// using only prices at or before the checkpoint:
//
//   anchor = median of the last 20 closes                       (the current level, print noise removed)
//   ref    = median of the last 1,440 closes (24 h)             (the level the price orbits at this horizon)
//   guess  = (anchor + 0.30 * (ref - anchor)) * exp(0.5 * d)
//   d      = median of the 240-minute log returns over the last 2,880 minutes, halved
//
// The level pull walks 30% of the way from the 20-minute anchor toward the 24-hour median: a checkpoint
// print displaced from its own day's middle tends to be nearer that middle 4 hours later. The drift term
// keeps half of the median 4-hour move of the last two days, no more: the full median move overshoots as
// often as it helps, and half of it is what the practice windows rewarded. Both constants were fitted on
// the kit's practice cases only (walk-forward inside each case's own series); the header of NOTES.md in the
// entry's build record carries the numbers. Where a case holds fewer prices than a window asks for, the
// window shrinks to what exists, and with fewer than 240 prices the drift term is 0.
//
// Output, per case file in the input directory: {"forecasts":[{"case":"<id>","price":<number>}]}, the price
// kept on the grid's 5 decimals and inside the scorer's (0, 10,000,000). Deterministic: medians and fixed
// constants only, so two runs write identical bytes.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The smallest positive price on the grid: one unit of its 5 decimals. */
const MIN_PRICE = 0.00001;
/** The largest grid price below the scorer's exclusive 10,000,000-dollar cap. */
const MAX_PRICE = 9_999_999.99999;

/** Minutes in the forecast horizon (matches the case's horizon_minutes). */
const HORIZON = 240;
/** Closes in the anchor median: the current level with print noise removed. */
const ANCHOR_MINUTES = 20;
/** Closes in the reference median the anchor is pulled toward: 24 hours. */
const REF_MINUTES = 1440;
/** Fraction of the way from the anchor toward the 24-hour median. */
const LEVEL_PULL = 0.3;
/** Minutes of 240-minute log returns whose median is the drift; two days. */
const DRIFT_MINUTES = 2880;
/** Fraction of the median 240-minute log return kept as drift. */
const DRIFT_SHRINK = 0.5;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  markets: CaseMarket[];
}

/** The median of a non-empty list: the middle value, or the mean of the two middle ones. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** x kept on the grid's 5 decimals and inside the scorer's (0, 10,000,000). */
const price5 = (x: number): number => Math.round(Math.min(MAX_PRICE, Math.max(MIN_PRICE, x)) * 1e5) / 1e5;

/** The forecast for one market: its closes up to the checkpoint, nothing after. */
function forecast(m: CaseMarket): number {
  if (!Array.isArray(m.prices) || m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const p = m.prices;
  for (const x of p) {
    if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) throw new Error(`market ${m.id} holds a bad price`);
  }
  const n = p.length;
  const anchor = median(p.slice(Math.max(0, n - ANCHOR_MINUTES)));
  const ref = median(p.slice(Math.max(0, n - REF_MINUTES)));
  const level = anchor + LEVEL_PULL * (ref - anchor);
  let drift = 0;
  if (n > HORIZON) {
    const rets: number[] = [];
    for (let i = Math.max(HORIZON, n - DRIFT_MINUTES); i < n; i++) {
      rets.push(Math.log((p[i] as number) / (p[i - HORIZON] as number)));
    }
    drift = DRIFT_SHRINK * median(rets);
  }
  return price5(level * Math.exp(drift));
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (!Array.isArray(c.markets) || c.markets.length !== 1) throw new Error(`${file} does not hold exactly one market`);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts: [{ case: id, price: forecast(c.markets[0] as CaseMarket) }] })}\n`);
}
