const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function loadModule(relativePath, exportedNames, extraContext = {}) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  const context = {
    console,
    setTimeout,
    clearTimeout,
    ...extraContext,
  };
  vm.createContext(context);
  const exportCode = exportedNames
    .map((name) => `${name}: ${name}`)
    .join(",");
  vm.runInContext(`${source}\nthis.__testApi = {${exportCode}};`, context, { filename: relativePath });
  return { context, api: context.__testApi };
}

function loadSelectionTableModule(extraContext = {}) {
  return loadModule("plotly_selection_bridge/selection_table_module.js", [
    "automaticSelectionMethodsForCase",
    "selectedRowsForTable",
    "downloadSelectedCsv",
  ], extraContext);
}

function loadSelectionBridge() {
  const win = {
    parent: null,
    addEventListener() {},
    postMessage() {},
  };
  win.parent = win;
  return loadModule(
    "plotly_selection_bridge/listener.js",
    ["renderSelectedRows", "updateScatterLocator", "rxGradientStrengthForState", "applyRxGradientToPlot"],
    {
      window: win,
      document: {},
    },
  );
}

function loadExportButton() {
  const win = {
    parent: null,
    addEventListener() {},
    postMessage() {},
  };
  win.parent = win;
  return loadModule(
    "plotly_export_button/listener.js",
    ["rxGradientImageSource", "visibleAxisRange", "applyRxGradientToPlot", "normalizeRxGradientStrength", "readRxGradientStrength", "publishRxGradientState"],
    {
      window: win,
      document: {},
    },
  );
}

test("selection provenance counts distinct active methods and preserves case IDs", () => {
  const { context, api } = loadSelectionTableModule();
  const state = vm.runInContext(`({
    methodEnerginetEnabled: true,
    methodEnerginetCasesRaw: new Set(["A", "A"]),
    methodIecEnabled: true,
    methodIecCasesRaw: new Set(["A"]),
    methodPeakZEnabled: true,
    methodPeakZCasesRaw: new Set(["A"]),
    methodPeakXEnabled: false,
    methodPeakXCasesRaw: new Set(["A"]),
    methodRiskEnabled: true,
    methodRiskCasesRaw: new Set(["B"]),
    methodOutlierEnabled: false,
    methodOutlierCasesRaw: new Set(["A"]),
    selectedCases: new Set(["A", "M"]),
  })`, context);

  assert.deepEqual(
    Array.from(api.automaticSelectionMethodsForCase(state, "A")),
    ["Energinet", "RX hull", "Peak |Z|"],
  );
  assert.deepEqual(Array.from(api.automaticSelectionMethodsForCase(state, "B")), ["Risk"]);

  state.methodRiskEnabled = true;
  state.methodRiskCasesRaw = vm.runInContext('new Set(["A"])', context);
  assert.deepEqual(
    Array.from(api.automaticSelectionMethodsForCase(state, "A")),
    ["Energinet", "RX hull", "Peak |Z|", "Risk"],
  );

  context.stateForTest = state;
  const tableContext = vm.runInContext(`({
    state: stateForTest,
    caseById: new Map([
      ["A", {display_case: "C1"}],
      ["M", {display_case: "C5"}],
    ]),
  })`, context);
  const allowed = vm.runInContext('new Set(["A", "M"])', context);
  const rows = api.selectedRowsForTable(tableContext, allowed);
  const rowA = rows.find((row) => row.caseId === "A");
  const rowM = rows.find((row) => row.caseId === "M");
  assert.equal(rowA.caseId, "A");
  assert.equal(rowA.selectionMethodCount, 4);
  assert.deepEqual(Array.from(rowA.selectionMethods), ["Energinet", "RX hull", "Peak |Z|", "Risk"]);
  assert.equal(rowM.selectionMethodCount, 0);
  assert.deepEqual(Array.from(rowM.selectionMethods), []);
  assert.equal(rows[0].caseId, "A");
  assert.equal(rows[1].caseId, "M");
});

