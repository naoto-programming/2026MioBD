# 双六RPG フェーズ1 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ローカル(ホットシート)で2〜8人が遊べる、双六RPGのコアゲームエンジン+UIを実装する。ネットワーク通信は含まない。

**Architecture:** ロジック(`mapGenerator.js`/`characters.js`/`boss.js`/`engine.js`)は副作用のない純粋関数として実装し、`render.js`がDOM描画、`main.js`が入力とロジックと描画を結線する一方向データフロー。ビルドツールなし、ブラウザネイティブのES Modulesを使用。

**Tech Stack:** Vanilla JavaScript (ES Modules)、HTML/CSS、テストはNode.js組込みテストランナー(`node --test`)。

**Spec:** [docs/superpowers/specs/2026-08-16-sugoroku-rpg-phase1-design.md](../specs/2026-08-16-sugoroku-rpg-phase1-design.md)

## Global Constraints

- ビルドツール・バンドラーなし。ブラウザは`<script type="module">`でES Modulesを直接読み込む
- 外部npmパッケージへの依存なし(テストもNode組込み`node --test`のみ)
- ロジック層(`src/mapGenerator.js`, `src/characters.js`, `src/boss.js`, `src/engine.js`)は副作用のない純粋関数のみで構成し、乱数は必ず引数`rng`(デフォルト`Math.random`)として注入する(テストで決定的な値を渡せるようにするため)
- キャラクター4種(剣士/弓士/盗賊/魔法使い)、ボス1種(炎竜)がフェーズ1のスコープ
- 枝は単層のみ(枝からさらに枝分かれしない)。ネスト分岐はフェーズ3で対応
- 回復範囲・防御範囲の距離判定は同一トラック(幹 or 同じ枝)内のインデックス差のみで判定する。別トラックのプレイヤーは範囲外とする

---

## Task 0: プロジェクト初期化

**Files:**
- Create: `package.json`
- Create: `src/` ディレクトリ(空でよい)
- Create: `test/` ディレクトリ(空でよい)

**Interfaces:**
- Produces: `npm test`コマンドで`node --test test/`が走る設定

- [ ] **Step 1: package.jsonを作成**

```json
{
  "name": "sugoroku-rpg",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/**/*.test.js"
  }
}
```

- [ ] **Step 2: ディレクトリ作成**

```bash
mkdir -p src test
```

- [ ] **Step 3: コミット**

```bash
git add package.json src test 2>/dev/null; git add package.json
git commit -m "chore: initialize project structure for phase 1"
```

(`src`/`test`は空ディレクトリなのでgitには追跡されない。中身のファイルができるTask 1以降で自動的にコミットされる。)

---

## Task 1: mapGenerator.js — セル生成とトランク作成

**Files:**
- Create: `src/mapGenerator.js`
- Test: `test/mapGenerator.test.js`

**Interfaces:**
- Produces: `CELL_TYPES` (array), `randomCellType(rng)`, `createCell(type)`, `createInitialMap(rng)`, `getCell(map, track, index)`

- [ ] **Step 1: 失敗するテストを書く**

```js
// test/mapGenerator.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CELL_TYPES, randomCellType, createCell, createInitialMap, getCell } from '../src/mapGenerator.js';

test('randomCellType returns a value from CELL_TYPES', () => {
  const type = randomCellType(() => 0);
  assert.ok(CELL_TYPES.includes(type));
});

test('randomCellType uses rng to pick deterministically', () => {
  assert.equal(randomCellType(() => 0), CELL_TYPES[0]);
  assert.equal(randomCellType(() => 0.999), CELL_TYPES[CELL_TYPES.length - 1]);
});

test('createCell wraps a type', () => {
  assert.deepEqual(createCell('attack'), { type: 'attack' });
});

test('createInitialMap creates 20 trunk cells and no branches', () => {
  const map = createInitialMap(() => 0.5);
  assert.equal(map.trunk.length, 20);
  assert.deepEqual(map.branches, []);
});

test('getCell reads a trunk cell by index', () => {
  const map = createInitialMap(() => 0);
  assert.deepEqual(getCell(map, 'trunk', 0), { type: CELL_TYPES[0] });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL (`src/mapGenerator.js`が存在しないためモジュール解決エラー)

- [ ] **Step 3: 最小実装**

```js
// src/mapGenerator.js
export const CELL_TYPES = ['attack', 'defense', 'heal', 'item', 'damage'];

export function randomCellType(rng = Math.random) {
  const index = Math.min(CELL_TYPES.length - 1, Math.floor(rng() * CELL_TYPES.length));
  return CELL_TYPES[index];
}

export function createCell(type) {
  return { type };
}

export function createInitialMap(rng = Math.random) {
  const trunk = [];
  for (let i = 0; i < 20; i++) trunk.push(createCell(randomCellType(rng)));
  return { trunk, branches: [] };
}

