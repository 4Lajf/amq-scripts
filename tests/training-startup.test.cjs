const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../amqPlusConnector.user.js'), 'utf8');
const code = source.slice(source.indexOf('let pendingTrainingStartup ='), source.indexOf('function endTrainingSession()'));

function harness() {
  const listeners = [], timers = new Map(), requests = [], messages = [];
  let nextTimer = 0, starts = 0;
  const jquery = { prop() { return this; }, html() { return this; }, modal() { return this; } };
  const context = {
    console: { log() {}, warn() {}, error() {} },
    $: () => jquery, trainingState: { authToken: 'test' }, API_BASE_URL: 'https://example.test',
    getConnectorVersion: () => '1.4.2.1', isConnectorVersionAtLeast: () => true,
    saveTrainingSettings() {}, resetCatchUpButton() {}, showTrainingStatus() {},
    showTrainingError() {}, endTrainingSession() { vm.runInContext('pendingTrainingStartup.cancel()', context); },
    sendSystemMessage: message => messages.push(message),
    createOrUpdateQuiz() {}, applyQuizToLobby() {},
    reconcilePlaylistWithAmq: (_, playlist) => ({ reconciledPlaylist: playlist, droppedSongs: [] }),
    lobby: { fireMainButtonEvent() { starts++; } }, socket: { sendCommand() {} },
    GM_xmlhttpRequest: request => requests.push(request),
    Listener: class {
      constructor(event, callback) { this.event = event; this.callback = callback; listeners.push(this); }
      bindListener() { this.bound = true; }
      unbindListener() { this.bound = false; }
    },
    setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout: timer => timers.delete(timer)
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return {
    context, messages, listeners, requests,
    get starts() { return starts; },
    start() { context.startTrainingSession('quiz', 1, { mode: 'auto' }); },
    ready(request = requests.at(-1)) {
      request.onload({ status: 200, responseText: JSON.stringify({ sessionId: 'session', quizName: 'test',
        totalSongs: 1, playlist: [{ annSongId: 1 }], command: { data: { quizSave: { name: 'test' } } } }) });
    },
    emit(event, payload) {
      // Simulate a duplicate already queued by AMQ even after unbinding.
      for (const listener of listeners.filter(l => l.event === event && l.bound)) {
        listener.callback(payload); listener.callback(payload);
      }
    },
    finish() {
      this.emit('save custom quiz', { success: true, quizId: 7, quizSave: { name: 'test' } });
      this.emit('custom quiz selected', { quizName: 'test' });
      this.emit('load custom quiz', { quizId: 7, quizSave: { ruleBlocks: [{ blocks: [{ annSongId: 1 }] }] } });
    },
    tick(delay) {
      for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); }
    }
  };
}

test('duplicate ready/save/select/load callbacks start only once', () => {
  const h = harness(); h.start(); h.ready(); h.ready(); h.finish(); h.tick(500); h.tick(5000);
  assert.equal(h.starts, 1);
  assert.equal(h.messages.filter(m => m.includes('Training quiz ready!')).length, 1);
  assert.equal(h.messages.filter(m => m.includes('Training quiz started:')).length, 1);
  assert.equal(h.listeners.filter(l => l.bound).length, 0);
});

test('retry cancels stale listeners and queued automatic start', () => {
  const h = harness(); h.start(); h.ready(); h.finish(); h.start(); h.tick(500);
  assert.equal(h.starts, 0);
  h.ready(); h.finish(); h.tick(500);
  assert.equal(h.starts, 1);
});

test('late response from replaced request cannot create a second startup', () => {
  const h = harness(); h.start(); const old = h.requests[0]; h.start(); h.ready(old);
  assert.equal(h.listeners.length, 0);
  h.ready(); h.finish(); h.tick(500); assert.equal(h.starts, 1);
});

test('verification timeout and late load cannot both start the quiz', () => {
  const h = harness(); h.start(); h.ready();
  h.emit('save custom quiz', { success: true, quizId: 7, quizSave: { name: 'test' } });
  h.emit('custom quiz selected', { quizName: 'test' });
  h.tick(5000);
  h.emit('load custom quiz', { quizId: 7 });
  h.tick(500); assert.equal(h.starts, 1);
});