test("selected-case CSV keeps the count numeric and method names separate", () => {
  let csvText = "";
  const anchor = { click() {}, remove() {} };
  const { context, api } = loadSelectionTableModule({
    Blob: function Blob(parts) {
      csvText = String(parts[0]);
    },
    URL: {
      createObjectURL() { return "blob:test"; },
      revokeObjectURL() {},
    },
    document: {
      body: { appendChild() {} },
      createElement() { return anchor; },
    },
  });

  const rows = vm.runInContext(`[
    {caseId: "A", displayCase: "C1", selectionMethodCount: 2, selectionMethods: ["Energinet", "RX hull"], hidden: false},
    {caseId: "M", displayCase: "C5", selectionMethodCount: 0, selectionMethods: [], hidden: true},
  ]`, context);
  api.downloadSelectedCsv(rows);
  const lines = csvText.split("\n");
  assert.equal(lines[0], "case_id,display_case,Selection Method Count,Selection Methods,status");
  assert.equal(lines[1], '"A","C1",2,"Energinet; RX hull","visible"');
  assert.equal(lines[2], '"M","C5",0,"","hidden_by_case_parts"');
});

test("selected-case display adds the method count without changing the locator ID", () => {
  const { api } = loadSelectionBridge();
  const html = api.renderSelectedRows([
    { caseId: "internal-A", displayCase: "C1", selectionMethodCount: 3, hidden: false },
  ]);
  assert.match(html, /C1 \(3\)/);
  assert.match(html, /data-locator-case="internal-A"/);
  assert.doesNotMatch(html, /data-locator-case="internal-A \(3\)"/);
});

test("X/R gradient is symmetric in X and stronger at low R and high |X|", () => {
  const { api } = loadExportButton();
  const svg = decodeURIComponent(api.rxGradientImageSource([1, 5], [-4, 4]).split(",", 2)[1]);
  assert.match(svg, /linearGradient id="rx-r-strength"/);
  assert.match(svg, /linearGradient id="rx-x-strength"/);
  assert.match(svg, /fill="#edf7f1"/);
  assert.match(svg, /stop-color="#d45b62"/);
  assert.doesNotMatch(svg, /width="1\.1"/);
  const xSection = svg.match(/id="rx-x-strength"[\s\S]*?<\/linearGradient>/)[0];
  const xOpacities = Array.from(xSection.matchAll(/stop-opacity="([0-9.]+)"/g)).map((match) => Number(match[1]));
  assert.ok(xOpacities[0] > xOpacities[3]);
  assert.ok(xOpacities[0] >= 0.20);
  assert.ok(Math.abs(xOpacities[0] - xOpacities.at(-1)) < 0.002);
  const rSection = svg.match(/id="rx-r-strength"[\s\S]*?<\/linearGradient>/)[0];
  const rOpacities = Array.from(rSection.matchAll(/stop-opacity="([0-9.]+)"/g)).map((match) => Number(match[1]));
  assert.ok(rOpacities[0] > rOpacities[1]);
  assert.ok(rOpacities[0] >= 0.14);
});

test("X/R gradient uses the current visible range when one is available", () => {
  const { api } = loadExportButton();
  const gd = {
    _fullLayout: {
      xaxis: { range: [2, 4] },
      yaxis: { range: [-3, 3] },
    },
    data: [{ x: [0, 100], y: [-100, 100] }],
  };
  assert.deepEqual(Array.from(api.visibleAxisRange(gd, "xaxis", "x")), [2, 4]);
  assert.deepEqual(Array.from(api.visibleAxisRange(gd, "yaxis", "y")), [-3, 3]);
});

test("X/R gradient strength is adjustable, bounded, and retained per chart", () => {
  const { context, api } = loadExportButton();
  const peakOpacity = (svg, gradientId) => {
    const section = svg.match(new RegExp(`id="${gradientId}"[\\s\\S]*?<\\/linearGradient>`))[0];
    return Math.max(...Array.from(section.matchAll(/stop-opacity="([0-9.]+)"/g), (match) => Number(match[1])));
  };
  const low = decodeURIComponent(api.rxGradientImageSource([1, 5], [-4, 4], 50).split(",", 2)[1]);
  const medium = decodeURIComponent(api.rxGradientImageSource([1, 5], [-4, 4], 160).split(",", 2)[1]);
  const high = decodeURIComponent(api.rxGradientImageSource([1, 5], [-4, 4], 250).split(",", 2)[1]);

  assert.ok(peakOpacity(low, "rx-x-strength") < peakOpacity(medium, "rx-x-strength"));
  assert.ok(peakOpacity(medium, "rx-x-strength") < peakOpacity(high, "rx-x-strength"));
  assert.ok(peakOpacity(high, "rx-x-strength") <= 0.5);
  assert.equal(api.normalizeRxGradientStrength(0), 50);
  assert.equal(api.normalizeRxGradientStrength(254), 250);
  assert.equal(api.normalizeRxGradientStrength(Number.NaN), 160);

  api.publishRxGradientState("data|chart", true, 210);
  assert.equal(api.readRxGradientStrength("data|chart"), 210);
  assert.equal(context.window.__fsRxGradientState["data|chart"], true);
  assert.equal(context.window.__fsRxGradientStrength["data|chart"], 210);
});

