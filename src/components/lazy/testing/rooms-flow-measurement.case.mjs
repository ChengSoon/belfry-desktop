import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, capturePanel, click, waitFor } from "./roomsQaFixture.mjs";

const PAGE = "src/components/lazy/testing/rooms-qa.html?attention=0&flow=untracked";
const graphReady = (nodes, edges) => `document.querySelectorAll('.react-flow__node').length === ${nodes}
  && [...document.querySelectorAll('.react-flow__node')].every(node => getComputedStyle(node).visibility === 'visible' && node.offsetWidth > 0 && node.offsetHeight > 0)
  && document.querySelectorAll('.react-flow__edge').length === ${edges}`;

async function openFlow(view, nodes = 5, edges = 4) {
  await waitFor(view, "!!document.querySelector('[role=tab]') && typeof window.qaSetActivity === 'function'");
  await click(view, '[role="tab"][id$="-trigger-flow"]');
  await waitFor(view, graphReady(nodes, edges));
}

async function settledViewport(view) {
  return view.cdp.evaluate(`new Promise((resolve, reject) => {
    let previous = '', stable = 0;
    const deadline = performance.now() + 10_000;
    const sample = () => {
      const transform = document.querySelector('.react-flow__viewport').style.transform;
      stable = transform === previous ? stable + 1 : 0;
      previous = transform;
      if (stable >= 6) return resolve(transform);
      if (performance.now() > deadline) return reject(new Error('Flow viewport did not settle'));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })`);
}

function queueInitialMeasurement() {
  // Test-only scheduling control. Locate the provider's store through React's
  // mounted tree, then deliver real ResizeObserver callbacks immediately before
  // the next controlled node batch is adopted. No dimensions/bounds are forged.
  const NativeObserver = window.ResizeObserver;
  const report = window.qaFlowMeasurement = { queued: [], delivered: false };
  const pending = [];
  let store;
  window.ResizeObserver = class extends NativeObserver {
    constructor(callback) {
      super((entries, observer) => {
        const nodes = entries.filter(entry => entry.target.classList.contains("react-flow__node"));
        if (!nodes.length || report.delivered) return callback(entries, observer);
        if (!store) {
          const host = document.querySelector(".react-flow");
          let fiber = host?.[Object.keys(host).find(key => key.startsWith("__reactFiber"))];
          while (fiber && !store) {
            if (typeof fiber.memoizedProps?.value?.getState === "function") store = fiber.memoizedProps.value;
            fiber = fiber.return;
          }
          if (!store) throw new Error("QA could not locate the mounted React Flow store");
          const adopt = store.getState().setNodes;
          store.setState({ setNodes(next) {
            if (!report.delivered && pending.length && next.find(node => node.id === "fe")?.data.status === "busy") {
              report.delivered = true;
              pending.splice(0).forEach(deliver => deliver());
              report.measured = [...store.getState().nodeLookup.values()].map(node => ({ id: node.id, ...node.measured }));
            }
            adopt(next);
          } });
        }
        pending.push(() => callback(entries, observer));
        report.queued = [...new Set([...report.queued, ...nodes.map(entry => entry.target.dataset.id)])];
      });
    }
  };
}