export function getCell(map, track, index) {
  if (track === 'trunk') return map.trunk[index];
  const branch = map.branches.find((b) => b.id === track);
  return branch.cells[index];
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS (5 tests)

- [ ] **Step 5: コミット**

```bash
git add src/mapGenerator.js test/mapGenerator.test.js
git commit -m "feat: add map cell generation and trunk creation"
```

---

## Task 2: mapGenerator.js — トランク延長と枝生成

**Files:**
- Modify: `src/mapGenerator.js`
- Test: `test/mapGenerator.test.js`

**Interfaces:**
- Consumes: `CELL_TYPES`, `createCell`, `randomCellType`, `getCell`(Task 1で定義)
- Produces: `BRANCH_THEME_NAMES` (array), `weightedCellType(weights, rng)`, `createBranch(id, theme, connectFromIndex, rng)`, `extendTrunk(map, targetLength, rng)`, `isBranchPoint(map, index)`, `branchesAt(map, index)`, `ensureMapAhead(map, playerPositions, lookahead, rng)`

- [ ] **Step 1: 失敗するテストを書く**

```js
// test/mapGenerator.test.js に追記
import {
  BRANCH_THEME_NAMES,
  weightedCellType,
  createBranch,
  extendTrunk,
  isBranchPoint,
  branchesAt,
  ensureMapAhead,
} from '../src/mapGenerator.js';

test('extendTrunk grows trunk to target length without shrinking existing cells', () => {
  const map = createInitialMap(() => 0);
  const original = map.trunk.slice();
  const extended = extendTrunk(map, 25, () => 0.99);
  assert.equal(extended.trunk.length, 25);
  assert.deepEqual(extended.trunk.slice(0, 20), original);
});

test('extendTrunk is a no-op when already long enough', () => {
  const map = createInitialMap(() => 0);
  const extended = extendTrunk(map, 5, () => 0.99);
  assert.equal(extended.trunk.length, 20);
});

test('weightedCellType respects cumulative weights', () => {
  const weights = { attack: 0.5, defense: 0.5 };
  assert.equal(weightedCellType(weights, () => 0), 'attack');
  assert.equal(weightedCellType(weights, () => 0.9), 'defense');
});

test('createBranch produces 15-20 cells with the requested theme', () => {
  const branch = createBranch('branch-3', 'heal', 3, () => 0.4);
  assert.equal(branch.id, 'branch-3');
  assert.equal(branch.theme, 'heal');
  assert.equal(branch.connectFrom, 3);
  assert.ok(branch.cells.length >= 15 && branch.cells.length <= 20);
});

test('ensureMapAhead extends trunk so furthest player has lookahead cells ahead', () => {
  const map = createInitialMap(() => 0);
  const positions = [{ track: 'trunk', index: 18 }];
  const result = ensureMapAhead(map, positions, 10, () => 0.99);
  assert.ok(result.trunk.length >= 18 + 10 + 1);
});

test('ensureMapAhead can spawn a branch and branchesAt/isBranchPoint reflect it', () => {
  const map = createInitialMap(() => 0);
  // furthest player is at index 5, lookahead 20 -> target length 26, which is
  // beyond the initial 20 cells, so new cells (indices 20-25) get generated
  // and checked for branch spawns.
  const positions = [{ track: 'trunk', index: 5 }];
  // Constant low rng: every random draw (cell type, spawn chance, theme,
  // branch length, branch cell types, connectTo offset) resolves to its
  // lowest/first option, so a branch is guaranteed at every new trunk index.
  const rng = () => 0.01;
  const result = ensureMapAhead(map, positions, 20, rng);
  assert.ok(result.branches.length > 0, 'expected at least one branch to spawn with this rng');
  const branch = result.branches[0];
  assert.ok(isBranchPoint(result, branch.connectFrom));
  assert.deepEqual(branchesAt(result, branch.connectFrom).map((b) => b.id), [branch.id]);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL (未定義のexportをimportしようとしてエラー)

- [ ] **Step 3: 実装を追加**

```js
// src/mapGenerator.js に追記

const BRANCH_THEMES = {
  attack: { attack: 0.4, defense: 0.1, heal: 0.1, item: 0.15, damage: 0.25 },
  defense: { attack: 0.1, defense: 0.4, heal: 0.15, item: 0.15, damage: 0.2 },
  heal: { attack: 0.1, defense: 0.1, heal: 0.4, item: 0.1, damage: 0.3 },
  item: { attack: 0.1, defense: 0.1, heal: 0.15, item: 0.45, damage: 0.2 },
  danger: { attack: 0.2, defense: 0.1, heal: 0.1, item: 0.1, damage: 0.5 },
};

export const BRANCH_THEME_NAMES = Object.keys(BRANCH_THEMES);

export function weightedCellType(weights, rng = Math.random) {
  const roll = rng();
  let cumulative = 0;
  for (const [type, weight] of Object.entries(weights)) {
    cumulative += weight;
    if (roll < cumulative) return type;
  }
  return Object.keys(weights)[Object.keys(weights).length - 1];
}

export function createBranch(id, theme, connectFromIndex, rng = Math.random) {
  const length = 15 + Math.floor(rng() * 6); // 15-20
  const weights = BRANCH_THEMES[theme];
  const cells = [];
  for (let i = 0; i < length; i++) cells.push(createCell(weightedCellType(weights, rng)));
  return { id, theme, connectFrom: connectFromIndex, connectTo: null, cells };
}

export function extendTrunk(map, targetLength, rng = Math.random) {
  const trunk = map.trunk.slice();
  while (trunk.length < targetLength) trunk.push(createCell(randomCellType(rng)));
  return { ...map, trunk };
}

export function branchesAt(map, trunkIndex) {
  return map.branches.filter((b) => b.connectFrom === trunkIndex);
}

export function isBranchPoint(map, trunkIndex) {
  return branchesAt(map, trunkIndex).length > 0;
}

const BRANCH_SPAWN_CHANCE = 0.08;

export function ensureMapAhead(map, playerPositions, lookahead, rng = Math.random) {
  const furthestTrunkIndex = playerPositions
    .filter((p) => p.track === 'trunk')
    .reduce((max, p) => Math.max(max, p.index), 0);

  const targetLength = furthestTrunkIndex + lookahead + 1;
  const extended = extendTrunk(map, targetLength, rng);
  const branches = extended.branches.slice();

  for (let i = map.trunk.length; i < extended.trunk.length; i++) {
    if (isBranchPoint({ branches }, i)) continue;
    if (rng() < BRANCH_SPAWN_CHANCE) {
      const theme = BRANCH_THEME_NAMES[Math.floor(rng() * BRANCH_THEME_NAMES.length)];
      const branch = createBranch(`branch-${i}`, theme, i, rng);
      branch.connectTo = i + 5 + Math.floor(rng() * 5); // 5-9マス先で合流
      branches.push(branch);
    }
  }

  return { ...extended, branches };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS (全テスト)

- [ ] **Step 5: コミット**

```bash
git add src/mapGenerator.js test/mapGenerator.test.js
git commit -m "feat: add trunk extension and branch spawning"
```

---

## Task 3: characters.js — キャラクター定義

**Files:**
- Create: `src/characters.js`
- Test: `test/characters.test.js`

**Interfaces:**
- Produces: `CHARACTERS` (object keyed by `warrior`/`archer`/`thief`/`mage`, each `{ id, name, maxHp, diceTable: { [1-6]: { power, special? } } }`), `rollCharacterAttack(characterId, dieValue)`

- [ ] **Step 1: 失敗するテストを書く**

```js
// test/characters.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, rollCharacterAttack } from '../src/characters.js';

test('CHARACTERS contains the four phase-1 classes', () => {
  assert.deepEqual(Object.keys(CHARACTERS).sort(), ['archer', 'mage', 'thief', 'warrior']);
});

test('every character has a full 1-6 dice table with positive power', () => {
  for (const character of Object.values(CHARACTERS)) {
    for (let face = 1; face <= 6; face++) {
      const entry = character.diceTable[face];
      assert.ok(entry, `${character.id} missing face ${face}`);
      assert.ok(entry.power > 0, `${character.id} face ${face} power must be positive`);
    }
  }
});

test('rollCharacterAttack looks up power for a given class and die value', () => {
  const result = rollCharacterAttack('warrior', 6);
  assert.equal(result.power, CHARACTERS.warrior.diceTable[6].power);
  assert.equal(result.special, 'critical');
});

test('each character has a unique special effect on face 6', () => {
  const specials = Object.values(CHARACTERS).map((c) => c.diceTable[6].special);
  assert.equal(new Set(specials).size, specials.length);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL (`src/characters.js`が存在しない)

- [ ] **Step 3: 実装**

```js
// src/characters.js
export const CHARACTERS = {
  warrior: {
    id: 'warrior',
    name: '剣士',
    maxHp: 30,
    diceTable: {
      1: { power: 3 },
      2: { power: 4 },
      3: { power: 5 },
      4: { power: 6 },
      5: { power: 7 },
      6: { power: 10, special: 'critical' },
    },
  },
  archer: {
    id: 'archer',
    name: '弓士',
    maxHp: 24,
    diceTable: {
      1: { power: 3 },
      2: { power: 4 },
      3: { power: 5 },
      4: { power: 6 },
      5: { power: 7 },
      6: { power: 8, special: 'extraHit' },
    },
  },
  thief: {
    id: 'thief',
    name: '盗賊',
    maxHp: 22,
    diceTable: {
      1: { power: 2 },
      2: { power: 3 },
      3: { power: 4 },
      4: { power: 5 },
      5: { power: 6 },
      6: { power: 6, special: 'stealItem' },
    },
  },
  mage: {
    id: 'mage',
    name: '魔法使い',
    maxHp: 20,
    diceTable: {
      1: { power: 4 },
      2: { power: 5 },
      3: { power: 6 },
      4: { power: 7 },
      5: { power: 8 },
      6: { power: 12, special: 'bigMagic' },
    },
  },
};

export function rollCharacterAttack(characterId, dieValue) {
  return CHARACTERS[characterId].diceTable[dieValue];
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/characters.js test/characters.test.js
git commit -m "feat: add character class definitions"
```

---

## Task 4: boss.js — ボス定義と制限ターン計算

**Files:**
- Create: `src/boss.js`
- Test: `test/boss.test.js`

**Interfaces:**
- Produces: `BOSSES` (object with `fireDragon`: `{ id, name, maxHp, diceTable: { [1-6]: { name, damage } } }`), `rollBossAttack(bossId, dieValue)`, `calculateTurnLimit(maxHp, playerCount, avgDamagePerPlayerPerTurn = 6, safetyFactor = 1.5)`

- [ ] **Step 1: 失敗するテストを書く**

```js
// test/boss.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOSSES, rollBossAttack, calculateTurnLimit } from '../src/boss.js';

test('fireDragon has a full 1-6 dice table matching the design doc flavor', () => {
  const names = [1, 2, 3, 4, 5, 6].map((face) => BOSSES.fireDragon.diceTable[face].name);
  assert.deepEqual(names, ['爪撃', '火球', '火球', '咆哮', '全体火炎', '大火炎']);
});

test('rollBossAttack returns the dice table entry for the given face', () => {
  const result = rollBossAttack('fireDragon', 6);
  assert.equal(result.name, '大火炎');
  assert.ok(result.damage > 0);
});

test('calculateTurnLimit scales inversely with player count', () => {
  const limitFor2 = calculateTurnLimit(300, 2);
  const limitFor8 = calculateTurnLimit(300, 8);
  assert.ok(limitFor2 > limitFor8);
});

test('calculateTurnLimit is a positive integer', () => {
  const limit = calculateTurnLimit(300, 4);
  assert.ok(Number.isInteger(limit));
  assert.ok(limit > 0);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL (`src/boss.js`が存在しない)

- [ ] **Step 3: 実装**

```js
// src/boss.js
export const BOSSES = {
  fireDragon: {
    id: 'fireDragon',
    name: '炎竜',
    maxHp: 300,
    diceTable: {
      1: { name: '爪撃', damage: 4 },
      2: { name: '火球', damage: 6 },
      3: { name: '火球', damage: 6 },
      4: { name: '咆哮', damage: 3 },
      5: { name: '全体火炎', damage: 8 },
      6: { name: '大火炎', damage: 14 },
    },
  },
};

export function rollBossAttack(bossId, dieValue) {
  return BOSSES[bossId].diceTable[dieValue];
}

// avgDamagePerPlayerPerTurn/safetyFactorは初期の仮値。実プレイで調整する想定。
export function calculateTurnLimit(maxHp, playerCount, avgDamagePerPlayerPerTurn = 6, safetyFactor = 1.5) {
  return Math.ceil((maxHp / (playerCount * avgDamagePerPlayerPerTurn)) * safetyFactor);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/boss.js test/boss.test.js
git commit -m "feat: add boss definition and turn limit calculation"
```

---

## Task 5: engine.js — 状態初期化と移動解決

**Files:**
- Create: `src/engine.js`
- Test: `test/engine.test.js`

**Interfaces:**
- Consumes: `createInitialMap`, `ensureMapAhead`, `getCell`, `branchesAt`(mapGenerator.js) / `CHARACTERS`(characters.js) / `BOSSES`, `calculateTurnLimit`(boss.js)
- Produces: `rollDie(rng)`, `createGameState(playerSelections, bossId, rng)`, `moveOnePlayer(map, position, steps, chooseBranch)`, `resolveMovement(state, moves, chooseBranchFns, rng)`

- [ ] **Step 1: 失敗するテストを書く**

```js
// test/engine.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollDie, createGameState, moveOnePlayer, resolveMovement } from '../src/engine.js';

test('rollDie returns 1-6 based on rng', () => {
  assert.equal(rollDie(() => 0), 1);
  assert.equal(rollDie(() => 0.999), 6);
});

test('createGameState sets up players, boss, turnLimit and initial map', () => {
  const state = createGameState(
    [
      { id: 'p1', name: 'Alice', characterId: 'warrior' },
      { id: 'p2', name: 'Bob', characterId: 'mage' },
    ],
    'fireDragon',
    () => 0.5,
  );
  assert.equal(state.turn, 0);
  assert.ok(state.turnLimit > 0);
  assert.equal(state.boss.hp, 300);
  assert.equal(state.players.length, 2);
  assert.equal(state.players[0].hp, state.players[0].maxHp);
  assert.deepEqual(state.players[0].position, { track: 'trunk', index: 0 });
  assert.equal(state.map.trunk.length, 20);
});

test('moveOnePlayer advances along the trunk when there is no fork', () => {
  const map = { trunk: Array.from({ length: 30 }, () => ({ type: 'attack' })), branches: [] };
  const position = moveOnePlayer(map, { track: 'trunk', index: 2 }, 4, () => null);
  assert.deepEqual(position, { track: 'trunk', index: 6 });
});

test('moveOnePlayer takes the branch when chooseBranch returns its id', () => {
  const map = {
    trunk: Array.from({ length: 10 }, () => ({ type: 'attack' })),
    branches: [{ id: 'branch-3', connectFrom: 3, connectTo: 7, cells: [{ type: 'heal' }, { type: 'heal' }] }],
  };
  const position = moveOnePlayer(map, { track: 'trunk', index: 1 }, 3, (forks) => forks[0].id);
  // step1: 1->2 (no fork), step2: 2->3 (no fork at 2), step3: at index3 fork exists -> enter branch index0
  assert.deepEqual(position, { track: 'branch-3', index: 0 });
});

test('moveOnePlayer rejoins the trunk after exhausting branch cells', () => {
  const map = {
    trunk: Array.from({ length: 10 }, () => ({ type: 'attack' })),
    branches: [{ id: 'branch-0', connectFrom: 0, connectTo: 5, cells: [{ type: 'heal' }] }],
  };
  const position = moveOnePlayer(map, { track: 'branch-0', index: 0 }, 1, () => null);
  assert.deepEqual(position, { track: 'trunk', index: 5 });
});

test('resolveMovement moves every player and extends the map ahead', () => {
  const state = createGameState(
    [{ id: 'p1', name: 'Alice', characterId: 'warrior' }],
    'fireDragon',
    () => 0.5,
  );
  const moved = resolveMovement(state, { p1: 6 }, {}, () => 0.5);
  assert.deepEqual(moved.players[0].position, { track: 'trunk', index: 6 });
  // ensureMapAhead extends based on pre-move positions (furthest index 0) with
  // lookahead 20 -> target length 21, comfortably past the post-move index 6.
  assert.equal(moved.map.trunk.length, 21);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL (`src/engine.js`が存在しない)

- [ ] **Step 3: 実装**

```js
// src/engine.js
import { createInitialMap, ensureMapAhead, branchesAt } from './mapGenerator.js';
import { CHARACTERS } from './characters.js';
import { BOSSES, calculateTurnLimit } from './boss.js';

export function rollDie(rng = Math.random) {
  return Math.min(6, Math.floor(rng() * 6) + 1);
}

export function createGameState(playerSelections, bossId, rng = Math.random) {
  const boss = BOSSES[bossId];
  const players = playerSelections.map((sel) => {
    const character = CHARACTERS[sel.characterId];
    return {
      id: sel.id,
      name: sel.name,
      characterId: sel.characterId,
      hp: character.maxHp,
      maxHp: character.maxHp,
      position: { track: 'trunk', index: 0 },
      skipNextEffect: false,
    };
  });
  return {
    turn: 0,
    turnLimit: calculateTurnLimit(boss.maxHp, players.length),
    boss: { id: boss.id, name: boss.name, hp: boss.maxHp, maxHp: boss.maxHp },
    players,
    map: createInitialMap(rng),
  };
}

export function moveOnePlayer(map, position, steps, chooseBranch) {
  let { track, index } = position;
  for (let i = 0; i < steps; i++) {
    const forks = track === 'trunk' ? branchesAt(map, index) : [];
    if (forks.length > 0) {
      const choice = chooseBranch(forks);
      if (choice) {
        track = choice;
        index = 0;
        continue;
      }
    }
    index += 1;
    if (track !== 'trunk') {
      const branch = map.branches.find((b) => b.id === track);
      if (index >= branch.cells.length) {
        track = 'trunk';
        index = branch.connectTo;
      }
    }
  }
  return { track, index };
}

export function resolveMovement(state, moves, chooseBranchFns, rng = Math.random) {
  const positions = state.players.map((p) => p.position);
  const map = ensureMapAhead(state.map, positions, 20, rng);

  const players = state.players.map((player) => {
    const steps = moves[player.id];
    const chooseBranch = chooseBranchFns[player.id] || (() => null);
    const position = moveOnePlayer(map, player.position, steps, chooseBranch);
    return { ...player, position };
  });

  return { ...state, map, players };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/engine.js test/engine.test.js
git commit -m "feat: add game state initialization and movement resolution"
```

---

## Task 6: engine.js — 効果解決(回復/攻撃/防御/ボス攻撃)

**Files:**
- Modify: `src/engine.js`
- Test: `test/engine.test.js`

**Interfaces:**
- Consumes: `getCell`(mapGenerator.js), `rollCharacterAttack`(characters.js), `rollBossAttack`(boss.js), `rollDie`(このファイル、Task 5)
- Produces: `resolveEffects(state, attackRolls, damageRolls, rng)` — 戻り値に`log`配列を含む

- [ ] **Step 1: 失敗するテストを書く**

```js
// test/engine.test.js に追記
import { resolveEffects } from '../src/engine.js';

function baseState(overrides = {}) {
  return {
    turn: 0,
    turnLimit: 10,
    boss: { id: 'fireDragon', name: '炎竜', hp: 300, maxHp: 300 },
    players: [],
    map: { trunk: [], branches: [] },
    ...overrides,
  };
}

test('resolveEffects heals players within radius 3 on the same track', () => {
  const map = { trunk: [{ type: 'heal' }, {}, {}, {}, {}], branches: [] };
  const state = baseState({
    map,
    players: [
      { id: 'healer', hp: 10, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 } },
      { id: 'near', hp: 5, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 3 } },
      { id: 'far', hp: 5, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 4 } },
    ],
  });
  const result = resolveEffects(state, {}, {}, () => 0.5);
  assert.ok(result.players.find((p) => p.id === 'near').hp > 5);
  assert.equal(result.players.find((p) => p.id === 'far').hp, 5);
});

test('resolveEffects applies attack damage to the boss using character power', () => {
  const map = { trunk: [{ type: 'attack' }], branches: [] };
  const state = baseState({
    map,
    players: [{ id: 'p1', hp: 30, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 } }],
  });
  const result = resolveEffects(state, { p1: 6 }, {}, () => 0.5);
  assert.equal(result.boss.hp, 300 - 10); // warrior face-6 power is 10
});

test('resolveEffects protects players on a defense cell and their co-located allies from boss damage', () => {
  const map = { trunk: [{ type: 'defense' }], branches: [] };
  const state = baseState({
    map,
    players: [
      { id: 'defender', hp: 30, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 } },
      { id: 'ally', hp: 30, maxHp: 30, characterId: 'mage', position: { track: 'trunk', index: 0 } },
    ],
  });
  const result = resolveEffects(state, {}, {}, () => 0); // rng=0 -> boss die face 1 (爪撃, damage 4)
  assert.equal(result.players.find((p) => p.id === 'defender').hp, 30);
  assert.equal(result.players.find((p) => p.id === 'ally').hp, 30);
});

test('resolveEffects damage cell: die value 1-2 deals zero damage, otherwise damage equals die value', () => {
  const map = { trunk: [{ type: 'damage' }], branches: [] };
  const lowRoll = resolveEffects(
    baseState({ map, players: [{ id: 'p1', hp: 30, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 } }] }),
    {},
    { p1: 2 },
    () => 0.99, // boss die won't matter for this assertion beyond being applied too
  );
  const p1Hp = lowRoll.players.find((p) => p.id === 'p1').hp;
  assert.ok(p1Hp === 30 - 0 - lowRoll.log.find((e) => e.type === 'bossAttack').damage);
});