test("selection bridge applies the saved strength to the R/X plot", () => {
  const { context, api } = loadSelectionBridge();
  const applied = [];
  context.window.__fsRxGradientStrength = { "data|chart": 230 };
  context.window.__fsRxGradientController = {
    applyToPlot(plot, enabled, strength) {
      applied.push({ plot, enabled, strength });
    },
  };
  const gd = { layout: { meta: { rx_single_trace: { enabled: true } } } };
  const ctx = { dataId: "data", chartId: "chart" };

  api.applyRxGradientToPlot(ctx, gd, true, api.rxGradientStrengthForState("data|chart"));
  assert.equal(applied.length, 1);
  assert.equal(applied[0].plot, gd);
  assert.equal(applied[0].enabled, true);
  assert.equal(applied[0].strength, 230);
});

test("X/R gradient toggles the Plotly image without changing the point data", async () => {
  const { api } = loadExportButton();
  const relayouts = [];
  const gd = {
    layout: {
      xaxis: { range: [1, 5] },
      yaxis: { range: [-4, 4] },
      images: [{ name: "existing-image" }],
    },
    _fullLayout: {
      xaxis: { range: [1, 5] },
      yaxis: { range: [-4, 4] },
    },
    data: [{ x: [2], y: [-1] }],
    ownerDocument: { defaultView: { Plotly: {
      relayout(plot, payload) {
        relayouts.push(payload);
        plot.layout.images = payload.images;
        return Promise.resolve();
      },
    } } },
  };
  const originalData = JSON.stringify(gd.data);

  await api.applyRxGradientToPlot(gd, true, 100);
  assert.equal(relayouts.at(-1).images.length, 2);
  assert.equal(relayouts.at(-1).images[1].name, "__fs_rx_gradient__");
  const firstGradient = relayouts.at(-1).images[1].source;
  await api.applyRxGradientToPlot(gd, true, 200);
  assert.equal(relayouts.at(-1).images.length, 2);
  assert.notEqual(relayouts.at(-1).images[1].source, firstGradient);
  assert.equal(JSON.stringify(gd.data), originalData);

  await api.applyRxGradientToPlot(gd, false);
  assert.deepEqual(Array.from(relayouts.at(-1).images), [{ name: "existing-image" }]);
});

test("scatter locator draws a single halo and crosshair at the current case point", () => {
  const { api } = loadSelectionBridge();
  const gd = {
    layout: {
      meta: { rx_single_trace: { enabled: true } },
      shapes: [{ name: "axis-zero", type: "line" }],
    },
    _fullLayout: {
      xaxis: { range: [0, 10] },
      yaxis: { range: [-5, 5] },
    },
    data: [{ meta: { kind: "points" }, ids: ["A", "B"], x: [2, 8], y: [-1, 3] }],
    ownerDocument: { defaultView: { Plotly: {
      relayout(plot, payload) {
        plot.layout.shapes = payload.shapes;
      },
    } } },
  };
  const ctx = {
    state: { rxHoverLocatorCase: "A", rxPinnedLocatorCase: "B" },
    caseById: new Map([["A", {}], ["B", {}]]),
  };

  api.updateScatterLocator(ctx, gd);
  const locatorShapes = gd.layout.shapes.filter((shape) => String(shape.name || "").startsWith("__fs_rx_locator_"));
  assert.equal(locatorShapes.length, 3);
  assert.equal(locatorShapes.find((shape) => shape.name === "__fs_rx_locator_vertical").x0, 2);
  assert.equal(locatorShapes.find((shape) => shape.name === "__fs_rx_locator_horizontal").y0, -1);

  ctx.state.rxHoverLocatorCase = "";
  api.updateScatterLocator(ctx, gd);
  assert.equal(gd.layout.shapes.find((shape) => shape.name === "__fs_rx_locator_vertical").x0, 8);
});
