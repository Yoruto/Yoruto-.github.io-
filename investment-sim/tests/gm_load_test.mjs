import assert from 'assert';
import { initGM } from '../js/core/gm.js';
import { createInitialState } from '../js/core/state.js';

const originalClipboard = globalThis.navigator?.clipboard;

async function run() {
  const oldState = createInitialState(1);
  oldState.companyCashWan = 123;
  oldState.year = 2001;
  oldState.month = 2;

  const importedState = createInitialState(99);
  importedState.companyCashWan = 9876;
  importedState.year = 2030;
  importedState.month = 11;

  let state = oldState;
  let renderCount = 0;
  let savedState = null;

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        readText: async () => JSON.stringify(importedState),
      },
    },
  });

  const gm = initGM({
    getState: () => state,
    importJson: (text) => JSON.parse(text),
    setState: (nextState) => { state = nextState; },
    saveAndRender: () => {
      savedState = state;
      renderCount += 1;
    },
  });

  const result = await gm.executeCommand('/load');

  assert.equal(result.ok, true, result.msg);
  assert.equal(state.companyCashWan, 9876, 'GM load should replace current state with imported save');
  assert.equal(state.year, 2030);
  assert.equal(state.month, 11);
  assert.equal(savedState, state, 'saveAndRender should persist the imported state');
  assert.equal(renderCount, 1, 'GM load should save/render exactly once');
}

run()
  .finally(() => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: originalClipboard },
    });
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
