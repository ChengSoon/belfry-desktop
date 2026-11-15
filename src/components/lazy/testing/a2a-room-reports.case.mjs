import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, capturePanel, click, waitFor } from "./roomsQaFixture.mjs";

// Production React room/inbox components, served by the existing source UI
// fixture with synthetic IPC. The full app dist case is a2a-connections.case.mjs.
test("room tasks and inbox show only current exact-reference A2A reports and preserve the task board state", async t => {
  const { view } = await browserFixture(t, "src/components/lazy/testing/rooms-qa.html?attention=0&inbox=1&a2a=1&locale=en");
  await view.bounds({ x: 0, y: 0, width: 1440, height: 900 });
  await waitFor(view, "!!document.querySelector('.room-task-row')");
  await view.cdp.evaluate(`(() => {
    qaSetTaskGeneration('T2',7);
    const report = {taskRef:{kind:'room_task',roomId:qaRoomIds[0],id:'T2',generation:7},protocolTaskId:'room-protocol-task',state:'TASK_STATE_INPUT_REQUIRED',source:'localA2A',text:'Which login branch?',textTruncated:false,artifacts:[{artifactId:'draft',name:'Draft review',text:'Partial results',truncated:true}]};
    qaSetReports([report,
      {...report,taskRef:{...report.taskRef,generation:6},text:'OLD TASK RESULT MUST NOT APPEAR',state:'TASK_STATE_COMPLETED'},
      {...report,taskRef:{...report.taskRef,roomId:qaRoomIds[1]},text:'OTHER ROOM RESULT MUST NOT APPEAR'}]);
  })()`);
  await waitFor(view, "document.querySelector('.room-taskboard .a2a-task-report[data-task-generation=\"7\"]')?.textContent.includes('Which login branch')");
  const report = await view.cdp.evaluate("document.querySelector('.room-taskboard .a2a-task-report').innerText");
  assert.match(report, /Input required/); assert.match(report, /Preview truncated/); assert.match(report, /Partial results/);
  assert.doesNotMatch(report, /OLD TASK|OTHER ROOM/);
  const taskText = await view.cdp.evaluate("document.querySelector('.a2a-task-report').closest('.room-task-row').textContent");
  assert.match(taskText, /T2/); assert.doesNotMatch(taskText, /Completed/);
  await capturePanel(view, "a2a-room-input-and-artifact-preview");
  await click(view, "[data-room-inbox-tab]"); await click(view, ".room-inbox .inbox-session");
  await waitFor(view, "document.querySelectorAll('.inbox-message').length === 2");
  await waitFor(view, "!!document.querySelector('[data-entry=inbox-1] .a2a-task-report')");
  assert.equal(await view.cdp.evaluate("document.querySelector('[data-entry=inbox-1] .a2a-task-report').dataset.taskGeneration"), "7");
  assert.equal(await view.cdp.evaluate("!!document.querySelector('[data-entry=inbox-2] .a2a-task-report')"), false, "discussion without TaskRef is not assigned a guessed report");
  await capturePanel(view, "a2a-inbox-explicit-report");
  await view.cdp.evaluate("qaSetTaskGeneration('T2',8)");
  await waitFor(view, "!document.querySelector('.room-taskboard .a2a-task-report')");
  await waitFor(view, "!document.querySelector('.room-inbox .a2a-task-report')");
  assert.equal(await view.cdp.evaluate("qaCalls.some(call => /^a2a_(?:send|report|cancel)|^collab_inbox_(?:offer|prepare|begin|receipt|activate)/.test(call.command))"), false);
});