test("flow recovers when its first measurement precedes a pending activity update", async t => {
  const { view } = await browserFixture(t, PAGE, {
    beforeNavigate: view => view.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${queueInitialMeasurement})()` }),
  });
  await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
  await waitFor(view, "typeof window.qaSetActivity === 'function'");
  await view.cdp.evaluate("['t1','t2','t3'].forEach(id => qaSetActivity(id, 'idle')); qaSetActivity('t2', 'awaiting-choice')");
  await click(view, '[role="tab"][id$="-trigger-flow"]');
  await waitFor(view, "window.qaFlowMeasurement.queued.length === 5");
  await view.cdp.evaluate("qaSetActivity('t2', 'talking')");
  await waitFor(view, `${graphReady(5, 4)} && document.querySelectorAll('.room-flow-edge--animated').length === 1`);
  const measured = await view.cdp.evaluate("window.qaFlowMeasurement");
  assert.equal(measured.delivered, true, "the queued browser measurement ran before node adoption");
  assert.equal(measured.measured.length, 5);
  assert.ok(measured.measured.every(node => node.width === 232 && node.height === 64));
  t.diagnostic(JSON.stringify({ scheduledFlowMeasurement: measured }));
});

for (const theme of ["dark", "light"]) {
  test(`activity and locale updates keep measured flow nodes visible (${theme})`, async t => {
    const { view } = await browserFixture(t, `${PAGE}&theme=${theme}`);
    await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
    await openFlow(view);
    // Finish initial framing, then choose a user viewport through the real control.
    await settledViewport(view);
    await click(view, ".react-flow__controls-zoomout");
    const viewport = await settledViewport(view);
    await view.cdp.evaluate(`(() => {
      window.qaHiddenFlowNodes = [];
      window.qaOriginalFlowNodes = [...document.querySelectorAll('.react-flow__node')];
      window.qaFlowVisibilityObserver = new MutationObserver(records => {
        for (const record of records) {
          if (record.target.matches('.react-flow__node') && (record.target.style.visibility === 'hidden' || /visibility:\\s*hidden/.test(record.oldValue || ''))) {
            qaHiddenFlowNodes.push({ id: record.target.dataset.id, before: record.oldValue, after: record.target.getAttribute('style') });
          }
        }
      });
      qaFlowVisibilityObserver.observe(document.querySelector('.react-flow__nodes'), { subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true });
    })()`);
    await view.cdp.evaluate("['t1','t2','t3'].forEach(id => qaSetActivity(id, 'idle'))");
    await waitFor(view, `${graphReady(5, 4)} && document.querySelectorAll('.room-flow-node--busy, .room-flow-edge--animated').length === 0`);
    const idleViewport = await settledViewport(view);
    await view.cdp.evaluate("qaSetActivity('t2', 'talking')");
    await waitFor(view, `${graphReady(5, 4)} && document.querySelectorAll('.room-flow-edge--animated').length === 1`);
    const busyViewport = await settledViewport(view);
    // Waiting can reveal an attention card and resize the canvas. Its existing
    // fitView behavior is valid; compare the unchanged-size activity states above.
    await view.cdp.evaluate("qaSetActivity('t2', 'awaiting-choice')");
    await waitFor(view, `${graphReady(5, 4)} && document.querySelectorAll('.room-flow-node--waiting').length === 1`);
    assert.equal(await view.cdp.evaluate("document.querySelectorAll('.room-flow-edge--animated').length"), 0);
    await view.cdp.evaluate("qaSetActivity('t2', 'talking')");
    await waitFor(view, `${graphReady(5, 4)} && document.querySelectorAll('.room-flow-edge--animated').length === 1`);
    await view.cdp.evaluate("qaSetLocale('en')");
    await waitFor(view, `${graphReady(5, 4)} && document.querySelector('.react-flow__node[data-id=user]').textContent.includes('You')`);
    const visibility = await view.cdp.evaluate(`({ hidden: qaHiddenFlowNodes,
      sameNodes: qaOriginalFlowNodes.every(node => node === document.querySelector('.react-flow__node[data-id="' + node.dataset.id + '"]')) })`);
    await view.cdp.evaluate("qaFlowVisibilityObserver.disconnect()");
    assert.deepEqual(visibility.hidden, [], "data-only updates never hide an already measured node");
    assert.equal(visibility.sameNodes, true, "activity updates preserve mounted nodes");
    assert.equal(idleViewport, viewport, "idle activity preserves the user viewport");
    assert.equal(busyViewport, viewport, "busy activity preserves the user viewport");
    await capturePanel(view, `room-flow-measurement-${theme}`);
  });
}

function connectionGeometry() {
  const path = document.querySelector('.react-flow__edge[data-id="foreman->fe"] .react-flow__edge-path');
  const source = document.querySelector('.react-flow__node[data-id=foreman] [data-handleid=s-right]');
  const target = document.querySelector('.react-flow__node[data-id=fe] [data-handleid=t-left]');
  if (!path || !source || !target) return null;
  const point = length => {
    const p = path.getPointAtLength(length);
    return new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM());
  };
  const start = point(0), end = point(path.getTotalLength());
  const from = source.getBoundingClientRect(), to = target.getBoundingClientRect();
  return { start: Math.hypot(start.x - from.right, start.y - (from.y + from.height / 2)),
    end: Math.hypot(end.x - to.x, end.y - (to.y + to.height / 2)), path: path.getAttribute("d") };
}

test("flow remeasures resized nodes and handles member removal, return and room switches", async t => {
  const { view } = await browserFixture(t, PAGE);
  await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
  await openFlow(view);
  const before = await view.cdp.evaluate(`(${connectionGeometry})()`);
  await view.cdp.evaluate(`document.querySelector('.react-flow__node[data-id=foreman] .room-flow-node').style.width = '280px';
    document.querySelector('.react-flow__node[data-id=foreman] .room-flow-node').style.height = '80px';
    qaSetActivity('t2', 'idle')`);
  await waitFor(view, `${graphReady(5, 4)} && (() => { const edge = (${connectionGeometry})(); return edge && edge.start < 1 && edge.end < 1 && edge.path !== ${JSON.stringify(before.path)}; })()`);
  await view.cdp.evaluate("qaSetActivity('t2', 'talking')");
  await waitFor(view, "document.querySelectorAll('.room-flow-edge--animated').length === 3");
  const resized = await view.cdp.evaluate(`(${connectionGeometry})()`);
  assert.ok(resized.start < 1 && resized.end < 1, "updated handles stay attached after the next data update");
  await view.cdp.evaluate("document.querySelector('.react-flow__node[data-id=qa] .room-flow-node').style.width = '300px'");
  await waitFor(view, "document.querySelector('.react-flow__node[data-id=qa]').offsetWidth === 300");
  await view.cdp.evaluate("qaSetMemberPresent('qa', false)");
  await waitFor(view, `${graphReady(4, 3)} && !document.querySelector('.react-flow__node[data-id=qa]')`);
  await view.cdp.evaluate("qaSetMemberPresent('qa', true)");
  await waitFor(view, `${graphReady(5, 4)} && document.querySelector('.react-flow__node[data-id=qa]').offsetWidth === 232`);
  await view.cdp.evaluate("qaSetMemberPresent('be', false, qaRoomIds[1])");
  await click(view, 'nav[aria-label="房间列表"] button:not([aria-current=true])');
  await openFlow(view, 4, 3);
  assert.equal(await view.cdp.evaluate("!!document.querySelector('.react-flow__node[data-id=be]')"), false);
  assert.equal(await view.cdp.evaluate("document.querySelector('.react-flow__node[data-id=foreman]').offsetWidth"), 232, "the next room measures its own DOM");
  await click(view, 'nav[aria-label="房间列表"] button:not([aria-current=true])');
  await openFlow(view);
  assert.equal(await view.cdp.evaluate("document.querySelector('.react-flow__node[data-id=foreman]').offsetWidth"), 232);
  const returned = await view.cdp.evaluate(`(${connectionGeometry})()`);
  assert.ok(returned.start < 1 && returned.end < 1, "room switches leave valid connection bounds");
  t.diagnostic(JSON.stringify({ flowGeometry: { before, resized, returned } }));
});