test('resolveEffects revives a player who reaches 0 hp at half max hp', () => {
  // cell type 'item' is intentionally not handled by resolveEffects (no-op),
  // so only the boss attack phase affects this player's hp.
  const map = { trunk: [{ type: 'item' }], branches: [] };
  const state = baseState({
    map,
    boss: { id: 'fireDragon', name: '炎竜', hp: 300, maxHp: 300 },
    players: [{ id: 'p1', hp: 1, maxHp: 30, characterId: 'warrior', position: { track: 'trunk', index: 0 } }],
  });
  const result = resolveEffects(state, {}, {}, () => 0.999); // boss die face 6, damage 14, exceeds hp 1
  const p1 = result.players.find((p) => p.id === 'p1');
  assert.equal(p1.hp, 15); // maxHp/2
  assert.equal(p1.skipNextEffect, true);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL (`resolveEffects`が未定義)

- [ ] **Step 3: 実装を追加**

```js
// src/engine.js に追記
import { getCell } from './mapGenerator.js';
import { rollCharacterAttack } from './characters.js';
import { rollBossAttack } from './boss.js';

const HEAL_RADIUS = 3;
const HEAL_AMOUNT = 8;

function trackDistance(posA, posB) {
  if (posA.track !== posB.track) return Infinity;
  return Math.abs(posA.index - posB.index);
}

export function resolveEffects(state, attackRolls, damageRolls, rng = Math.random) {
  let players = state.players.map((p) => ({ ...p }));
  let boss = { ...state.boss };
  const log = [];

  // 1. 回復
  for (const player of players) {
    const cell = getCell(state.map, player.position.track, player.position.index);
    if (cell.type === 'heal') {
      for (const target of players) {
        if (trackDistance(player.position, target.position) <= HEAL_RADIUS) {
          const before = target.hp;
          target.hp = Math.min(target.maxHp, target.hp + HEAL_AMOUNT);
          if (target.hp !== before) log.push({ type: 'heal', by: player.id, target: target.id, amount: target.hp - before });
        }
      }
    }
  }

  // 2. 攻撃
  for (const player of players) {
    const cell = getCell(state.map, player.position.track, player.position.index);
    if (cell.type === 'attack') {
      const dieValue = attackRolls[player.id];
      const result = rollCharacterAttack(player.characterId, dieValue);
      boss.hp = Math.max(0, boss.hp - result.power);
      log.push({ type: 'attack', by: player.id, damage: result.power, special: result.special ?? null });
    }
  }

  // 3. 防御(同一マスの味方も対象)
  const defendedPlayerIds = new Set();
  for (const player of players) {
    const cell = getCell(state.map, player.position.track, player.position.index);
    if (cell.type === 'defense') {
      for (const target of players) {
        if (target.position.track === player.position.track && target.position.index === player.position.index) {
          defendedPlayerIds.add(target.id);
        }
      }
    }
  }

  // ダメージマス(防御は適用されない = プレイヤー自身のマス由来のダメージなので防御の対象外とする)
  for (const player of players) {
    const cell = getCell(state.map, player.position.track, player.position.index);
    if (cell.type === 'damage') {
      const dieValue = damageRolls[player.id];
      const damage = dieValue <= 2 ? 0 : dieValue;
      if (damage > 0) {
        player.hp = Math.max(0, player.hp - damage);
        log.push({ type: 'damage', target: player.id, amount: damage });
      }
    }
  }

  // 4. ボス攻撃(防御中のプレイヤーは無効)
  if (boss.hp > 0) {
    const bossDie = rollDie(rng);
    const bossAttack = rollBossAttack(boss.id, bossDie);
    for (const player of players) {
      if (!defendedPlayerIds.has(player.id)) {
        player.hp = Math.max(0, player.hp - bossAttack.damage);
      }
    }
    log.push({ type: 'bossAttack', name: bossAttack.name, damage: bossAttack.damage });
  }

  // 死亡プレイヤーの即時復活(ペナルティ: HP半分・次の効果を1回無効化)
  players = players.map((p) => {
    if (p.hp <= 0) {
      log.push({ type: 'revive', target: p.id });
      return { ...p, hp: Math.floor(p.maxHp / 2), skipNextEffect: true };
    }
    return p;
  });

  return { ...state, players, boss, log };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/engine.js test/engine.test.js
git commit -m "feat: add heal/attack/defense/boss-attack effect resolution"
```

---

## Task 7: engine.js — 勝敗判定とターン統合

**Files:**
- Modify: `src/engine.js`
- Test: `test/engine.test.js`

**Interfaces:**
- Consumes: `resolveMovement`, `resolveEffects`(このファイル、Task 5-6)
- Produces: `checkGameOver(state)` — `{ over: boolean, result: 'win'|'lose'|null }`、`playTurn(state, moves, chooseBranchFns, attackRolls, damageRolls, rng)` — `{ state, gameOver }`

- [ ] **Step 1: 失敗するテストを書く**

```js
// test/engine.test.js に追記
import { checkGameOver, playTurn } from '../src/engine.js';

test('checkGameOver reports win when boss hp is 0', () => {
  const result = checkGameOver({ turn: 1, turnLimit: 10, boss: { hp: 0 } });
  assert.deepEqual(result, { over: true, result: 'win' });
});

test('checkGameOver reports lose when turn exceeds turnLimit', () => {
  const result = checkGameOver({ turn: 10, turnLimit: 10, boss: { hp: 50 } });
  assert.deepEqual(result, { over: true, result: 'lose' });
});

test('checkGameOver reports not over otherwise', () => {
  const result = checkGameOver({ turn: 3, turnLimit: 10, boss: { hp: 50 } });
  assert.deepEqual(result, { over: false, result: null });
});

test('playTurn moves players, resolves effects, and advances the turn counter', () => {
  const state = createGameState(
    [{ id: 'p1', name: 'Alice', characterId: 'warrior' }],
    'fireDragon',
    () => 0.5,
  );
  const { state: nextState, gameOver } = playTurn(state, { p1: 6 }, {}, {}, {}, () => 0.5);
  assert.equal(nextState.turn, 1);
  assert.deepEqual(nextState.players[0].position, { track: 'trunk', index: 6 });
  assert.equal(gameOver.over, false);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL (`checkGameOver`/`playTurn`が未定義)

- [ ] **Step 3: 実装を追加**

```js
// src/engine.js に追記
export function checkGameOver(state) {
  if (state.boss.hp <= 0) return { over: true, result: 'win' };
  if (state.turn >= state.turnLimit) return { over: true, result: 'lose' };
  return { over: false, result: null };
}

export function playTurn(state, moves, chooseBranchFns, attackRolls, damageRolls, rng = Math.random) {
  const movedState = resolveMovement(state, moves, chooseBranchFns, rng);
  const resolvedState = resolveEffects(movedState, attackRolls, damageRolls, rng);
  const nextState = { ...resolvedState, turn: resolvedState.turn + 1 };
  const gameOver = checkGameOver(nextState);
  return { state: nextState, gameOver };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS (mapGenerator + characters + boss + engineの全テスト)

- [ ] **Step 5: コミット**

```bash
git add src/engine.js test/engine.test.js
git commit -m "feat: add win/lose detection and turn orchestration"
```

---

## Task 8: render.js — DOM描画

**Files:**
- Create: `src/render.js`

**Interfaces:**
- Consumes: `GameState`の形(Task 5-7で確定した`{ turn, turnLimit, boss, players, map }`)
- Produces: `renderGame(state, container)` — `container`(DOM要素)の中身を現在の状態で再描画する

- [ ] **Step 1: 実装**

(DOM描画は自動テスト対象外。spec通り目視確認とする。)

```js
// src/render.js
import { getCell } from './mapGenerator.js';

const BOARD_WINDOW = 10; // 各プレイヤーの前後何マスを表示するか

export function renderGame(state, container) {
  container.innerHTML = '';
  container.appendChild(renderBoss(state));
  container.appendChild(renderBoard(state));
  container.appendChild(renderPlayers(state));
}

function renderBoss(state) {
  const section = document.createElement('section');
  section.className = 'boss-panel';
  const hpPercent = Math.round((state.boss.hp / state.boss.maxHp) * 100);
  section.innerHTML = `
    <h2>${state.boss.name}</h2>
    <div class="hp-bar"><div class="hp-bar-fill" style="width:${hpPercent}%"></div></div>
    <p>HP ${state.boss.hp} / ${state.boss.maxHp}</p>
    <p>ターン ${state.turn} / ${state.turnLimit}</p>
  `;
  return section;
}

const CELL_ICONS = { attack: '⚔', defense: '🛡', heal: '♥', item: '🎁', damage: '💥' };

function renderBoard(state) {
  const section = document.createElement('section');
  section.className = 'board';
  const furthest = state.players.reduce((max, p) => (p.position.track === 'trunk' ? Math.max(max, p.position.index) : max), 0);
  const start = Math.max(0, furthest - BOARD_WINDOW);
  const end = Math.min(state.map.trunk.length, furthest + BOARD_WINDOW);

  for (let i = start; i < end; i++) {
    const cell = state.map.trunk[i];
    const cellEl = document.createElement('span');
    cellEl.className = 'cell';
    cellEl.textContent = CELL_ICONS[cell.type];
    const here = state.players.filter((p) => p.position.track === 'trunk' && p.position.index === i);
    if (here.length > 0) {
      cellEl.title = here.map((p) => p.name).join(', ');
      cellEl.classList.add('occupied');
    }
    section.appendChild(cellEl);
  }
  return section;
}

function renderPlayers(state) {
  const section = document.createElement('section');
  section.className = 'players';
  for (const player of state.players) {
    const cell = getCell(state.map, player.position.track, player.position.index);
    const card = document.createElement('div');
    card.className = 'player-card';
    card.innerHTML = `
      <strong>${player.name}</strong>
      <span>HP ${player.hp} / ${player.maxHp}</span>
      <span>現在地: ${CELL_ICONS[cell.type]}</span>
    `;
    section.appendChild(card);
  }
  return section;
}
```

- [ ] **Step 2: コミット**

```bash
git add src/render.js
git commit -m "feat: add DOM rendering for boss, board, and players"
```

---

## Task 9: main.js + index.html + style.css — キャラ選択とゲームループ

**Files:**
- Create: `src/main.js`
- Modify: `index.html`
- Modify: `style.css`

**Interfaces:**
- Consumes: `createGameState`, `playTurn`, `rollDie`(engine.js) / `CHARACTERS`(characters.js) / `renderGame`(render.js)

- [ ] **Step 1: index.htmlを実装**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>双六RPG</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="src/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: main.jsを実装**

```js
// src/main.js
import { CHARACTERS } from './characters.js';
import { createGameState, playTurn, rollDie } from './engine.js';
import { getCell } from './mapGenerator.js';
import { renderGame } from './render.js';

const app = document.getElementById('app');
let state = null;
let pendingMoves = {};

renderSetupScreen();

function renderSetupScreen() {
  app.innerHTML = '';
  const form = document.createElement('form');
  form.innerHTML = `
    <h1>双六RPG - プレイヤー設定</h1>
    <label>プレイヤー人数(2〜8)
      <input type="number" id="playerCount" min="2" max="8" value="2" />
    </label>
    <div id="playerSlots"></div>
    <button type="submit">ゲーム開始</button>
  `;
  app.appendChild(form);

  const slotsContainer = form.querySelector('#playerSlots');
  const countInput = form.querySelector('#playerCount');

  function renderSlots() {
    const count = Number(countInput.value);
    slotsContainer.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const row = document.createElement('div');
      row.innerHTML = `
        <input type="text" name="name-${i}" placeholder="プレイヤー${i + 1}" value="プレイヤー${i + 1}" />
        <select name="character-${i}">
          ${Object.values(CHARACTERS)
            .map((c) => `<option value="${c.id}">${c.name}</option>`)
            .join('')}
        </select>
      `;
      slotsContainer.appendChild(row);
    }
  }
  countInput.addEventListener('input', renderSlots);
  renderSlots();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const count = Number(countInput.value);
    const selections = [];
    for (let i = 0; i < count; i++) {
      selections.push({
        id: `p${i}`,
        name: form.querySelector(`[name="name-${i}"]`).value || `プレイヤー${i + 1}`,
        characterId: form.querySelector(`[name="character-${i}"]`).value,
      });
    }
    startGame(selections);
  });
}

function startGame(selections) {
  state = createGameState(selections, 'fireDragon');
  pendingMoves = {};
  renderTurnScreen();
}

function renderTurnScreen() {
  renderGame(state, app);

  const controls = document.createElement('section');
  controls.className = 'controls';
  for (const player of state.players) {
    const button = document.createElement('button');
    const rolled = pendingMoves[player.id] !== undefined;
    button.textContent = rolled ? `${player.name}: ${pendingMoves[player.id]}` : `${player.name} サイコロを振る`;
    button.disabled = rolled;
    button.addEventListener('click', () => {
      pendingMoves[player.id] = rollDie();
      renderTurnScreen();
    });
    controls.appendChild(button);
  }
  app.appendChild(controls);

  const allRolled = state.players.every((p) => pendingMoves[p.id] !== undefined);
  if (allRolled) {
    const resolveButton = document.createElement('button');
    resolveButton.textContent = 'ターンを解決する';
    resolveButton.addEventListener('click', resolveTurn);
    app.appendChild(resolveButton);
  }
}

function resolveTurn() {
  const chooseBranchFns = {};
  for (const player of state.players) {
    chooseBranchFns[player.id] = (forks) => {
      if (forks.length === 0) return null;
      const names = forks.map((f, i) => `${i + 1}: ${f.theme}`).join('\n');
      const answer = window.prompt(`${player.name}: 分岐があります。番号を選んでください(未入力で幹を直進)\n${names}`);
      const index = Number(answer) - 1;
      return forks[index] ? forks[index].id : null;
    };
  }

  const attackRolls = {};
  const damageRolls = {};
  for (const player of state.players) {
    attackRolls[player.id] = rollDie();
    damageRolls[player.id] = rollDie();
  }

  const { state: nextState, gameOver } = playTurn(state, pendingMoves, chooseBranchFns, attackRolls, damageRolls);
  state = nextState;
  pendingMoves = {};

  if (gameOver.over) {
    renderGame(state, app);
    const banner = document.createElement('h1');
    banner.textContent = gameOver.result === 'win' ? '勝利!' : '敗北...';
    app.appendChild(banner);
    return;
  }

  renderTurnScreen();
}
```

- [ ] **Step 3: style.cssを実装**

```css
body {
  font-family: system-ui, sans-serif;
  background: #1b1f24;
  color: #eee;
  margin: 0;
  padding: 1rem;
}

.boss-panel {
  border: 1px solid #444;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
}

.hp-bar {
  background: #333;
  border-radius: 4px;
  height: 12px;
  overflow: hidden;
}

.hp-bar-fill {
  background: #c0392b;
  height: 100%;
}

.board {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 0.5rem;
  background: #262b31;
  border-radius: 8px;
  margin-bottom: 1rem;
}

.cell {
  min-width: 2rem;
  text-align: center;
  padding: 0.25rem;
  border-radius: 4px;
}

.cell.occupied {
  background: #3a4a5c;
}

.players {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.player-card {
  border: 1px solid #444;
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  display: flex;
  flex-direction: column;
  min-width: 8rem;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.controls button {
  padding: 0.5rem 0.75rem;
}
```

(配色はフェーズ3で見直す前提の暫定値。ネオン系は避け、落ち着いたトーンにしてある。)

- [ ] **Step 4: ブラウザで動作確認**

`index.html`を開き(例: `npx serve .`または任意の静的サーバー、あるいはブラウザで直接ファイルを開く)、以下を確認する:
- 2〜8人でプレイヤー人数・キャラを選んでゲーム開始できる
- 各プレイヤーのサイコロボタンを押すと出目が表示され、全員分揃うと「ターンを解決する」ボタンが出る
- ターン解決後、盤面・HP・ボスHPが更新される
- 分岐に到達すると`prompt`でルート選択できる
- ボスHPが0になると勝利、制限ターンを超えると敗北の表示が出る

- [ ] **Step 5: コミット**

```bash
git add src/main.js index.html style.css
git commit -m "feat: wire character select and hotseat game loop to the UI"
```

---

## Task 10: 最終確認

**Files:** なし(検証のみ)

- [ ] **Step 1: 全自動テストを実行**

Run: `npm test`
Expected: PASS (全スイート)

- [ ] **Step 2: ブラウザで2人プレイを最初から最後まで通しでプレイし、Task 9のチェック項目に加えて以下を確認**
- 味方が回復マスの周囲3マス以内にいると回復されること
- 防御マスに複数人がいるとき全員がボス攻撃を無効化すること
- HPが0になったプレイヤーがその場で復活すること(最大HPの半分)

- [ ] **Step 3: 気になったバランス値があれば`src/boss.js`/`src/characters.js`の数値をメモしておく(フェーズ3で調整)**

- [ ] **Step 4: 最終コミット(必要なら)**

```bash
git status
# 変更が残っていれば適宜 git add && git commit
```
