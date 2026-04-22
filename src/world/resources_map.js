// Resource node map - wood/stone/iron nodes tracked separately from tiles

import { TILE, TILE_SIZE, MAP_W, MAP_H } from './map.js';
import { add } from '../resources.js';

let nodeMap = new Map();  // id -> node
let nodesByTile = new Map(); // "tx,ty" -> node id

let uidCounter = 0;

export function initResourceNodes(tiles, sprites) {
  nodeMap = new Map();
  nodesByTile = new Map();
  uidCounter = 0;

  // Stone resource nodes: 25% sample of STONE_ROCK tiles
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (tiles[ty * MAP_W + tx] === TILE.STONE_ROCK) {
        if (Math.random() < 0.25) {  // post-gen so Math.random is OK here
          registerNode({ tx, ty, kind: 'stone', hp: 4, maxHp: 4, sprite: null });
        }
      }
    }
  }

  // Wood/iron nodes from sprites scattered at map gen
  for (const s of sprites) {
    if (s.kind2 === 'wood' || s.kind2 === 'iron') {
      registerNode({ tx: s.tx, ty: s.ty, kind: s.kind2,
        hp: s.maxHp || (s.kind2 === 'wood' ? 3 : 5),
        maxHp: s.maxHp || (s.kind2 === 'wood' ? 3 : 5),
        sprite: s });
    }
  }
}

function registerNode({ tx, ty, kind, hp, maxHp, sprite }) {
  const id = `n${uidCounter++}`;
  const node = { id, tx, ty, kind, hp, maxHp, reserved: null, _sprite: sprite };
  nodeMap.set(id, node);
  nodesByTile.set(`${tx},${ty}`, id);
  return node;
}

export function getNodeById(id) { return nodeMap.get(id) || null; }
export function getNodeAt(tx, ty) {
  const id = nodesByTile.get(`${tx},${ty}`);
  return id ? nodeMap.get(id) : null;
}

export function findNearestNode(kind, fromTx, fromTy, excludeReserved = true) {
  let best = null, bestDist = Infinity;
  for (const node of nodeMap.values()) {
    if (node.kind !== kind) continue;
    if (node.hp <= 0) continue;
    if (excludeReserved && node.reserved) continue;
    const dx = node.tx - fromTx, dy = node.ty - fromTy;
    const d = dx*dx + dy*dy;
    if (d < bestDist) { bestDist = d; best = node; }
  }
  return best;
}

export function reserveNode(nodeId, citizenId) {
  const node = nodeMap.get(nodeId);
  if (!node) return false;
  node.reserved = citizenId;
  return true;
}

export function releaseNode(nodeId) {
  const node = nodeMap.get(nodeId);
  if (node) node.reserved = null;
}

export function strikeNode(nodeId, tiles, sprites) {
  const node = nodeMap.get(nodeId);
  if (!node) return 0;
  node.hp--;
  if (node.hp <= 0) {
    depleteNode(node, tiles, sprites);
    return 0;
  }
  return node.hp;
}

function depleteNode(node, tiles, sprites) {
  nodeMap.delete(node.id);
  nodesByTile.delete(`${node.tx},${node.ty}`);

  if (node.kind === 'stone') {
    // Tile becomes DIRT (walkable)
    tiles[node.ty * MAP_W + node.tx] = TILE.DIRT;
  } else if (node._sprite) {
    // Remove from sprites array
    const idx = sprites.indexOf(node._sprite);
    if (idx !== -1) sprites.splice(idx, 1);
  }
}

export function getAllNodes() { return nodeMap; }
