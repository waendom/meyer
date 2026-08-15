// Works out which artwork each lattice cell shows.
//
// The "all" view uses index = (col + 3*row) mod N. On this triangular lattice a cell's six
// neighbours differ in index by ±1, ±2, ±3 or ±4, so as long as N >= 5 no piece can ever
// touch itself.
//
// Under a category filter a cell KEEPS its artwork when that artwork belongs to the
// category, so switching filters only respawns what genuinely changes. Cells whose artwork
// drops out need a substitute, and those substitutes must still satisfy the no-touching
// rule. There is no closed formula for that, so it is solved as a constraint problem, per
// index and row parity.
export const A_COL = 1;

// index deltas to the six neighbours, by row parity
// Index offsets to the six neighbours. On this lattice a row step also shifts the column
// by half, so the diagonals differ by parity.
export function neighbourDeltas(parity, B){
  return parity === 0
    ? [[-1,0],[+1,0],[-B,1],[-B-1,1],[+B,1],[+B-1,1]]
    : [[-1,0],[+1,0],[-B,1],[-B+1,1],[+B,1],[+B+1,1]];
}

export function baseIndex(col, row, N, B){
  return (((A_COL*col + B*row) % N) + N) % N;
}

// Is the unfiltered arrangement free of self-contact?
export function checkAllView(N, B){
  if(N < 5) return false;
  for(const parity of [0,1]){
    for(const [d] of neighbourDeltas(parity, B)){
      if((((d % N) + N) % N) === 0) return false;
    }
  }
  return true;
}

// Solve substitutes for one category. `order` is the full artwork list (ids), `pool` the
// ids that survive the filter. Returns { "<index>_<parity>": id } or null if unsolvable.
export function solveSubstitutes(order, pool, B){
  const N = order.length;
  const keep = new Set(pool);
  const keptIdx = new Set();
  order.forEach((id, i) => { if(keep.has(id)) keptIdx.add(i); });
  const subIdx = [];
  for(let i = 0; i < N; i++) if(!keptIdx.has(i)) subIdx.push(i);
  if(subIdx.length === 0) return {};
  if(pool.length === 0) return null;

  const vars = [];
  for(const i of subIdx) for(const p of [0,1]) vars.push([i,p]);

  const neigh = (i,p) => neighbourDeltas(p, B).map(([d,flip]) => {
    const j = (((i + d) % N) + N) % N;
    return [j, flip ? (1-p) : p];
  });

  const assign = new Map();
  const key = (i,p) => i + '_' + p;

  function ok(i, p, val){
    for(const [j,q] of neigh(i,p)){
      if(keptIdx.has(j)){ if(order[j] === val) return false; }
      else if(assign.get(key(j,q)) === val) return false;
    }
    return true;
  }
  // most-constrained-first ordering keeps the search shallow
  const sorted = vars.slice().sort((a,b) => a[0] - b[0]);
  let steps = 0;
  function bt(k){
    if(++steps > 2e6) return false;            // give up rather than hang a build
    if(k === sorted.length) return true;
    const [i,p] = sorted[k];
    for(const val of pool){
      if(ok(i,p,val)){
        assign.set(key(i,p), val);
        if(bt(k+1)) return true;
        assign.delete(key(i,p));
      }
    }
    return false;
  }
  if(!bt(0)) return null;
  const out = {};
  for(const [k,v] of assign) out[k] = v;
  return out;
}

// Verify a finished mapping over a wide area — the build must never ship a broken grid.
export function verify(order, pool, subs, B, radius = 14){
  const N = order.length;
  const catOf = new Set(pool);
  const at = (col,row) => {
    const i = baseIndex(col,row,N,B);
    const id = order[i];
    if(catOf.has(id)) return id;
    return subs[i + '_' + (row & 1)];
  };
  let touches = 0, missing = 0;
  const used = new Set();
  for(let row = -radius; row <= radius; row++){
    for(let col = -radius; col <= radius; col++){
      const v = at(col,row);
      if(v === undefined){ missing++; continue; }
      used.add(v);
      const nb = (row & 1)
        ? [[col-1,row],[col+1,row],[col,row-1],[col+1,row-1],[col,row+1],[col+1,row+1]]
        : [[col-1,row],[col+1,row],[col,row-1],[col-1,row-1],[col,row+1],[col-1,row+1]];
      for(const [c2,r2] of nb) if(at(c2,r2) === v) touches++;
    }
  }
  return { touches, missing, coverage: used.size, expected: pool.length };
}
