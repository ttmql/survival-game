/* =========================================================
   Inventory data, recipes, equipment durability and slot rules.

   The equipment bar (8 slots) and backpack (4 × 8 slots) are the
   same kind of slot. Items stack to 64; durability-consuming tools occupy one slot each.
   ========================================================= */

(function () {
  "use strict";

  const EQUIPMENT_SLOT_COUNT = 8;
  const BACKPACK_COLUMNS = 8;
  const BACKPACK_ROWS = 4;
  const BACKPACK_SLOT_COUNT = BACKPACK_COLUMNS * BACKPACK_ROWS;
  const MATERIAL_MAX_STACK = 64;

  // ---------------------------------------------------------------------
  // Inline SVG icons. Everything is drawn as crisp-edged 16×16 pixel art so
  // the game never needs to load external sprite files.
  // ---------------------------------------------------------------------

  const EQUIPMENT_ICON = [
    '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">',
    '<path fill="#9aa39d" d="M4 12 10 6l2 2-6 6z"/>',
    '<path fill="#c9cdbd" d="m10 3 3 3-1 2-2-2-2-2z"/>',
    '<path fill="#5d4631" d="m3 13 2-1 1 1-2 1z"/>',
    "</svg>",
  ].join("");

  const MATERIAL_ICONS = Object.freeze({
    coal: [
      '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">',
      '<path fill="#050a0b" d="M2 7 4 4 8 3 13 6 14 10 10 14 4 13 1 9Z"/>',
      '<path fill="#152125" d="M3 7 5 5 8 4 12 6 12 9 9 12 5 11 2 9Z"/>',
      '<path fill="#2d4347" d="M5 7 7 6 9 7 7 9 5 9Z"/>',
      '<path fill="#73979a" d="M7 5 9 4 11 6 9 6Z"/>',
      '<path fill="#b1ccc8" d="M9 5 10 5 11 6 10 6Z"/>',
      '<path fill="#070b0c" d="M12 10 14 9 15 12 13 15 10 13Z"/>',
      '<path fill="#2b3c3f" d="M12 11 13 10 14 12 12 13Z"/>',
      "</svg>",
    ].join(""),
    wood: [
      '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">',
      '<rect x="2" y="3" width="12" height="5" fill="#24160d"/>',
      '<rect x="3" y="4" width="9" height="3" fill="#704120"/>',
      '<rect x="3" y="4" width="8" height="1" fill="#a06431"/>',
      '<rect x="11" y="4" width="2" height="3" fill="#dfa45a"/>',
      '<rect x="12" y="5" width="1" height="1" fill="#8d5628"/>',
      '<rect x="2" y="9" width="12" height="5" fill="#24160d"/>',
      '<rect x="3" y="10" width="9" height="3" fill="#815029"/>',
      '<rect x="3" y="10" width="8" height="1" fill="#ad6f38"/>',
      '<rect x="11" y="10" width="2" height="3" fill="#e8ad62"/>',
      '<rect x="12" y="11" width="1" height="1" fill="#8d5628"/>',
      '<rect x="5" y="5" width="2" height="1" fill="#5a321a"/>',
      '<rect x="5" y="11" width="2" height="1" fill="#663b1f"/>',
      "</svg>",
    ].join(""),
    dirt: [
      '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">',
      '<path fill="#281a0e" d="M2 8 4 5 8 4 13 6 15 11 10 14 4 13 1 10Z"/>',
      '<path fill="#704a27" d="M3 8 5 6 8 5 12 7 13 10 9 12 4 11 2 9Z"/>',
      '<path fill="#966439" d="M4 7 8 6 11 7 8 9 5 9Z"/>',
      '<path fill="#b8814a" d="M6 6 8 6 9 7 7 7Z"/>',
      '<path fill="#4e341d" d="M5 10 7 9 9 11 7 12Z"/>',
      '<rect x="7" y="1" width="1" height="4" fill="#5d963f"/>',
      '<rect x="5" y="2" width="2" height="1" fill="#7fb057"/>',
      '<rect x="9" y="3" width="2" height="1" fill="#6da24c"/>',
      '<rect x="8" y="2" width="1" height="2" fill="#8fc063"/>',
      "</svg>",
    ].join(""),
    rock: [
      '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">',
      '<path fill="#222522" d="M2 10 5 4 10 3 14 6 13 11 8 14 4 13Z"/>',
      '<path fill="#72756a" d="M4 9 6 5 10 4 13 6 12 10 8 12 5 12Z"/>',
      '<path fill="#9c9d8d" d="M6 5 10 4 12 6 8 7 6 7Z"/>',
      '<path fill="#c2c0a9" d="M7 5 9 5 8 6Z"/>',
      '<path fill="#4a4d45" d="M5 12 8 10 12 10 8 12Z"/>',
      '<path fill="#343730" d="M9 7 10 8 9 11 8 10Z"/>',
      "</svg>",
    ].join(""),
  });

  // Tool icons share one painter with a wood / stone palette.
  function makeToolIcon(toolType, style) {
    const palette = style === "stone"
      ? {
        head: "#94968a",
        light: "#cbc9b6",
        dark: "#5f6259",
        edge: "#2a2d28",
      }
      : {
        head: "#c18a4c",
        light: "#e4b471",
        dark: "#87602f",
        edge: "#2d2115",
      };
    const handle = "#744a29";
    const handleEdge = "#2c1b10";

    const parts = [
      '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">',
    ];

    if (toolType === "axe") {
      parts.push(
        `<rect x="2" y="12" width="2" height="2" fill="${handleEdge}"/>`,
        `<rect x="3" y="12" width="1" height="1" fill="${handle}"/>`,
        `<rect x="4" y="10" width="2" height="2" fill="${handleEdge}"/>`,
        `<rect x="5" y="10" width="1" height="1" fill="${handle}"/>`,
        `<rect x="6" y="8" width="2" height="2" fill="${handleEdge}"/>`,
        `<rect x="7" y="8" width="1" height="1" fill="${handle}"/>`,
        `<rect x="8" y="6" width="2" height="2" fill="${handleEdge}"/>`,
        `<rect x="9" y="6" width="1" height="1" fill="${handle}"/>`,
        `<path fill="${palette.edge}" d="M7 2h6v2h2v4h-3v2H9V8H7V4z"/>`,
        `<path fill="${palette.head}" d="M8 3h4v2h2v2h-3v2H9V7H8z"/>`,
        `<rect x="8" y="3" width="3" height="1" fill="${palette.light}"/>`,
        `<rect x="11" y="6" width="2" height="1" fill="${palette.dark}"/>`
      );
    } else if (toolType === "hoe") {
      parts.push(`<path stroke="${handleEdge}" stroke-width="3" d="M4 14 10 3"/><path stroke="${handle}" stroke-width="1.5" d="M4 14 10 3"/>`,
        `<path fill="${palette.head}" stroke="${palette.edge}" d="m9 3 5 2-1 5-4-2Z"/><path stroke="${palette.light}" d="m10 4 3 1"/>`);
    } else if (toolType === "pickaxe") {
      parts.push(
        `<rect x="7" y="5" width="2" height="10" fill="${handleEdge}"/>`,
        `<rect x="8" y="5" width="1" height="9" fill="${handle}"/>`,
        `<path fill="${palette.edge}" d="M2 4h12v2h-2v2H9V7H7v1H4V6H2z"/>`,
        `<path fill="${palette.head}" d="M3 5h10v1h-1v1H4V6H3z"/>`,
        `<rect x="3" y="5" width="2" height="1" fill="${palette.light}"/>`,
        `<rect x="11" y="5" width="2" height="1" fill="${palette.light}"/>`
      );
    } else if (toolType === "shovel") {
      parts.push(
        `<rect x="7" y="2" width="2" height="9" fill="${handleEdge}"/>`,
        `<rect x="8" y="2" width="1" height="8" fill="${handle}"/>`,
        `<path fill="${palette.edge}" d="M5 9h6v3l-1 1v2H6v-2l-1-1z"/>`,
        `<path fill="${palette.head}" d="M6 10h4v2l-1 1H7l-1-1z"/>`,
        `<rect x="6" y="10" width="4" height="1" fill="${palette.light}"/>`,
        `<rect x="8" y="11" width="1" height="2" fill="${palette.dark}"/>`
      );
    } else if (toolType === "sword") {
      parts.push(
        `<rect x="7" y="1" width="2" height="9" fill="${palette.edge}"/>`,
        `<rect x="8" y="2" width="1" height="7" fill="${palette.light}"/>`,
        `<rect x="7" y="2" width="1" height="7" fill="${palette.head}"/>`,
        `<rect x="4" y="10" width="8" height="2" fill="${handleEdge}"/>`,
        `<rect x="5" y="10" width="6" height="1" fill="${palette.head}"/>`,
        `<rect x="7" y="12" width="2" height="3" fill="${handleEdge}"/>`,
        `<rect x="8" y="12" width="1" height="2" fill="${handle}"/>`,
        `<rect x="6" y="14" width="4" height="1" fill="${palette.dark}"/>`
      );
    }

    parts.push("</svg>");
    return parts.join("");
  }

  function makeWorkbenchIcon() {
    return [
      '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">',
      '<rect x="1" y="6" width="14" height="3" fill="#2b1c0f"/>',
      '<rect x="2" y="6" width="12" height="2" fill="#9c6a3c"/>',
      '<rect x="2" y="5" width="12" height="1" fill="#c6935a"/>',
      '<rect x="3" y="9" width="2" height="5" fill="#2b1c0f"/>',
      '<rect x="11" y="9" width="2" height="5" fill="#2b1c0f"/>',
      '<rect x="4" y="10" width="1" height="3" fill="#6e492a"/>',
      '<rect x="11" y="10" width="1" height="3" fill="#6e492a"/>',
      '<rect x="9" y="2" width="4" height="2" fill="#d0cdb9"/>',
      '<rect x="10" y="2" width="2" height="1" fill="#f0ebd2"/>',
      '<rect x="8" y="3" width="1" height="1" fill="#7d5130"/>',
      "</svg>",
    ].join("");
  }

  function makeTorchIcon() {
    return [
      '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">',
      '<rect x="7" y="7" width="2" height="8" fill="#2b1a0e"/>',
      '<rect x="8" y="7" width="1" height="7" fill="#8a5932"/>',
      '<rect x="6" y="9" width="1" height="2" fill="#6b4327"/>',
      '<rect x="9" y="9" width="1" height="2" fill="#6b4327"/>',
      '<path fill="#d65c24" d="M6 5h4v2h1v2H5V7H6z"/>',
      '<path fill="#f0a33b" d="M7 3h2v4H7z"/>',
      '<rect x="7" y="1" width="1" height="3" fill="#ffe18b"/>',
      "</svg>",
    ].join("");
  }

  function makeSteleIcon() {
    return [
      '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">',
      '<path fill="#242722" d="M4 2h8v11h2v2H2v-2h2z"/>',
      '<path fill="#73766a" d="M5 3h6v10H5z"/>',
      '<rect x="6" y="2" width="4" height="11" fill="#8f9183"/>',
      '<rect x="6" y="4" width="4" height="1" fill="#c0bea8"/>',
      '<rect x="6" y="6" width="3" height="1" fill="#4e5148"/>',
      '<rect x="7" y="8" width="3" height="1" fill="#4e5148"/>',
      '<rect x="6" y="10" width="2" height="1" fill="#4e5148"/>',
      '<rect x="3" y="13" width="10" height="2" fill="#4c4f45"/>',
      "</svg>",
    ].join("");
  }

  function makeRespawnSteleIcon() {
    return [
      '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">',
      '<rect x="3" y="13" width="10" height="2" fill="#292d24"/>',
      '<rect x="4" y="12" width="8" height="1" fill="#8c8e7d"/>',
      '<path fill="#252a24" d="M5 2h6v10H5z"/>',
      '<path fill="#727a6d" d="M6 2h4v10H6z"/>',
      '<rect x="5" y="2" width="2" height="9" fill="#a5aa98"/>',
      '<rect x="7" y="5" width="2" height="4" fill="#2d6b61"/>',
      '<rect x="8" y="4" width="1" height="1" fill="#85d3b7"/>',
      '<rect x="6" y="6" width="1" height="1" fill="#67b49d"/>',
      '<rect x="8" y="9" width="1" height="1" fill="#67b49d"/>',
      '<rect x="2" y="12" width="2" height="1" fill="#4f5a46"/>',
      '<rect x="12" y="12" width="2" height="1" fill="#4f5a46"/>',
      "</svg>",
    ].join("");
  }

  function makeWoolIcon() {
    return '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><rect x="2" y="5" width="12" height="8" fill="#d9d7cc"/><rect x="3" y="4" width="10" height="2" fill="#f0eee3"/><rect x="4" y="7" width="2" height="1" fill="#aaa89f"/><rect x="8" y="9" width="3" height="1" fill="#bdbab0"/><rect x="3" y="11" width="10" height="1" fill="#aaa89f"/></svg>';
  }

  function makeMuttonIcon() {
    return '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><rect x="4" y="5" width="9" height="7" fill="#a65b4d"/><rect x="5" y="4" width="7" height="2" fill="#c77863"/><rect x="2" y="9" width="4" height="2" fill="#e7ddc8"/><rect x="5" y="11" width="7" height="2" fill="#c77863"/><rect x="7" y="6" width="2" height="1" fill="#e0a28d"/></svg>';
  }

  function makeChickenLegIcon() {
    return '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><rect x="3" y="5" width="7" height="6" fill="#d7b26a"/><rect x="4" y="4" width="5" height="2" fill="#efd393"/><rect x="10" y="8" width="3" height="2" fill="#d8d5c7"/><rect x="12" y="10" width="2" height="2" fill="#eeeadd"/><rect x="6" y="7" width="2" height="1" fill="#a47a39"/></svg>';
  }

  function makeElbowIcon() {
    return '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><rect x="3" y="5" width="8" height="7" fill="#687b4f"/><rect x="4" y="4" width="6" height="2" fill="#829665"/><rect x="10" y="8" width="3" height="2" fill="#d9d1bd"/><rect x="5" y="7" width="3" height="1" fill="#4b5a39"/></svg>';
  }

  function makeSilkIcon() {
    return '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><rect x="3" y="3" width="10" height="10" fill="#d7d2e0"/><rect x="4" y="4" width="8" height="8" fill="#eee9f4"/><rect x="5" y="5" width="6" height="1" fill="#b7aec9"/><rect x="7" y="7" width="1" height="4" fill="#b7aec9"/><rect x="5" y="10" width="6" height="1" fill="#b7aec9"/></svg>';
  }

  function makeBedIcon() {
    return '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><rect x="1" y="7" width="14" height="3" fill="#3b2718"/><rect x="2" y="6" width="12" height="2" fill="#e4e0d0"/><rect x="2" y="8" width="12" height="3" fill="#b5483d"/><rect x="2" y="4" width="4" height="3" fill="#f2eee0"/><rect x="12" y="10" width="2" height="4" fill="#5a3b25"/><rect x="2" y="11" width="2" height="3" fill="#5a3b25"/></svg>';
  }

  function makeBowIcon() {
    return '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#6e4729" d="M3 2h2v2h2v1h1v6H6v1H4v2H2v-2h1V5H2V3h1z"/><path fill="#c9c6b6" d="M3 4h1v8H3z"/><rect x="9" y="7" width="5" height="1" fill="#e7ddc0"/><rect x="13" y="6" width="1" height="3" fill="#9e9680"/></svg>';
  }

  function makeScrollIcon() {
    return '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><rect x="2" y="4" width="12" height="9" fill="#d7bc7b"/><rect x="3" y="5" width="10" height="7" fill="#efe0b6"/><rect x="2" y="3" width="12" height="2" fill="#8d6235"/><rect x="2" y="13" width="12" height="1" fill="#8d6235"/><rect x="5" y="7" width="6" height="1" fill="#8b6e3d"/><rect x="5" y="9" width="4" height="1" fill="#a88a56"/><rect x="12" y="2" width="2" height="2" fill="#d8bc7c"/></svg>';
  }

  function makeChestIcon() {
    return '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><rect x="2" y="5" width="12" height="8" fill="#6b4629"/><rect x="2" y="4" width="12" height="3" fill="#8b6037"/><rect x="3" y="7" width="10" height="1" fill="#c49a5c"/><rect x="7" y="3" width="2" height="9" fill="#c9a25b"/><rect x="7" y="8" width="2" height="3" fill="#e2c47b"/></svg>';
  }

  function makeFurnaceIcon() {
    return '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><rect x="3" y="3" width="10" height="11" fill="#6e6c61"/><rect x="4" y="4" width="8" height="9" fill="#8b897b"/><rect x="5" y="8" width="6" height="4" fill="#2b241d"/><rect x="6" y="9" width="4" height="2" fill="#e28745"/><rect x="7" y="1" width="2" height="3" fill="#7b786c"/></svg>';
  }

  function makeCookedMuttonIcon() {
    return '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><rect x="4" y="5" width="9" height="7" fill="#8f4e35"/><rect x="5" y="4" width="7" height="2" fill="#b66a46"/><rect x="2" y="9" width="4" height="2" fill="#f0e4c8"/><rect x="7" y="6" width="1" height="1" fill="#6f3927"/><rect x="9" y="8" width="1" height="1" fill="#6f3927"/></svg>';
  }

  function makeCookedChickenIcon() {
    return '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><rect x="3" y="5" width="7" height="6" fill="#b87b3d"/><rect x="4" y="4" width="5" height="2" fill="#d39c55"/><rect x="10" y="8" width="3" height="2" fill="#e4e0d1"/><rect x="12" y="10" width="2" height="2" fill="#f0ece0"/><rect x="6" y="7" width="2" height="1" fill="#7d4d26"/></svg>';
  }

  function makeWasteIcon() {
    return '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#6a6745" d="M3 10h2V8h3V6h3v3h2v4H8v2H5v-2H3z"/><rect x="5" y="9" width="2" height="1" fill="#8a855e"/><rect x="9" y="11" width="2" height="1" fill="#4c4a32"/></svg>';
  }

  function buildingIcon(type) {
    const shapes = {
      wall: '<path fill="#777971" d="M1 3h14v11H1z"/><path fill="#b5b5a5" d="M1 1h14v3H1z"/><path stroke="#52574f" d="M1 7h14M1 11h14M6 4v3m4 0v4m-4 0v3"/>',
      wood_floor: '<path fill="#ba8b52" d="M1 3h14v10H1z"/><path stroke="#795232" d="M1 6h14M1 10h14M6 3v3m4 0v4m-4 0v3"/>',
      roof: '<path fill="#795248" d="M0 0h16v16H0z"/><path fill="#a97660" d="M0 0h16v3H0zm0 8h16v3H0z"/><path fill="#a16f5c" d="M0 4h16v3H0zm0 8h16v3H0z"/><path stroke="#b88a70" d="M0 .5h16M0 4.5h16M0 8.5h16M0 12.5h16"/><path stroke="#634b43" d="M0 3.5h16M0 7.5h16M0 11.5h16M0 15.5h16M8 1v2M4 5v2m8-2v2M8 9v2M4 13v2m8-2v2"/>',
      wood_door: '<path fill="#5d402a" d="M3 1h10v14H3z"/><path fill="#ba8547" d="M4 2h8v12H4z"/><path stroke="#785331" d="M7 2v12M4 6h8m-8 5h8"/><path fill="#ead295" d="M10 8h2v2h-2z"/>',
      wood_fence: '<path fill="#986b3b" d="M1 5h14v2H1zm0 5h14v2H1z"/><path fill="#c39557" d="M2 2h3v13H2zm9 0h3v13h-3z"/>',
      fence_gate: '<path fill="#b08249" d="M1 2h3v13H1zm11 0h3v13h-3zM4 5h8v2H4zm0 5h8v2H4z"/><path fill="#e4c47c" d="M7 7h2v3H7z"/>',
    };
    return '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">' + shapes[type] + '</svg>';
  }

  // Long in-game inscription shown on the stele panel.
  const STELE_TEXT = [
    "蓝星神秘大陆中永远的神，别人写算法，是在时间复杂度里挣扎；斌神写算法，是在给复杂度重新立法。我们对着 O(n²) 苦苦优化，他把下标一换，直接降到 O(n)；我们为一组边界条件熬到凌晨三点，他看完题意，只说一句“这是单调栈”，然后 AC。",
    "他手里的数据结构是活的。线段树到了他手里，会自己下放懒标记；并查集见到他，会主动路径压缩；连网络流的残量网络，都愿意为他多让出一条增广路。图论、数论、动态规划、计算几何，在他那里不是四门功课，而是四种方言，他随口一句，就是标准答案。",
    "传说他刷题像散步，一天三百道，收题速度快过评测机出数据的速度；也有人说他根本不刷题，他只是把题目重新想了一遍，题目就自己投降了，交出了 AC。更早的传说里，他在机房用自动补全写完了整场模拟赛，队友看见他敲下的第一行 `#include`，就知道这场比赛已经结束了。",
    "最要命的是他讲题。推导像水银泻地，一步不断；写到第三行，你已经忘了自己原本想问什么，只想点头。他调参像老道炼丹，别人 grid search 三天三夜，他改一个学习率，loss 就乖乖收敛。论文审稿人看到他的 idea，先拍桌子，再签字。",
    "他是在替这个宇宙维护正确性。",
  ].join("\n\n");

  // ---------------------------------------------------------------------
  // Item catalogue. Each entry is frozen; `placeType` marks placeable items,
  // `edible` marks food, `toolType`/`weaponType` mark tools/weapons.
  // ---------------------------------------------------------------------
  const ITEMS = Object.freeze({
    blg_gift_box:Object.freeze({id:"blg_gift_box",name:"S16世界赛冠军BLG限定纪念礼盒",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"以此纪念BLG战队在S16世界赛的优秀表现",throwable:"blg",icon:'<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#129ba9" d="M2 6h12v9H2z"/><path fill="#10c3cf" d="M1 4h14v3H1z"/><path fill="#ed4e7a" d="M7 4h2v11H7zM4 1h3v3H4zm5 0h3v3H9z"/><path fill="#ecf8dc" d="M4 9h2v1H4zm6 0h2v1h-2z"/></svg>'}),
    raw_fish:Object.freeze({id:"raw_fish",name:"生鱼",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"海里捕捞到的鱼类",edible:Object.freeze({satiety:20}),icon:'<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#8ac8cc" d="M1 5l4 3-4 3V5zm4 0h7v2h3v3h-3v2H5z"/><rect x="11" y="7" width="1" height="1" fill="#243c43"/></svg>'}),
    cooked_fish:Object.freeze({id:"cooked_fish",name:"熟鱼",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"香喷喷可口的鱼",edible:Object.freeze({satiety:40}),icon:'<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#c58c50" d="M1 5l4 3-4 3V5zm4 0h7v2h3v3h-3v2H5z"/><rect x="11" y="7" width="1" height="1" fill="#243c43"/></svg>'}),
    deep_sea_gills:Object.freeze({id:"deep_sea_gills",name:"深海鱼鳃",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"击败鲨鱼获得的战利品",icon:'<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#703e55" d="M4 2h6v2h2v9h-2v2H4v-2H2V5h2z"/><path fill="#ce8390" d="M5 3h4v2h2v7H9v2H5v-2H3V6h2z"/><path fill="#793f59" d="M5 5h5v1H5zm-1 3h7v1H4zm1 3h5v1H5z"/><path fill="#efd0be" d="M4 4h1v8H4z"/></svg>'}),

    fine_sand: Object.freeze({id:"fine_sand",name:"细沙",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"可以在熔炉中烧制玻璃",icon:'<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#dbc48f" d="M2 5h3V3h7v3h2v8H2z"/><path fill="#f0e8c9" d="M4 6h6v2H4z"/></svg>'}),
    silica: Object.freeze({id:"silica",name:"硅石",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"海洋底部较常见的矿物",icon:'<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#b4e2df" d="M2 5h3V3h7v3h2v8H2z"/><path fill="#f0e8c9" d="M4 6h6v2H4z"/></svg>'}),
    glass: Object.freeze({id:"glass",name:"玻璃",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"耗材，可以制作玻璃制品",icon:'<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#a0e2dc" d="M2 5h3V3h7v3h2v8H2z"/><path fill="#f0e8c9" d="M4 6h6v2H4z"/></svg>'}),
    glass_bottle: Object.freeze({id:"glass_bottle",name:"玻璃瓶",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"在水面上点击，可以用来装水",icon:'<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#c2efdf" stroke="#536d63" d="M5 1h6v3H9v2l4 3v6H3V9l4-3V4H5z"/><path fill="#efffe8" d="M5 10h1v3H5z"/></svg>'}),
    water_bottle: Object.freeze({id:"water_bottle",name:"装水玻璃瓶",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"可以用来灌溉开垦后的土地",icon:'<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#57b9dc" stroke="#536d63" d="M5 1h6v3H9v2l4 3v6H3V9l4-3V4H5z"/><path fill="#efffe8" d="M5 10h1v3H5z"/></svg>'}),
    driftwood: Object.freeze({id:"driftwood",name:"浮木",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"可以放在水中作为支撑物",placeType:"driftwood",icon:'<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#a67e50" d="M1 1h14v14H1z"/><path stroke="#5a3c28" d="M4 1v14m4-14v14m4-14v14"/><path fill="#ddc695" d="M1 3h14v2H1zm0 8h14v2H1z"/></svg>'}),

    wall: Object.freeze({ id: "wall", name: "墙", kind: "material", maxStack: MATERIAL_MAX_STACK, placeType: "wall", description: "坚固结实的混凝土，可以作为房屋的墙使用", icon: buildingIcon("wall") }),
    wood_floor: Object.freeze({ id: "wood_floor", name: "木板砖", kind: "material", maxStack: MATERIAL_MAX_STACK, placeType: "wood_floor", description: "可以作为你房子的地板", icon: buildingIcon("wood_floor") }),
    roof: Object.freeze({ id: "roof", name: "屋顶", kind: "material", maxStack: MATERIAL_MAX_STACK, placeType: "roof", description: "可以作为你房子的屋顶", icon: buildingIcon("roof") }),
    wood_door: Object.freeze({ id: "wood_door", name: "木门", kind: "material", maxStack: MATERIAL_MAX_STACK, placeType: "wood_door", description: "可以作为你房子的门", icon: buildingIcon("wood_door") }),
    wood_fence: Object.freeze({ id: "wood_fence", name: "木栅栏", kind: "material", maxStack: MATERIAL_MAX_STACK, placeType: "wood_fence", description: "围栅栏不觉得很有乐趣吗", icon: buildingIcon("wood_fence") }),
    fence_gate: Object.freeze({ id: "fence_gate", name: "木栅栏门", kind: "material", maxStack: MATERIAL_MAX_STACK, placeType: "fence_gate", description: "搭配木栅栏的门", icon: buildingIcon("fence_gate") }),

    coal: Object.freeze({
      id: "coal",
      name: "小煤块",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "小煤块，材料，在岩石地随处可见",
      icon: MATERIAL_ICONS.coal,
    }),
    wood: Object.freeze({
      id: "wood",
      name: "木块",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "木块，材料，砍伐树木后掉落",
      icon: MATERIAL_ICONS.wood,
    }),
    dirt: Object.freeze({
      id: "dirt",
      name: "土块",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "土块，材料，挖掘脚下的草地获得",
      icon: MATERIAL_ICONS.dirt,
    }),
    rock: Object.freeze({
      id: "rock",
      name: "岩石块",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "岩石块，材料，挖掘脚下的岩石获得",
      icon: MATERIAL_ICONS.rock,
    }),
    enderman_portal_fragment: Object.freeze({
      id: "enderman_portal_fragment", name: "末影人的传送法阵碎片", kind: "material", maxStack: MATERIAL_MAX_STACK,
      description: "可以合成末影人的传送法阵",
      icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="#10182f" stroke="#3656a4" d="m3 3 7-2 4 5-3 8-7-2Z"/><path fill="#28467b" d="m4 4 5-2 2 4-4 5-3-1Z"/><path fill="none" stroke="#71baff" d="m5 4 3 3-2 3m4-6 1 2-2 4"/><path stroke="#bddfff" d="m4 3 3-1m4 7-1 3"/></svg>',
    }),
    enderman_portal: Object.freeze({
      id: "enderman_portal", name: "末影人的传送法阵", kind: "equipment", maxStack: 1, maxDurability: 15, skill: "portal",
      description: "末影人的传送法阵，按对应键释放技能，按 Tab 更改键位。可以在你原地和指定位置生成两个虫洞，交换虫洞之间的移动单位。生存模式冷却8秒",
      icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#020719" stroke="#0f2b76" stroke-width="2"/><path fill="none" stroke="#1b419a" stroke-width="1.5" d="M8 1a7 7 0 0 1 7 7"/></svg>',
    }),
    summoner_bracelet: Object.freeze({
      id: "summoner_bracelet", name: "召唤师手环", kind: "equipment", maxStack: 1, maxDurability: 25, skill: "summoner",
      description: "召唤师手环，你可以选择英雄联盟的一个召唤师技能使用，按tab键更改其键位",
      icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3 8 1 13 3 15 8 13 13 8 15 3 13 1 8Z" fill="#816037" stroke="#3a2920"/><path d="M5 5 8 4 11 5 12 8 11 11 8 12 5 11 4 8Z" fill="#162a2d" stroke="#f0c972"/><path d="m8 2 3 2-3 4-3-4z" fill="#76e2d8" stroke="#345e60"/><path d="M3 11h2m6 0h2" stroke="#d7a756"/></svg>',
    }),
    workbench: Object.freeze({
      id: "workbench",
      name: "工具台",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "创造一切吧",
      placeType: "workbench",
      icon: makeWorkbenchIcon(),
    }),
    sapling: Object.freeze({id:"sapling",name:"小树苗",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"小小树苗快快长大！种在浇水过后的耕地上。",icon:'<svg viewBox="0 0 16 16" aria-hidden="true"><path stroke="#704528" stroke-width="1.5" d="M8 14V6m0 4L4 6m4 2 4-4"/><path fill="#346638" d="M2 3Q7 2 7 7Q2 8 2 3M9 3Q11 0 14 2Q15 7 9 7Z"/><path fill="#79ad4d" d="M3 3Q6 3 6 6M10 4Q11 2 13 3" stroke="#79ad4d"/><path fill="#64452f" d="m8 12-4 3h8z"/></svg>',plant:"sapling"}),
    wheat_seed: Object.freeze({id:"wheat_seed",name:"小麦种子",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"可以在耕地上生长",icon:'<svg viewBox="0 0 16 16" aria-hidden="true"><g fill="#d8a348" stroke="#835725" stroke-width=".5"><ellipse cx="5" cy="5" rx="2" ry="3" transform="rotate(-30 5 5)"/><ellipse cx="11" cy="6" rx="2" ry="3" transform="rotate(35 11 6)"/><ellipse cx="7" cy="12" rx="2" ry="3" transform="rotate(65 7 12)"/></g><path stroke="#f7d68a" d="m4 3 2 4m6-3-2 4m-5 5 4-2"/></svg>',plant:"wheat"}),
    rice_seed: Object.freeze({id:"rice_seed",name:"水稻种子",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"可以在浅水区生长",icon:'<svg viewBox="0 0 16 16" aria-hidden="true"><g fill="#c8b177" stroke="#8c774b" stroke-width=".5"><path d="M2 3Q5 1 6 8Q3 10 2 3M10 2Q14 3 11 9Q8 8 10 2M7 9Q11 8 13 14Q9 16 7 9"/></g><path stroke="#f1de9b" d="m3 4 2 3m6-4-1 4m-2 3 3 3"/></svg>',plant:"rice"}),
    wheat: Object.freeze({id:"wheat",name:"小麦",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"在工具箱以提供食物的原材料",icon:'<svg viewBox="0 0 16 16" aria-hidden="true"><path stroke="#9c742c" d="M7 15V3m-3 12L3 6m7 9 3-9"/><g fill="#e7bd53" stroke="#b48b38" stroke-width=".4"><path d="M7 4 4 2v3l3 2 3-2V2ZM7 8 4 6v3l3 2 3-2V6ZM7 12 4 10v2l3 2 3-2v-2ZM3 8 1 6v3l3 2ZM12 8l3-3v4l-4 3Z"/></g><path stroke="#efda89" d="M7 1v3M4 0v3m6-3v3"/></svg>',}),
    rice: Object.freeze({id:"rice",name:"水稻",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"在工具箱以提供食物的原材料",icon:'<svg viewBox="0 0 16 16" aria-hidden="true"><path stroke="#64853d" d="M5 15Q8 7 8 2Q13 1 14 7M5 15Q2 7 1 5m4 10 5-9" fill="none"/><g fill="#d7c27a"><ellipse cx="10" cy="4" rx="1" ry="2"/><ellipse cx="12" cy="5" rx="1" ry="2"/><ellipse cx="14" cy="8" rx="1" ry="2"/><ellipse cx="9" cy="8" rx="1" ry="2"/><ellipse cx="11" cy="10" rx="1" ry="2"/></g></svg>',}),
    wood_bowl: Object.freeze({id:"wood_bowl",name:"小木碗",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"可以用来盛饭的餐具",icon:'<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="#82502d" stroke="#51311f" d="M1 6h14l-2 6q-5 4-10 0Z"/><ellipse cx="8" cy="6" rx="7" ry="3" fill="#c18b54" stroke="#634027"/><ellipse cx="8" cy="6" rx="5" ry="1.8" fill="#684129"/><path stroke="#b88049" fill="none" d="M4 11q4 3 8 0"/></svg>',}),
    raw_rice: Object.freeze({id:"raw_rice",name:"生米饭",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"在熔炼炉烧制可获得熟米饭",icon:'<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="#986239" stroke="#573922" d="M1 7h14l-2 6H3Z"/><ellipse cx="8" cy="7" rx="7" ry="3" fill="#c89a65"/><ellipse cx="8" cy="7" rx="5" ry="2" fill="#a78e62"/><path stroke="#e9d7a6" stroke-width="1.2" d="m4 7 2-1m1 2 1-2m2 1 2 1m-2-3 2 1"/></svg>',}),
    bread: Object.freeze({id:"bread",name:"面包",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"味道看起来不错的干粮",icon:'<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="#ae652d" stroke="#714025" d="M1 10Q0 4 6 3q6-3 9 3v6Q8 16 1 13Z"/><path fill="#d89b4c" d="M2 10Q1 5 7 4q5-2 7 3v3Q8 13 2 12Z"/><path stroke="#f5d28a" stroke-width="1.5" d="m5 5-2 3m6-4L6 8m6-3-2 3"/></svg>',edible:Object.freeze({satiety:50})}),
    cooked_rice: Object.freeze({id:"cooked_rice",name:"熟米饭",kind:"material",maxStack:MATERIAL_MAX_STACK,description:"好香啊这米饭，迫不及待想吃了啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊",icon:'<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="#986239" stroke="#573922" d="M1 8h14l-2 5H3Z"/><ellipse cx="8" cy="8" rx="7" ry="2.5" fill="#c89a65"/><path fill="#fff4db" stroke="#d9d5bd" stroke-width=".5" d="M2 8Q2 5 5 5Q5 2 8 4Q11 2 12 5Q15 5 14 8Z"/><path stroke="#d6d9ce" d="m5 6 1 1m2-2 1 1m2 0 1 1"/><path fill="none" stroke="#d9e5da" stroke-width=".6" d="M5 3Q3 2 5 0m5 3q-2-1 0-3"/></svg>',edible:Object.freeze({satiety:70,returnItem:"wood_bowl"})}),
    lucian_holy_gun:Object.freeze({id:"lucian_holy_gun",name:"卢锡安的圣枪",kind:"equipment",maxStack:1,maxDurability:5,skill:"culling",description:"卢锡安的圣枪，超级强大的武器，按对应键释放技能，按 Tab 更改键位。7秒内发射200颗子弹，每颗子弹伤害10，生存模式冷却20秒",icon:'<svg viewBox="0 0 16 16"><path fill="#243448" stroke="#101d2b" d="M2 2h12v4H9v8H5V6H2z"/><path fill="#c4d5df" d="M2 2h12v2H2zm4 5h2v6H6z"/><path fill="#58cfff" d="M11 3h4v2h-4z"/><path fill="#7795ad" d="M3 5h7v2H3z"/></svg>'}),
    wood_hoe:Object.freeze({id:"wood_hoe",name:"木锄头",kind:"equipment",maxStack:1,maxDurability:30,toolType:"hoe",speedMultiplier:1,attackBonus:0,description:"农具，点击草地，可以将其开垦化，以种植作物",icon:makeToolIcon("hoe","wood")}),
    stone_hoe:Object.freeze({id:"stone_hoe",name:"石锄头",kind:"equipment",maxStack:1,maxDurability:60,toolType:"hoe",speedMultiplier:1,attackBonus:0,description:"结实一点的农具，点击草地，可以将其开垦化，以种植作物",icon:makeToolIcon("hoe","stone")}),
    wood_axe: Object.freeze({
      id: "wood_axe",
      name: "木斧头",
      kind: "equipment",
      maxStack: 1,
      maxDurability: 30,
      toolType: "axe",
      speedMultiplier: 1,
      attackBonus: 0,
      description: "装备，对树木使用，可以加快砍伐速度",
      icon: makeToolIcon("axe", "wood"),
    }),
    stone_axe: Object.freeze({
      id: "stone_axe",
      name: "石斧头",
      kind: "equipment",
      maxStack: 1,
      maxDurability: 60,
      toolType: "axe",
      speedMultiplier: 1.5,
      attackBonus: 0,
      description: "结实一点的装备，对树木使用，可以加快砍伐速度",
      icon: makeToolIcon("axe", "stone"),
    }),
    wood_pickaxe: Object.freeze({
      id: "wood_pickaxe",
      name: "木镐子",
      kind: "equipment",
      maxStack: 1,
      maxDurability: 30,
      toolType: "pickaxe",
      speedMultiplier: 1,
      attackBonus: 0,
      description: "装备，对岩石使用，可以加快挖掘速度",
      icon: makeToolIcon("pickaxe", "wood"),
    }),
    stone_pickaxe: Object.freeze({
      id: "stone_pickaxe",
      name: "石镐子",
      kind: "equipment",
      maxStack: 1,
      maxDurability: 60,
      toolType: "pickaxe",
      speedMultiplier: 1.5,
      attackBonus: 0,
      description: "结实一点的装备，对岩石使用，可以加快挖掘速度",
      icon: makeToolIcon("pickaxe", "stone"),
    }),
    wood_shovel: Object.freeze({
      id: "wood_shovel",
      name: "木铲子",
      kind: "equipment",
      maxStack: 1,
      maxDurability: 30,
      toolType: "shovel",
      speedMultiplier: 1,
      attackBonus: 0,
      description: "装备，对草地使用，可以加快挖掘速度",
      icon: makeToolIcon("shovel", "wood"),
    }),
    stone_shovel: Object.freeze({
      id: "stone_shovel",
      name: "石铲子",
      kind: "equipment",
      maxStack: 1,
      maxDurability: 60,
      toolType: "shovel",
      speedMultiplier: 1.5,
      attackBonus: 0,
      description: "结实一点的装备，对草地使用，可以加快挖掘速度",
      icon: makeToolIcon("shovel", "stone"),
    }),
    torch: Object.freeze({
      id: "torch",
      name: "火把",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "材料，怕黑不老铁",
      placeType: "torch",
      icon: makeTorchIcon(),
    }),
    wood_sword: Object.freeze({
      id: "wood_sword",
      name: "木剑",
      kind: "equipment",
      maxStack: 1,
      maxDurability: 60,
      attackBonus: 10,
      description: "装备，可以自保的武器",
      icon: makeToolIcon("sword", "wood"),
    }),
    stone_sword: Object.freeze({
      id: "stone_sword",
      name: "石剑",
      kind: "equipment",
      maxStack: 1,
      maxDurability: 120,
      attackBonus: 15,
      description: "结实一点的装备，你过来呀啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊",
      icon: makeToolIcon("sword", "stone"),
    }),
    stele: Object.freeze({
      id: "stele",
      name: "夸赞斌神的石碑",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "斌神的强大震古烁今",
      placeType: "stele",
      steleText: STELE_TEXT,
      icon: makeSteleIcon(),
    }),
    respawn_stele: Object.freeze({
      id: "respawn_stele",
      name: "复活石碑",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "复活吧我的爱人",
      placeType: "respawn_stele",
      icon: makeRespawnSteleIcon(),
    }),
    wool: Object.freeze({
      id: "wool",
      name: "羊毛",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "从羊身上获取的毛发",
      icon: makeWoolIcon(),
    }),
    raw_pork: Object.freeze({
      id: "raw_pork", name: "生猪肉", kind: "material", maxStack: MATERIAL_MAX_STACK,
      description: "看起来可以吃，小心食物中毒",
      edible: Object.freeze({ satiety: 30, poisonChance: 0.7, slowFactor: 0.5, slowHours: 2, indigestion: true }),
      icon: '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#d68489" d="M3 4h9v2h2v6H3z"/><path fill="#f4c4b9" d="M4 5h7v2H6v4H4z"/><rect x="8" y="8" width="4" height="2" fill="#b45f6b"/></svg>',
    }),
    cooked_pork: Object.freeze({
      id: "cooked_pork", name: "熟猪肉", kind: "material", maxStack: MATERIAL_MAX_STACK,
      description: "香喷喷美味可口",
      edible: Object.freeze({ satiety: 60, poisonChance: 0 }),
      icon: '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#a65e38" d="M3 4h9v2h2v6H3z"/><path fill="#d69b60" d="M4 5h7v2H6v4H4z"/><path fill="#603622" d="M8 7h1v4H8zm3 0h1v4h-1z"/></svg>',
    }),
    animal_manure: Object.freeze({
      id: "animal_manure", name: "动物粪便", kind: "material", maxStack: MATERIAL_MAX_STACK,
      description: "可以加速作物生长",
      edible: Object.freeze({satiety:10,manureDietHours:24}),
      icon: '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#725039" d="M2 10h2V7h3V4h3v3h2v3h2v3H2z"/><path fill="#a07b4a" d="M5 8h5v1H5zm-1 3h7v1H4z"/></svg>',
    }),
    spider_leg: Object.freeze({
      id: "spider_leg", name: "蜘蛛腿", kind: "material", maxStack: MATERIAL_MAX_STACK,
      description: "看起来似乎可以吃？",
      edible: Object.freeze({ satiety: 0, healthDamage: 30 }),
      icon: '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path fill="#51444f" d="M2 3h3v3h3v3h3v5H9v-4H6V7H3z"/><path fill="#94727f" d="M3 3h1v3H3zm4 4h1v2H7zm3 3h1v3h-1z"/></svg>',
    }),
    raw_mutton: Object.freeze({
      id: "raw_mutton",
      name: "生羊腿",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "吃生肉小心食物中毒，长按鼠标左键食用",
      edible: Object.freeze({ satiety: 30, poisonChance: 0.5, poisonDamage: 50, poisonHours: 1 }),
      icon: makeMuttonIcon(),
    }),
    algorithm_chicken_leg: Object.freeze({
      id: "algorithm_chicken_leg",
      name: "斌神培育的算法鸡腿",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "吃生肉小心食物中毒，长按鼠标左键食用",
      edible: Object.freeze({ satiety: 20, poisonChance: 0.5, poisonDamage: 30, poisonHours: 1 }),
      icon: makeChickenLegIcon(),
    }),
    zombie_elbow: Object.freeze({
      id: "zombie_elbow",
      name: "僵尸肘子",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "奇怪的肘子，真的可以吃吗",
      edible: Object.freeze({ satiety: 20, poisonChance: 1, slowFactor: 0.3, slowHours: 1 }),
      icon: makeElbowIcon(),
    }),
    silk: Object.freeze({
      id: "silk",
      name: "丝线",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "野人猎手身上搜刮到的奇怪物品",
      icon: makeSilkIcon(),
    }),
    comfortable_bed: Object.freeze({
      id: "comfortable_bed",
      name: "舒服的床",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "帮你熬过晚上，睡觉把",
      placeType: "bed",
      icon: makeBedIcon(),
    }),
    wood_bow: Object.freeze({
      id: "wood_bow",
      name: "木弓",
      kind: "equipment",
      maxStack: 1,
      maxDurability: 30,
      weaponType: "bow",
      attackDamage: 40,
      attackBonus: 0,
      description: "装备，远程攻击，单次伤害40",
      icon: makeBowIcon(),
    }),
    creation_scroll: Object.freeze({
      id: "creation_scroll",
      name: "创世卷轴",
      kind: "equipment",
      maxStack: MATERIAL_MAX_STACK,
      unbreakable: true,
      description: "学习部重要成员张嘉颂开发的卷轴，可以助你合成工具台，拿在手上右键点击",
      icon: makeScrollIcon(),
    }),
    storage_chest: Object.freeze({
      id: "storage_chest",
      name: "储物箱",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "可以容纳物品的箱子",
      placeType: "storage_chest",
      icon: makeChestIcon(),
    }),
    furnace: Object.freeze({
      id: "furnace",
      name: "熔炼炉",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "没有什么是不可以烧的哈哈哈哈哈哈哈哈哈",
      placeType: "furnace",
      icon: makeFurnaceIcon(),
    }),
    cooked_mutton: Object.freeze({
      id: "cooked_mutton",
      name: "熟羊腿",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "美味可口",
      edible: Object.freeze({ satiety: 60, poisonChance: 0 }),
      icon: makeCookedMuttonIcon(),
    }),
    cooked_algorithm_chicken_leg: Object.freeze({
      id: "cooked_algorithm_chicken_leg",
      name: "熟斌神培育的算法鸡腿",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "美味可口",
      edible: Object.freeze({ satiety: 40, poisonChance: 0 }),
      icon: makeCookedChickenIcon(),
    }),
    strange_waste: Object.freeze({
      id: "strange_waste",
      name: "奇怪废料",
      kind: "material",
      maxStack: MATERIAL_MAX_STACK,
      description: "真的可以吃吗",
      edible: Object.freeze({ satiety: 0, poisonChance: 0, kills: true }),
      icon: makeWasteIcon(),
    }),
  });

  // Crafting recipes. `costs` maps itemId → required count.
  const RECIPES = Object.freeze([
    Object.freeze({ id: "recipe_enderman_portal", output: "enderman_portal", count: 1, costs: Object.freeze({ enderman_portal_fragment: 4 }) }),
Object.freeze({id:"recipe_wood_hoe",output:"wood_hoe",count:1,costs:Object.freeze({wood:5})}),
Object.freeze({id:"recipe_stone_hoe",output:"stone_hoe",count:1,costs:Object.freeze({wood:2,rock:2})}),
Object.freeze({id:"recipe_bread",output:"bread",count:1,costs:Object.freeze({wheat:2})}),
Object.freeze({id:"recipe_wood_bowl",output:"wood_bowl",count:1,costs:Object.freeze({wood:3})}),
Object.freeze({id:"recipe_raw_rice",output:"raw_rice",count:1,costs:Object.freeze({wood_bowl:1,rice:2})}),

    Object.freeze({id:"recipe_blg_gift_box",output:"blg_gift_box",count:1,costs:Object.freeze({silica:2,wood:2})}),
    Object.freeze({id:"recipe_glass_bottle",output:"glass_bottle",count:1,costs:Object.freeze({glass:2,silica:1,wood:1})}),
    Object.freeze({id:"recipe_driftwood",output:"driftwood",count:1,costs:Object.freeze({silica:1,wood:1})}),
    Object.freeze({ id: "recipe_wall", output: "wall", count: 1, costs: Object.freeze({"dirt": 1, "rock": 1}) }),
    Object.freeze({ id: "recipe_wood_floor", output: "wood_floor", count: 1, costs: Object.freeze({"wood": 1}) }),
    Object.freeze({ id: "recipe_roof", output: "roof", count: 1, costs: Object.freeze({"wood": 1, "rock": 1}) }),
    Object.freeze({ id: "recipe_wood_door", output: "wood_door", count: 1, costs: Object.freeze({"wood": 4}) }),
    Object.freeze({ id: "recipe_wood_fence", output: "wood_fence", count: 1, costs: Object.freeze({"wood": 1}) }),
    Object.freeze({ id: "recipe_fence_gate", output: "fence_gate", count: 1, costs: Object.freeze({"wood": 6}) }),

    Object.freeze({ id: "recipe_wood_axe", output: "wood_axe", count: 1, costs: Object.freeze({ wood: 5 }) }),
    Object.freeze({ id: "recipe_stone_axe", output: "stone_axe", count: 1, costs: Object.freeze({ wood: 2, rock: 3 }) }),
    Object.freeze({ id: "recipe_wood_pickaxe", output: "wood_pickaxe", count: 1, costs: Object.freeze({ wood: 5 }) }),
    Object.freeze({ id: "recipe_stone_pickaxe", output: "stone_pickaxe", count: 1, costs: Object.freeze({ wood: 2, rock: 3 }) }),
    Object.freeze({ id: "recipe_wood_shovel", output: "wood_shovel", count: 1, costs: Object.freeze({ wood: 5 }) }),
    Object.freeze({ id: "recipe_stone_shovel", output: "stone_shovel", count: 1, costs: Object.freeze({ wood: 2, rock: 3 }) }),
    Object.freeze({ id: "recipe_torch", output: "torch", count: 1, costs: Object.freeze({ wood: 2, coal: 1 }) }),
    Object.freeze({ id: "recipe_wood_sword", output: "wood_sword", count: 1, costs: Object.freeze({ wood: 7 }) }),
    Object.freeze({ id: "recipe_stone_sword", output: "stone_sword", count: 1, costs: Object.freeze({ wood: 3, rock: 5 }) }),
    Object.freeze({ id: "recipe_stele", output: "stele", count: 1, costs: Object.freeze({ wood: 2, rock: 3, coal: 3, dirt: 3 }) }),
    Object.freeze({ id: "recipe_respawn_stele", output: "respawn_stele", count: 1, costs: Object.freeze({ rock: 8 }) }),
    Object.freeze({ id: "recipe_bed", output: "comfortable_bed", count: 1, costs: Object.freeze({ wool: 1, wood: 5, rock: 2 }) }),
    Object.freeze({ id: "recipe_wood_bow", output: "wood_bow", count: 1, costs: Object.freeze({ silk: 2, wood: 8 }) }),
    Object.freeze({ id: "recipe_storage_chest", output: "storage_chest", count: 1, costs: Object.freeze({ wood: 8 }) }),
    Object.freeze({ id: "recipe_furnace", output: "furnace", count: 1, costs: Object.freeze({ rock: 8 }) }),
  ]);

  function itemTypeLabel(item) {
    return item.kind === "equipment" ? "装备" : "材料";
  }

  function itemIcon(item) {
    return item.icon || EQUIPMENT_ICON;
  }

  // Shallow-copy a slot array (used for crafting rollback).
  function copySlots(slots) {
    return slots.map((stack) => (stack ? { ...stack } : null));
  }

  /**
   * Owns the two slot areas and all stack/durability/crafting rules.
   * Slot objects look like `{ itemId, count, durability? }`.
   */
  class Inventory {
    constructor(itemDefinitions) {
      this.items = itemDefinitions || ITEMS;
      this.equipment = new Array(EQUIPMENT_SLOT_COUNT).fill(null);
      this.backpack = new Array(BACKPACK_SLOT_COUNT).fill(null);
    }

    getSlots(area) {
      if (area === "equipment") return this.equipment;
      if (area === "backpack") return this.backpack;
      return null;
    }

    getSlot(area, index) {
      const slots = this.getSlots(area);
      if (!slots || index < 0 || index >= slots.length) return null;
      return slots[index];
    }

    setSlot(area, index, stack) {
      const slots = this.getSlots(area);
      if (!slots || index < 0 || index >= slots.length) return false;
      slots[index] = stack;
      return true;
    }

    removeSlot(area, index) {
      return this.setSlot(area, index, null);
    }

    swap(from, to) {
      if (!from || !to) return false;
      if (from.area === to.area && from.index === to.index) return false;

      const a = this.getSlot(from.area, from.index);
      const b = this.getSlot(to.area, to.index);
      if (!this.setSlot(from.area, from.index, b)) return false;
      if (!this.setSlot(to.area, to.index, a)) return false;
      return true;
    }

    itemDefinition(itemId) {
      return this.items[itemId] || null;
    }

    maxStackFor(itemId) {
      const item = this.itemDefinition(itemId);
      if (!item) return 0;
      return item.maxDurability > 0 && !item.unbreakable ? 1 : MATERIAL_MAX_STACK;
    }

    addEquipment(itemId, durability, skillReadyAt = 0) {
      const item = this.itemDefinition(itemId);
      if (!item || item.kind !== "equipment") return false;

      if (this.maxStackFor(itemId) > 1) return this.addItem(itemId,1) === 1;
      const maxDurability = item.maxDurability || 1;
      const value = Number.isFinite(durability)
        ? Math.max(0, Math.min(maxDurability, durability))
        : maxDurability;
      if (value <= 0) return false;

      for (const area of ["equipment", "backpack"]) {
        const slots = this.getSlots(area);
        for (let i = 0; i < slots.length; i += 1) {
          if (slots[i]) continue;
          slots[i] = { itemId, count: 1, durability: value, ...(skillReadyAt ? {skillReadyAt} : {}) };
          return true;
        }
      }

      return false;
    }

    /**
     * Add a material/equipment stack using Minecraft-like priority:
     * merge into an existing matching stack first, then use empty
     * equipment slots before empty backpack slots.
     *
     * Returns the number of units actually accepted.
     */
    addItem(itemId, amount) {
      const item = this.itemDefinition(itemId);
      if (!item) return 0;

      let remaining = Math.max(0, Math.floor(Number(amount) || 0));
      if (remaining === 0) return 0;

      if (item.kind === "equipment" && this.maxStackFor(itemId) === 1) {
        let accepted = 0;
        while (accepted < remaining && this.addEquipment(itemId, item.maxDurability)) {
          accepted += 1;
        }
        return accepted;
      }

      const maxStack = this.maxStackFor(itemId);
      const areas = ["equipment", "backpack"];

      for (const area of areas) {
        const slots = this.getSlots(area);
        for (let i = 0; i < slots.length && remaining > 0; i += 1) {
          const stack = slots[i];
          if (!stack || stack.itemId !== itemId || stack.count >= maxStack) continue;
          const moved = Math.min(maxStack - stack.count, remaining);
          stack.count += moved;
          remaining -= moved;
        }
      }

      for (const area of areas) {
        const slots = this.getSlots(area);
        for (let i = 0; i < slots.length && remaining > 0; i += 1) {
          if (slots[i]) continue;
          const moved = Math.min(maxStack, remaining);
          slots[i] = { itemId, count: moved };
          remaining -= moved;
        }
      }

      return Math.max(0, Math.floor(Number(amount) || 0)) - remaining;
    }

    sortBackpack() {
      const groups = new Map();
      for (const stack of this.backpack) {
        if (!stack) continue;
        if (!groups.has(stack.itemId)) groups.set(stack.itemId, []);
        const group = groups.get(stack.itemId), max = this.maxStackFor(stack.itemId);
        if (max <= 1) { group.push({ ...stack }); continue; }
        let remaining = stack.count;
        while (remaining > 0) {
          let target = group[group.length - 1];
          if (!target || target.count >= max) { target = { itemId: stack.itemId, count: 0 }; group.push(target); }
          const count = Math.min(remaining,max-target.count);target.count+=count;remaining-=count;
        }
      }
      const sorted = [...groups.values()].flat();
      if (sorted.length > this.backpack.length) return false;
      this.backpack = sorted.concat(new Array(this.backpack.length-sorted.length).fill(null));
      return true;
    }

    removeItem(itemId, amount) {
      let remaining = Math.max(0, Math.floor(Number(amount) || 0));
      const requested = remaining;

      for (const area of ["equipment", "backpack"]) {
        const slots = this.getSlots(area);
        for (let i = 0; i < slots.length && remaining > 0; i += 1) {
          const stack = slots[i];
          if (!stack || stack.itemId !== itemId) continue;
          const taken = Math.min(stack.count, remaining);
          stack.count -= taken;
          remaining -= taken;
          if (stack.count <= 0) slots[i] = null;
        }
      }

      return requested - remaining;
    }

    countItem(itemId) {
      let total = 0;
      for (const area of ["equipment", "backpack"]) {
        const slots = this.getSlots(area);
        for (const stack of slots) {
          if (stack && stack.itemId === itemId) total += stack.count;
        }
      }
      return total;
    }

    hasMaterials(costs) {
      for (const [itemId, count] of Object.entries(costs)) {
        if (this.countItem(itemId) < count) return false;
      }
      return true;
    }

    craft(recipe) {
      const output = this.itemDefinition(recipe.output);
      if (!output || !this.hasMaterials(recipe.costs)) {
        return { ok: false, reason: "materials" };
      }

      const equipmentBackup = copySlots(this.equipment);
      const backpackBackup = copySlots(this.backpack);

      for (const [itemId, count] of Object.entries(recipe.costs)) {
        this.removeItem(itemId, count);
      }

      let accepted = 0;
      if (output.kind === "equipment") {
        for (let i = 0; i < recipe.count; i += 1) {
          if (!this.addEquipment(recipe.output, output.maxDurability)) break;
          accepted += 1;
        }
      } else {
        accepted = this.addItem(recipe.output, recipe.count);
      }

      if (accepted < recipe.count) {
        this.equipment = equipmentBackup;
        this.backpack = backpackBackup;
        return { ok: false, reason: "space" };
      }

      return { ok: true };
    }
  }

  globalThis.Wilds = Object.assign(globalThis.Wilds || {}, {
    ITEMS,
    RECIPES,
    STELE_TEXT,
    Inventory,
    ITEM_ICONS: Object.freeze({
      equipment: EQUIPMENT_ICON,
    }),
    INVENTORY_LAYOUT: Object.freeze({
      equipment: EQUIPMENT_SLOT_COUNT,
      backpackColumns: BACKPACK_COLUMNS,
      backpackRows: BACKPACK_ROWS,
      backpack: BACKPACK_SLOT_COUNT,
    }),
    itemTypeLabel,
    itemIcon,
  });
})();
